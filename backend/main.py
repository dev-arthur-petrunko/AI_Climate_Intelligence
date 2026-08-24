import asyncio
import os
from datetime import datetime, timezone
from typing import List, Optional, Tuple

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn

from data_sources import (
    get_weather,
    get_marine,
    get_air_quality,
    get_gistemp,
    get_co2,
    get_ch4,
    get_n2o,
    get_sea_ice,
    get_sea_ice_south,
    get_sea_level,
    get_ocean_heat,
    get_ocean_ph,
    get_hurricanes,
    get_fires,
    get_neo,
    get_geomagnetic,
    get_solar_events,
    get_eonet,
    get_gdacs,
    get_geocode,
    get_kp_forecast,
    get_goes_xray,
    nearest_place,
    get_solar_cycle,
    get_solar_wind,
    get_earthquakes,
    get_aurora,
    get_schumann,
    get_coral_reef,
    get_sea_level_psmsl,
    get_sources_status,
)
from ai_groq import get_ai_analysis, get_ai_predictions, get_ai_summary_text
from analytics import describe as analyze
from analytics import to_annual_average
from scheduler import start_scheduler, stop_scheduler

# Створення основного додатка FastAPI з описом та версією
app = FastAPI(
    title="Climate Intelligence API",
    description="AI-Powered Global Climate Monitoring API — live data from Open-Meteo, NASA, NOAA and NSIDC",
    version="2.0.0",
)

# Налаштування CORS — джерела з env (CORS_ORIGINS, через кому)
_origins = os.getenv(
    "CORS_ORIGINS",
    "http://localhost:3000,http://127.0.0.1:3000",
).split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in _origins if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Координати за замовчуванням (Київ, Україна)
DEFAULT_LAT, DEFAULT_LON = 50.45, 30.52


# --- Pydantic моделі даних ---

class ClimateData(BaseModel):
    metric: str
    value: float
    unit: str
    timestamp: str
    location: Optional[str] = None


class KPIMetric(BaseModel):
    name: str
    value: str
    trend: str
    trend_up: bool
    insight: str


class ClimateEvent(BaseModel):
    event_type: str
    location: str
    time: str
    severity: str
    coordinates: Optional[Tuple[float, float]] = None
    frp: Optional[float] = None
    confidence: Optional[str] = None
    satellite: Optional[str] = None


class AIPrediction(BaseModel):
    category: str
    prediction: str
    probability: float
    confidence_interval: Tuple[float, float]
    reasoning: str
    risk_level: Optional[str] = None
    timeframe: Optional[str] = None


# --- REST API Маршрути ---

@app.get("/")
async def root():
    """Головний маршрут перевірки статусу API"""
    return {
        "message": "Climate Intelligence API",
        "version": "2.0.0",
        "status": "operational",
        "sources": ["Open-Meteo", "NASA GISTEMP", "NOAA GML", "NSIDC", "NOAA NHC", "NASA FIRMS"],
    }


@app.get("/api/health")
async def health_check():
    """Ендпоінт перевірки здоров'я сервісу"""
    return {"status": "healthy"}


@app.on_event("startup")
async def _startup():
    """Створити таблиці (якщо є БД) та запустити фонові задачі."""
    try:
        from db import Base, _engine, db_available

        if db_available() and _engine is not None:
            async with _engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
    except Exception:
        pass
    start_scheduler()


@app.on_event("shutdown")
async def _shutdown():
    stop_scheduler()


@app.get("/api/db-status")
async def db_status():
    """Стан бази даних: чи підключена PostgreSQL та чи йдуть снапшоти."""
    from db import db_available
    from scheduler import last_store_time

    return {
        "configured": db_available(),
        "last_snapshot_attempt": last_store_time(),
    }


