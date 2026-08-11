"""Data source adapters for the Climate Intelligence backend.

Each adapter fetches from a real public climate data provider and normalizes
the response to a JSON-serializable dict. Responses are cached in-memory with
TTLs matched to how often each dataset changes.

Providers (no API key required unless noted):
  - Open-Meteo:      weather, marine (SST/waves), air quality
  - NASA GISTEMP:    global surface temperature anomaly (1880 - present)
  - NOAA GML:        global CO2 concentration (monthly)
  - NSIDC:           Arctic sea ice extent (daily, v4.0)
  - NSIDC:           Antarctic sea ice extent (daily, v4.0)
  - OWID:            global sea level rise (Church & White + UHSLC)
  - OWID:            ocean heat content, top 2000 m (NOAA GML)
  - OWID:            ocean acidification (seawater pH, Hawaii station)
  - NOAA NHC:        active tropical cyclones (Atlantic RSS)
  - NASA FIRMS:      active fire hotspots (requires FIRMS_API_KEY env var)
"""

import os
import time
import csv
import io
import math
import logging
import random
import xml.etree.ElementTree as ET
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
    _CACHE[key] = {"ts": now, "data": data}
    return data


# ---------------------------------------------------------------------------
# Open-Meteo: weather
# ---------------------------------------------------------------------------

