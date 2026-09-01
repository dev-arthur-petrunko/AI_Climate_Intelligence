"""Юніт-тести для горизонт-залежних шаблонних AI-прогнозів (ai_groq)."""

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest

from ai_groq import _horizon_label, _projected, _template_predictions

ALL_LANGS = ("en", "uk", "de", "pl", "fr", "it", "ka")


def _snapshot():
    return {
        "temperature": {"value": 1.35},
        "co2": {"value": 426.5},
        "arctic_ice": {"value": 4.1},
        "sea_level": {"value": 101.0},
        "ocean_heat": {"value": 420.0},
        "ocean_ph": {"value": 8.07},
        "temperature_analysis": {"trend_analysis": {"slope_per_year": 0.019, "recent_slope_per_year": 0.028, "r_squared": 0.9, "n": 46}},
        "co2_analysis": {"trend_analysis": {"slope_per_year": 1.91, "recent_slope_per_year": 2.52, "r_squared": 0.99, "n": 48}},
        "arctic_ice_analysis": {"trend_analysis": {"slope_per_year": -0.05, "recent_slope_per_year": -0.062, "r_squared": 0.8, "n": 40}},
        "sea_level_analysis": {"trend_analysis": {"slope_per_year": 3.6, "recent_slope_per_year": 4.4, "r_squared": 0.85, "n": 31}},
        "ocean_heat_analysis": {"trend_analysis": {"slope_per_year": 9.5, "recent_slope_per_year": 11.0, "r_squared": 0.95, "n": 45}},
        "ocean_ph_analysis": {"trend_analysis": {"slope_per_year": -0.0017, "recent_slope_per_year": -0.0019, "r_squared": 0.9, "n": 33}},
        "fires": 240,
        "storms": 2,
    }


class TestTemplatePredictions:
    def test_horizon_changes_prediction(self):
        """Різні горизонти дають різний текст, імовірність і timeframe."""
        short = _template_predictions(_snapshot(), "en", 7)
        long = _template_predictions(_snapshot(), "en", 3650)
        assert short != long
        assert all(p["timeframe"] == "10 years" for p in long)
        assert all(p["timeframe"] == "7 days" for p in short)
        # довірчість на 10 років нижча, ніж на 7 днів
        short_prob = max(p["probability"] for p in short)
        long_prob = max(p["probability"] for p in long)
        assert long_prob < short_prob

    def test_ten_year_projection_grounded_in_trend(self):
        """Прогноз на 10 років екстраполює поточне значення багаторічним трендом."""
        preds = _template_predictions(_snapshot(), "en", 3650)
        co2 = next(p for p in preds if p["category"] == "CO₂")
        # 426.5 + 2.52*10 ≈ 451.7 ppm
        assert "451" in co2["prediction"]
        assert "2.52" in co2["reasoning"]
        sl = next(p for p in preds if p["category"] == "Sea Level")
        # 101 + 4.4*10 = 145 mm
        assert "+145" in sl["prediction"]

    def test_short_horizon_includes_live_events(self):
        """7 днів — додаються «живі» події (пожежі, циклони)."""
        preds = _template_predictions(_snapshot(), "en", 7)
        cats = {p["category"] for p in preds}
        assert "Wildfire Risk" in cats
        assert "Cyclone" in cats
        wf = next(p for p in preds if p["category"] == "Wildfire Risk")
        assert "240" in wf["prediction"]

    def test_long_horizon_uses_structural_trends(self):
        """3650 днів — структурні тренди (CO₂, рівень моря, тепло океану)."""
        preds = _template_predictions(_snapshot(), "en", 3650)
        cats = {p["category"] for p in preds}
        assert {"CO₂", "Sea Level", "Ocean Heat"}.issubset(cats)
        # на 10 років живі події не домінують
        assert "Wildfire Risk" not in cats

    def test_short_horizon_no_numeric_projection(self):
        """Не використовувати тренд-екстраполяцію для 7/30 днів."""
        preds = _template_predictions(_snapshot(), "en", 30)
        co2 = next(p for p in preds if p["category"] == "CO₂")
        assert "ppm within" not in co2["prediction"]

    def test_ten_year_widening_confidence_interval(self):
        """CI на 10 років ширший, ніж на 7 днів."""
        def avg_width(preds):
            widths = [ci[1] - ci[0] for p in preds if (ci := p["confidence_interval"])]
            return sum(widths) / len(widths)

        assert avg_width(_template_predictions(_snapshot(), "en", 3650)) > avg_width(
            _template_predictions(_snapshot(), "en", 7)
        )

    def test_all_languages_render(self):
        """Усі 7 мов віддають прогнози без помилок форматування."""
        for lang in ALL_LANGS:
            for days in (7, 30, 90, 365, 3650):
                preds = _template_predictions(_snapshot(), lang, days)
                assert preds, lang
                assert all(p["prediction"] and p["reasoning"] for p in preds)

    def test_empty_snapshot_returns_localized_fallback(self):
        """Порожній знімок → щонайменше одна картка мовою інтерфейсу."""
        preds = _template_predictions({}, "de", 365)
        assert len(preds) == 1
        assert preds[0]["timeframe"] == "1 Jahr"

    def test_horizon_label(self):
        assert _horizon_label("uk", 3650) == "10 років"
        assert _horizon_label("ka", 7) == "7 დღე"
        assert _horizon_label("fr", 730) == "2 ans"

    def test_projected(self):
        assert _projected(100.0, 2.0, 10) == pytest.approx(120.0)
        assert _projected(None, 2.0, 10) is None
        assert _projected(100.0, None, 10) is None