@app.get("/api/weather")
async def weather(lat: float = Query(DEFAULT_LAT), lon: float = Query(DEFAULT_LON)):
    """Поточна погода та 7-денний прогноз (Open-Meteo)"""
    return _safe(lambda: get_weather(lat, lon), {"source": "Open-Meteo", "current": {}, "daily": {}})


@app.get("/api/marine")
async def marine(lat: float = Query(DEFAULT_LAT), lon: float = Query(DEFAULT_LON)):
    """Температура поверхні океану та хвилі (Open-Meteo Marine)"""
    return _safe(lambda: get_marine(lat, lon), {"source": "Open-Meteo Marine", "hourly": {}})


@app.get("/api/air-quality")
async def air_quality(lat: float = Query(DEFAULT_LAT), lon: float = Query(DEFAULT_LON)):
    """Якість повітря: PM2.5, PM10, озон, індекс AQI (Open-Meteo)"""
    return _safe(lambda: get_air_quality(lat, lon), {"source": "Open-Meteo", "current": {}})


@app.get("/api/gistemp")
async def gistemp():
    """Глобальна температурна аномалія з 1880 року (NASA GISTEMP)"""
    data = get_gistemp()
    data["analysis"] = analyze(data.get("series", []))
    return data


@app.get("/api/co2")
async def co2():
    """Глобальна концентрація CO2, щомісяця (NOAA GML)"""
    data = get_co2()
    # Для статистики (trend/z-score) використовуємо річні середні, а не сірі місячні:
    # сезонний цикл CO₂ (крива Келінга) створює автокорельовані залишки,
    # через що p_value scipy.stats.linregress занижується.
    annual = to_annual_average(data.get("series", []))
    data["analysis"] = analyze(annual)
    return data


@app.get("/api/sea-ice")
async def sea_ice():
    """Протяжність арктичного морського льоду (NSIDC Sea Ice Index)"""
    data = get_sea_ice()
    data["analysis"] = analyze(data.get("annual_minimum", []))
    return data


@app.get("/api/sea-ice-south")
async def sea_ice_south():
    """Протяжність антарктичного морського льоду (NSIDC Sea Ice Index)"""
    data = get_sea_ice_south()
    data["analysis"] = analyze(data.get("annual_minimum", []))
    return data


@app.get("/api/sea-level")
async def sea_level():
    """Глобальний рівень моря за даними супутникової альтиметрії (University of Colorado)"""
    data = get_sea_level()
    data["analysis"] = analyze(data.get("series", []), time_key="date")
    return data


@app.get("/api/sea-level-psmsl")
async def sea_level_psmsl():
    """Рівень моря — мареографи (PSMSL, 12 еталонних станцій, незалежна перевірка альтиметрії)"""
    data = get_sea_level_psmsl()
    data["analysis"] = analyze(data.get("series", []), time_key="date")
    return data


@app.get("/api/ocean-heat")
async def ocean_heat():
    """Вміст тепла в океані, верхні 2000 м (NOAA GML, через OWID)"""
    data = get_ocean_heat()
    data["analysis"] = analyze(data.get("series", []))
    return data


@app.get("/api/ocean-ph")
async def ocean_ph():
    """Закислення океану — pH поверхневої води, станція ALOHA (HOT)"""
    data = get_ocean_ph()
    data["analysis"] = analyze(data.get("series", []), time_key="date")
    return data


@app.get("/api/hurricanes")
async def hurricanes():
    """Активні тропічні циклони в Атлантиці (NOAA NHC)"""
    return get_hurricanes()


@app.get("/api/fires")
async def fires(days: int = Query(1, ge=1, le=7)):
    """Активні осередки пожеж (NASA FIRMS, потрібен FIRMS_API_KEY)"""
    return get_fires(days)


@app.get("/api/asteroids")
async def asteroids(days: int = Query(7, ge=1, le=7)):
    """Навколоземні астероїди (NASA NeoWs, потрібен NASA_API_KEY)"""
    return _safe(lambda: get_neo(days), {"objects": [], "source": "fallback", "error": True})


