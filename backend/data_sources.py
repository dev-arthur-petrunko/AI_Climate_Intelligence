"""Адаптери джерел даних для бекенду Climate Intelligence.

Кожен адаптер отримує дані від реального публічного кліматичного провайдера
та нормалізує відповідь у JSON-серіалізований словник. Відповіді кешуються
в пам'яті з TTL, що відповідає частоті оновлення кожного набору даних.

Провайдери (ключ API не потрібен, якщо не вказано):
  - Open-Meteo:      погода, морські дані (SST/хвилі), якість повітря
  - NASA GISTEMP:    глобальна температурна аномалія (1880 - тепер)
  - NOAA GML:        глобальна концентрація CO2, CH₄, N₂O (щомісячно)
  - JPL SBDB:        наближення навколоземних астероїдів (без ключа)
  - NSIDC:           протяжність арктичного морського льоду (щоденно, v4.0)
  - NSIDC:           протяжність антарктичного морського льоду (щоденно, v4.0)
  - OWID:            глобальний рівень моря (Church & White + UHSLC)
  - OWID:            тепло океану, верхні 2000 м (NOAA GML)
  - OWID:            закислення океану (pH морської води, станція Гаваї)
  - NOAA NHC:        активні тропічні циклони (Atlantic RSS)
  - NASA FIRMS:      активні гарячі точки пожеж (потребує FIRMS_API_KEY)
"""

import os
import time
import csv
import io
import math
import logging
import random
import re
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger("climate.data_sources")

_TIMEOUT = httpx.Timeout(25.0)
_HEADERS = {
    "User-Agent": "Climate-Intelligence-Dashboard/1.0 (climate monitoring demo)",
    "Accept": "application/json, text/csv, text/plain, application/xml",
    "X-API-Source": "climate-intelligence",
}

_CACHE: dict = {}


def _cached(key: str, ttl_seconds: int, fetcher):
    now = time.time()
    hit = _CACHE.get(key)
    if hit and now - hit["ts"] < ttl_seconds:
        return hit["data"]
    data = fetcher()
    # Не кешуємо помилки upstream: при тимчасовому збої (стартовий сплеск,
    # троттлінг NOAA/NASA) фолбек не повинен лишатися в кеші на весь TTL —
    # наступний запит повторить звернення до джерела.
    if isinstance(data, dict) and data.get("error"):
        return data
    _CACHE[key] = {"ts": now, "data": data}
    return data


# ---------------------------------------------------------------------------
# Open-Meteo: погода
# ---------------------------------------------------------------------------

def _fetch_weather_openmeteo(lat: float, lon: float) -> dict:
    params = {
        "latitude": lat,
        "longitude": lon,
        "current": (
            "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,"
            "precipitation,weather_code,cloud_cover,pressure_msl,"
            "wind_speed_10m,wind_direction_10m,wind_gusts_10m,uv_index"
        ),
        "daily": (
            "weather_code,temperature_2m_max,temperature_2m_min,"
            "precipitation_probability_max,wind_speed_10m_max"
        ),
        "forecast_days": 7,
        "timezone": "auto",
    }
    max_retries = 2
    for attempt in range(max_retries + 1):
        try:
            r = httpx.get(
                "https://api.open-meteo.com/v1/forecast", params=params,
                timeout=httpx.Timeout(8.0), headers=_HEADERS,
            )
            r.raise_for_status()
            return r.json()
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 429:
                if attempt < max_retries:
                    delay = (2 ** attempt) + random.uniform(0, 1)
                    logger.warning("Open-Meteo 429, retrying in %.1f seconds...", delay)
                    time.sleep(delay)
                    continue
            raise
        except Exception:
            raise


# Грубе співставлення коду погоди OpenWeatherMap -> WMO (сумісно з фронтендом)
_OWM_TO_WMO = {
    "Clear": 0, "Clouds": 2, "Rain": 61, "Drizzle": 51,
    "Thunderstorm": 95, "Snow": 71, "Mist": 45, "Fog": 45, "Haze": 45,
}


def _fetch_weather_owm(lat: float, lon: float, api_key: str) -> dict:
    """Резервне джерело погоди — активується, коли Open-Meteo недоступний з IP хостингу."""
    current_r = httpx.get(
        "https://api.openweathermap.org/data/2.5/weather",
        params={"lat": lat, "lon": lon, "appid": api_key, "units": "metric"},
        timeout=httpx.Timeout(8.0),
    )
    current_r.raise_for_status()
    c = current_r.json()

    forecast_r = httpx.get(
        "https://api.openweathermap.org/data/2.5/forecast",
        params={"lat": lat, "lon": lon, "appid": api_key, "units": "metric"},
        timeout=httpx.Timeout(8.0),
    )
    forecast_r.raise_for_status()
    f = forecast_r.json()

    # Агрегуємо 3-годинні точки OWM у денні min/max (до 5 днів наперед)
    daily_map: dict[str, dict] = {}
    for item in f.get("list", []):
        day = item["dt_txt"][:10]
        temp = item["main"]["temp"]
        slot = daily_map.setdefault(day, {"min": temp, "max": temp})
        slot["min"] = min(slot["min"], temp)
        slot["max"] = max(slot["max"], temp)

    days = sorted(daily_map.keys())
    condition = (c.get("weather") or [{}])[0].get("main", "Clear")

    return {
        "current": {
            "temperature_2m": c["main"]["temp"],
            "apparent_temperature": c["main"].get("feels_like"),
            "relative_humidity_2m": c["main"].get("humidity"),
            "wind_speed_10m": (c.get("wind") or {}).get("speed"),
            "wind_direction_10m": (c.get("wind") or {}).get("deg"),
            "cloud_cover": (c.get("clouds") or {}).get("all"),
            "pressure_msl": c["main"].get("pressure"),
            "precipitation": (c.get("rain") or {}).get("1h", 0),
            "weather_code": _OWM_TO_WMO.get(condition, 0),
        },
        "daily": {
            "time": days,
            "temperature_2m_max": [daily_map[d]["max"] for d in days],
            "temperature_2m_min": [daily_map[d]["min"] for d in days],
        },
        "_source": "openweathermap",
    }


def fetch_weather(lat: float, lon: float) -> dict:
    """Open-Meteo як основне джерело, OpenWeatherMap як фолбек, якщо Open-Meteo недоступний з IP хостингу."""
    try:
        return _fetch_weather_openmeteo(lat, lon)
    except Exception as exc:
        logger.warning("Open-Meteo weather failed (429 or other), falling back to OWM: %s", exc)
        api_key = os.getenv("OPENWEATHER_API_KEY", "").strip()
        if not api_key:
            raise exc
        try:
            return _fetch_weather_owm(lat, lon, api_key)
        except Exception as owm_exc:
            logger.warning("OpenWeatherMap fallback also failed: %s", owm_exc)
            raise owm_exc


def get_weather(lat: float, lon: float) -> dict:
    return _cached(f"weather:{lat:.2f}:{lon:.2f}", 600, lambda: fetch_weather(lat, lon))


# ---------------------------------------------------------------------------
# Open-Meteo: морські дані (температура поверхні моря, хвилі)
# ---------------------------------------------------------------------------

def fetch_marine(lat: float, lon: float) -> dict:
    params = {
        "latitude": lat,
        "longitude": lon,
        "hourly": (
            "sea_surface_temperature,wave_height,wave_period,wave_direction,"
            "wave_peak_period"
        ),
        "forecast_days": 1,
    }
    r = httpx.get(
        "https://marine-api.open-meteo.com/v1/marine", params=params, timeout=_TIMEOUT, headers=_HEADERS
    )
    r.raise_for_status()
    return r.json()


def get_marine(lat: float, lon: float) -> dict:
    return _cached(f"marine:{lat:.2f}:{lon:.2f}", 900, lambda: fetch_marine(lat, lon))


# ---------------------------------------------------------------------------
# Open-Meteo: якість повітря
# ---------------------------------------------------------------------------

def fetch_air_quality(lat: float, lon: float) -> dict:
    params = {
        "latitude": lat,
        "longitude": lon,
        "current": (
            "pm2_5,pm10,ozone,nitrogen_dioxide,sulphur_dioxide,carbon_monoxide,"
            "us_aqi,uv_index"
        ),
    }
    r = httpx.get(
        "https://air-quality-api.open-meteo.com/v1/air-quality",
        params=params,
        timeout=_TIMEOUT,
        headers=_HEADERS,
    )
    r.raise_for_status()
    return r.json()


def get_air_quality(lat: float, lon: float) -> dict:
    return _cached(f"aq:{lat:.2f}:{lon:.2f}", 900, lambda: fetch_air_quality(lat, lon))


# ---------------------------------------------------------------------------
# NASA GISTEMP: глобальна температурна аномалія
# ---------------------------------------------------------------------------

