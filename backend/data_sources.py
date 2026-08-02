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
import logging
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone

import httpx
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger("climate.data_sources")

_TIMEOUT = httpx.Timeout(25.0)
_HEADERS = {
    "User-Agent": "Climate-Intelligence-Dashboard/1.0 (climate monitoring demo)",
    "Accept": "application/json, text/csv, text/plain, application/xml",
}

_cache: dict = {}


def _cached(key: str, ttl_seconds: int, fetcher):
    now = time.time()
    hit = _cache.get(key)
    if hit and now - hit["ts"] < ttl_seconds:
        return hit["data"]
    data = fetcher()
    _cache[key] = {"ts": now, "data": data}
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
    r = httpx.get(
        "https://api.open-meteo.com/v1/forecast", params=params,
        timeout=httpx.Timeout(8.0), headers=_HEADERS,
    )
    r.raise_for_status()
    return r.json()


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
    """Open-Meteo як основне джерело, OpenWeatherMap як фолбек, якщо Open-Meteo заблокований з хостингу."""
    try:
        return _fetch_weather_openmeteo(lat, lon)
    except Exception as exc:
        logger.warning("Open-Meteo weather failed, falling back to OWM: %s", exc)
        api_key = os.getenv("OPENWEATHER_API_KEY", "").strip()
        if not api_key:
            raise
        return _fetch_weather_owm(lat, lon, api_key)


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
        day = (row.get("Day") or "").strip()
        raw = (row.get("Average of Church and White (2011) and UHSLC") or "").strip()
        if not raw:
            raw = (row.get("Church and White (2011)") or "").strip()
        if not day or not raw:
            continue
        try:
            value = float(raw)
        except ValueError:
            continue
        series.append({"date": day, "value": round(value, 2)})

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
        day = (row.get("Day") or "").strip()
        raw = (row.get("Annual average") or "").strip()
        if not raw:
            raw = (row.get("Monthly average") or "").strip()
        if not day or not raw:
            continue
        try:
            value = float(raw)
        except ValueError:
            continue
        series.append({"date": day, "value": round(value, 4)})

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