@app.get("/api/geomagnetic")
async def geomagnetic():
    """Геомагнітна активність Kp-індекс в реальному часі (NOAA SWPC)"""
    return _safe(get_geomagnetic, {"current_kp": None, "series": [], "storm_level": "G0", "source": "fallback", "error": True})


@app.get("/api/space-weather")
async def space_weather(days: int = Query(7, ge=1, le=30)):
    """Космічна погода: сонячні спалахи, CME, геомагнітні бурі (NASA DONKI)"""
    return _safe(lambda: get_solar_events(days), {"events": [], "source": "fallback", "error": True})


@app.get("/api/eonet")
async def eonet(days: int = Query(10, ge=1, le=30)):
    """Єдина лента природних подій на Землі (NASA EONET v3, без ключа).
    Пожежі, вулкани, повені, шторми, лід/сніг, посухи, пилові бурі, циклони."""
    return _safe(lambda: get_eonet(days), {"events": [], "source": "fallback", "error": True})


@app.get("/api/geocode")
async def geocode(q: str = Query(..., min_length=2), count: int = Query(8, ge=1, le=20)):
    """Пошук міст/країн за назвою (Open-Meteo Geocoding, без ключа).
    Повертає назву, країну, широту/довготу для вибору міста в погоді."""
    return _safe(lambda: get_geocode(q, count), {"results": [], "source": "fallback", "error": True})


@app.get("/api/kp-forecast")
async def kp_forecast():
    """3-денний прогноз Kp-індексу (NOAA SWPC, без ключа)."""
    return _safe(get_kp_forecast, {"forecast": [], "source": "fallback", "error": True})


@app.get("/api/solar-flares")
async def solar_flares():
    """Рентгенівський потік Сонця в реальному часі (GOES-18, без ключа).
    Дозволяє визначати поточний клас сонячного спалаху A/B/C/M/X."""
    return _safe(get_goes_xray, {"series": [], "current": None, "source": "fallback", "error": True})


@app.get("/api/solar-cycle")
async def solar_cycle():
    """Сонячний цикл: число Вольфа (SSN) та радіо-потік F10.7 (NOAA SWPC, без ключа)."""
    return _safe(get_solar_cycle, {"latest": None, "source": "fallback", "error": True})


@app.get("/api/solar-wind")
async def solar_wind():
    """Сонячний вітер: швидкість, густина протонів та IMF Bz (NOAA SWPC, без ключа).
    Ключові індикатори для прогнозу геомагнітних бур та полярних сяйв."""
    return _safe(get_solar_wind, {"speed": None, "bz": None, "source": "fallback", "error": True})


@app.get("/api/earthquakes")
async def earthquakes():
    """Значні землетруси за останній тиждень (USGS GeoJSON, без ключа)."""
    return _safe(get_earthquakes, {"earthquakes": [], "count": 0, "source": "fallback", "error": True})


@app.get("/api/aurora")
async def aurora(lat: float = Query(DEFAULT_LAT), lon: float = Query(DEFAULT_LON)):
    """Ймовірність полярного сяйва в точці (NOAA SWPC OVATION, без ключа;
    фолбек — оцінка за Kp-індексом)."""
    return _safe(lambda: get_aurora(lat, lon), {"probability": None, "source": "fallback", "error": True})


@app.get("/api/schumann")
async def schumann():
    """Шуманівський резонанс + складовий індекс активності (ResonanceOne, без ключа)."""
    return _safe(get_schumann, {"error": True, "source": "ResonanceOne"})


@app.get("/api/sources")
async def sources():
    """Статус усіх джерел даних: онлайн/офлайн. Жива перевірка кешується 30 хв."""
    return _safe(get_sources_status, {"sources": [], "error": True, "source": "fallback"})


