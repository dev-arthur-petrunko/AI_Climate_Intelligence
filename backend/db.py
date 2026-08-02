"""База даних PostgreSQL (Neon) через SQLAlchemy async.

Модуль накопичує власну історію кліматичних метрик для аналітики
(тренди, аномалії, year-over-year) незалежно від зовнішніх API.

Якщо DATABASE_URL не заданий (локальна розробка без БД), всі функції
безпечно повертають фолбек і додаток працює в режимі без персистентності.
"""
import os
from datetime import datetime
from typing import Optional

from sqlalchemy import JSON, Column, DateTime, Float, Integer, String
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import declarative_base, sessionmaker

DATABASE_URL = os.getenv("DATABASE_URL", "").strip()
_pool_size = int(os.getenv("DATABASE_POOL_SIZE", "5"))

_engine = None
async_session = None
Base = declarative_base()

_configured = bool(DATABASE_URL)


def _make_engine():
    global _engine, async_session, _configured
    if not DATABASE_URL:
        _configured = False
        return
    url = DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://")
    if "sslmode=require" not in url and "?" in url:
        url += "&sslmode=require"
    elif "sslmode=require" not in url:
        url += "?sslmode=require"
    try:
        _engine = create_async_engine(url, pool_size=_pool_size, max_overflow=5)
        async_session = sessionmaker(_engine, class_=AsyncSession, expire_on_commit=False)
        _configured = True
    except Exception:
        _engine = None
        async_session = None
        _configured = False


_make_engine()


class ClimateSnapshot(Base):
    __tablename__ = "climate_snapshots"

    id = Column(Integer, primary_key=True)
    captured_at = Column(DateTime, index=True, default=datetime.utcnow)
    metric = Column(String(64), index=True)
    value = Column(Float)
    meta = Column(JSON, nullable=True)


def db_available() -> bool:
    return _configured and async_session is not None


async def save_snapshot(metric: str, value: float, meta: Optional[dict] = None) -> bool:
    """Зберегти точку метрики в БД. Повертає False, якщо БД недоступна."""
    if not db_available():
        return False
    try:
        async with async_session() as session:
            session.add(
                ClimateSnapshot(
                    captured_at=datetime.utcnow(),
                    metric=metric,
                    value=float(value),
                    meta=meta or None,
                )
            )
            await session.commit()
        return True
    except Exception:
        return False


async def recent_series(metric: str, limit: int = 500) -> list[dict]:
    """Останні точки метрики (captured_at DESC) — для аналітики."""
    if not db_available():
        return []
    try:
        async with async_session() as session:
            result = await session.execute(
                ClimateSnapshot.__table__.select()
                .where(ClimateSnapshot.metric == metric)
                .order_by(ClimateSnapshot.captured_at.desc())
                .limit(limit)
            )
            rows = result.fetchall()
        return [
            {"captured_at": row.captured_at, "value": row.value, "meta": row.meta}
            for row in rows
        ]
    except Exception:
        return []
