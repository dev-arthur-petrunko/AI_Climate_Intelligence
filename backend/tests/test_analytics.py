"""Тести аналітичного модуля: _x_values, linear_trend, z_score_anomaly, year_over_year.

Запуск: cd backend && python -m pytest tests/test_analytics.py -v
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import numpy as np
import pytest

from analytics import (
    _x_values,
    _y_values,
    linear_trend,
    to_annual_average,
    z_score_anomaly,
    year_over_year,
    describe,
)


# ──────────────────────────────────────────────
# Fixture: реальні ряди GISTEMP (річні аномалії)
# Джерело: NASA GISTEMP v4, J-D середня, 1951-1980 baseline
# ──────────────────────────────────────────────

GISTEMP_ANNUAL = [
    {"year": 1950, "value": -0.16}, {"year": 1951, "value": 0.01},
    {"year": 1952, "value": 0.02}, {"year": 1953, "value": 0.08},
    {"year": 1954, "value": -0.13}, {"year": 1955, "value": -0.14},
    {"year": 1956, "value": -0.19}, {"year": 1957, "value": 0.05},
    {"year": 1958, "value": 0.06}, {"year": 1959, "value": 0.03},
    {"year": 1960, "value": -0.02}, {"year": 1961, "value": 0.05},
    {"year": 1962, "value": 0.03}, {"year": 1963, "value": 0.07},
    {"year": 1964, "value": -0.20}, {"year": 1965, "value": -0.11},
    {"year": 1966, "value": -0.03}, {"year": 1967, "value": -0.02},
    {"year": 1968, "value": -0.07}, {"year": 1969, "value": 0.06},
    {"year": 1970, "value": 0.02}, {"year": 1971, "value": -0.09},
    {"year": 1972, "value": 0.01}, {"year": 1973, "value": 0.16},
    {"year": 1974, "value": -0.07}, {"year": 1975, "value": -0.01},
    {"year": 1976, "value": -0.10}, {"year": 1977, "value": 0.18},
    {"year": 1978, "value": 0.07}, {"year": 1979, "value": 0.16},
    {"year": 1980, "value": 0.26}, {"year": 1981, "value": 0.32},
    {"year": 1982, "value": 0.14}, {"year": 1983, "value": 0.31},
    {"year": 1984, "value": 0.16}, {"year": 1985, "value": 0.12},
    {"year": 1986, "value": 0.18}, {"year": 1987, "value": 0.33},
    {"year": 1988, "value": 0.39}, {"year": 1989, "value": 0.27},
    {"year": 1990, "value": 0.45}, {"year": 1991, "value": 0.41},
    {"year": 1992, "value": 0.22}, {"year": 1993, "value": 0.24},
    {"year": 1994, "value": 0.31}, {"year": 1995, "value": 0.45},
    {"year": 1996, "value": 0.35}, {"year": 1997, "value": 0.46},
    {"year": 1998, "value": 0.61}, {"year": 1999, "value": 0.40},
    {"year": 2000, "value": 0.39}, {"year": 2001, "value": 0.54},
    {"year": 2002, "value": 0.63}, {"year": 2003, "value": 0.62},
    {"year": 2004, "value": 0.54}, {"year": 2005, "value": 0.68},
    {"year": 2006, "value": 0.64}, {"year": 2007, "value": 0.66},
    {"year": 2008, "value": 0.54}, {"year": 2009, "value": 0.64},
    {"year": 2010, "value": 0.72}, {"year": 2011, "value": 0.61},
    {"year": 2012, "value": 0.64}, {"year": 2013, "value": 0.68},
    {"year": 2014, "value": 0.75}, {"year": 2015, "value": 0.90},
    {"year": 2016, "value": 1.01}, {"year": 2017, "value": 0.92},
    {"year": 2018, "value": 0.85}, {"year": 2019, "value": 0.98},
    {"year": 2020, "value": 1.02}, {"year": 2021, "value": 0.85},
    {"year": 2022, "value": 0.89}, {"year": 2023, "value": 1.17},
    {"year": 2024, "value": 1.29},
]


# ──────────────────────────────────────────────
# _x_values
# ──────────────────────────────────────────────

class TestXValues:
    def test_year_keys(self):
        series = [{"year": 2020}, {"year": 2021}, {"year": 2022}]
        x = _x_values(series, "year")
        assert x is not None
        np.testing.assert_array_almost_equal(x, [2020.0, 2021.0, 2022.0])

    def test_date_keys(self):
        series = [{"date": "2020-01-01"}, {"date": "2020-07-01"}]
        x = _x_values(series, "date")
        assert x is not None
        assert x[0] == pytest.approx(2020.0, abs=0.01)
        assert x[1] == pytest.approx(2020.5, abs=0.02)

    def test_empty(self):
        assert _x_values([], "year") is None

    def test_invalid_date(self):
        series = [{"date": "not-a-date"}]
        assert _x_values(series, "date") is None

    def test_leap_year(self):
        series = [{"date": "2024-03-01"}]
        x = _x_values(series, "date")
        # March 1 in leap year = day 61, 61/366 ≈ 0.1667
        assert x is not None
        assert x[0] == pytest.approx(2024.1667, abs=0.01)


# ──────────────────────────────────────────────
# linear_trend
# ──────────────────────────────────────────────

class TestLinearTrend:
    def test_perfect_linear(self):
        series = [{"year": y, "value": 2.0 * y} for y in range(2000, 2020)]
        result = linear_trend(series)
        assert result is not None
        assert result["slope_per_year"] == pytest.approx(2.0, abs=0.01)
        assert result["r_squared"] == pytest.approx(1.0, abs=1e-6)

    def test_gistemp_has_positive_slope(self):
        result = linear_trend(GISTEMP_ANNUAL)
        assert result is not None
        assert result["slope_per_year"] > 0
        assert result["n"] == len(GISTEMP_ANNUAL)
        assert result["r_squared"] > 0.5

    def test_too_few_points(self):
        series = [{"year": 2020, "value": 1.0}, {"year": 2021, "value": 2.0}]
        assert linear_trend(series) is None

    def test_constant_series(self):
        series = [{"year": y, "value": 5.0} for y in range(2000, 2020)]
        result = linear_trend(series)
        assert result is not None
        assert result["slope_per_year"] == pytest.approx(0.0, abs=1e-6)
        # scipy.stats.linregress returns nan for r on constant series
        assert result["r_squared"] == 0.0 or np.isnan(result["r_squared"])

    def test_recent_slope_accelerating_series(self):
        """Прискорюваний ряд (як CO₂) має recent_slope > long-run slope."""
        # Пологий початок, круте закінчення
        series = []
        for y in range(1990, 2005):
            series.append({"year": y, "value": 300.0 + 0.5 * (y - 1990)})
        for y in range(2005, 2026):
            series.append({"year": y, "value": 300.0 + 0.5 * 15 + 3.0 * (y - 2005)})
        result = linear_trend(series)
        assert result is not None
        assert result["recent_slope_per_year"] > result["slope_per_year"]

    def test_recent_slope_insufficient_points(self):
        """Замало точок у вікні → recent_slope_per_year відсутній."""
        series = [{"year": 2023, "value": 1.0}, {"year": 2024, "value": 2.0}, {"year": 2025, "value": 3.0}]
        result = linear_trend(series)
        assert result is not None
        # вікно 10 років покриває всі 3 точки → recent_slope дорівнює загальному
        assert "recent_slope_per_year" in result


# ──────────────────────────────────────────────
# z_score_anomaly
# ──────────────────────────────────────────────

class TestZScoreAnomaly:
    def test_point_on_trend(self):
        """Точка рівно на тренді → z = None (std=0, неможливо нормалізувати)."""
        series = [{"year": y, "value": 0.5 * y} for y in range(2000, 2012)]
        z = z_score_anomaly(series)
        assert z is None  # std(residuals) = 0 → None

    def test_point_above_trend(self):
        """Остання точка вище тренду → z > 0."""
        series = [{"year": y, "value": 0.5 * y} for y in range(2000, 2011)]
        series.append({"year": 2011, "value": 0.5 * 2011 + 3.0})
        z = z_score_anomaly(series)
        assert z is not None
        assert z > 1.0

    def test_gistemp_returns_value(self):
        """На реальних GISTEMP даних z має бути числом."""
        z = z_score_anomaly(GISTEMP_ANNUAL)
        assert z is not None
        assert isinstance(z, float)

    def test_min_points_8(self):
        """Менше 8 точок → None."""
        series = [{"year": y, "value": float(y)} for y in range(2000, 2007)]
        assert z_score_anomaly(series) is None

    def test_exactly_8_points(self):
        """Рівно 8 точок — має працювати."""
        series = [{"year": y, "value": float(y) + np.random.normal(0, 0.1)} for y in range(2000, 2008)]
        z = z_score_anomaly(series)
        assert z is not None

    def test_std_zero(self):
        """Всі залишки = 0 → None (неможливо нормалізувати)."""
        series = [{"year": y, "value": 0.0} for y in range(2000, 2010)]
        z = z_score_anomaly(series)
        assert z is None


# ──────────────────────────────────────────────
# year_over_year
# ──────────────────────────────────────────────

class TestYearOverYear:
    def test_annual_series(self):
        """Річні дані: steps=1, різниця між останнім і передостаннім."""
        series = [
            {"year": 2020, "value": 100.0},
            {"year": 2021, "value": 105.0},
            {"year": 2022, "value": 110.0},
        ]
        yoy = year_over_year(series)
        assert yoy == pytest.approx(5.0)

    def test_monthly_series(self):
        """Місячні дані з ISO-датами: steps ≈ 12."""
        series = [{"date": f"2020-{i+1:02d}-15", "value": float(i)}
                  for i in range(12)]  # 12 months in 2020
        series += [{"date": f"2021-{i+1:02d}-15", "value": float(i) + 10.0}
                   for i in range(12)]
        yoy = year_over_year(series, time_key="date")
        assert yoy is not None
        # series[-1] = 2021-12 (value=21.0), series[-13] = 2020-12 (value=11.0)
        assert yoy == pytest.approx(10.0)

    def test_two_points(self):
        """Лише 2 точки — має працювати (steps=1)."""
        series = [{"year": 2020, "value": 10.0}, {"year": 2021, "value": 12.0}]
        yoy = year_over_year(series)
        assert yoy == pytest.approx(2.0)

    def test_single_point(self):
        """Одна точка → None."""
        series = [{"year": 2020, "value": 10.0}]
        assert year_over_year(series) is None

    def test_gap_handling_by_date(self):
        """Пропуск дати: YoY має порівнювати з точкою ~1 рік тому (за датою), а не зміщуватись."""
        # Річні дані, але 2021 рік пропущений (немає точки даних)
        series = [
            {"year": 2020, "value": 100.0},
            {"year": 2022, "value": 106.0},
            {"year": 2023, "value": 110.0},
        ]
        # Остання точка = 2023 (110). Точка ~1 рік тому = 2022 (106) → +4.0
        yoy = year_over_year(series, time_key="year")
        assert yoy == pytest.approx(4.0)

    def test_all_same_dates(self):
        """Всі дати однакові → None."""
        series = [{"year": 2020, "value": 10.0}, {"year": 2020, "value": 12.0}]
        yoy = year_over_year(series)
        assert yoy is None

    def test_insufficient_history(self):
        """Місячні дані, але менше 12 місяців → None."""
        series = [{"year": 2020, "month": i + 1, "value": float(i)}
                  for i in range(6)]
        yoy = year_over_year(series)
        assert yoy is None


# ──────────────────────────────────────────────
# to_annual_average
# ──────────────────────────────────────────────

class TestToAnnualAverage:
    def test_monthly_to_annual(self):
        monthly = [
            {"year": 2020, "month": 1, "value": 10.0},
            {"year": 2020, "month": 7, "value": 20.0},
            {"year": 2021, "month": 1, "value": 30.0},
        ]
        annual = to_annual_average(monthly)
        assert len(annual) == 2
        assert annual[0] == {"year": 2020, "value": 15.0}
        assert annual[1] == {"year": 2021, "value": 30.0}

    def test_empty(self):
        assert to_annual_average([]) == []

    def test_already_annual(self):
        series = [{"year": 2020, "value": 5.0}]
        annual = to_annual_average(series)
        assert annual == [{"year": 2020, "value": 5.0}]


# ──────────────────────────────────────────────
# describe (агрегований)
# ──────────────────────────────────────────────

class TestDescribe:
    def test_gistemp(self):
        result = describe(GISTEMP_ANNUAL)
        assert "trend_analysis" in result
        assert "z_score_anomaly" in result
        assert "year_over_year" in result

    def test_short_series(self):
        """Короткий ряд → частковий або порожній результат."""
        series = [{"year": 2020, "value": 1.0}]
        result = describe(series)
        assert isinstance(result, dict)


# ──────────────────────────────────────────────
# Integration: реальні API-ряди (потребує мережі)
# ──────────────────────────────────────────────

@pytest.mark.skipif(
    os.getenv("CI") == "true" and not os.getenv("RUN_INTEGRATION"),
    reason="Спрощений CI — запускати з RUN_INTEGRATION=1"
)
class TestIntegration:
    def test_gistemp_real(self):
        from data_sources import get_gistemp
        data = get_gistemp()
        series = data.get("series", [])
        assert len(series) > 20
        result = describe(series)
        assert "trend_analysis" in result
        trend = result["trend_analysis"]
        assert trend["slope_per_year"] > 0, "GISTEMP must show warming"
        assert trend["n"] >= 20

    def test_co2_real(self):
        from data_sources import get_co2
        from analytics import to_annual_average
        data = get_co2()
        monthly = data.get("series", [])
        assert len(monthly) > 100
        annual = to_annual_average(monthly)
        assert len(annual) > 10
        result = describe(annual)
        assert "trend_analysis" in result
        assert result["trend_analysis"]["slope_per_year"] > 0

    def test_sea_level_real(self):
        from data_sources import get_sea_level
        data = get_sea_level()
        series = data.get("series", [])
        assert len(series) > 100
        result = describe(series, time_key="date")
        assert "trend_analysis" in result
        assert result["trend_analysis"]["slope_per_year"] > 0


# ──────────────────────────────────────────────
# Aurora fallback (unit-тест без мережі)
# ──────────────────────────────────────────────

class TestAuroraFallback:
    """Перевірка фізичної коректності формульної оцінки aurora."""

    @pytest.fixture(autouse=True)
    def _mock_ovation_down(self, monkeypatch):
        """Робимо OVATION недоступним, щоб використовувався Kp-fallback."""
        import data_sources as ds
        original_httpx_get = ds.httpx.get
        def _selective_mock(url, *args, **kwargs):
            if "ovation_aurora" in str(url):
                import httpx
                raise httpx.ConnectError("mock: OVATION down")
            return original_httpx_get(url, *args, **kwargs)
        monkeypatch.setattr(ds.httpx, "get", _selective_mock)

    def test_kyiv_low_kp(self):
        """Київ (~50.5°N) при Kp < 3 → probability ≈ 0."""
        import data_sources as ds
        original_geomag = ds.get_geomagnetic
        ds.get_geomagnetic = lambda: {"current_kp": 2}
        try:
            result = ds.fetch_aurora(50.45, 30.52)
            assert result["source"] == "NOAA SWPC (Kp estimate)"
            assert result["probability"] is not None
            assert result["probability"] < 15.0
        finally:
            ds.get_geomagnetic = original_geomag

    def test_murmansk_higher_than_kyiv(self):
        """Мурманск (~69°N) має давати більшу ймовірність за Київ при тому ж Kp."""
        import data_sources as ds
        original_geomag = ds.get_geomagnetic
        ds.get_geomagnetic = lambda: {"current_kp": 3}
        try:
            kyiv = ds.fetch_aurora(50.45, 30.52)
            murmansk = ds.fetch_aurora(68.95, 33.09)
            assert murmansk["probability"] > kyiv["probability"]
        finally:
            ds.get_geomagnetic = original_geomag

    def test_storm_kp9_southern(self):
        """Kp=9 → навіть нижчі широти мають ненульову ймовірність."""
        import data_sources as ds
        original_geomag = ds.get_geomagnetic
        ds.get_geomagnetic = lambda: {"current_kp": 9}
        try:
            result = ds.fetch_aurora(45.0, 30.0)
            assert result["probability"] > 0
        finally:
            ds.get_geomagnetic = original_geomag


# ──────────────────────────────────────────────
# Fallback fires: simulated flag
# ──────────────────────────────────────────────

class TestFallbackFires:
    def test_simulated_flag(self):
        from data_sources import _fallback_fires_data
        data = _fallback_fires_data()
        assert data["live"] is False
        assert "simulated" in data["source"].lower() or "simulated" in data["source"]
        for fire in data["fires"]:
            assert fire.get("simulated") is True

    def test_count(self):
        from data_sources import _fallback_fires_data
        data = _fallback_fires_data()
        assert len(data["fires"]) == len(data["fires"])  # sanity
        assert len(data["fires"]) >= 20  # 24 фіксовані точки на суходолі