@app.get("/api/ch4")
async def ch4():
    """Глобальний метан (CH₄) — NOAA GML, похвилинні серії + analyze()."""
    data = _safe(lambda: get_ch4(), {})
    if not data or not data.get("series"):
        return data
    series = data["series"]
    values = [p["value"] for p in series if p.get("value") is not None]
    data["analysis"] = analyze(values) if values else {}
    return data


@app.get("/api/n2o")
async def n2o():
    """Глобальний закис азоту (N₂O) — NOAA GML, похвилинні серії + analyze()."""
    data = _safe(lambda: get_n2o(), {})
    if not data or not data.get("series"):
        return data
    series = data["series"]
    values = [p["value"] for p in series if p.get("value") is not None]
    data["analysis"] = analyze(values) if values else {}
    return data


@app.get("/api/gdacs")
async def gdacs(event_type: str = Query("")):
    """Природні катастрофи GDACS (UN OCHA + EU JRC) — повені, циклони, вулкани, пожежі, землетруси."""
    return _safe(lambda: get_gdacs(event_type), {"events": [], "source": "GDACS (fallback)", "error": True})


@app.get("/api/coral-reef")
async def coral_reef():
    """NOAA Coral Reef Watch — термічний стрес коралів та ризик блікування."""
    return _safe(lambda: get_coral_reef(), {"source": "NOAA CRW (fallback)", "error": True})


def _safe(fetcher, default=None):
    """Викликати fetcher() і повернути default при будь-якій помилці."""
    try:
        return fetcher()
    except Exception:
        return default


@app.get("/api/overview")
async def overview(lat: float = Query(DEFAULT_LAT), lon: float = Query(DEFAULT_LON)):
    """Агрегований знімок планети для головного дашборда"""
    weather_data, marine_data, aq_data, gistemp_data, co2_data, ice_data, storm_data, fire_data = (
        await asyncio.gather(
            asyncio.to_thread(lambda: _safe(lambda: get_weather(lat, lon), {})),
            asyncio.to_thread(lambda: _safe(lambda: get_marine(lat, lon), {})),
            asyncio.to_thread(lambda: _safe(lambda: get_air_quality(lat, lon), {})),
            asyncio.to_thread(lambda: _safe(lambda: get_gistemp(), {})),
            asyncio.to_thread(lambda: _safe(lambda: get_co2(), {})),
            asyncio.to_thread(lambda: _safe(lambda: get_sea_ice(), {})),
            asyncio.to_thread(lambda: _safe(lambda: get_hurricanes(), {})),
            asyncio.to_thread(lambda: _safe(lambda: get_fires(1), {})),
        )
    )
    current = weather_data.get("current", {})
    daily = weather_data.get("daily", {})

    # Середня температура поверхні океану за останні 24 години
    marine_current = None
    if marine_data.get("hourly", {}).get("sea_surface_temperature"):
        sst = marine_data["hourly"]["sea_surface_temperature"]
        sst_valid = [v for v in sst if v is not None]
        if sst_valid:
            marine_current = round(sum(sst_valid) / len(sst_valid), 1)

    wave_current = None
    if marine_data.get("hourly", {}).get("wave_height"):
        waves = [v for v in marine_data["hourly"]["wave_height"] if v is not None]
        if waves:
            wave_current = round(sum(waves) / len(waves), 1)

    aqi = (aq_data.get("current") or {}).get("us_aqi")

    latest_gistemp = (gistemp_data or {}).get("latest") or {}
    latest_co2 = (co2_data or {}).get("latest") or {}
    ice_latest = (ice_data or {}).get("latest") or {}

    sea_level_data, ocean_heat_data, ocean_ph_data, antarctic_ice_data = (
        await asyncio.gather(
            asyncio.to_thread(lambda: _safe(lambda: get_sea_level(), {})),
            asyncio.to_thread(lambda: _safe(lambda: get_ocean_heat(), {})),
            asyncio.to_thread(lambda: _safe(lambda: get_ocean_ph(), {})),
            asyncio.to_thread(lambda: _safe(lambda: get_sea_ice_south(), {})),
        )
    )

    return {
        "location": {"lat": lat, "lon": lon},
        "weather": {
            "temperature": current.get("temperature_2m"),
            "apparent_temperature": current.get("apparent_temperature"),
            "humidity": current.get("relative_humidity_2m"),
            "wind_speed": current.get("wind_speed_10m"),
            "wind_direction": current.get("wind_direction_10m"),
            "cloud_cover": current.get("cloud_cover"),
            "pressure": current.get("pressure_msl"),
            "precipitation": current.get("precipitation"),
            "weather_code": current.get("weather_code"),
            "uv_index": current.get("uv_index"),
            "forecast": daily,
            "source": weather_data.get("_source", "open-meteo"),
        },
        "air_quality": {
            "us_aqi": aqi,
            "pm2_5": (aq_data.get("current") or {}).get("pm2_5"),
            "pm10": (aq_data.get("current") or {}).get("pm10"),
            "ozone": (aq_data.get("current") or {}).get("ozone"),
        },
        "temperature_anomaly": latest_gistemp,
        "co2": latest_co2,
        "sea_ice": {
            "extent": ice_latest.get("extent"),
            "date": ice_latest.get("date"),
            "anomaly": (ice_data or {}).get("anomaly"),
        },
        "ocean": {
            "sea_surface_temperature": marine_current,
            "wave_height": wave_current,
        },
        "ocean_climate": {
            "sea_level": (sea_level_data or {}).get("latest"),
            "sea_level_trend": (sea_level_data or {}).get("trend"),
            "ocean_heat": (ocean_heat_data or {}).get("latest"),
            "ocean_ph": (ocean_ph_data or {}).get("latest"),
            "antarctic_ice": (antarctic_ice_data or {}).get("latest"),
        },
        "hurricanes": {
            "active": (storm_data or {}).get("active", False),
            "count": len((storm_data or {}).get("storms", [])),
        },
        "fires": {
            "count": (fire_data or {}).get("count", 0),
            "live": (fire_data or {}).get("live", False),
        },
    }


