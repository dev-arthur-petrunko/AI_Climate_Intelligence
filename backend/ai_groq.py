"""Groq-powered AI analysis and predictions for the Climate Intelligence backend.

Uses the Groq API (OpenAI-compatible chat completions) to generate:
  - Today's climate situation analysis — regenerated twice a day at
    09:00 and 17:00 Kyiv time (EET/EEST)
  - AI predictions / forecasts based on the latest live data

The AI analysis is generated in the requested UI language (en/uk/de/pl/fr/it/ka).

Requires the GROQ_API_KEY environment variable. If the key is missing or a
request fails, the module falls back to deterministic template summaries so the
frontend always receives a response.
"""

import json
import os
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import httpx
from dotenv import load_dotenv

load_dotenv()

_TIMEOUT = httpx.Timeout(45.0)
_GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
_DEFAULT_MODEL = "llama-3.3-70b-versatile"

try:
    _KYIV_TZ = ZoneInfo("Europe/Kyiv")
except ZoneInfoNotFoundError:
    # Fallback: 3h offset (Kyiv = UTC+2 in winter, UTC+3 in DST; use a fixed +3)
    from datetime import timedelta

    _KYIV_TZ = timezone(timedelta(hours=3))
# Регенерація аналізу двічі на день о 09:00 та 17:00 за Києвом
_ANALYSIS_SLOT_HOURS = (9, 17)

_cache: dict = {}

# Назви мов для промпту Groq
_LANG_NAMES = {
    "en": "English",
    "uk": "Ukrainian",
    "de": "German",
    "pl": "Polish",
    "fr": "French",
    "it": "Italian",
    "ka": "Georgian",
}


def _normalize_lang(lang: str) -> str:
    return lang if lang in _LANG_NAMES else "en"


def _lang_name(lang: str) -> str:
    return _LANG_NAMES.get(_normalize_lang(lang), "English")


def _last_slot_utc() -> datetime:
    """Найновіший запланований слот (09:00/17:00 за Києвом), що вже минув.

    Повертає UTC datetime слота. Поки не настав наступний слот — аналіз
    вважається актуальним і не перегенеровується.
    """
    now_local = datetime.now(_KYIV_TZ)
    today = now_local.date()

    candidates = [
        datetime(today.year, today.month, today.day, h, 0, tzinfo=_KYIV_TZ)
        for h in _ANALYSIS_SLOT_HOURS
    ]
    # Додаємо вчорашній 17:00 для ранкового вікна (00:00–08:59)
    prev_day = today.toordinal() - 1
    prev_date = datetime.fromordinal(prev_day)
    candidates.append(
        datetime(prev_date.year, prev_date.month, prev_date.day, 17, 0, tzinfo=_KYIV_TZ)
    )

    passed = [c for c in candidates if c <= now_local]
    slot = max(passed) if passed else candidates[-1]
    return slot.astimezone(timezone.utc)


def _api_key() -> str:
    return os.getenv("GROQ_API_KEY", "").strip()


def _model() -> str:
    return os.getenv("GROQ_MODEL", _DEFAULT_MODEL).strip() or _DEFAULT_MODEL


def _chat(messages: List[Dict[str, str]]) -> Optional[str]:
    """Call the Groq chat completions API. Returns text or None on failure."""
    key = _api_key()
    if not key:
        return None
    try:
        r = httpx.post(
            _GROQ_URL,
            headers={
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
            },
            json={
                "model": _model(),
                "messages": messages,
                "temperature": 0.4,
                "max_tokens": 1600,
            },
            timeout=_TIMEOUT,
        )
        r.raise_for_status()
        payload = r.json()
        return payload["choices"][0]["message"]["content"]
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Data snapshot used to ground the AI prompts in real observations
# ---------------------------------------------------------------------------