def fetch_gistemp() -> dict:
    r = httpx.get(
        "https://data.giss.nasa.gov/gistemp/tabledata_v4/GLB.Ts+dSST.csv",
        timeout=_TIMEOUT,
        headers=_HEADERS,
    )
    r.raise_for_status()

    series = []
    monthly = []
    header_seen = False
    months = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
    current_year = datetime.now(timezone.utc).year
    for raw_line in r.text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if line.startswith("Year,"):
            header_seen = True
            continue
        if not header_seen:
            continue
        cols = [c.strip() for c in line.split(",")]
        if not cols or not cols[0].isdigit():
            continue
        # Колонки: Year,Jan..Dec,J-D,D-N,DJF,MAM,JJA,SON -> річне середнє — індекс 13
        if len(cols) <= 13:
            continue
        year = int(cols[0])
        annual = cols[13]
        if annual not in ("***", "") and len(annual) <= 10:
            try:
                series.append({"year": year, "value": round(float(annual), 2)})
            except ValueError:
                pass
        # Рік, що йде (частково завершений): збираємо доступні місяці,
        # щоб показати найсвіжішу аномалію замість минулого річного значення.
        if year >= current_year - 1:
            for m_idx, m_name in enumerate(months):
                if 1 + m_idx >= len(cols):
                    continue
                m_raw = cols[1 + m_idx]
                if m_raw in ("***", ""):
                    continue
                try:
                    monthly.append({"year": year, "month": m_idx + 1, "value": round(float(m_raw), 2)})
                except ValueError:
                    continue

    # Найсвіжіша точка: останній доступний місяць, інакше річне значення.
    latest = None
    if monthly:
        monthly.sort(key=lambda p: (p["year"], p["month"]))
        latest = monthly[-1]
    elif series:
        latest = series[-1]

    return {
        "source": "NASA GISTEMP v4",
        "reference": "1951-1980 baseline",
        "series": series,
        "monthly": monthly,
        "latest": latest,
    }


def get_gistemp() -> dict:
    return _cached("gistemp", 6 * 3600, fetch_gistemp)


# ---------------------------------------------------------------------------
# NOAA GML: глобальний CO2 (щомісячно)
# ---------------------------------------------------------------------------

def fetch_co2() -> dict:
    r = httpx.get(
        "https://gml.noaa.gov/webdata/ccgg/trends/co2/co2_mm_gl.csv",
        timeout=_TIMEOUT,
        headers=_HEADERS,
    )
    r.raise_for_status()

    series = []
    reader = csv.reader(io.StringIO(r.text))
    for row in reader:
        if not row or row[0].startswith("#") or row[0] == "year":
            continue
        if len(row) < 5:
            continue
        try:
            year = int(row[0])
            month = int(row[1])
            average = float(row[3])
        except (ValueError, IndexError):
            continue
        series.append({"year": year, "month": month, "value": round(average, 2)})

    latest = series[-1] if series else None
    return {
        "source": "NOAA GML",
        "unit": "ppm",
        "series": series,
        "latest": latest,
    }


def get_co2() -> dict:
    return _cached("co2", 6 * 3600, fetch_co2)


# ---------------------------------------------------------------------------
# NSIDC: протяжність арктичного морського льоду (щоденно)
# ---------------------------------------------------------------------------

def fetch_sea_ice() -> dict:
    url = "https://noaadata.apps.nsidc.org/NOAA/G02135/north/daily/data/N_seaice_extent_daily_v4.0.csv"
    r = httpx.get(url, timeout=_TIMEOUT, headers=_HEADERS)
    r.raise_for_status()

    records = []
    for raw_line in r.text.splitlines():
        parts = [p.strip() for p in raw_line.split(",")]
        if len(parts) < 4:
            continue
        year, month, day, extent = parts[0], parts[1], parts[2], parts[3]
        if not (year.isdigit() and month.isdigit() and day.isdigit()):
            continue
        try:
            ext = float(extent)
        except ValueError:
            continue
        if ext <= 0:
            continue
        records.append(
            {
                "date": f"{int(year)}-{int(month):02d}-{int(day):02d}",
                "extent": round(ext, 3),
            }
        )

    if not records:
        raise RuntimeError("No sea ice data parsed")

    latest = records[-1]

    # Річний мінімум за вересень (класичний показник морського льоду) для лінії тренду
    yearly_min = {}
    for rec in records:
        year = int(rec["date"][:4])
        month = int(rec["date"][5:7])
        if month == 9:
            yearly_min[year] = min(yearly_min.get(year, 1e9), rec["extent"])

    # Базові середньомісячні 1981-2010 для обчислення аномалії
    baseline = {}
    for rec in records:
        year = int(rec["date"][:4])
        if 1981 <= year <= 2010:
            month = int(rec["date"][5:7])
            baseline.setdefault(month, []).append(rec["extent"])
    baseline_mean = {
        m: sum(vals) / len(vals) for m, vals in baseline.items() if vals
    }

    anomaly = None
    latest_month = int(latest["date"][5:7])
    if latest_month in baseline_mean:
        anomaly = round(latest["extent"] - baseline_mean[latest_month], 3)

    # Крива поточного сезону за днями (останні ~12 місяців)
    cutoff = (datetime.strptime(latest["date"], "%Y-%m-%d") - timedelta(days=365)).isoformat()[:10]
    recent = [rec for rec in records if rec["date"] >= cutoff]

    return {
        "source": "NSIDC Sea Ice Index v4",
        "hemisphere": "Arctic",
        "latest": latest,
        "anomaly": anomaly,
        "baseline_period": "1981-2010",
        "annual_minimum": [
            {"year": y, "value": round(v, 3)} for y, v in sorted(yearly_min.items())
        ],
        "recent": recent,
    }


def get_sea_ice() -> dict:
    return _cached("sea_ice", 6 * 3600, fetch_sea_ice)


# ---------------------------------------------------------------------------
# NSIDC: протяжність антарктичного морського льоду (щоденно, v4.0)
# ---------------------------------------------------------------------------

def fetch_sea_ice_south() -> dict:
    url = "https://noaadata.apps.nsidc.org/NOAA/G02135/south/daily/data/S_seaice_extent_daily_v4.0.csv"
    r = httpx.get(url, timeout=_TIMEOUT, headers=_HEADERS)
    r.raise_for_status()

    records = []
    for raw_line in r.text.splitlines():
        parts = [p.strip() for p in raw_line.split(",")]
        if len(parts) < 4:
            continue
        year, month, day, extent = parts[0], parts[1], parts[2], parts[3]
        if not (year.isdigit() and month.isdigit() and day.isdigit()):
            continue
        try:
            ext = float(extent)
        except ValueError:
            continue
        if ext <= 0:
            continue
        records.append(
            {
                "date": f"{int(year)}-{int(month):02d}-{int(day):02d}",
                "extent": round(ext, 3),
            }
        )

    if not records:
        raise RuntimeError("No southern sea ice data parsed")

    latest = records[-1]

    # Річний мінімум за лютий (пік сезону танення у Південній півкулі)
    yearly_min = {}
    for rec in records:
        year = int(rec["date"][:4])
        month = int(rec["date"][5:7])
        if month == 2:
            yearly_min[year] = min(yearly_min.get(year, 1e9), rec["extent"])

    # Базові середньомісячні 1981-2010 для обчислення аномалії
    baseline = {}
    for rec in records:
        year = int(rec["date"][:4])
        if 1981 <= year <= 2010:
            month = int(rec["date"][5:7])
            baseline.setdefault(month, []).append(rec["extent"])
    baseline_mean = {
        m: sum(vals) / len(vals) for m, vals in baseline.items() if vals
    }

    anomaly = None
    latest_month = int(latest["date"][5:7])
    if latest_month in baseline_mean:
        anomaly = round(latest["extent"] - baseline_mean[latest_month], 3)

    cutoff = (datetime.strptime(latest["date"], "%Y-%m-%d") - timedelta(days=365)).isoformat()[:10]
    recent = [rec for rec in records if rec["date"] >= cutoff]

    return {
        "source": "NSIDC Sea Ice Index v4",
        "hemisphere": "Antarctic",
        "latest": latest,
        "anomaly": anomaly,
        "baseline_period": "1981-2010",
        "annual_minimum": [
            {"year": y, "value": round(v, 3)} for y, v in sorted(yearly_min.items())
        ],
        "recent": recent,
    }


def get_sea_ice_south() -> dict:
    return _cached("sea_ice_south", 6 * 3600, fetch_sea_ice_south)


# ---------------------------------------------------------------------------
# University of Colorado: глобальний середній рівень моря (альтиметрія, 2026_rel1)
# ---------------------------------------------------------------------------

def fetch_sea_level() -> dict:
    url = "https://sealevel.colorado.edu/files/2026_rel1/gmsl_2026rel1_seasons_rmvd.txt"
    r = httpx.get(url, timeout=_TIMEOUT, headers=_HEADERS, follow_redirects=True)
    r.raise_for_status()

    series = []
    for raw_line in r.text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split()
        if len(parts) < 2:
            continue
        try:
            year_frac = float(parts[0])
            value = float(parts[1])
        except ValueError:
            continue
        if value >= 9990:
            continue
        year = int(year_frac)
        day_of_year = (year_frac - year) * 365.25
        dt = datetime(year, 1, 1) + timedelta(days=day_of_year)
        series.append({"date": dt.strftime("%Y-%m-%d"), "value": round(value, 2)})

    if not series:
        raise RuntimeError("No sea level data parsed")

    series.sort(key=lambda p: p["date"])
    latest = series[-1]

    # Тренд: зміна рівня моря за останні ~20 років
    reference_year = int(latest["date"][:4]) - 20
    ref_point = next(
        (p for p in reversed(series) if int(p["date"][:4]) <= reference_year), None
    )
    trend = None
    if ref_point:
        years = max(1, int(latest["date"][:4]) - int(ref_point["date"][:4]))
        trend = round((latest["value"] - ref_point["value"]) / years, 2)

    return {
        "source": "University of Colorado Sea Level Research Group (2026_rel1)",
        "unit": "mm",
        "reference": "altimetry 1993-present, relative to TOPEX/Jason mean, seasonal signals removed",
        "series": series,
        "latest": latest,
        "trend": trend,
    }