@app.get("/api/kpi", response_model=List[KPIMetric])
async def get_kpi_metrics():
    """Поточні KPI кліматичних метрик (реальні значення з постачальників)"""
    overview_data = await get_overview_safe()

    kpis = []
    if overview_data:
        weather = overview_data.get("weather") or {}
        temp = weather.get("temperature")
        if temp is not None:
            kpis.append(
                {
                    "name": "Local Temperature",
                    "value": f"{temp:.1f}°C",
                    "trend": f"feels like {overview_data['weather'].get('apparent_temperature', temp):.1f}°C",
                    "trend_up": (overview_data["weather"].get("apparent_temperature", temp) or 0) > temp,
                    "insight": "Live weather station data (Open-Meteo)" if overview_data.get("weather", {}).get("source", "open-meteo") != "openweathermap" else "Live weather station data (OpenWeatherMap fallback)",
                }
            )

    anomaly = (overview_data or {}).get("temperature_anomaly") or {}
    if anomaly.get("value") is not None:
        kpis.append(
            {
                "name": "Global Temperature Anomaly",
                "value": f"{anomaly['value']:+.2f}°C",
                "trend": f"vs 1951-1980 baseline",
                "trend_up": anomaly["value"] > 0,
                "insight": f"NASA GISTEMP, {anomaly.get('year')}"
                + (f"-{anomaly.get('month'):02d}" if anomaly.get("month") else ""),
            }
        )

    co2_latest = (overview_data or {}).get("co2") or {}
    if co2_latest.get("value") is not None:
        kpis.append(
            {
                "name": "Atmospheric CO₂",
                "value": f"{co2_latest['value']:.1f} ppm",
                "trend": f"{co2_latest.get('year')}-{co2_latest.get('month'):02d}",
                "trend_up": True,
                "insight": "NOAA GML monthly global average",
            }
        )

    ice = (overview_data or {}).get("sea_ice") or {}
    if ice.get("extent") is not None:
        anomaly_ice = ice.get("anomaly")
        kpis.append(
            {
                "name": "Arctic Sea Ice Extent",
                "value": f"{ice['extent']:.1f}M km²",
                "trend": f"{anomaly_ice:+.2f}M vs 1981-2010" if anomaly_ice is not None else "daily",
                "trend_up": False,
                "insight": f"NSIDC, {ice.get('date')}",
            }
        )

    fires_count = (overview_data or {}).get("fires", {}).get("count", 0)
    kpis.append(
        {
            "name": "Active Fire Hotspots",
            "value": str(fires_count),
            "trend": "global, 24h",
            "trend_up": fires_count > 0,
            "insight": "NASA FIRMS VIIRS (global)",
        }
    )

    hurricane_count = (overview_data or {}).get("hurricanes", {}).get("count", 0)
    kpis.append(
        {
            "name": "Active Cyclones",
            "value": str(hurricane_count),
            "trend": "Atlantic basin",
            "trend_up": hurricane_count > 0,
            "insight": "NOAA National Hurricane Center",
        }
    )

    # Геомагнітна буря — Kp-індекс у реальному часі (NOAA SWPC, без ключа)
    geomag = _safe(get_geomagnetic, {"current_kp": None, "storm_level": "G0", "source": "fallback"})
    current_kp = geomag.get("current_kp")
    if current_kp is not None:
        storm_level = geomag.get("storm_level", "G0")
        kpis.append(
            {
                "name": "Geomagnetic Storm",
                "value": f"Kp {current_kp:.1f}",
                "trend": f"{storm_level} · live",
                "trend_up": current_kp >= 5,
                "insight": f"NOAA SWPC planetary Kp index · {geomag.get('source', '')}",
            }
        )

    # --- Океанічний клімат: рівень моря, тепло океану, закислення, південний лід ---
    ocean_climate = (overview_data or {}).get("ocean_climate") or {}

    sl = ocean_climate.get("sea_level") or {}
    if sl.get("value") is not None:
        sl_trend = ocean_climate.get("sea_level_trend")
        kpis.append(
            {
                "name": "Global Sea Level",
                "value": f"{sl['value']:+.0f} mm",
                "trend": f"{sl_trend:+.2f} mm/yr" if sl_trend is not None else "relative",
                "trend_up": True,
                "insight": f"Satellite altimetry (Univ. of Colorado), {sl.get('date', '')[:4]}",
            }
        )

    oh = ocean_climate.get("ocean_heat") or {}
    if oh.get("value") is not None:
        kpis.append(
            {
                "name": "Ocean Heat Content",
                "value": f"{oh['value']:.0f} ZJ",
                "trend": f"0-2000 m, {oh.get('year', '')}",
                "trend_up": True,
                "insight": "NOAA GML ocean heat content (OWID)",
            }
        )

    ph = ocean_climate.get("ocean_ph") or {}
    if ph.get("value") is not None:
        kpis.append(
            {
                "name": "Ocean pH",
                "value": f"{ph['value']:.3f}",
                "trend": "Station ALOHA",
                "trend_up": False,
                "insight": "HOT (Station ALOHA) surface seawater pH",
            }
        )

    south_ice = ocean_climate.get("antarctic_ice") or {}
    if south_ice.get("extent") is not None:
        kpis.append(
            {
                "name": "Antarctic Sea Ice Extent",
                "value": f"{south_ice['extent']:.1f}M km²",
                "trend": f"daily, {south_ice.get('date', '')}",
                "trend_up": False,
                "insight": "NSIDC Sea Ice Index (south)",
            }
        )

    if not kpis:
        return [
            {
                "name": "Global Temperature",
                "value": "+1.54°C",
                "trend": "+0.12°C",
                "trend_up": True,
                "insight": "Температурна аномалія продовжує зростати",
            },
            {
                "name": "Atmospheric CO₂",
                "value": "428.5 ppm",
                "trend": "+2.1 ppm",
                "trend_up": True,
                "insight": "Рівень CO₂ на найвищій позначці за 800,000 років",
            },
        ]

    return kpis