def _data_snapshot() -> Dict[str, Any]:
    """Collect the latest values from the data adapters into a compact snapshot."""
    snapshot: Dict[str, Any] = {}

    try:
        from data_sources import (
            get_weather,
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

        weather = get_weather(50.45, 30.52)
        snapshot["weather"] = weather.get("current", {})
        snapshot["temperature"] = (get_gistemp() or {}).get("latest")
        snapshot["co2"] = (get_co2() or {}).get("latest")
        snapshot["arctic_ice"] = (get_sea_ice() or {}).get("latest")
        snapshot["antarctic_ice"] = (get_sea_ice_south() or {}).get("latest")
        snapshot["sea_level"] = (get_sea_level() or {}).get("latest")
        snapshot["ocean_heat"] = (get_ocean_heat() or {}).get("latest")
        snapshot["ocean_ph"] = (get_ocean_ph() or {}).get("latest")

        storms = (get_hurricanes() or {}).get("storms", [])
        snapshot["storms"] = len(storms)
        snapshot["fires"] = (get_fires(1) or {}).get("count", 0)
    except Exception:
        pass

    return snapshot


def _snapshot_text(snapshot: Dict[str, Any]) -> str:
    """Render the snapshot into a compact human-readable block for the prompt."""
    lines: List[str] = []

    weather = snapshot.get("weather") or {}
    if weather.get("temperature_2m") is not None:
        lines.append(
            f"- Local weather (Kyiv): {weather.get('temperature_2m')}°C, "
            f"clouds {weather.get('cloud_cover')}%, wind {weather.get('wind_speed_10m')} km/h"
        )
    if snapshot.get("temperature"):
        anom = snapshot["temperature"].get("value")
        if anom is not None:
            lines.append(f"- Global temperature anomaly: {anom:+.2f}°C vs 1951-1980 baseline")
    if snapshot.get("co2"):
        co2 = snapshot["co2"].get("value")
        if co2 is not None:
            lines.append(f"- Atmospheric CO2: {co2:.1f} ppm")
    if snapshot.get("arctic_ice"):
        extent = snapshot["arctic_ice"].get("extent")
        if extent is not None:
            lines.append(f"- Arctic sea ice extent: {extent:.2f}M km²")
    if snapshot.get("antarctic_ice"):
        extent = snapshot["antarctic_ice"].get("extent")
        if extent is not None:
            lines.append(f"- Antarctic sea ice extent: {extent:.2f}M km²")
    if snapshot.get("sea_level"):
        value = snapshot["sea_level"].get("value")
        if value is not None:
            lines.append(f"- Global sea level: {value:+.0f} mm")
    if snapshot.get("ocean_heat"):
        value = snapshot["ocean_heat"].get("value")
        if value is not None:
            lines.append(f"- Ocean heat content (0-2000m): {value:.0f} ZJ")
    if snapshot.get("ocean_ph"):
        value = snapshot["ocean_ph"].get("value")
        if value is not None:
            lines.append(f"- Ocean surface pH: {value:.3f}")
    lines.append(f"- Active fire hotspots: {snapshot.get('fires', 0)}")
    lines.append(f"- Active tropical cyclones: {snapshot.get('storms', 0)}")

    return "\n".join(lines) if lines else "No live data available at the moment."


# ---------------------------------------------------------------------------
# AI analysis of today's situation (09:00 / 17:00 Kyiv, per language)
# ---------------------------------------------------------------------------

def _generate_analysis(lang: str, slot_utc: datetime) -> Dict[str, Any]:
    """Generate a fresh AI analysis of today's climate situation via Groq."""
    lang = _normalize_lang(lang)
    snapshot = _data_snapshot()
    snapshot_block = _snapshot_text(snapshot)

    system_prompt = (
        "You are a senior climate scientist for the AI Climate Intelligence platform. "
        "You analyze the current state of the planet using real-time satellite and "
        "station data. Be concise, factual, and structured. Use plain text with short "
        "paragraphs and bullet points. Never invent numbers — only reference the data "
        "provided. "
        f"Write your entire answer in {_lang_name(lang)}. Keep it under 220 words."
    )
    user_prompt = (
        "Here is today's climate snapshot:\n\n"
        f"{snapshot_block}\n\n"
        "Please analyze the current situation for today: highlight the most important "
        "indicators, trends and any urgent risks or anomalies. Structure the answer with "
        "a short overview paragraph followed by 3-5 bullet points."
    )

    text = _chat(
        [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]
    )

    if text:
        return {
            "analysis": text.strip(),
            "model": _model(),
            "generated_at": slot_utc.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "live": True,
            "lang": lang,
        }

    # Fallback template when Groq is unavailable
    return _template_analysis(snapshot, lang, slot_utc)


# Шаблони резервного аналізу для всіх 7 мов інтерфейсу
_TEMPLATE_ANALYSIS = {
    "en": {
        "temp": "Global temperature anomaly is {v}°C relative to the 1951-1980 baseline, continuing the long-term warming trend.",
        "co2": "Atmospheric CO2 has reached {v} ppm, a record high.",
        "fires": "Satellites currently track {n} active fire hotspots globally.",
        "storms": "{n} tropical cyclone(s) are active in the Atlantic basin.",
        "fallback": "Live data is being aggregated. The planet is under continuous AI monitoring.",
    },
    "uk": {
        "temp": "Глобальна температурна аномалія становить {v}°C відносно базового періоду 1951–1980, продовжуючи довгостроковий тренд потепління.",
        "co2": "Концентрація CO2 в атмосфері досягла {v} ppm — рекордний рівень.",
        "fires": "Супутники відстежують {n} активних осередків пожеж у світі.",
        "storms": "В Атлантичному басейні активні {n} тропічний(их) циклон(ів).",
        "fallback": "Живі дані агрегуються. Планета перебуває під безперервним AI-моніторингом.",
    },
    "de": {
        "temp": "Die globale Temperaturanomalie beträgt {v}°C gegenüber der Referenzperiode 1951–1980 und setzt den langfristigen Erwärmungstrend fort.",
        "co2": "Die atmosphärische CO2-Konzentration hat {v} ppm erreicht — ein Rekordwert.",
        "fires": "Satelliten erfassen derzeit {n} aktive Brandherde weltweit.",
        "storms": "{n} tropischer Wirbelsturm/Wirbelstürme ist/sind im Atlantikbecken aktiv.",
        "fallback": "Live-Daten werden aggregiert. Der Planet wird kontinuierlich per KI überwacht.",
    },
    "pl": {
        "temp": "Globalna anomalia temperatury wynosi {v}°C względem linii bazowej 1951–1980, kontynuując długoterminowy trend ocieplenia.",
        "co2": "Stężenie CO2 w atmosferze osiągnęło {v} ppm — rekordowy poziom.",
        "fires": "Satelity obecnie śledzą {n} aktywnych ognisk pożarów na świecie.",
        "storms": "{n} cyklon(y) tropikalne jest/są aktywne w basenie atlantyckim.",
        "fallback": "Dane na żywo są agregowane. Planeta jest pod ciągłym monitoringiem AI.",
    },
    "fr": {
        "temp": "L'anomalie de température mondiale est de {v}°C par rapport à la référence 1951–1980, poursuivant la tendance au réchauffement à long terme.",
        "co2": "Le CO2 atmosphérique a atteint {v} ppm, un niveau record.",
        "fires": "Les satellites suivent actuellement {n} foyers d'incendie actifs dans le monde.",
        "storms": "{n} cyclone(s) tropical(aux) est/sont actif(s) dans le bassin atlantique.",
        "fallback": "Les données en direct sont agrégées. La planète est sous surveillance IA continue.",
    },
    "it": {
        "temp": "L'anomalia di temperatura globale è di {v}°C rispetto alla linea di base 1951–1980, proseguendo la tendenza al riscaldamento a lungo termine.",
        "co2": "La CO2 atmosferica ha raggiunto {v} ppm, un livello record.",
        "fires": "I satelliti attualmente tracciano {n} focolai di incendio attivi nel mondo.",
        "storms": "{n} ciclone(i) tropicale(i) attivo(i) nel bacino atlantico.",
        "fallback": "I dati live vengono aggregati. Il pianeta è sotto monitoraggio IA continuo.",
    },
    "ka": {
        "temp": "გლობალური ტემპერატურული ანომალია არის {v}°C საბაზო პერიოდთან 1951–1980 შედარებით, რაც აგრძელებს დათბობის გრძელვადიან ტენდენციას.",
        "co2": "ატმოსფერულმა CO2-მა მიაღწია {v} ppm-ს — რეკორდულ მაჩვენებელს.",
        "fires": "სატელიტები ამჟამად აკვირდებიან {n} აქტიურ ხანძრის კერას მსოფლიოში.",
        "storms": "ატლანტიკის აუზში აქტიურია {n} ტროპიკული ციკლონი.",
        "fallback": "პირდაპირი მონაცემები გროვდება. პლანეტა იმყოფება უწყვეტი AI მონიტორინგის ქვეშ.",
    },
}


def _template_analysis(snapshot: Dict[str, Any], lang: str, slot_utc: datetime) -> Dict[str, Any]:
    """Deterministic fallback used when the Groq key is missing or the call fails."""
    lang = _normalize_lang(lang)
    tpl = _TEMPLATE_ANALYSIS[lang]
    parts = []

    anomaly = (snapshot.get("temperature") or {}).get("value")
    if anomaly is not None:
        parts.append(tpl["temp"].format(v=f"{anomaly:+.2f}"))
    co2 = (snapshot.get("co2") or {}).get("value")
    if co2 is not None:
        parts.append(tpl["co2"].format(v=f"{co2:.1f}"))
    fires = snapshot.get("fires", 0)
    if fires:
        parts.append(tpl["fires"].format(n=fires))
    storms = snapshot.get("storms", 0)
    if storms:
        parts.append(tpl["storms"].format(n=storms))
    if not parts:
        parts.append(tpl["fallback"])

    return {
        "analysis": " ".join(parts),
        "model": "fallback",
        "generated_at": slot_utc.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "live": False,
        "lang": lang,
    }


def get_ai_analysis(lang: str = "en") -> Dict[str, Any]:
    """Return today's AI analysis in the requested language.

    Regenerated at most twice per day: when the current Kyiv time has passed
    the next scheduled slot (09:00 or 17:00).
    """
    lang = _normalize_lang(lang)
    slot = _last_slot_utc()
    key = f"ai_analysis:{lang}"
    hit = _cache.get(key)
    if hit and hit["data"].get("generated_at"):
        try:
            gen = datetime.strptime(hit["data"]["generated_at"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
        except ValueError:
            gen = None
        if gen is not None and gen >= slot:
            return hit["data"]
    data = _generate_analysis(lang, slot)
    _cache[key] = {"ts": time.time(), "data": data}
    return data


# ---------------------------------------------------------------------------
# AI predictions (used by /api/predictions)
# ---------------------------------------------------------------------------

def _parse_predictions(text: str) -> Optional[List[Dict[str, Any]]]:
    """Try to extract a JSON list of predictions from the Groq response."""
    try:
        start = text.index("[")
        end = text.rindex("]") + 1
        data = json.loads(text[start:end])
        if isinstance(data, list):
            return data
    except (ValueError, json.JSONDecodeError):
        pass
    return None


def _generate_predictions(lang: str) -> List[Dict[str, Any]]:
    """Generate AI predictions for the planet's near-term climate via Groq."""
    lang = _normalize_lang(lang)
    snapshot = _data_snapshot()
    snapshot_block = _snapshot_text(snapshot)

    system_prompt = (
        "You are a climate risk forecasting AI. Based on the provided data snapshot, "
        "generate exactly 5 predictions about near-term climate risks. Return ONLY a "
        "valid JSON array, no markdown. Each object must have exactly these keys:\n"
        '  - "category": string (e.g. "Temperature", "Wildfire Risk", "Flood Risk", "Sea Ice", "Cyclone")\n'
        '  - "prediction": short string describing the expected situation\n'
        '  - "probability": float 0..1\n'
        '  - "confidence_interval": [low, high] two floats 0..1\n'
        '  - "reasoning": short explanation grounded in the provided data\n'
        '  - "risk_level": "low" | "medium" | "high"\n'
        '  - "timeframe": short string (e.g. "7-14 days")\n'
        "Do not invent numeric facts beyond the data; the reasoning should reference the snapshot. "
        f"Write all string values in {_lang_name(lang)}."
    )
    user_prompt = f"Data snapshot:\n\n{snapshot_block}"

    text = _chat(
        [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]
    )

    if text:
        parsed = _parse_predictions(text)
        if parsed and len(parsed) >= 2:
            return parsed

    return _template_predictions(snapshot, lang)


# Шаблони резервних прогнозів для всіх 7 мов
_TEMPLATE_PREDICTIONS = {
    "en": {
        "temperature": {"category": "Temperature", "prediction": "Global mean temperature anomaly continues to trend upward", "reasoning": "Current anomaly of {v}°C versus the 1951-1980 baseline indicates sustained warming."},
        "wildfire": {"category": "Wildfire Risk", "prediction": "Elevated wildfire activity in regions with active hotspots", "reasoning": "{n} active fire hotspots detected by satellites."},
        "cyclone": {"category": "Cyclone", "prediction": "Active tropical cyclones may intensify over warm waters", "reasoning": "{n} tropical cyclone(s) currently tracked in the Atlantic."},
        "ice": {"category": "Sea Ice", "prediction": "Polar sea ice extent remains below its long-term seasonal baseline", "reasoning": "Long-term Arctic and Antarctic sea ice trends are declining."},
        "ocean": {"category": "Ocean Heat", "prediction": "Ocean heat content continues to accumulate, fueling extremes", "reasoning": "Upper-ocean heat storage keeps increasing year over year."},
    },
    "uk": {
        "temperature": {"category": "Температура", "prediction": "Глобальна температурна аномалія продовжує зростати", "reasoning": "Поточна аномалія {v}°C відносно базового періоду 1951–1980 вказує на стале потепління."},
        "wildfire": {"category": "Ризик пожеж", "prediction": "Підвищена пожежна активність у регіонах з активними осередками", "reasoning": "Супутники виявили {n} активних осередків пожеж."},
        "cyclone": {"category": "Циклон", "prediction": "Активні тропічні циклони можуть посилитися над теплими водами", "reasoning": "В Атлантиці відстежується {n} тропічний(их) циклон(ів)."},
        "ice": {"category": "Морський лід", "prediction": "Протяжність полярного морського льоду залишається нижчою за сезонну норму", "reasoning": "Довгострокові тенденції арктичного та антарктичного льоду знижуються."},
        "ocean": {"category": "Тепло океану", "prediction": "Тепло океану продовжує накопичуватися, посилюючи екстремуми", "reasoning": "Запас тепла верхнього шару океану зростає з року в рік."},
    },
    "de": {
        "temperature": {"category": "Temperatur", "prediction": "Die globale Temperaturanomalie steigt weiter an", "reasoning": "Die aktuelle Anomalie von {v}°C gegenüber der Basislinie 1951–1980 deutet auf eine anhaltende Erwärmung hin."},
        "wildfire": {"category": "Waldbrandrisiko", "prediction": "Erhöhte Waldbrandaktivität in Regionen mit aktiven Brandherden", "reasoning": "{n} aktive Brandherde von Satelliten erkannt."},
        "cyclone": {"category": "Wirbelsturm", "prediction": "Aktive tropische Wirbelstürme können sich über warmem Wasser verstärken", "reasoning": "{n} tropischer Wirbelsturm/Wirbelstürme werden im Atlantik verfolgt."},
        "ice": {"category": "Meereis", "prediction": "Die Ausdehnung des polaren Meereises bleibt unter der saisonalen Basislinie", "reasoning": "Langfristige Trends von arktischem und antarktischem Meereis sind rückläufig."},
        "ocean": {"category": "Ozeanwärme", "prediction": "Die Ozeanwärme nimmt weiter zu und befeuert Extreme", "reasoning": "Die Wärmespeicherung des oberen Ozeans steigt Jahr für Jahr."},
    },
    "pl": {
        "temperature": {"category": "Temperatura", "prediction": "Globalna anomalia temperatury nadal rośnie", "reasoning": "Obecna anomalia {v}°C względem linii bazowej 1951–1980 wskazuje na utrzymujące się ocieplenie."},
        "wildfire": {"category": "Ryzyko pożarów", "prediction": "Podwyższona aktywność pożarowa w regionach z aktywnymi ogniskami", "reasoning": "{n} aktywnych ognisk pożarów wykrytych przez satelity."},
        "cyclone": {"category": "Cyklon", "prediction": "Aktywne cyklony tropikalne mogą się wzmocnić nad ciepłymi wodami", "reasoning": "{n} cyklon(y) tropikalnych śledzonych na Atlantyku."},
        "ice": {"category": "Lód morski", "prediction": "Zasięg polarnego lodu morskiego pozostaje poniżej sezonowej normy", "reasoning": "Długoterminowe trendy lodu arktycznego i antarktycznego spadają."},
        "ocean": {"category": "Ciepło oceanu", "prediction": "Ciepło oceanu nadal się gromadzi, napędzając ekstrema", "reasoning": "Zasoby ciepła górnego oceanu rosną z roku na rok."},
    },
    "fr": {
        "temperature": {"category": "Température", "prediction": "L'anomalie de température mondiale continue de monter", "reasoning": "L'anomalie actuelle de {v}°C par rapport à la référence 1951-1980 indique un réchauffement soutenu."},
        "wildfire": {"category": "Risque d'incendie", "prediction": "Activité d'incendie élevée dans les régions à foyers actifs", "reasoning": "{n} foyers d'incendie actifs détectés par satellite."},
        "cyclone": {"category": "Cyclone", "prediction": "Les cyclones tropicaux actifs peuvent s'intensifier sur les eaux chaudes", "reasoning": "{n} cyclone(s) tropical(aux) suivi(s) dans l'Atlantique."},
        "ice": {"category": "Glace marine", "prediction": "L'étendue de la glace polaire reste sous la référence saisonnière", "reasoning": "Les tendances à long terme de la glace arctique et antarctique sont à la baisse."},
        "ocean": {"category": "Chaleur océanique", "prediction": "La chaleur océanique continue de s'accumuler, alimentant les extrêmes", "reasoning": "Le stockage de chaleur de l'océan supérieur augmente chaque année."},
    },
    "it": {
        "temperature": {"category": "Temperatura", "prediction": "L'anomalia di temperatura globale continua a salire", "reasoning": "L'anomalia attuale di {v}°C rispetto alla linea di base 1951-1980 indica un riscaldamento sostenuto."},
        "wildfire": {"category": "Rischio incendi", "prediction": "Attività di incendio elevata nelle regioni con focolai attivi", "reasoning": "{n} focolai di incendio attivi rilevati dai satelliti."},
        "cyclone": {"category": "Ciclone", "prediction": "I cicloni tropicali attivi possono intensificarsi su acque calde", "reasoning": "{n} ciclone(i) tropicale(i) attualmente monitorati nell'Atlantico."},
        "ice": {"category": "Ghiaccio marino", "prediction": "L'estensione del ghiaccio polare resta sotto la linea di base stagionale", "reasoning": "Le tendenze a lungo termine del ghiaccio artico e antartico sono in calo."},
        "ocean": {"category": "Calore oceanico", "prediction": "Il calore oceanico continua ad accumularsi, alimentando gli estremi", "reasoning": "Lo stoccaggio di calore dell'oceano superiore cresce anno dopo anno."},
    },
    "ka": {
        "temperature": {"category": "ტემპერატურა", "prediction": "გლობალური ტემპერატურული ანომალია აგრძელებს ზრდას", "reasoning": "მიმდინარე ანომალია {v}°C საბაზო პერიოდთან 1951–1980 შედარებით მიუთითებს სტაბილურ დათბობაზე."},
        "wildfire": {"category": "ხანძრის რისკი", "prediction": "ხანძრის გაზრდილი აქტივობა აქტიური კერების მქონე რეგიონებში", "reasoning": "სატელიტებმა აღმოაჩინეს {n} აქტიური ხანძრის კერა."},
        "cyclone": {"category": "ციკლონი", "prediction": "აქტიური ტროპიკული ციკლონები შესაძლოა გაძლიერდნენ თბილ წყლებზე", "reasoning": "ატლანტიკაში აკვირდებიან {n} ტროპიკულ ციკლონს."},
        "ice": {"category": "ზღვის ყინული", "prediction": "პოლარული ყინულის მოცულობა რჩება სეზონურ ნორმაზე დაბლა", "reasoning": "არქტიკის და ანტარქტიდის ყინულის გრძელვადიანი ტენდენციები კლებულობს."},
        "ocean": {"category": "ოკეანის სითბო", "prediction": "ოკეანის სითბო აგრძელებს დაგროვებას და აძლიერებს ექსტრემებს", "reasoning": "ოკეანის ზედა ფენების სითბო წლიდან წლამდე იზრდება."},
    },
}


def _template_predictions(snapshot: Dict[str, Any], lang: str) -> List[Dict[str, Any]]:
    """Deterministic fallback predictions when Groq is unavailable."""
    lang = _normalize_lang(lang)
    tpl = _TEMPLATE_PREDICTIONS[lang]
    predictions: List[Dict[str, Any]] = []

    anomaly = (snapshot.get("temperature") or {}).get("value")
    if anomaly is not None:
        t = tpl["temperature"]
        predictions.append(
            {
                "category": t["category"],
                "prediction": t["prediction"],
                "probability": 0.88,
                "confidence_interval": [0.80, 0.94],
                "reasoning": t["reasoning"].format(v=f"{anomaly:+.2f}"),
                "risk_level": "high",
                "timeframe": "30-90 days",
            }
        )

    fires = snapshot.get("fires", 0)
    if fires:
        t = tpl["wildfire"]
        predictions.append(
            {
                "category": t["category"],
                "prediction": t["prediction"],
                "probability": 0.74,
                "confidence_interval": [0.66, 0.82],
                "reasoning": t["reasoning"].format(n=fires),
                "risk_level": "high",
                "timeframe": "7-14 days",
            }
        )

    storms = snapshot.get("storms", 0)
    if storms:
        t = tpl["cyclone"]
        predictions.append(
            {
                "category": t["category"],
                "prediction": t["prediction"],
                "probability": 0.68,
                "confidence_interval": [0.58, 0.78],
                "reasoning": t["reasoning"].format(n=storms),
                "risk_level": "medium",
                "timeframe": "7-30 days",
            }
        )

    if len(predictions) < 5:
        t = tpl["ice"]
        predictions.append(
            {
                "category": t["category"],
                "prediction": t["prediction"],
                "probability": 0.82,
                "confidence_interval": [0.74, 0.90],
                "reasoning": t["reasoning"],
                "risk_level": "high",
                "timeframe": "90 days",
            }
        )
        t = tpl["ocean"]
        predictions.append(
            {
                "category": t["category"],
                "prediction": t["prediction"],
                "probability": 0.85,
                "confidence_interval": [0.78, 0.92],
                "reasoning": t["reasoning"],
                "risk_level": "high",
                "timeframe": "1 year",
            }
        )

    return predictions[:5]


def get_ai_predictions(lang: str = "en") -> List[Dict[str, Any]]:
    """Return Groq-powered predictions in the requested language."""
    lang = _normalize_lang(lang)
    key = f"ai_predictions:{lang}"
    hit = _cache.get(key)
    if hit:
        return hit["data"]
    data = _generate_predictions(lang)
    _cache[key] = {"ts": time.time(), "data": data}
    return data