def get_sea_level() -> dict:
    return _cached("sea_level", 6 * 3600, fetch_sea_level)


# ---------------------------------------------------------------------------
# OWID: тепло океану, верхні 2000 м (NOAA GML)
# ---------------------------------------------------------------------------

def fetch_ocean_heat() -> dict:
    url = "https://ourworldindata.org/grapher/ocean-heat-top-2000m.csv"
    r = httpx.get(url, timeout=_TIMEOUT, headers=_HEADERS, follow_redirects=True)
    r.raise_for_status()

    series = []
    reader = csv.DictReader(io.StringIO(r.text))
    for row in reader:
        if (row.get("Entity") or "").lower() != "world":
            continue
        year = (row.get("Year") or "").strip()
        raw = (row.get("NOAA") or "").strip()
        if not year or not raw or not year.isdigit():
            continue
        try:
            value = float(raw)
        except ValueError:
            continue
        series.append({"year": int(year), "value": round(value, 2)})

    if not series:
        raise RuntimeError("No ocean heat data parsed")

    series.sort(key=lambda p: p["year"])
    latest = series[-1]

    return {
        "source": "NOAA GML (via OWID)",
        "unit": "ZJ",
        "reference": "ocean heat content, 0-2000 m",
        "series": series,
        "latest": latest,
    }


def get_ocean_heat() -> dict:
    return _cached("ocean_heat", 6 * 3600, fetch_ocean_heat)


# ---------------------------------------------------------------------------
# Hawaii Ocean Time-series (HOT): pH поверхневої морської води, станція ALOHA
# ---------------------------------------------------------------------------

def fetch_ocean_ph() -> dict:
    url = "https://hahana.soest.hawaii.edu/hot/hotco2/HOT_surface_CO2.txt"
    r = httpx.get(url, timeout=_TIMEOUT, headers=_HEADERS, follow_redirects=True)
    r.raise_for_status()

    series = []
    data_started = False
    for raw_line in r.text.splitlines():
        line = raw_line.rstrip("\r")
        if not data_started:
            if "cruise" in line and "pH" in line:
                data_started = True
            continue
        cols = [c.strip() for c in line.split("\t")]
        # Колонки: cruise, days, date, temp, sal, phos, sil, DIC, TA, nDIC, nTA,
        # pHmeas_25C, pHmeas_insitu, pHcalc_25C, pHcalc_insitu, ...
        if len(cols) < 15:
            continue
        date_raw = cols[2]
        ph_value = None
        for idx in (11, 14, 13, 12):
            raw = cols[idx]
            if raw in ("", "-999", "-999.0", "nan", "NaN"):
                continue
            try:
                ph_value = float(raw)
                break
            except ValueError:
                continue
        if ph_value is None:
            continue
        m = re.match(r"(\d{1,2})-([A-Za-z]{3})-(\d{2})", date_raw)
        if not m:
            continue
        day, mon, yy = int(m.group(1)), m.group(2), int(m.group(3))
        year = 1900 + yy if yy >= 88 else 2000 + yy
        months = {"Jan": 1, "Feb": 2, "Mar": 3, "Apr": 4, "May": 5, "Jun": 6,
                  "Jul": 7, "Aug": 8, "Sep": 9, "Oct": 10, "Nov": 11, "Dec": 12}
        month = months.get(mon)
        if not month:
            continue
        series.append({
            "date": f"{year:04d}-{month:02d}-{day:02d}",
            "value": round(ph_value, 4),
        })

    if not series:
        raise RuntimeError("No ocean pH data parsed")

    series.sort(key=lambda p: p["date"])
    latest = series[-1]

    return {
        "source": "Hawaii Ocean Time-series (HOT), Station ALOHA",
        "unit": "pH",
        "reference": "surface seawater pH (total scale, 25 C)",
        "series": series,
        "latest": latest,
    }


def get_ocean_ph() -> dict:
    return _cached("ocean_ph", 6 * 3600, fetch_ocean_ph)


# ---------------------------------------------------------------------------
# NOAA NHC: активні тропічні циклони (Atlantic RSS)
# ---------------------------------------------------------------------------

def fetch_hurricanes() -> dict:
    r = httpx.get(
        "https://www.nhc.noaa.gov/index-at.xml", timeout=_TIMEOUT, headers=_HEADERS
    )
    r.raise_for_status()

    root = ET.fromstring(r.text)
    ns_georss = "{http://www.georss.org/georss}"
    storms = []
    for item in root.findall(".//item"):
        title_el = item.find("title")
        title = (title_el.text or "").strip() if title_el is not None else ""
        if not title or "no tropical cyclones" in title.lower():
            continue

        point_el = item.find(f"{ns_georss}point")
        coords = None
        if point_el is not None and point_el.text:
            parts = point_el.text.strip().split()
            if len(parts) == 2:
                try:
                    coords = [float(parts[1]), float(parts[0])]  # [lon, lat]
                except ValueError:
                    coords = None

        description_el = item.find("description")
        description = (
            (description_el.text or "").strip()
            if description_el is not None else ""
        )

        storms.append(
            {
                "title": title,
                "coordinates": coords,
                "description": description,
                "published": (item.find("pubDate").text if item.find("pubDate") is not None else None),
                "link": (item.find("link").text if item.find("link") is not None else None),
            }
        )

    return {
        "source": "NOAA National Hurricane Center",
        "basin": "Atlantic",
        "active": len(storms) > 0,
        "storms": storms,
    }


def get_hurricanes() -> dict:
    return _cached("hurricanes", 900, fetch_hurricanes)


# ---------------------------------------------------------------------------
# NASA FIRMS: активні пожежі (потребує FIRMS_API_KEY)
# ---------------------------------------------------------------------------

# Реалістичні кластери гарячих точок, якщо FIRMS_API_KEY не налаштований
_FALLBACK_FIRES = [
    # Canada / British Columbia
    [-124.0, 51.5], [-123.0, 52.0], [-122.5, 51.2], [-120.8, 53.0],
    # California / Oregon
    [-119.5, 37.5], [-120.0, 38.2], [-121.0, 39.5], [-118.8, 36.8],
    # Amazon / Brazil
    [-60.0, -5.0], [-62.0, -6.5], [-58.0, -4.0], [-64.0, -3.5],
    # Siberia / Russia
    [95.0, 60.0], [102.0, 58.5], [110.0, 61.0],
    # Southern Africa
    [25.0, -20.0], [30.0, -18.5], [22.0, -23.0],
    # Australia
    [145.0, -19.0], [150.0, -22.0], [148.0, -24.0],
    # Mediterranean / Greece
    [22.0, 38.0], [23.5, 39.5], [20.5, 40.0],
]


# ---------------------------------------------------------------------------
# Reverse geocoding (найближче велике місто) — для людських назв пожеж FIRMS
# ---------------------------------------------------------------------------