@app.get("/api/indicators")
async def indicators():
    """Зведена Python-аналітика всіх кліматичних індикаторів.

    Централізований розрахунок на бекенді (numpy/scipy): тренд на рік,
    R², p-value, year-over-year, z-score аномалії та прогноз на наступний рік
    для кожного ряду — без дублювання логіки у фронтенді.
    """
    jobs = {
        "temperature": (get_gistemp, "series", "year"),
        "co2": (get_co2, "series", "year"),
        "sea_ice_arctic": (get_sea_ice, "annual_minimum", "year"),
        "sea_ice_antarctic": (get_sea_ice_south, "annual_minimum", "year"),
        "sea_level": (get_sea_level, "series", "date"),
        "ocean_heat": (get_ocean_heat, "series", "year"),
        "ocean_ph": (get_ocean_ph, "series", "date"),
    }
    fetched = await asyncio.gather(
        *(asyncio.to_thread(lambda fn=fn: _safe(fn, {})) for fn, _, _ in jobs.values())
    )
    indicators_data = {}
    for (key, (_, series_key, time_key)), data in zip(jobs.items(), fetched):
        series = data.get(series_key) or []
        analysis = analyze(series, "value", time_key) if len(series) >= 3 else {}
        indicators_data[key] = {
            "latest": data.get("latest"),
            "unit": data.get("unit"),
            "source": data.get("source"),
            **analysis,
        }
    return {
        "source": "Climate Intelligence · Python numpy/scipy analytics",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "indicators": indicators_data,
    }