def _fetch_weather_openmeteo(lat: float, lon: float) -> dict:
    params = {
        "latitude": lat,
        "longitude": lon,
        "current": (
            "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,"
            "precipitation,weather_code,cloud_cover,pressure_msl,"
            "wind_speed_10m,wind_direction_10m,wind_gusts_10m"
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
# Open-Meteo: marine (sea surface temperature, waves)
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
# Open-Meteo: air quality
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
# NASA GISTEMP: global temperature anomaly
# ---------------------------------------------------------------------------

def fetch_gistemp() -> dict:
    r = httpx.get(
        "https://data.giss.nasa.gov/gistemp/tabledata_v4/GLB.Ts+dSST.csv",
        timeout=_TIMEOUT,
        headers=_HEADERS,
    )
    r.raise_for_status()

    series = []
    header_seen = False
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
        # Columns: Year,Jan..Dec,J-D,D-N,DJF,MAM,JJA,SON -> annual mean is idx 13
        if len(cols) <= 13:
            continue
        annual = cols[13]
        if annual in ("***", ""):
            continue
        try:
            value = float(annual)
        except ValueError:
            continue
        series.append({"year": int(cols[0]), "value": round(value, 2)})

    latest = series[-1] if series else None
    return {
        "source": "NASA GISTEMP v4",
        "reference": "1951-1980 baseline",
        "series": series,
        "latest": latest,
    }


def get_gistemp() -> dict:
    return _cached("gistemp", 6 * 3600, fetch_gistemp)


# ---------------------------------------------------------------------------
# NOAA GML: global CO2 (monthly)
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
# NSIDC: Arctic sea ice extent (daily)
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

    # Annual September minimum (classic sea ice metric) for trend line
    yearly_min = {}
    for rec in records:
        year = int(rec["date"][:4])
        month = int(rec["date"][5:7])
        if month == 9:
            yearly_min[year] = min(yearly_min.get(year, 1e9), rec["extent"])

    # 1981-2010 baseline monthly means for anomaly computation
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

    # Current season daily curve (last ~12 months)
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
# NSIDC: Antarctic sea ice extent (daily, v4.0)
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

    # Annual February minimum (peak melt season in the Southern Hemisphere)
    yearly_min = {}
    for rec in records:
        year = int(rec["date"][:4])
        month = int(rec["date"][5:7])
        if month == 2:
            yearly_min[year] = min(yearly_min.get(year, 1e9), rec["extent"])

    # 1981-2010 baseline monthly means for anomaly computation
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
# OWID: global sea level rise (Church & White + UHSLC)
# ---------------------------------------------------------------------------

def fetch_sea_level() -> dict:
    url = "https://ourworldindata.org/grapher/sea-level.csv"
    r = httpx.get(url, timeout=_TIMEOUT, headers=_HEADERS, follow_redirects=True)
    r.raise_for_status()

    series = []
    reader = csv.DictReader(io.StringIO(r.text))
    for row in reader:
        if (row.get("Entity") or "").lower() != "world":
            continue
        month = (row.get("Month") or row.get("Day") or "").strip()
        raw = (row.get("Average of Church and White (2011) and UHSLC") or "").strip()
        if not raw:
            raw = (row.get("Church and White (2011)") or "").strip()
        if not month or not raw:
            continue
        try:
            value = float(raw)
        except ValueError:
            continue
        series.append({"date": month, "value": round(value, 2)})

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
        "source": "Church & White (2011) + UHSLC (OWID)",
        "unit": "mm",
        "reference": "mean sea level 1900-2000",
        "series": series,
        "latest": latest,
        "trend": trend,
    }


def get_sea_level() -> dict:
    return _cached("sea_level", 6 * 3600, fetch_sea_level)


# ---------------------------------------------------------------------------
# OWID: ocean heat content, top 2000 m (NOAA GML)
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
# OWID: ocean acidification (seawater pH, Hawaii station)
# ---------------------------------------------------------------------------

def fetch_ocean_ph() -> dict:
    url = "https://ourworldindata.org/grapher/seawater-ph.csv"
    r = httpx.get(url, timeout=_TIMEOUT, headers=_HEADERS, follow_redirects=True)
    r.raise_for_status()

    series = []
    reader = csv.DictReader(io.StringIO(r.text))
    for row in reader:
        if (row.get("Entity") or "").lower() != "hawaii":
            continue
        month = (row.get("Month") or row.get("Day") or "").strip()
        raw = (row.get("Annual average") or "").strip()
        if not raw:
            raw = (row.get("Monthly average") or "").strip()
        if not month or not raw:
            continue
        try:
            value = float(raw)
        except ValueError:
            continue
        series.append({"date": month, "value": round(value, 4)})

    if not series:
        raise RuntimeError("No ocean pH data parsed")

    series.sort(key=lambda p: p["date"])
    latest = series[-1]

    return {
        "source": "NOAA / OWID (Hawaii station)",
        "unit": "pH",
        "reference": "surface seawater pH (total scale)",
        "series": series,
        "latest": latest,
    }


def get_ocean_ph() -> dict:
    return _cached("ocean_ph", 6 * 3600, fetch_ocean_ph)


# ---------------------------------------------------------------------------
# NOAA NHC: active tropical cyclones (Atlantic RSS)
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
# NASA FIRMS: active fires (requires FIRMS_API_KEY)
# ---------------------------------------------------------------------------

# Realistic hotspot clusters used when FIRMS_API_KEY is not configured
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
    # (lat, lon, city, country)
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

# Париж залишається єдиним: видалено дублікат із пунктом 49.0/2.55


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


def fetch_fires(days: int = 1) -> dict:
    api_key = os.getenv("FIRMS_API_KEY", "").strip()
    if not api_key:
        return _fallback_fires_data()

    url = (
        f"https://firms.modaps.eosdis.nasa.gov/api/area/csv/{api_key}/"
        f"VIIRS_SNPP_NRT/world/{days}"
    )
    r = httpx.get(url, timeout=_TIMEOUT, headers=_HEADERS)
    if r.status_code == 401 or r.status_code == 403:
        return _fallback_fires_data()
    r.raise_for_status()

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

    return {
        "source": "NASA FIRMS (VIIRS)",
        "count": len(fires),
        "days": days,
        "fires": fires,
    }


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
# NASA NeoWs: near-Earth asteroids (requires NASA_API_KEY)
# ---------------------------------------------------------------------------

def fetch_neo(days: int = 7) -> dict:
    """Near-Earth objects approaching Earth from NASA NeoWs.

    The API allows a max range of 7 days per request. Returns a flat list of
    approach events normalized to a compact shape for the 3D globe.
    """
    api_key = os.getenv("NASA_API_KEY", "").strip()
    if not api_key:
        logger.warning("NASA_API_KEY not set, returning empty NEO fallback")
        return {"objects": [], "source": "fallback", "error": True}

    days = max(1, min(int(days), 7))
    today = datetime.now(timezone.utc).date()
    start_date = today.isoformat()
    end_date = (today + timedelta(days=days - 1)).isoformat()

    try:
        r = httpx.get(
            "https://api.nasa.gov/neo/rest/v1/feed",
            params={"start_date": start_date, "end_date": end_date, "api_key": api_key},
            timeout=httpx.Timeout(15.0),
        )
        r.raise_for_status()
        payload = r.json()
    except Exception as exc:
        logger.warning("NeoWs request failed: %s", exc)
        return {"objects": [], "source": "fallback", "error": True}

    objects = []
    for day_objects in (payload.get("near_earth_objects") or {}).values():
        for neo in day_objects or []:
            approach = (neo.get("close_approach_data") or [{}])[0]
            diameter = (neo.get("estimated_diameter") or {}).get("meters") or {}
            objects.append(
                {
                    "name": neo.get("name"),
                    "hazardous": bool(neo.get("is_potentially_hazardous_asteroid")),
                    "approach_date": (approach.get("close_approach_date_full") or "").strip(),
                    "miss_km": _num(approach.get("miss_distance", {}).get("kilometers")),
                    "velocity_kms": _num(
                        approach.get("relative_velocity", {}).get("kilometers_per_second")
                    ),
                    "diameter_m_min": _num(diameter.get("estimated_diameter_min")),
                    "diameter_m_max": _num(diameter.get("estimated_diameter_max")),
                }
            )

    return {
        "source": "NASA NeoWs",
        "range": {"start": start_date, "end": end_date},
        "count": len(objects),
        "objects": objects,
    }


def get_neo(days: int = 7) -> dict:
    return _cached(f"neo:{days}", 6 * 3600, lambda: fetch_neo(days))


# ---------------------------------------------------------------------------
# NOAA SWPC: geomagnetic activity (Kp index, real time)
# ---------------------------------------------------------------------------

def fetch_geomagnetic() -> dict:
    """Planetary Kp index from NOAA SWPC, latest values + derived G-scale storm level."""
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
# NASA DONKI: solar events (flares, CME, geomagnetic storms)
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
            return {
                "type": "CME",
                "start_time": (item.get("startTime") or "").strip(),
                "class_": (item.get("cmeAnalyses") or [{}])[0].get("type") if item.get("cmeAnalyses") else None,
                "source_location": linked.get("activityID"),
            }
    except Exception as exc:  # pragma: no cover
        logger.warning("Failed to normalize DONKI %s event: %s", kind, exc)
    return None


def _num(value) -> float | None:
    """Safe numeric conversion that returns None on empty/invalid input."""
    if value in (None, ""):
        return None
    try:
        return round(float(value), 3)
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------------------------
# NASA EONET: unified global natural events feed (no API key)
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
        events.append(
            {
                "id": item.get("id"),
                "event_type": event_type,
                "title": item.get("title"),
                "location": item.get("title"),
                "time": (geom.get("date") or "").strip(),
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
# Open-Meteo geocoding: city/country search (no API key)
# ---------------------------------------------------------------------------

def fetch_geocode(query: str, count: int = 8, language: str = "en") -> dict:
    """Search cities by name/country via Open-Meteo Geocoding (free, no key)."""
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
# NOAA SWPC: free real-time space weather (no API key)
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

    # Long-wavelength band (0.1-0.8nm) drives flare classification
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

    # NOAА flare class from max flux in the window (A/B/C/M/X)
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
    for row in reversed(rows or []):
        tag = row.get("time-tag")
        if tag and tag >= "2020-01":
            latest = {
                "time_tag": tag,
                "ssn": row.get("observed_swpc_ssn"),
                "f10_7": row.get("f10.7"),
            }
            break
    return {"latest": latest, "source": "NOAA SWPC"}


def get_solar_cycle() -> dict:
    return _cached("solar_cycle", 6 * 3600, fetch_solar_cycle)