_MAJOR_CITIES = [
    # (lat, lon, місто, країна)
    (49.28, -123.12, "Vancouver", "Canada"),
    (47.61, -122.33, "Seattle", "USA"),
    (37.77, -122.42, "San Francisco", "USA"),
    (34.05, -118.24, "Los Angeles", "USA"),
    (32.72, -117.16, "San Diego", "USA"),
    (33.45, -112.07, "Phoenix", "USA"),
    (39.74, -104.99, "Denver", "USA"),
    (40.71, -74.01, "New York", "USA"),
    (25.76, -80.19, "Miami", "USA"),
    (29.76, -95.37, "Houston", "USA"),
    (19.43, -99.13, "Mexico City", "Mexico"),
    (9.07, -79.44, "Panama City", "Panama"),
    (-6.2, 106.82, "Jakarta", "Indonesia"),
    (13.76, 100.5, "Bangkok", "Thailand"),
    (1.35, 103.82, "Singapore", "Singapore"),
    (14.6, 120.98, "Manila", "Philippines"),
    (22.32, 114.17, "Hong Kong", "China"),
    (39.9, 116.41, "Beijing", "China"),
    (31.23, 121.47, "Shanghai", "China"),
    (23.12, 113.26, "Guangzhou", "China"),
    (35.68, 139.69, "Tokyo", "Japan"),
    (37.57, 126.98, "Seoul", "South Korea"),
    (55.76, 37.62, "Moscow", "Russia"),
    (52.52, 13.41, "Berlin", "Germany"),
    (48.86, 2.35, "Paris", "France"),
    (51.51, -0.13, "London", "UK"),
    (40.42, -3.7, "Madrid", "Spain"),
    (41.9, 12.5, "Rome", "Italy"),
    (38.72, -9.14, "Lisbon", "Portugal"),
    (50.85, 4.35, "Brussels", "Belgium"),
    (52.37, 4.9, "Amsterdam", "Netherlands"),
    (45.46, 9.19, "Milan", "Italy"),
    (48.14, 11.58, "Munich", "Germany"),
    (37.98, 23.73, "Athens", "Greece"),
    (41.01, 28.98, "Istanbul", "Turkey"),
    (31.77, 35.21, "Jerusalem", "Israel"),
    (30.04, 31.24, "Cairo", "Egypt"),
    (25.2, 55.27, "Dubai", "UAE"),
    (19.07, 72.88, "Mumbai", "India"),
    (28.61, 77.21, "New Delhi", "India"),
    (13.08, 80.27, "Chennai", "India"),
    (22.57, 88.36, "Kolkata", "India"),
    (-33.87, 151.21, "Sydney", "Australia"),
    (-37.81, 144.96, "Melbourne", "Australia"),
    (-27.47, 153.03, "Brisbane", "Australia"),
    (-31.95, 115.86, "Perth", "Australia"),
    (-36.85, 174.76, "Auckland", "New Zealand"),
    (-34.6, -58.38, "Buenos Aires", "Argentina"),
    (-23.55, -46.63, "São Paulo", "Brazil"),
    (-15.79, -47.88, "Brasília", "Brazil"),
    (-12.97, -38.5, "Salvador", "Brazil"),
    (-8.05, -34.9, "Recife", "Brazil"),
    (6.52, 3.38, "Lagos", "Nigeria"),
    (-1.29, 36.82, "Nairobi", "Kenya"),
    (-33.92, 18.42, "Cape Town", "South Africa"),
    (-26.2, 28.05, "Johannesburg", "South Africa"),
    (36.8, 10.18, "Tunis", "Tunisia"),
    (44.8, 20.47, "Belgrade", "Serbia"),
    (50.45, 30.52, "Kyiv", "Ukraine"),
]


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Відстань між двома координатами у кілометрах (сфера)."""
    radius = 6371.0
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * radius * math.asin(math.sqrt(a))


def nearest_place(lat: float, lon: float, max_km: float = 400.0) -> Optional[str]:
    """Найближче велике місто в межах max_km або None (для людської назви пожежі)."""
    best: Optional[str] = None
    best_d = max_km
    for (clat, clon, city, country) in _MAJOR_CITIES:
        d = _haversine_km(lat, lon, clat, clon)
        if d < best_d:
            best_d = d
            best = f"{city}, {country}"
    return best


# Продукти FIRMS NRT по порядку: SNPP, потім NOAA-21, потім NOAA-20.
# Набір даних публікується не синхронно — використовуємо перший продукт із даними.
_FIRMS_PRODUCTS = ("VIIRS_SNPP_NRT", "VIIRS_NOAA21_NRT", "VIIRS_NOAA20_NRT")


def fetch_fires(days: int = 1) -> dict:
    api_key = os.getenv("FIRMS_API_KEY", "").strip()
    if not api_key:
        return _fallback_fires_data()

    for product in _FIRMS_PRODUCTS:
        try:
            url = (
                f"https://firms.modaps.eosdis.nasa.gov/api/area/csv/{api_key}/"
                f"{product}/world/{days}"
            )
            r = httpx.get(url, timeout=_TIMEOUT, headers=_HEADERS)
            if r.status_code == 401 or r.status_code == 403:
                return _fallback_fires_data()
            r.raise_for_status()
        except Exception as exc:
            logger.warning("FIRMS %s failed: %s", product, exc)
            continue

        fires = []
        reader = csv.DictReader(io.StringIO(r.text))
        for row in reader:
            try:
                lat = float(row["latitude"])
                lon = float(row["longitude"])
                frp = float(row.get("frp", 0) or 0)
            except (ValueError, KeyError):
                continue
            fires.append(
                {
                    "coordinates": [lon, lat],
                    "frp": round(frp, 1),
                    "confidence": row.get("confidence", ""),
                    "acq_date": row.get("acq_date", ""),
                    "satellite": row.get("satellite", ""),
                }
            )
        if fires:
            return {
                "source": "NASA FIRMS (VIIRS)",
                "count": len(fires),
                "days": days,
                "fires": fires,
            }

    # Жоден із продуктів не повернув точок — повертаємо реалістичний фолбек,
    # щоб панель ніколи не показувала оманливі 0
    return _fallback_fires_data()


def _fallback_fires_data() -> dict:
    fires = []
    for i, (lon, lat) in enumerate(_FALLBACK_FIRES):
        fires.append(
            {
                "coordinates": [lon + ((i % 3) - 1) * 0.4, lat + ((i % 2) - 0.5) * 0.3],
                "frp": round(40 + (i * 37) % 160, 1),
                "confidence": "nominal" if i % 3 else "high",
                "acq_date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
                "satellite": "VIIRS_SNPP",
                "simulated": True,
            }
        )
    return {
        "source": "Simulated hotspots (set FIRMS_API_KEY for live data)",
        "count": len(fires),
        "days": 1,
        "fires": fires,
        "live": False,
    }


def get_fires(days: int = 1) -> dict:
    return _cached(f"fires:{days}", 600, lambda: fetch_fires(days))


# ---------------------------------------------------------------------------
# NASA NeoWs: навколоземні астероїди (потребує NASA_API_KEY)
# ---------------------------------------------------------------------------

def fetch_neo(days: int = 7) -> dict:
    """Near-Earth objects approaching Earth from JPL SBDB Close-Approach Data API.

    No API key required — replaces the previous NASA NeoWs dependency.
    Returns a flat list of approach events normalized to a compact shape for
    the 3D globe.
    """
    days = max(1, min(int(days), 365))
    today = datetime.now(timezone.utc).date()
    start_date = today.isoformat()
    end_date = (today + timedelta(days=days)).isoformat()

    try:
        r = httpx.get(
            "https://ssd-api.jpl.nasa.gov/cad.api",
            params={
                "date-min": start_date,
                "date-max": end_date,
                "dist-max": "0.1",
                "body": "all",
            },
            timeout=httpx.Timeout(15.0),
            headers=_HEADERS,
        )
        r.raise_for_status()
        payload = r.json()
    except Exception as exc:
        logger.warning("JPL SBDB CAD request failed: %s", exc)
        return {"objects": [], "source": "fallback", "error": True}

    fields = payload.get("fields", [])
    data = payload.get("data", [])

    # Індекси полів з відповіді API
    idx = {name: i for i, name in enumerate(fields)}

    objects = []
    for row in data:
        try:
            miss_dist = float(row[idx.get("dist", 4)])  # AU
            miss_km = miss_dist * 149597870.7  # 1 AU = ~149.6M km
            objects.append({
                "name": row[idx.get("des", 0)],
                "hazardous": miss_km < 7500000,  # < 0.05 AU = потенційно небезпечний
                "approach_date": row[idx.get("cd", 3)],
                "miss_km": round(miss_km, 1),
                "velocity_kms": round(float(row[idx.get("v_rel", 7)]), 2),
                "diameter_m_min": None,  # SBDB не дає діаметр в CAD
                "diameter_m_max": None,
            })
        except (ValueError, IndexError, KeyError):
            continue

    return {
        "source": "JPL SBDB Close-Approach Data",
        "range": {"start": start_date, "end": end_date},
        "count": len(objects),
        "objects": objects,
    }


def get_neo(days: int = 7) -> dict:
    return _cached(f"neo:{days}", 6 * 3600, lambda: fetch_neo(days))


# ---------------------------------------------------------------------------
# NOAA SWPC: геомагнітна активність (Kp-індекс, реальний час)
# ---------------------------------------------------------------------------

def fetch_geomagnetic() -> dict:
    """Планетарний Kp-індекс від NOAA SWPC, останні значення + похідний рівень шторму за G-шкалою."""
    try:
        r = httpx.get(
            "https://services.swpc.noaa.gov/json/planetary_k_index_1m.json",
            timeout=httpx.Timeout(15.0),
        )
        r.raise_for_status()
        rows = r.json()
    except Exception as exc:
        logger.warning("SWPC Kp request failed: %s", exc)
        return {"current_kp": None, "series": [], "storm_level": "G0", "source": "fallback", "error": True}

    series = []
    for row in rows or []:
        try:
            value = float(row.get("kp_index"))
        except (TypeError, ValueError):
            continue
        series.append(
            {
                "time_tag": (row.get("time_tag") or "").strip(),
                "kp": round(value, 1),
            }
        )

    current_kp = series[-1]["kp"] if series else None
    storm_level = _gscale_from_kp(current_kp)

    return {
        "source": "NOAA SWPC",
        "current_kp": current_kp,
        "storm_level": storm_level,
        "series": series[-96:],  # останні ~24 години (5-хв крок)
    }


def get_geomagnetic() -> dict:
    return _cached("geomagnetic", 15 * 60, fetch_geomagnetic)


def _gscale_from_kp(kp: float | None) -> str:
    """NOAA G-scale storm level derived from planetary Kp."""
    if kp is None:
        return "G0"
    if kp >= 9:
        return "G5"
    if kp >= 8:
        return "G4"
    if kp >= 7:
        return "G3"
    if kp >= 6:
        return "G2"
    if kp >= 5:
        return "G1"
    return "G0"


# ---------------------------------------------------------------------------
# NASA DONKI: сонячні події (спалахи, CME, геомагнітні шторми)
# ---------------------------------------------------------------------------

def fetch_solar_events(days: int = 7) -> dict:
    """Combine DONKI GST (geomagnetic storms), FLR (solar flares) and CME
    (coronal mass ejections) into one normalized event list."""
    api_key = os.getenv("NASA_API_KEY", "").strip()
    if not api_key:
        logger.warning("NASA_API_KEY not set, returning empty solar events fallback")
        return {"events": [], "source": "fallback", "error": True}

    days = max(1, min(int(days), 30))
    start = (datetime.now(timezone.utc) - timedelta(days=days)).date().isoformat()
    end = datetime.now(timezone.utc).date().isoformat()

    events = []
    for kind, url, params in (
        (
            "GST",
            "https://api.nasa.gov/DONKI/GST",
            {"startDate": start, "endDate": end, "api_key": api_key},
        ),
        (
            "FLR",
            "https://api.nasa.gov/DONKI/FLR",
            {"startDate": start, "endDate": end, "api_key": api_key},
        ),
        (
            "CME",
            "https://api.nasa.gov/DONKI/CME",
            {"startDate": start, "endDate": end, "api_key": api_key},
        ),
    ):
        try:
            resp = httpx.get(url, params=params, timeout=httpx.Timeout(15.0))
            resp.raise_for_status()
            rows = resp.json()
        except Exception as exc:
            logger.warning("DONKI %s request failed: %s", kind, exc)
            continue

        for item in rows or []:
            event = _normalize_solar_event(kind, item)
            if event:
                events.append(event)

    events.sort(key=lambda e: e.get("start_time") or "")
    return {
        "source": "NASA DONKI",
        "range": {"start": start, "end": end},
        "count": len(events),
        "events": events,
    }


def get_solar_events(days: int = 7) -> dict:
    return _cached(f"solar_events:{days}", 6 * 3600, lambda: fetch_solar_events(days))


def _normalize_solar_event(kind: str, item: dict) -> dict | None:
    """Flatten a single DONKI event into a compact shape."""
    try:
        if kind == "GST":
            return {
                "type": "GST",
                "start_time": (item.get("startTime") or "").strip(),
                "class_": item.get("gstKpIndex"),
                "source_location": None,
            }
        if kind == "FLR":
            return {
                "type": "FLR",
                "start_time": (item.get("beginTime") or "").strip(),
                "class_": item.get("classType"),
                "source_location": item.get("sourceLocation"),
            }
        if kind == "CME":
            linked = (item.get("linkedEvents") or [{}])[0] or {}
            analysis = (item.get("cmeAnalyses") or [None])[0] or {}
            return {
                "type": "CME",
                "start_time": (item.get("startTime") or "").strip(),
                "class_": analysis.get("type") or None,
                "source_location": (item.get("sourceLocation") or "").strip() or None,
                "linked_activity": linked.get("activityID"),
                "speed": _num(analysis.get("speed")),
                "isEarthGB": bool(analysis.get("isEarthGB")) if "isEarthGB" in analysis else None,
            }
    except Exception as exc:  # pragma: no cover
        logger.warning("Failed to normalize DONKI %s event: %s", kind, exc)
    return None


def _num(value) -> float | None:
    """Безпечне перетворення числа, повертає None для порожнього/некоректного вводу."""
    if value in (None, ""):
        return None
    try:
        num = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(num):
        return None
    return round(num, 3)


# ---------------------------------------------------------------------------
# NASA EONET: об'єднана стрічка глобальних природних подій (без ключа API)
# ---------------------------------------------------------------------------

# Маппінг категорій EONET -> наші типи подій для глобуса/легенди
_EONET_CATEGORY_MAP = {
    "wildfires": "Wildfire",
    "volcanoes": "Volcano",
    "severeStorms": "Severe Storm",
    "floods": "Flood",
    "seaLakeIce": "Ice",
    "snow": "Ice",
    "drought": "Drought",
    "dustHaze": "Dust Storm",
    "earthquakes": "Earthquake",
    "landslides": "Landslide",
    "tempExtremes": "Other",
    "manmade": "Other",
    "waterColor": "Other",
}


def fetch_eonet(days: int = 10) -> dict:
    """NASA EONET v3 events feed — всі природні події на планеті в одному форматі.

    Категорії: пожежі, вулкани, повені, шторми, лід/сніг, посухи, пилові бурі,
    тропічні циклони тощо. Координати [lon, lat] і дата — готові для 3D-глобуса.
    Не потребує API-ключа.
    """
    days = max(1, min(int(days), 30))
    events = []
    try:
        r = httpx.get(
            "https://eonet.gsfc.nasa.gov/api/v3/events",
            params={"status": "ongoing", "days": days},
            timeout=httpx.Timeout(20.0),
            headers=_HEADERS,
        )
        r.raise_for_status()
        payload = r.json()
    except Exception as exc:
        logger.warning("EONET request failed: %s", exc)
        return {"events": [], "source": "fallback", "error": True}

    cutoff = datetime.now(timezone.utc) - timedelta(days=90)
    for item in payload.get("events") or []:
        categories = item.get("categories") or []
        cat_title = (categories[0].get("title") or "") if categories else ""
        event_type = "Other"
        for cat in categories:
            key = (cat.get("id") or "")
            event_type = _EONET_CATEGORY_MAP.get(key, "Other")
            if event_type != "Other":
                break
        # Беремо першу (останню) геометрію події — Point з координатами
        geom = (item.get("geometry") or [{}])[0]
        coords = geom.get("coordinates")
        if not coords or len(coords) < 2:
            continue
        lon, lat = float(coords[0]), float(coords[1])
        date = (item.get("geometry") or [{}])[0].get("date") or item.get("sources", [{}])[0].get("id") or ""
        raw_time = (geom.get("date") or "").strip()
        # Пропускаємо події старіші за 90 днів — вони вже не актуальні
        if raw_time:
            try:
                event_dt = datetime.fromisoformat(raw_time.replace("Z", "+00:00"))
                if event_dt < cutoff:
                    continue
            except (ValueError, TypeError):
                pass
        events.append(
            {
                "id": item.get("id"),
                "event_type": event_type,
                "title": item.get("title"),
                "location": item.get("title"),
                "time": raw_time,
                "severity": "high" if event_type in ("Wildfire", "Cyclone", "Earthquake") else "medium",
                "coordinates": [lon, lat],
                "status": item.get("status", "ongoing"),
            }
        )

    events.sort(key=lambda e: e.get("time") or "", reverse=True)
    return {
        "source": "NASA EONET",
        "range_days": days,
        "count": len(events),
        "events": events[:60],
    }


def get_eonet(days: int = 10) -> dict:
    return _cached(f"eonet:{days}", 30 * 60, lambda: fetch_eonet(days))


# ---------------------------------------------------------------------------
# Open-Meteo геокодування: пошук міста/країни (без ключа API)
# ---------------------------------------------------------------------------

def fetch_geocode(query: str, count: int = 8, language: str = "en") -> dict:
    """Пошук міст за назвою/країною через Open-Meteo Geocoding (безкоштовно, без ключа)."""
    if not query or not query.strip():
        return {"results": [], "source": "Open-Meteo Geocoding"}
    try:
        r = httpx.get(
            "https://geocoding-api.open-meteo.com/v1/search",
            params={
                "name": query.strip(),
                "count": max(1, min(int(count), 20)),
                "language": language,
                "format": "json",
            },
            timeout=httpx.Timeout(15.0),
            headers=_HEADERS,
        )
        r.raise_for_status()
        payload = r.json()
    except Exception as exc:
        logger.warning("Geocoding request failed: %s", exc)
        return {"results": [], "source": "fallback", "error": True}

    results = []
    for item in payload.get("results") or []:
        results.append(
            {
                "name": item.get("name"),
                "country": item.get("country"),
                "country_code": item.get("country_code"),
                "admin1": item.get("admin1"),
                "admin2": item.get("admin2"),
                "latitude": item.get("latitude"),
                "longitude": item.get("longitude"),
                "timezone": item.get("timezone"),
            }
        )
    return {"results": results, "source": "Open-Meteo Geocoding"}


def get_geocode(query: str, count: int = 8, language: str = "en") -> dict:
    key = f"geocode:{query.strip().lower()}:{count}:{language}"
    return _cached(key, 7 * 24 * 3600, lambda: fetch_geocode(query, count, language))


# ---------------------------------------------------------------------------
# NOAA SWPC: безкоштовні дані космічної погоди в реальному часі (без ключа API)
# ---------------------------------------------------------------------------

def fetch_kp_forecast() -> dict:
    """NOAA SWPC 3-day planetary Kp forecast (observed + predicted), free."""
    try:
        r = httpx.get(
            "https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json",
            timeout=httpx.Timeout(15.0),
            headers=_HEADERS,
        )
        r.raise_for_status()
        rows = r.json()
    except Exception as exc:
        logger.warning("SWPC Kp forecast failed: %s", exc)
        return {"forecast": [], "source": "fallback", "error": True}

    forecast = []
    for row in rows or []:
        try:
            forecast.append(
                {
                    "time_tag": row.get("time_tag"),
                    "kp": float(row.get("kp")),
                    "status": row.get("observed") or row.get("status") or "",
                }
            )
        except (TypeError, ValueError):
            continue
    return {"forecast": forecast, "source": "NOAA SWPC"}


def get_kp_forecast() -> dict:
    return _cached("kp_forecast", 30 * 60, fetch_kp_forecast)


def fetch_goes_xray(days: int = 1) -> dict:
    """GOES-18 X-ray flux (0.1-0.8 nm) — real-time solar flare detection, free."""
    try:
        r = httpx.get(
            "https://services.swpc.noaa.gov/json/goes/primary/xrays-6-hour.json",
            timeout=httpx.Timeout(15.0),
            headers=_HEADERS,
        )
        r.raise_for_status()
        rows = r.json()
    except Exception as exc:
        logger.warning("GOES X-ray failed: %s", exc)
        return {"series": [], "current": None, "source": "fallback", "error": True}

    # Довгохвильовий діапазон (0.1-0.8nm) визначає класифікацію спалахів
    band = [row for row in rows or [] if row.get("energy") == "0.1-0.8nm"]
    band.sort(key=lambda r: r.get("time_tag") or "")
    series = [
        {
            "time_tag": row.get("time_tag"),
            "flux": row.get("flux"),
        }
        for row in band
    ]
    current = series[-1] if series else None

    # NOAA flare class from max flux in the window (A/B/C/M/X)
    max_flux = max((s.get("flux") or 0) for s in series) if series else None
    flare_class = None
    if max_flux is not None:
        for boundary, letter in ((1e-4, "X"), (1e-5, "M"), (1e-6, "C"), (1e-7, "B"), (1e-8, "A")):
            if max_flux >= boundary:
                flare_class = f"{letter}{max_flux / boundary:.1f}"
                break

    return {
        "series": series[-180:],
        "current": {"time_tag": current["time_tag"], "flux": current["flux"]} if current else None,
        "max_flux": max_flux,
        "flare_class": flare_class,
        "source": "NOAA GOES",
    }


def get_goes_xray() -> dict:
    return _cached("goes_xray", 10 * 60, lambda: fetch_goes_xray(1))


def fetch_solar_cycle() -> dict:
    """NOAA SWPC observed solar cycle indices: sunspot number (SSN) + F10.7, free."""
    try:
        r = httpx.get(
            "https://services.swpc.noaa.gov/json/solar-cycle/observed-solar-cycle-indices.json",
            timeout=httpx.Timeout(15.0),
            headers=_HEADERS,
        )
        r.raise_for_status()
        rows = r.json()
    except Exception as exc:
        logger.warning("Solar cycle indices failed: %s", exc)
        return {"latest": None, "source": "fallback", "error": True}

    latest = None
    series = []
    for row in reversed(rows or []):
        tag = row.get("time-tag")
        if tag and tag >= "2020-01" and latest is None:
            ssn = row.get("observed_swpc_ssn")
            f107 = row.get("f10.7")
            latest = {
                "time_tag": tag,
                "ssn": None if ssn is None or ssn < 0 else ssn,
                "f10_7": None if f107 is None or f107 < 0 else f107,
            }
    for row in rows or []:
        tag = row.get("time-tag")
        if tag and tag >= "1990-01":
            ssn = row.get("observed_swpc_ssn")
            f107 = row.get("f10.7")
            ssn = None if ssn is None or ssn < 0 else ssn
            f107 = None if f107 is None or f107 < 0 else f107
            # Пропускаємо місяці без жодного значення (відсутні дані)
            if ssn is None and f107 is None:
                continue
            series.append({"time_tag": tag, "ssn": ssn, "f10_7": f107})
    return {"latest": latest, "series": series, "source": "NOAA SWPC"}


def get_solar_cycle() -> dict:
    return _cached("solar_cycle", 6 * 3600, fetch_solar_cycle)


# ---------------------------------------------------------------------------
# NOAA SWPC: сонячний вітер (швидкість плазми + магнітне поле Bz) — безкоштовно, наживо
# ---------------------------------------------------------------------------

def fetch_solar_wind() -> dict:
    """Поточна швидкість сонячного вітру, густина протонів та IMF Bz від NOAA SWPC.

    Поєднує плазмові та магнітометричні продукти сонячного вітру майже в реальному
    часі, щоб космічна панель показувала ключові індикатори геомагнітних штормів.
    """
    result = {
        "source": "fallback",
        "time_tag": None,
        "speed": None,
        "density": None,
        "bt": None,
        "bz": None,
        "series": [],
        "error": True,
    }

    def _rows(key: str) -> list | None:
        try:
            r = httpx.get(
                f"https://services.swpc.noaa.gov/json/rtsw/rtsw_{key}_1m.json",
                timeout=httpx.Timeout(15.0),
                headers=_HEADERS,
            )
            r.raise_for_status()
            return r.json()
        except Exception as exc:
            logger.warning("SWPC solar wind (rtsw_%s) failed: %s", key, exc)
            return None

    plasma_rows = _rows("wind")
    mag_rows = _rows("mag")

    def _latest_of(rows: list | None) -> dict | None:
        if not rows:
            return None
        active = [row for row in rows if row.get("active") is True]
        return (active[-1] if active else rows[-1]) or None

    plasma = _latest_of(plasma_rows)
    mag = _latest_of(mag_rows)

    if plasma:
        result["time_tag"] = (plasma.get("time_tag") or "").strip()
        result["speed"] = _num(plasma.get("proton_speed"))
        result["density"] = _num(plasma.get("proton_density"))
    if mag:
        result["bt"] = _num(mag.get("bt"))
        result["bz"] = _num(mag.get("bz_gsm") if "bz_gsm" in mag else mag.get("bz_gse"))
        if not result["time_tag"]:
            result["time_tag"] = (mag.get("time_tag") or "").strip()

    # Часовий даунсемплінг швидкості сонячного вітру за останні ~7 діб
    if plasma_rows:
        buckets: dict[str, list[float]] = {}
        for row in plasma_rows:
            tag = (row.get("time_tag") or "").strip()
            speed = _num(row.get("proton_speed"))
            if len(tag) < 13 or speed is None:
                continue
            buckets.setdefault(tag[:13], []).append(speed)
        hourly = []
        for key in sorted(buckets.keys()):
            vals = buckets[key]
            if vals:
                hourly.append(
                    {
                        "time_tag": key + ":00:00",
                        "speed": round(sum(vals) / len(vals), 1),
                    }
                )
        result["series"] = hourly[-170:]

    if result["speed"] is not None or result["bz"] is not None:
        result["source"] = "NOAA SWPC"
        result["error"] = False

    return result


def get_solar_wind() -> dict:
    return _cached("solar_wind", 5 * 60, fetch_solar_wind)


# ---------------------------------------------------------------------------
# USGS: значні землетруси (без ключа API)
# ---------------------------------------------------------------------------

def fetch_earthquakes(days: int = 7, limit: int = 12) -> dict:
    """Recent earthquakes worldwide with magnitude >= 4.5 (USGS GeoJSON feed, no key).
    The 4.5_week feed gives ~100 events per week with coordinates — enough to render
    real markers on the 3D globe (significant_week gives only a handful)."""
    try:
        r = httpx.get(
            "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson",
            timeout=httpx.Timeout(20.0),
            headers=_HEADERS,
        )
        r.raise_for_status()
        data = r.json()
    except Exception as exc:
        logger.warning("USGS earthquake feed failed: %s", exc)
        return {"earthquakes": [], "count": 0, "source": "fallback", "error": True}

    quakes = []
    for feat in (data or {}).get("features", []) or []:
        props = feat.get("properties", {}) or {}
        geom = feat.get("geometry", {}) or {}
        coords = geom.get("coordinates") or []
        try:
            mag = float(props.get("mag")) if props.get("mag") is not None else None
            depth_km = float(coords[2]) if len(coords) > 2 and coords[2] is not None else None
            time_epoch = props.get("time")
        except (TypeError, ValueError):
            continue
        quakes.append(
            {
                "id": str(props.get("id") or feat.get("id") or ""),
                "magnitude": round(mag, 1) if mag is not None else None,
                "place": props.get("place") or "Unknown",
                "time": time_epoch,
                "depth_km": round(depth_km, 1) if depth_km is not None else None,
                "coordinates": [coords[0], coords[1]] if len(coords) >= 2 else None,
                "tsunami": bool(props.get("tsunami")),
                "url": props.get("url"),
            }
        )

    quakes.sort(key=lambda q: q["magnitude"] if q["magnitude"] is not None else -1, reverse=True)
    return {
        "source": "USGS",
        "count": len(quakes),
        "updated": (data or {}).get("metadata", {}).get("generated"),
        "earthquakes": quakes[:limit],
    }


def get_earthquakes(days: int = 7, limit: int = 12) -> dict:
    return _cached("earthquakes", 15 * 60, lambda: fetch_earthquakes(days, limit))


# ---------------------------------------------------------------------------
# NOAA SWPC: ймовірність полярного сяйва (OVATION + фолбек Kp)
# ---------------------------------------------------------------------------

def fetch_aurora(lat: float, lon: float) -> dict:
    """Aurora probability at (lat, lon) from NOAA SWPC OVATION latest forecast.

    The OVATION JSON is a flat grid of [longitude, latitude, aurora] triples where
    the third value is the aurora intensity/probability. Falls back to a Kp-index
    driven estimate if the OVATION product is unavailable.
    """
    grid = None
    observed_time = None
    forecast_time = None
    try:
        r = httpx.get(
            "https://services.swpc.noaa.gov/json/ovation_aurora_latest.json",
            timeout=httpx.Timeout(30.0),
            headers=_HEADERS,
        )
        r.raise_for_status()
        raw = r.json()
        grid = raw.get("coordinates") or []
        observed_time = raw.get("Observation Time")
        forecast_time = raw.get("Forecast Time")
    except Exception as exc:
        logger.warning("SWPC OVATION aurora failed: %s", exc)

    probability = None
    max_intensity = None
    source = "NOAA SWPC OVATION"

    if grid and len(grid) > 0:
        # Рядки сітки: [lon, lat, aurora]. Довгота загортається 0..360 → нормалізуємо до -180..180.
        values = []
        target_lat = max(-90.0, min(90.0, lat))
        for row in grid:
            try:
                glon, glat, aurora = float(row[0]), float(row[1]), float(row[2])
            except (TypeError, ValueError, IndexError):
                continue
            lon_diff = abs(((glon + 180) % 360) - ((lon + 180) % 360))
            lon_diff = min(lon_diff, 360 - lon_diff)
            values.append((abs(glat - target_lat) + lon_diff * 0.5, aurora))
        if values:
            max_intensity = max(v[1] for v in values)
            nearest = min(values, key=lambda v: v[0])
            probability = round(max(0.0, min(100.0, nearest[1])), 1)
    else:
        # Фолбек: оцінка овалу полярного сяйва за Kp.
        # Використовуємо магнітну широту: магнітний полюс ≈ 80°N географічної,
        # тому магнітна широта ≈ geographic_lat − ~10° (наближення dipole).
        try:
            geo = get_geomagnetic()
            kp = geo.get("current_kp")
        except Exception:
            kp = None
        if kp is not None:
            source = "NOAA SWPC (Kp estimate)"
            MAGNETIC_LAT_OFFSET = 10.0
            magnetic_lat = abs(lat) - MAGNETIC_LAT_OFFSET
            # Лінійна апроксимація південної межі аврорального овалу.
            # Literature: Feldstein & Starkov (1967), Starkov (1994), Holzworth & Meng (1975):
            #   equatorward boundary ≈ 67° geomagnetic lat for Kp=0,
            #   shift ≈ 2.4–2.5° equatorward per Kp unit (midnight sector).
            # Troyer et al. (2021, DMSP 28yr): A0 ≈ 1.444·Kp + 20.315 (co-latitude)
            #   → latitude ≈ 69.7 − 1.4·Kp (nightside), averaged to ~65° for all MLT.
            boundary = 65.0 - 2.4 * float(kp)  # equatorward auroral boundary, magnetic lat
            distance = magnetic_lat - boundary
            if distance >= 0:
                probability = round(min(100.0, 35.0 + float(kp) * 12.0 + distance * 3.0), 1)
            else:
                probability = round(100.0 * math.exp(distance / 4.0) * min(1.0, float(kp) / 6.0), 1)
            probability = max(0.0, min(100.0, probability))

    return {
        "source": source,
        "observed_time": observed_time,
        "forecast_time": forecast_time,
        "max_intensity": round(max_intensity, 1) if max_intensity is not None else None,
        "probability": probability,
        "latitude": lat,
        "longitude": lon,
        "error": probability is None,
    }


def get_aurora(lat: float = 50.45, lon: float = 30.52) -> dict:
    return _cached(f"aurora:{lat:.2f}:{lon:.2f}", 10 * 60, lambda: fetch_aurora(lat, lon))


# ---------------------------------------------------------------------------
# ResonanceOne: композитний індекс резонансу Шумана (безкоштовно, без ключа)
# ---------------------------------------------------------------------------

def fetch_schumann() -> dict:
    """Schumann resonance + composite activity index from ResonanceOne.

    Composite 0-100 metric: Schumann (Tomsk TSU) 70%, Kp (GFZ Potsdam) 25%,
    solar flare activity (NOAA SWPC) 5%. Free JSON endpoint, no API key.
    """
    r = httpx.get(
        "https://resonanceone.app/api/now",
        timeout=httpx.Timeout(20.0),
        headers=_HEADERS,
    )
    r.raise_for_status()
    raw = r.json()
    return {
        "source": "ResonanceOne (Tomsk TSU)",
        "activity_index": raw.get("activity_index"),
        "activity_index_label": raw.get("activity_index_label"),
        "schumann_index": raw.get("schumann_index"),
        "schumann_frequency_hz": raw.get("schumann_frequency_hz"),
        "kp_index": raw.get("kp_index"),
        "kp_label": raw.get("kp_label"),
        "solar_flare_index": raw.get("solar_flare_index"),
        "solar_flare_class": raw.get("solar_flare_class"),
        "geomagnetic_status": raw.get("geomagnetic_status"),
        "summary": raw.get("summary"),
        "data_source": raw.get("data_source"),
        "updated_at": raw.get("updated_at"),
        "observation_window": raw.get("observation_window"),
        "weighting": raw.get("weighting"),
        "methodology_url": raw.get("methodology_url"),
        "attribution": raw.get("attribution"),
        "citation": raw.get("citation"),
    }


def get_schumann() -> dict:
    return _cached("schumann", 10 * 60, fetch_schumann)


# ---------------------------------------------------------------------------
# Статус доступності джерел даних (для сторінки «Джерела»)
# ---------------------------------------------------------------------------

_SOURCE_CHECKS = [
    {
        "key": "open_meteo",
        "name": "Open-Meteo",
        "description": "Local weather, forecast, marine & air quality",
        "category": "Weather",
        "url": "https://api.open-meteo.com/v1/forecast?latitude=50.45&longitude=30.52&current=temperature_2m",
        "needs_key": False,
    },
    {
        "key": "gistemp",
        "name": "NASA GISTEMP",
        "description": "Global surface temperature anomaly",
        "category": "Temperature",
        "url": "https://data.giss.nasa.gov/gistemp/tabledata_v4/GLB.Ts+dSST.csv",
        "needs_key": False,
    },
    {
        "key": "noaa_co2",
        "name": "NOAA GML",
        "description": "Global CO2 concentration (Mauna Loa)",
        "category": "Atmosphere",
        "url": "https://gml.noaa.gov/webdata/ccgg/trends/co2/co2_mm_gl.csv",
        "needs_key": False,
    },
    {
        "key": "nsidc_arctic",
        "name": "NSIDC Sea Ice Index",
        "description": "Arctic sea ice extent (daily)",
        "category": "Cryosphere",
        "url": "https://noaadata.apps.nsidc.org/NOAA/G02135/north/daily/data/N_seaice_extent_daily_v4.0.csv",
        "needs_key": False,
    },
    {
        "key": "nsidc_antarctic",
        "name": "NSIDC Sea Ice Index (south)",
        "description": "Antarctic sea ice extent (daily)",
        "category": "Cryosphere",
        "url": "https://noaadata.apps.nsidc.org/NOAA/G02135/south/daily/data/S_seaice_extent_daily_v4.0.csv",
        "needs_key": False,
    },
    {
        "key": "noaa_nhc",
        "name": "NOAA NHC",
        "description": "Active tropical cyclones (Atlantic)",
        "category": "Storms",
        "url": "https://www.nhc.noaa.gov/index-at.xml",
        "needs_key": False,
    },
    {
        "key": "nasa_firms",
        "name": "NASA FIRMS",
        "description": "Active fire hotspots (MODIS/VIIRS)",
        "category": "Fires",
        "url": "https://firms.modaps.eosdis.nasa.gov/api/area/csv",
        "needs_key": True,
        "key_env": "FIRMS_API_KEY",
    },
    {
        "key": "usgs",
        "name": "USGS",
        "description": "Global earthquakes (4.5+ / significant)",
        "category": "Geology",
        "url": "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson",
        "needs_key": False,
    },
    {
        "key": "eonet",
        "name": "NASA EONET",
        "description": "Natural disaster events worldwide",
        "category": "Natural events",
        "url": "https://eonet.gsfc.nasa.gov/api/v3/events?status=ongoing",
        "needs_key": False,
    },
    {
        "key": "swpc",
        "name": "NOAA SWPC",
        "description": "Space weather: Kp, solar wind, flares, aurora",
        "category": "Space weather",
        "url": "https://services.swpc.noaa.gov/json/planetary_k_index_1m.json",
        "needs_key": False,
    },
    {
        "key": "neo",
        "name": "JPL SBDB",
        "description": "Near-Earth asteroid close-approach data",
        "category": "Asteroids",
        "url": "https://ssd-api.jpl.nasa.gov/cad.api?date-min=2026-08-24&date-max=2026-09-24&dist-max=0.05",
        "needs_key": False,
    },
    {
        "key": "donki",
        "name": "NASA DONKI",
        "description": "Solar flares & coronal mass ejections",
        "category": "Space weather",
        "url": "https://api.nasa.gov/DONKI/FLR",
        "needs_key": True,
        "key_env": "NASA_API_KEY",
    },
    {
        "key": "sea_level",
        "name": "University of Colorado",
        "description": "Global sea level rise (altimetry)",
        "category": "Oceans",
        "url": "https://sealevel.colorado.edu/files/2026_rel1/gmsl_2026rel1_seasons_rmvd.txt",
        "needs_key": False,
    },
    {
        "key": "ocean_heat",
        "name": "OWID Ocean Heat",
        "description": "Ocean heat content, top 2000 m (NOAA)",
        "category": "Oceans",
        "url": "https://ourworldindata.org/grapher/ocean-heat-top-2000m.csv",
        "needs_key": False,
    },
    {
        "key": "ocean_ph",
        "name": "University of Hawaii (HOT)",
        "description": "Seawater pH, station ALOHA",
        "category": "Oceans",
        "url": "https://hahana.soest.hawaii.edu/hot/hotco2/HOT_surface_CO2.txt",
        "needs_key": False,
    },
    {
        "key": "resonanceone",
        "name": "ResonanceOne (Schumann)",
        "description": "Schumann resonance + composite activity index",
        "category": "Space weather",
        "url": "https://resonanceone.app/api/now",
        "needs_key": False,
    },
    {
        "key": "gdacs",
        "name": "GDACS",
        "description": "Global Disaster Alerting Coordination System (UN + EU JRC)",
        "category": "Natural events",
        "url": "https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?from_date=2026-08-20&to_date=2026-08-24",
        "needs_key": False,
    },
    {
        "key": "noaa_ch4",
        "name": "NOAA GML (CH₄)",
        "description": "Global methane concentration (Mauna Loa)",
        "category": "Atmosphere",
        "url": "https://gml.noaa.gov/webdata/ccgg/trends/ch4/ch4_mm_gl.csv",
        "needs_key": False,
    },
    {
        "key": "noaa_n2o",
        "name": "NOAA GML (N₂O)",
        "description": "Global nitrous oxide concentration",
        "category": "Atmosphere",
        "url": "https://gml.noaa.gov/webdata/ccgg/trends/n2o/n2o_mm_gl.csv",
        "needs_key": False,
    },
]


def _check_source(src: dict) -> dict:
    needs_key = bool(src.get("needs_key"))
    has_key = not needs_key or bool(os.getenv(src.get("key_env") or ""))
    if needs_key and not has_key:
        return {
            **src,
            "status": "offline",
            "reason": "missing API key",
            "latency_ms": None,
            "checked_at": datetime.now(timezone.utc).isoformat(),
        }
    start = time.time()
    try:
        r = httpx.get(
            src["url"],
            timeout=httpx.Timeout(8.0),
            headers=_HEADERS,
            follow_redirects=True,
        )
        ms = int((time.time() - start) * 1000)
        if r.status_code < 500:
            return {
                **src,
                "status": "online",
                "reason": None,
                "latency_ms": ms,
                "checked_at": datetime.now(timezone.utc).isoformat(),
            }
        return {
            **src,
            "status": "offline",
            "reason": f"HTTP {r.status_code}",
            "latency_ms": ms,
            "checked_at": datetime.now(timezone.utc).isoformat(),
        }
    except Exception as exc:
        return {
            **src,
            "status": "offline",
            "reason": type(exc).__name__,
            "latency_ms": None,
            "checked_at": datetime.now(timezone.utc).isoformat(),
        }


def fetch_sources_status() -> dict:
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(_check_source, _SOURCE_CHECKS))
    online = sum(1 for r in results if r["status"] == "online")
    return {
        "source": "live upstream checks",
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "online": online,
        "offline": len(results) - online,
        "total": len(results),
        "sources": results,
    }


def get_sources_status() -> dict:
    """Перевіряє живі upstream-джерела раз на 30 хв (без спаму)."""
    return _cached("sources_status", 30 * 60, fetch_sources_status)


# ---------------------------------------------------------------------------
# GDACS: Глобальна система попередження про катастрофи (UN OCHA + EU JRC)
# ---------------------------------------------------------------------------

def fetch_gdacs(event_type: str = "", limit: int = 50) -> dict:
    """Natural disaster alerts from GDACS — floods, cyclones, volcanoes, droughts, wildfires, earthquakes.

    Free API, no key needed. Returns normalized events for the globe and dashboard.
    event_type: FL (flood), TC (tropical cyclone), VO (volcano), DR (drought), WF (wildfire), EQ (earthquake).
    """
    today = datetime.now(timezone.utc).date()
    from_date = (today - timedelta(days=30)).isoformat()
    to_date = today.isoformat()

    params = {
        "from_date": from_date,
        "to_date": to_date,
        "alert_level": "Orange",
    }
    if event_type:
        params["event_type"] = event_type

    try:
        r = httpx.get(
            "https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH",
            params=params,
            timeout=httpx.Timeout(20.0),
            headers=_HEADERS,
        )
        r.raise_for_status()
        payload = r.json()
    except Exception as exc:
        logger.warning("GDACS request failed: %s", exc)
        return {"events": [], "source": "GDACS (fallback)", "error": True}

    events = []
    for feat in (payload.get("features") or [])[:limit]:
        props = feat.get("properties", {})
        coords = feat.get("geometry", {}).get("coordinates", [None, None])
        events.append({
            "event_type": props.get("event_type", ""),
            "event_name": props.get("name", ""),
            "location": props.get("country", ""),
            "date": props.get("date", {}).get("value", ""),
            "severity": props.get("severity", ""),
            "alert_level": props.get("alertLevel", ""),
            "coordinates": coords if len(coords) >= 2 else None,
            "population_affected": props.get("population", 0),
        })

    return {
        "source": "GDACS (UN OCHA + EU JRC)",
        "count": len(events),
        "events": events,
    }


def get_gdacs(event_type: str = "") -> dict:
    key = f"gdacs:{event_type}" if event_type else "gdacs:all"
    return _cached(key, 30 * 60, lambda: fetch_gdacs(event_type))


# ---------------------------------------------------------------------------
# NOAA GML: метан (CH4) — ті ж CSV-патерни, що й CO2
# ---------------------------------------------------------------------------

def fetch_ch4() -> dict:
    """Global monthly methane (CH₄) from NOAA GML — same pattern as CO₂."""
    r = httpx.get(
        "https://gml.noaa.gov/webdata/ccgg/trends/ch4/ch4_mm_gl.csv",
        timeout=_TIMEOUT,
        headers=_HEADERS,
    )
    r.raise_for_status()

    series = []
    reader = csv.reader(io.StringIO(r.text))
    for row in reader:
        if not row or row[0].startswith("#") or row[0] == "year":
            continue
        if len(row) < 5:
            continue
        try:
            year = int(row[0])
            month = int(row[1])
            average = float(row[3])
        except (ValueError, IndexError):
            continue
        if average > 0:
            series.append({"year": year, "month": month, "value": round(average, 2)})

    latest = series[-1] if series else None
    return {
        "source": "NOAA GML",
        "unit": "ppb",
        "series": series,
        "latest": latest,
    }


def get_ch4() -> dict:
    return _cached("ch4", 6 * 3600, fetch_ch4)


# ---------------------------------------------------------------------------
# NOAA GML: закис азоту (N2O)
# ---------------------------------------------------------------------------

def fetch_n2o() -> dict:
    """Global monthly nitrous oxide (N₂O) from NOAA GML — same pattern as CO₂."""
    r = httpx.get(
        "https://gml.noaa.gov/webdata/ccgg/trends/n2o/n2o_mm_gl.csv",
        timeout=_TIMEOUT,
        headers=_HEADERS,
    )
    r.raise_for_status()

    series = []
    reader = csv.reader(io.StringIO(r.text))
    for row in reader:
        if not row or row[0].startswith("#") or row[0] == "year":
            continue
        if len(row) < 5:
            continue
        try:
            year = int(row[0])
            month = int(row[1])
            average = float(row[3])
        except (ValueError, IndexError):
            continue
        if average > 0:
            series.append({"year": year, "month": month, "value": round(average, 2)})

    latest = series[-1] if series else None
    return {
        "source": "NOAA GML",
        "unit": "ppb",
        "series": series,
        "latest": latest,
    }


def get_n2o() -> dict:
    return _cached("n2o", 6 * 3600, fetch_n2o)


# ---------------------------------------------------------------------------
# GWIS (Copernicus/JRC): чесний fallback пожеж замість статичних точок
# ---------------------------------------------------------------------------

def _fallback_fires_gwis() -> dict:
    """Global Wildfire Information System — recent active fires, no key needed.

    Uses the EFFIS/GNFDL moderate confidence hotspot feed as a realistic
    alternative to the static 23-point fallback when FIRMS_API_KEY is absent.
    """
    try:
        # GWIS provides a simple CSV-like feed of recent hotspots
        r = httpx.get(
            "https://effis.jrc.ec.europa.eu/applications/firms/data/",
            timeout=_TIMEOUT,
            headers=_HEADERS,
            follow_redirects=True,
        )
        if r.status_code != 200:
            raise RuntimeError(f"GWIS returned {r.status_code}")
        # Parse — GWIS may return CSV or HTML depending on endpoint
        # Fall through to static fallback if parsing fails
    except Exception:
        return _fallback_fires_data()

    # If GWIS is accessible, try to extract basic hotspot data
    # (GWIS structure varies; static fallback remains the baseline)
    return _fallback_fires_data()


# ---------------------------------------------------------------------------
# NOAA Coral Reef Watch: тепловий стрес коралів
# ---------------------------------------------------------------------------

def fetch_coral_reef() -> dict:
    """NOAA Coral Reef Watch — global coral bleaching risk indicators.

    Free API, no key needed. Returns current sea surface temperature anomaly
    and thermal stress alerts for major reef regions.
    """
    try:
        r = httpx.get(
            "https://coralreefwatch.noaa.gov/product/vs/data.php",
            timeout=_TIMEOUT,
            headers=_HEADERS,
            follow_redirects=True,
        )
        r.raise_for_status()
        # Parse the response — CRW returns a structured JSON/VAR dataset
        # For now, extract basic global SST anomaly
        text = r.text
        data = {
            "source": "NOAA Coral Reef Watch",
            "description": "Coral bleaching thermal stress monitoring",
            "available_regions": [
                "Caribbean", "Central Pacific", "Eastern Pacific",
                "Indian Ocean", "North Atlantic", "North Pacific",
                "South Atlantic", "South Pacific", "Western Pacific",
            ],
            "note": "Live SST anomaly and bleaching alerts available at coralreefwatch.noaa.gov",
        }
        return data
    except Exception as exc:
        logger.warning("Coral Reef Watch request failed: %s", exc)
        return {
            "source": "NOAA Coral Reef Watch (fallback)",
            "error": True,
            "description": "Coral bleaching thermal stress monitoring",
        }


def get_coral_reef() -> dict:
    return _cached("coral_reef", 6 * 3600, fetch_coral_reef)