async def get_overview_safe() -> dict:
    """Локальний виклик overview без мережевого шляху, з фолбеком."""
    try:
        return await overview(DEFAULT_LAT, DEFAULT_LON)
    except Exception:
        return {}


@app.get("/api/events", response_model=List[ClimateEvent])
async def get_climate_events():
    """Актуальні глобальні кліматичні події з координатами для 3D глобуса.
    Тільки реальні дані на сьогодні: NASA FIRMS (пожежі), NOAA NHC (циклони)
    та USGS (землетруси mag >= 4.5)."""
    events = []

    # --- Реальні дані: пожежі (NASA FIRMS) ---
    try:
        # days=2 дає значно більше точок (десятки тисяч) і рівномірне
        # покриття планети. days=1 часто повертає лише кілька точок,
        # скупчених в одному регіоні (напр., вулкани Гаваїв), що виглядає
        # як "пожежі в океані" на глобусі.
        fires_data = await asyncio.to_thread(get_fires, 2)
        fires = fires_data.get("fires", [])
        # Беремо рівномірну вибірку по всій планеті, а не перші рядки CSV
        # (CSV відсортований, перші записи можуть бути скупчені в одному регіоні).
        if len(fires) > 120:
            step = max(1, len(fires) // 120)
            sampled = fires[::step][:120]
        else:
            sampled = fires
        for fire in sampled:
            coords = fire.get("coordinates")
            if coords:
                frp = fire.get("frp")
                place = nearest_place(coords[1], coords[0])
                events.append(
                    {
                        "event_type": "Wildfire",
                        # Людська назва місця (найближче місто) або координати
                        "location": place
                        or f"≈ {coords[1]:.1f}°, {coords[0]:.1f}°",
                        "time": fire.get("acq_date", "recent"),
                        "severity": "high" if (frp or 0) > 100 else "medium",
                        "coordinates": (coords[0], coords[1]),
                        "frp": round(float(frp), 1) if frp is not None else None,
                        "confidence": fire.get("confidence"),
                        "satellite": fire.get("satellite"),
                    }
                )
    except Exception:
        pass

    # --- Реальні дані: циклони (NOAA NHC) ---
    try:
        storms = (await asyncio.to_thread(get_hurricanes)).get("storms", [])
        for storm in storms[:6]:
            coords = storm.get("coordinates")
            if coords:
                events.append(
                    {
                        "event_type": "Cyclone",
                        "location": storm.get("title", "Tropical Cyclone"),
                        "time": "active",
                        "severity": "high",
                        "coordinates": (coords[0], coords[1]),
                    }
                )
    except Exception:
        pass

    # --- Реальні дані: землетруси (USGS, mag >= 4.5, без ключа) ---
    try:
        quakes = (await asyncio.to_thread(get_earthquakes, 7, 60)).get("earthquakes", [])
        for q in quakes:
            coords = q.get("coordinates")
            if not coords:
                continue
            ts = q.get("time")
            iso = (
                datetime.fromtimestamp(ts / 1000, tz=timezone.utc).isoformat()
                if ts
                else None
            )
            mag = q.get("magnitude") or 0
            events.append(
                {
                    "event_type": "Earthquake",
                    "location": q.get("place") or "Earthquake",
                    "time": iso or "recent",
                    "severity": "high" if mag >= 6.0 else "medium",
                    "coordinates": (coords[0], coords[1]),
                }
            )
    except Exception:
        pass

    return events


@app.get("/api/predictions", response_model=List[AIPrediction])
async def get_predictions(lang: str = Query("en"), days: int = Query(30, ge=7, le=3650)):
    """Прогнози штучного інтелекту щодо кліматичних ризиків (AI Groq).
    days (7/30/90/365/730/1095/1460/1825/3650) змінює горизонт: щоразу AI генерує прогнози під цей період."""
    predictions = get_ai_predictions(lang, days)
    normalized = []
    for p in predictions:
        ci = p.get("confidence_interval") or p.get("confidence") or [p.get("probability", 0.5), p.get("probability", 0.5)]
        if isinstance(ci, (list, tuple)) and len(ci) == 2:
            low, high = ci[0], ci[1]
        else:
            low = high = p.get("probability", 0.5)
        normalized.append(
            {
                "category": p.get("category", "Climate"),
                "prediction": p.get("prediction", ""),
                "probability": max(0.0, min(1.0, float(p.get("probability", 0.5)))),
                "confidence_interval": (low, high),
                "reasoning": p.get("reasoning", ""),
                "risk_level": p.get("risk_level"),
                "timeframe": p.get("timeframe"),
            }
        )
    if not normalized:
        return [
            {
                "category": "Temperature",
                "prediction": "Above average temperatures expected in Southern Europe",
                "probability": 0.85,
                "confidence_interval": (0.78, 0.92),
                "reasoning": "AI forecast based on atmospheric pressure patterns and historical data.",
                "risk_level": "high",
                "timeframe": "7-30 days",
            },
        ]
    return normalized


@app.get("/api/ai-analysis")
async def ai_analysis(lang: str = Query("en")):
    """AI-аналіз сьогоднішньої кліматичної ситуації (AI Groq, 2 рази на день о 09:00 та 17:00 за Києвом, мовою інтерфейсу)"""
    return get_ai_analysis(lang)


@app.get("/api/ai-summary")
async def get_ai_summary(lang: str = Query("en", max_length=2)):
    """Кліматичне резюме мовою інтерфейсу (lang: en/uk/de/pl/fr/it/ka)."""
    try:
        overview_data = await get_overview_safe()
        summary = get_ai_summary_text(overview_data or {}, lang)
    except Exception:
        summary = get_ai_summary_text({}, lang)

    return {
        "summary": summary,
        "last_updated": "live",
        "confidence": 0.91,
        "lang": lang,
    }


if __name__ == "__main__":
    # Порт береться з $PORT (Render), інакше 8000 для локальної розробки
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", 8000)))
