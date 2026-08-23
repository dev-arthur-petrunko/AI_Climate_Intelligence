"""Аналітичний модуль: реальні статистичні розрахунки над кліматичними рядами.

Використовує numpy/scipy для МНК-регресії, z-оцінок аномалій та
year-over-year порівнянь. Функції приймають серії точок виду
[{"year": ..., "value": ...}] або [{"date": ..., "value": ...}]
і повертають окремі поля JSON, не ламаючи існуючу схему відповідей.
"""
import datetime
from typing import Optional

import numpy as np
from scipy import stats


def _x_values(series: list[dict], time_key: str = "year") -> Optional[np.ndarray]:
    """Числова вісь часу: year/yield напряму, ISO-дати перетворює в fractional year."""
    if not series:
        return None
    xs = []
    for p in series:
        raw = p.get(time_key)
        if isinstance(raw, (int, float)):
            xs.append(float(raw))
            continue
        s = str(raw)
        try:
            year = int(s[:4])
            month = int(s[5:7]) if len(s) >= 7 else 1
            day = int(s[8:10]) if len(s) >= 10 else 1
            date = datetime.date(year, month, day)
            start = datetime.date(year, 1, 1)
            day_of_year = (date - start).days
            days_in_year = 366 if (year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)) else 365
            xs.append(year + day_of_year / days_in_year)
        except (ValueError, TypeError):
            return None
    return np.asarray(xs, dtype=float)


def to_annual_average(series: list[dict], value_key: str = "value") -> list[dict]:
    """Агрегує місячні дані в річні середні (для CO₂, температури тощо).

    Причина: МНК-регресія на місячних даних CO₂ (крива Келінга) має
    автокорельовані залишки — p_value/std_err scipy.stats.linregress
    будуть занижені (тренд виглядає більш значимим, ніж є).
    Річні середні знімають сезонність природним шляхом."""
    by_year: dict[int, list[float]] = {}
    for p in series:
        y = p.get("year")
        v = p.get(value_key)
        if isinstance(y, (int, float)) and isinstance(v, (int, float)):
            by_year.setdefault(int(y), []).append(float(v))
    if not by_year:
        return []
    result = []
    for y in sorted(by_year):
        vals = by_year[y]
        result.append({"year": y, "value": round(sum(vals) / len(vals), 2)})
    return result


def _y_values(series: list[dict], value_key: str = "value") -> Optional[np.ndarray]:
    if not series:
        return None
    ys = []
    for p in series:
        v = p.get(value_key)
        if isinstance(v, (int, float)):
            ys.append(float(v))
        else:
            return None
    return np.asarray(ys, dtype=float)


def linear_trend(
    series: list[dict], value_key: str = "value", time_key: str = "year"
) -> Optional[dict]:
    """МНК-регресія: нахил на рік, довірчий інтервал, R², p-value, прогноз."""
    x = _x_values(series, time_key)
    y = _y_values(series, value_key)
    if x is None or y is None or len(x) < 3 or len(x) != len(y):
        return None
    try:
        slope, intercept, r, p_value, std_err = stats.linregress(x, y)
    except Exception:
        return None
    return {
        "slope_per_year": round(float(slope), 4),
        "intercept": round(float(intercept), 3),
        "r_squared": round(float(r) ** 2, 4),
        "p_value": round(float(p_value), 6),
        "std_error": round(float(std_err), 4),
        "projected_next_year": round(float(slope * (x[-1] + 1) + intercept), 3),
        "n": int(len(x)),
    }


def z_score_anomaly(
    series: list[dict], value_key: str = "value", time_key: str = "year"
) -> Optional[float]:
    """Z-оцінка аномалії останньої точки відносно тренду (в σ).

    Правильний підхід: спочатку будуємо МНК-регресію, потім обчислюємо
    залишки (факт − прогноз_по_тренду), і z-score рахуємо від цих залишків,
    а не від «сирого» середнього. Це гарантує, що для рядів з міцним
    трендом (CO₂, температура, рівень моря) z не росте «сам по собі».
    """
    x = _x_values(series, time_key)
    y = _y_values(series, value_key)
    if x is None or y is None or len(x) < 8 or len(x) != len(y):
        return None
    try:
        slope, intercept, *_ = stats.linregress(x, y)
    except Exception:
        return None
    residuals = y - (slope * x + intercept)
    hist = residuals[:-1]
    std = float(hist.std(ddof=1))
    if std == 0 or not np.isfinite(std):
        return None
    return round(float(residuals[-1] / std), 2)


def year_over_year(
    series: list[dict], value_key: str = "value", time_key: str = "year", steps: Optional[int] = None
) -> Optional[float]:
    """Різниця останньої точки і точки ~1 рік тому (None, якщо мало даних).

    steps підбирається автоматично за гранулярністю ряду (денні — 365,
    місячні — 12, річні — 1), якщо не заданий явно."""
    if len(series) < 2:
        return None
    if steps is None:
        x = _x_values(series, time_key)
        if x is not None and len(x) >= 2:
            gaps = np.diff(x)
            gaps = gaps[np.isfinite(gaps) & (gaps > 0)]
            if gaps.size:
                median_gap = float(np.median(gaps))
                steps = max(1, int(round(1.0 / median_gap))) if median_gap > 0 else 12
            else:
                steps = 12
        else:
            steps = 12
    if len(series) < steps + 1:
        return None
    try:
        return round(float(series[-1][value_key] - series[-steps - 1][value_key]), 3)
    except (KeyError, TypeError, IndexError):
        return None


def describe(series: list[dict], value_key: str = "value", time_key: str = "year") -> dict:
    """Зібрана аналітика для одного ряду — зручно підставляти в ендпоінти."""
    trend = linear_trend(series, value_key, time_key)
    anomaly = z_score_anomaly(series, value_key, time_key)
    yoy = year_over_year(series, value_key, time_key)
    result = {}
    if trend:
        result["trend_analysis"] = trend
    if anomaly is not None:
        result["z_score_anomaly"] = anomaly
    if yoy is not None:
        result["year_over_year"] = yoy
    return result
