"""Фонові задачі: періодичний прогрів кешу та збереження снапшотів у БД.

Живе повністю в бекенді. Запускається один раз при старті додатка.
Робить розрахунки заздалегідь, щоб відповіді API були швидкими,
а також накопичує власну історію метрик у PostgreSQL (Neon).
"""
import asyncio
import logging
from datetime import datetime, timezone

from apscheduler.schedulers.background import BackgroundScheduler

logger = logging.getLogger("climate.scheduler")

scheduler = BackgroundScheduler(timezone="Europe/Kyiv")


def _metrics_snapshot() -> dict:
    """Зібрати поточні значення метрик для збереження в БД."""
    from data_sources import (
        get_gistemp,
        get_co2,
        get_sea_ice,
        get_sea_ice_south,
        get_sea_level,
        get_ocean_heat,
        get_ocean_ph,
        get_hurricanes,
        get_fires,
    )

    result = {}
    for metric, data in (
        ("gistemp", get_gistemp()),
        ("co2", get_co2()),
        ("sea_ice", get_sea_ice()),
        ("sea_ice_south", get_sea_ice_south()),
        ("sea_level", get_sea_level()),
        ("ocean_heat", get_ocean_heat()),
        ("ocean_ph", get_ocean_ph()),
    ):
        latest = (data or {}).get("latest")
        if latest:
            value = latest.get("value")
            if value is None:
                value = latest.get("extent")
            if isinstance(value, (int, float)):
                result[metric] = {"value": float(value), "latest": latest}

    result["hurricanes"] = {"value": float(len((get_hurricanes() or {}).get("storms", [])))}
    result["fires"] = {"value": float((get_fires(1) or {}).get("count", 0))}
    return result


async def _store_snapshot() -> None:
    """Зберегти поточний снапшот метрик у PostgreSQL (Neon)."""
    from db import db_available, save_snapshot

    if not db_available():
        return
    metrics = _metrics_snapshot()
    for metric, item in metrics.items():
        try:
            await save_snapshot(
                metric,
                item["value"],
                meta={"latest": item.get("latest")},
            )
        except Exception as exc:  # pragma: no cover
            logger.warning("Failed to store snapshot %s: %s", metric, exc)


def _refresh_job() -> None:
    """Синхронна обгортка фонової задачі (викликається з APScheduler)."""
    try:
        asyncio.run(_store_snapshot())
    except Exception as exc:  # pragma: no cover
        logger.warning("Background refresh failed: %s", exc)


def _prewarm_cache() -> None:
    """Прогріти кеш даних та AI-аналізу, щоб перші запити були швидкими."""
    try:
        from ai_groq import get_ai_analysis

        get_ai_analysis("en")
    except Exception as exc:  # pragma: no cover
        logger.warning("Cache prewarm failed: %s", exc)


def start_scheduler() -> None:
    """Запустити фонові задачі (викликається при старті додатка)."""
    try:
        if scheduler.running:
            return
        scheduler.add_job(_refresh_job, "interval", hours=1, id="snapshot_hourly")
        scheduler.add_job(_prewarm_cache, "interval", hours=6, id="prewarm_6h")
        scheduler.start()
        logger.info("Background scheduler started")
    except Exception as exc:  # pragma: no cover
        logger.warning("Scheduler failed to start: %s", exc)


def stop_scheduler() -> None:
    """Зупинити фонові задачі при завершенні роботи."""
    try:
        if scheduler.running:
            scheduler.shutdown(wait=False)
    except Exception:  # pragma: no cover
        pass


def last_store_time() -> str:
    """Час останнього збереження снапшота (для діагностики)."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
