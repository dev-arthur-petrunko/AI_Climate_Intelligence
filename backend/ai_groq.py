"""AI-аналіз та прогнози на основі Groq для бекенду Climate Intelligence.

Використовує Groq API (сумісний з OpenAI chat completions) для генерації:
  - аналізу поточної кліматичної ситуації — генерується двічі на день о
    09:00 та 17:00 за Київським часом (EET/EEST)
  - AI-прогнозів на основі останніх живих даних

AI-аналіз генерується запитуваною мовою інтерфейсу (en/uk/de/pl/fr/it/ka).

Потребує змінної середовища GROQ_API_KEY. Якщо ключ відсутній або запит
не вдався, модуль повертається до детермінованих шаблонних підсумків, щоб
фронтенд завжди отримував відповідь.
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
    # Fallback: зсув 3 год (Київ = UTC+2 взимку, UTC+3 влітку; використовуємо фіксований +3)
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
    """Виклик API Groq chat completions. Повертає текст або None у разі помилки."""
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
# Знімок даних, що використовується для «заземлення» AI-промптів реальними спостереженнями
# ---------------------------------------------------------------------------

def _data_snapshot() -> Dict[str, Any]:
    """Збирає останні значення з адаптерів даних у компактний знімок."""
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
        from analytics import describe as analyze

        weather = get_weather(50.45, 30.52)
        snapshot["weather"] = weather.get("current", {})
        snapshot["temperature"] = (get_gistemp() or {}).get("latest")
        snapshot["co2"] = (get_co2() or {}).get("latest")
        snapshot["arctic_ice"] = (get_sea_ice() or {}).get("latest")
        snapshot["antarctic_ice"] = (get_sea_ice_south() or {}).get("latest")
        snapshot["sea_level"] = (get_sea_level() or {}).get("latest")
        snapshot["ocean_heat"] = (get_ocean_heat() or {}).get("latest")
        snapshot["ocean_ph"] = (get_ocean_ph() or {}).get("latest")

        # Обчислена аналітика (тренди, аномалії, YoY) — збагачений контекст для Groq
        snapshot["temperature_analysis"] = analyze((get_gistemp() or {}).get("series", []))
        snapshot["co2_analysis"] = analyze((get_co2() or {}).get("series", []))
        snapshot["arctic_ice_analysis"] = analyze((get_sea_ice() or {}).get("annual_minimum", []))
        snapshot["antarctic_ice_analysis"] = analyze(
            (get_sea_ice_south() or {}).get("annual_minimum", [])
        )
        snapshot["sea_level_analysis"] = analyze(
            (get_sea_level() or {}).get("series", []), time_key="date"
        )
        snapshot["ocean_heat_analysis"] = analyze((get_ocean_heat() or {}).get("series", []))
        snapshot["ocean_ph_analysis"] = analyze(
            (get_ocean_ph() or {}).get("series", []), time_key="date"
        )

        storms = (get_hurricanes() or {}).get("storms", [])
        snapshot["storms"] = len(storms)
        snapshot["fires"] = (get_fires(1) or {}).get("count", 0)
    except Exception:
        pass

    return snapshot


def _snapshot_text(snapshot: Dict[str, Any]) -> str:
    """Перетворює знімок у компактний зрозумілий блок для промпту."""
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

    # Обчислена статистика (тренди, аномалії) для точніших відповідей
    def _trend_line(label: str, analysis: Optional[Dict[str, Any]]) -> Optional[str]:
        if not analysis:
            return None
        trend = analysis.get("trend_analysis")
        if not trend:
            return None
        slope = trend.get("slope_per_year")
        recent = trend.get("recent_slope_per_year")
        r2 = trend.get("r_squared")
        proj = trend.get("projected_next_year")
        parts = [f"- {label} trend: {slope:+.2f}/year"]
        if recent is not None:
            parts.append(f"recent (~10y): {recent:+.2f}/year")
        if r2 is not None:
            parts.append(f"R²={r2:.2f}")
        if proj is not None:
            parts.append(f"projected next point: {proj:.2f}")
        anomaly = analysis.get("z_score_anomaly")
        if anomaly is not None:
            parts.append(f"last point {anomaly:+.1f}σ vs history")
        return " ".join(parts)

    for label, key in (
        ("CO2", "co2_analysis"),
        ("Global temperature anomaly", "temperature_analysis"),
        ("Arctic sea ice annual minimum", "arctic_ice_analysis"),
        ("Antarctic sea ice annual minimum", "antarctic_ice_analysis"),
        ("Global sea level", "sea_level_analysis"),
        ("Ocean heat content", "ocean_heat_analysis"),
        ("Ocean surface pH", "ocean_ph_analysis"),
    ):
        line = _trend_line(label, snapshot.get(key))
        if line:
            lines.append(line)

    return "\n".join(lines) if lines else "No live data available at the moment."


# ---------------------------------------------------------------------------
# AI-аналіз сьогоднішньої ситуації (09:00 / 17:00 за Києвом, кожною мовою)
# ---------------------------------------------------------------------------

def _generate_analysis(lang: str, slot_utc: datetime) -> Dict[str, Any]:
    """Генерує свіжий AI-аналіз поточної кліматичної ситуації через Groq."""
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

    # Шаблонний фолбек, коли Groq недоступний
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


# Шаблони короткого кліматичного резюме для всіх 7 мов інтерфейсу
_SUMMARY_TEMPLATES = {
    "en": {
        "temp": "Global temperature anomaly stands at {v}°C relative to the 1951–1980 baseline.",
        "co2": "Atmospheric CO₂ reached {v} ppm (NOAA GML).",
        "ice": "Arctic sea ice extent is {v}M km² versus the 1981–2010 baseline (NSIDC).",
        "sea_level": "Global mean sea level stands at {v} mm relative to the TOPEX/Jason reference mean.",
        "ocean_heat": "Ocean heat content (0–2000 m) reached {v} zettajoules.",
        "ocean_ph": "Surface ocean pH fell to {v}, reflecting continued acidification (Station ALOHA).",
        "fires": "Satellites are currently tracking {n} active fire hotspots globally.",
        "storms": "{n} tropical cyclone(s) active in the Atlantic basin.",
        "fallback_1": "Satellite observations indicate continuing above-average global temperatures.",
        "fallback_2": "Arctic sea ice remains below its long-term seasonal baseline.",
    },
    "uk": {
        "temp": "Глобальна температурна аномалія становить {v}°C відносно базового періоду 1951–1980.",
        "co2": "Концентрація CO₂ в атмосфері досягла {v} ppm (NOAA GML).",
        "ice": "Площа арктичного морського льоду становить {v} млн км² проти базового періоду 1981–2010 (NSIDC).",
        "sea_level": "Глобальний середній рівень моря становить {v} мм відносно середнього значення супутників TOPEX/Jason.",
        "ocean_heat": "Тепловміст океану (0–2000 м) досяг {v} зетаджоулів.",
        "ocean_ph": "pH поверхневих вод океану знизився до {v}, що відображає продовження закислення (станція ALOHA).",
        "fires": "Супутники відстежують {n} активних осередків пожеж у світі.",
        "storms": "В Атлантичному басейні активні {n} тропічних циклонів.",
        "fallback_1": "Супутникові спостереження вказують на подальші вищі за середні глобальні температури.",
        "fallback_2": "Площа арктичного морського льоду залишається нижчою за довгостроковий сезонний базовий рівень.",
    },
    "de": {
        "temp": "Die globale Temperaturanomalie beträgt {v}°C gegenüber der Referenzperiode 1951–1980.",
        "co2": "Der atmosphärische CO₂-Gehalt erreichte {v} ppm (NOAA GML).",
        "ice": "Die arktische Meereisausdehnung beträgt {v} Mio. km² gegenüber der Referenz 1981–2010 (NSIDC).",
        "sea_level": "Der globale mittlere Meeresspiegel liegt bei {v} mm gegenüber dem TOPEX/Jason-Referenzmittel.",
        "ocean_heat": "Der Wärmeinhalt der Ozeane (0–2000 m) erreichte {v} Zettajoule.",
        "ocean_ph": "Der pH-Wert der ozeanischen Oberflächengewässer fiel auf {v} — ein Zeichen anhaltender Versauerung (Station ALOHA).",
        "fires": "Satelliten erfassen derzeit {n} aktive Brandherde weltweit.",
        "storms": "{n} tropische(r) Wirbelsturm (Wirbelstürme) ist (sind) im Atlantikbecken aktiv.",
        "fallback_1": "Satellitenbeobachtungen deuten auf weiterhin überdurchschnittliche globale Temperaturen hin.",
        "fallback_2": "Die arktische Meereisausdehnung bleibt unter ihrem langfristigen saisonalen Niveau.",
    },
    "pl": {
        "temp": "Globalna anomalia temperatury wynosi {v}°C względem linii bazowej 1951–1980.",
        "co2": "Stężenie CO₂ w atmosferze osiągnęło {v} ppm (NOAA GML).",
        "ice": "Zasięg arktycznego lodu morskiego wynosi {v} mln km² wobec linii bazowej 1981–2010 (NSIDC).",
        "sea_level": "Globalny średni poziom morza wynosi {v} mm względem średniej referencyjnej TOPEX/Jason.",
        "ocean_heat": "Zawartość ciepła w oceanie (0–2000 m) osiągnęła {v} zettadżuli.",
        "ocean_ph": "pH wód powierzchniowych oceanu spadło do {v}, co odzwierciedla postępującą zakwaszenie (stacja ALOHA).",
        "fires": "Satelity obecnie śledzą {n} aktywnych ognisk pożarów na świecie.",
        "storms": "{n} cyklon(y) tropikalne jest/są aktywne w basenie atlantyckim.",
        "fallback_1": "Obserwacje satelitarne wskazują na utrzymujące się ponadprzeciętne globalne temperatury.",
        "fallback_2": "Zasięg arktycznego lodu morskiego pozostaje poniżej długoterminowego poziomu sezonowego.",
    },
    "fr": {
        "temp": "L'anomalie de température mondiale est de {v}°C par rapport à la référence 1951–1980.",
        "co2": "Le CO₂ atmosphérique a atteint {v} ppm (NOAA GML).",
        "ice": "L'étendue de la glace de mer arctique est de {v} M km² par rapport à la référence 1981–2010 (NSIDC).",
        "sea_level": "Le niveau moyen mondial de la mer s'établit à {v} mm par rapport à la moyenne de référence TOPEX/Jason.",
        "ocean_heat": "Le contenu thermique des océans (0–2000 m) a atteint {v} zettajoules.",
        "ocean_ph": "Le pH des eaux de surface de l'océan a baissé à {v}, reflétant une acidification continue (station ALOHA).",
        "fires": "Les satellites suivent actuellement {n} foyers d'incendie actifs dans le monde.",
        "storms": "{n} cyclone(s) tropical(aux) est/sont actif(s) dans le bassin atlantique.",
        "fallback_1": "Les observations par satellite indiquent des températures mondiales toujours supérieures à la moyenne.",
        "fallback_2": "L'étendue de la glace de mer arctique reste inférieure à son niveau saisonnier à long terme.",
    },
    "it": {
        "temp": "L'anomalia di temperatura globale è di {v}°C rispetto alla linea di base 1951–1980.",
        "co2": "La CO₂ atmosferica ha raggiunto {v} ppm (NOAA GML).",
        "ice": "L'estensione del ghiaccio marino artico è di {v} M km² rispetto alla linea di base 1981–2010 (NSIDC).",
        "sea_level": "Il livello medio globale del mare è di {v} mm rispetto alla media di riferimento TOPEX/Jason.",
        "ocean_heat": "Il contenuto termico degli oceani (0–2000 m) ha raggiunto {v} zettajoule.",
        "ocean_ph": "Il pH delle acque oceaniche superficiali è sceso a {v}, riflettendo la continua acidificazione (stazione ALOHA).",
        "fires": "I satelliti attualmente tracciano {n} focolai di incendio attivi nel mondo.",
        "storms": "{n} ciclone(i) tropicale(i) attivo(i) nel bacino atlantico.",
        "fallback_1": "Le osservazioni satellitari indicano temperature globali continuamente superiori alla media.",
        "fallback_2": "L'estensione del ghiaccio marino artico rimane al di sotto del livello stagionale a lungo termine.",
    },
    "ka": {
        "temp": "გლობალური ტემპერატურული ანომალია შეადგენს {v}°C საბაზო პერიოდთან 1951–1980 შედარებით.",
        "co2": "ატმოსფეროში CO₂-ის კონცენტრაციამ მიაღწია {v} ppm-ს (NOAA GML).",
        "ice": "არქტიკული ზღვის ყინულის ფართობია {v} მლნ კმ² საბაზო პერიოდთან 1981–2010 შედარებით (NSIDC).",
        "sea_level": "გლობალური საშუალო ზღვის დონეა {v} მმ TOPEX/Jason საცნობარო საშუალოსთან შედარებით.",
        "ocean_heat": "ოკეანის სითბოშემცველობამ (0–2000 მ) მიაღწია {v} ზეტაჯოულს.",
        "ocean_ph": "ოკეანის ზედაპირული წყლების pH დაეცა {v}-მდე, რაც ასახავს მჟავიანობის გაგრძელებას (ALOHA სადგური).",
        "fires": "სატელიტები ამჟამად აკვირდებიან {n} აქტიურ ხანძრის კერას მსოფლიოში.",
        "storms": "ატლანტიკის აუზში აქტიურია {n} ტროპიკული ციკლონი.",
        "fallback_1": "სატელიტური დაკვირვებები მიუთითებს საშუალოზე მაღალ გლობალურ ტემპერატურებზე.",
        "fallback_2": "არქტიკული ზღვის ყინულის ფართობი გრძელვადიან სეზონურ საბაზო დონეზე დაბალია.",
    },
}


def get_ai_summary_text(overview_data: Dict[str, Any], lang: str = "en") -> str:
    """Форматує коротке кліматичне резюме мовою інтерфейсу."""
    lang = _normalize_lang(lang)
    tpl = _SUMMARY_TEMPLATES[lang]
    parts = []

    anomaly = (overview_data.get("temperature_anomaly") or {}).get("value")
    if anomaly is not None:
        parts.append(tpl["temp"].format(v=f"{anomaly:+.2f}"))

    co2_value = (overview_data.get("co2") or {}).get("value")
    if co2_value is not None:
        parts.append(tpl["co2"].format(v=f"{co2_value:.1f}"))

    ice_anomaly = (overview_data.get("sea_ice") or {}).get("anomaly")
    if ice_anomaly is not None:
        parts.append(tpl["ice"].format(v=f"{ice_anomaly:+.2f}"))

    ocean = overview_data.get("ocean_climate") or {}
    sl_value = (ocean.get("sea_level") or {}).get("value")
    if sl_value is not None:
        parts.append(tpl["sea_level"].format(v=f"{sl_value:+.0f}"))

    oh_value = (ocean.get("ocean_heat") or {}).get("value")
    if oh_value is not None:
        parts.append(tpl["ocean_heat"].format(v=f"{oh_value:.0f}"))

    ph_value = (ocean.get("ocean_ph") or {}).get("value")
    if ph_value is not None:
        parts.append(tpl["ocean_ph"].format(v=f"{ph_value:.3f}"))

    fires = (overview_data.get("fires") or {}).get("count", 0)
    if fires:
        parts.append(tpl["fires"].format(n=fires))

    storms = (overview_data.get("hurricanes") or {}).get("count", 0)
    if storms:
        parts.append(tpl["storms"].format(n=storms))

    if not parts:
        parts = [tpl["fallback_1"], tpl["fallback_2"]]

    return " ".join(parts)


def _template_analysis(snapshot: Dict[str, Any], lang: str, slot_utc: datetime) -> Dict[str, Any]:
    """Детермінований фолбек, коли ключ Groq відсутній або виклик не вдався."""
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
    """Повертає сьогоднішній AI-аналіз запитуваною мовою.

    Перегенеровується щонайбільше двічі на день: коли поточний Київський час
    перевищив наступний запланований слот (09:00 або 17:00).
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
# AI-прогнози (використовуються ендпоінтом /api/predictions)
# ---------------------------------------------------------------------------

def _parse_predictions(text: str) -> Optional[List[Dict[str, Any]]]:
    """Спроба витягти JSON-список прогнозів із відповіді Groq."""
    try:
        start = text.index("[")
        end = text.rindex("]") + 1
        data = json.loads(text[start:end])
        if isinstance(data, list):
            return data
    except (ValueError, json.JSONDecodeError):
        pass
    return None


def _horizon_text(days: int) -> str:
    """Зрозумілий людині горизонт прогнозу, що використовується у промпті Groq."""
    if days <= 7:
        return "the next 7 days (short-term)"
    if days <= 30:
        return "the next 30 days"
    if days <= 90:
        return "the next 90 days"
    if days <= 365:
        return "the next 12 months (year-ahead)"
    if days <= 730:
        return "the next 2 years"
    if days <= 1095:
        return "the next 3 years"
    if days <= 1460:
        return "the next 4 years"
    if days <= 1825:
        return "the next 5 years"
    return "the next 10 years (long-term)"


def _generate_predictions(lang: str, days: int = 30) -> List[Dict[str, Any]]:
    """Генерує AI-прогнози для запитуваного горизонту прогнозу через Groq."""
    lang = _normalize_lang(lang)
    days = max(7, min(int(days or 30), 3650))
    snapshot = _data_snapshot()
    snapshot_block = _snapshot_text(snapshot)

    system_prompt = (
        "You are a climate risk forecasting AI. Based on the provided data snapshot, "
        f"generate exactly 5 predictions for {_horizon_text(days)}. "
        "The stagger (probabilities, urgency and timeframe values) must clearly reflect "
        "this EXACT horizon — short horizons should mention immediate weather drivers, "
        "long horizons should weigh structural trends (CO2, ice, sea level). Return ONLY a "
        "valid JSON array, no markdown. Each object must have exactly these keys:\n"
        '  - "category": string (e.g. "Temperature", "Wildfire Risk", "Flood Risk", "Sea Ice", "Cyclone")\n'
        '  - "prediction": short string describing the expected situation for this horizon\n'
        '  - "probability": float 0..1\n'
        '  - "confidence_interval": [low, high] two floats 0..1\n'
        '  - "reasoning": short explanation grounded in the provided data\n'
        '  - "risk_level": "low" | "medium" | "high"\n'
        '  - "timeframe": short string that reflects a sub-window of the horizon (e.g. "7-14 days" for 30-day horizon)\n'
        "Do not invent numeric facts beyond the data; the reasoning should reference the snapshot. "
        f"Write all string values in {_lang_name(lang)}."
    )
    user_prompt = (
        f"Forecast horizon: {days} days.\n\nData snapshot:\n\n{snapshot_block}"
    )

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

    return _template_predictions(snapshot, lang, days)


# Шаблони резервних прогнозів для всіх 7 мов.
# Кожна категорія має: category, prediction/reasoning (без чисел), prediction_proj/reasoning_proj
# (з поточним значенням {cur}, нахилом {slope}, R², {n}, екстраполяцією {proj} і горизонтом {horizon}),
# для «живих» подій — prediction_live/reasoning_live, а також risk і base_prob.
_TEMPLATE_PREDICTIONS = {
    "en": {
        "temperature": {
            "category": "Temperature",
            "prediction": "Global mean temperature anomaly remains elevated through {horizon}.",
            "prediction_proj": "Global mean temperature anomaly to reach {proj:+.2f}°C within {horizon} (currently {cur:+.2f}°C).",
            "reasoning": "Based on the sustained warming trend in the observational record.",
            "reasoning_proj": "Long-run trend {slope:+.3f}°C/yr (R²={r2}) fitted to {n} annual data points (1951–1980 baseline); current anomaly {cur:+.2f}°C.",
            "risk": "high",
            "base_prob": 0.88,
        },
        "co2": {
            "category": "CO₂",
            "prediction": "Atmospheric CO₂ continues to climb through {horizon}.",
            "prediction_proj": "Atmospheric CO₂ to reach about {proj:.1f} ppm within {horizon} (currently {cur:.1f} ppm).",
            "reasoning": "CO₂ growth is driven by sustained fossil-fuel emissions (NOAA GML).",
            "reasoning_proj": "Measured growth ≈ {slope:+.2f} ppm/yr (R²={r2}) over {n} years of NOAA GML observations.",
            "risk": "high",
            "base_prob": 0.90,
        },
        "ice": {
            "category": "Sea Ice",
            "prediction": "Polar sea-ice extent stays below its long-term seasonal baseline through {horizon}.",
            "prediction_proj": "Arctic annual sea-ice minimum to decline to about {proj:.2f} M km² within {horizon} (currently {cur:.2f} M km²).",
            "reasoning": "Multi-decadal Arctic and Antarctic ice trends are declining.",
            "reasoning_proj": "Annual-minimum trend {slope:+.3f} M km²/yr (R²={r2}) over {n} years (NSIDC).",
            "risk": "high",
            "base_prob": 0.82,
        },
        "sea_level": {
            "category": "Sea Level",
            "prediction": "Global mean sea level keeps rising through {horizon}.",
            "prediction_proj": "Global mean sea level to rise to about {proj:+.0f} mm within {horizon} (currently {cur:+.0f} mm).",
            "reasoning": "Thermal expansion and ice-sheet mass loss push sea level upward.",
            "reasoning_proj": "Rise of {slope:+.2f} mm/yr (R²={r2}) from {n} years of satellite altimetry and tide gauges.",
            "risk": "high",
            "base_prob": 0.84,
        },
        "ocean": {
            "category": "Ocean Heat",
            "prediction": "Upper-ocean heat content continues to accumulate through {horizon}.",
            "prediction_proj": "Upper-ocean heat content to rise to about {proj:.0f} ZJ within {horizon} (currently {cur:.0f} ZJ).",
            "reasoning": "The ocean absorbs the bulk of excess planetary heat.",
            "reasoning_proj": "Heat-content gain {slope:+.2f} ZJ/yr (R²={r2}) computed over {n} data points (0–2000 m).",
            "risk": "high",
            "base_prob": 0.85,
        },
        "ph": {
            "category": "Ocean Acidification",
            "prediction": "Surface-ocean pH continues to decline through {horizon}.",
            "prediction_proj": "Surface-ocean pH to fall to about {proj:.3f} within {horizon} (currently {cur:.3f}).",
            "reasoning": "Absorbed CO₂ lowers ocean pH (Station ALOHA).",
            "reasoning_proj": "Acidification trend {slope:+.3f} pH/yr (R²={r2}) over {n} years of Station ALOHA data.",
            "risk": "medium",
            "base_prob": 0.80,
        },
        "wildfire": {
            "category": "Wildfire Risk",
            "prediction": "Elevated wildfire activity persists through {horizon}.",
            "prediction_live": "Elevated wildfire activity persists through {horizon}, with {cur} hotspots active now.",
            "reasoning": "Satellite-detected hotspots mark regions of elevated fire danger.",
            "reasoning_live": "{cur} active fire hotspots currently detected by satellites (NASA FIRMS).",
            "risk": "high",
            "base_prob": 0.74,
        },
        "cyclone": {
            "category": "Cyclone",
            "prediction": "Tropical cyclone activity continues through {horizon}.",
            "prediction_live": "Tropical cyclone activity continues through {horizon}; {cur} storm(s) currently tracked.",
            "reasoning": "Warm ocean waters provide energy for cyclone development and strengthening.",
            "reasoning_live": "{cur} tropical cyclone(s) currently active over warm Atlantic waters.",
            "risk": "medium",
            "base_prob": 0.68,
        },
    },
    "uk": {
        "temperature": {
            "category": "Температура",
            "prediction": "Глобальна температурна аномалія залишається підвищеною протягом {horizon}.",
            "prediction_proj": "Глобальна температурна аномалія досягне {proj:+.2f}°C протягом {horizon} (зараз {cur:+.2f}°C).",
            "reasoning": "За даними спостережень триває стале потепління.",
            "reasoning_proj": "Тренд {slope:+.3f}°C/рік (R²={r2}) за {n} річних точок (базис 1951–1980); поточна аномалія {cur:+.2f}°C.",
            "risk": "high",
            "base_prob": 0.88,
        },
        "co2": {
            "category": "CO₂",
            "prediction": "Концентрація CO₂ в атмосфері продовжує зростати протягом {horizon}.",
            "prediction_proj": "Концентрація CO₂ досягне близько {proj:.1f} ppm протягом {horizon} (зараз {cur:.1f} ppm).",
            "reasoning": "Зростання CO₂ зумовлене сталим викидом від спалювання палива (NOAA GML).",
            "reasoning_proj": "Виміряний темп ≈ {slope:+.2f} ppm/рік (R²={r2}) за {n} років спостережень NOAA GML.",
            "risk": "high",
            "base_prob": 0.90,
        },
        "ice": {
            "category": "Морський лід",
            "prediction": "Протяжність полярного льоду залишається нижчою за сезонну норму протягом {horizon}.",
            "prediction_proj": "Арктичний річний мінімум льоду знизиться до ~{proj:.2f} млн км² протягом {horizon} (зараз {cur:.2f} млн км²).",
            "reasoning": "Багаторічні тенденції арктичного й антарктичного льоду знижуються.",
            "reasoning_proj": "Тренд річного мінімуму {slope:+.3f} млн км²/рік (R²={r2}) за {n} років (NSIDC).",
            "risk": "high",
            "base_prob": 0.82,
        },
        "sea_level": {
            "category": "Рівень моря",
            "prediction": "Глобальний рівень моря продовжує зростати протягом {horizon}.",
            "prediction_proj": "Глобальний рівень моря підніметься до ~{proj:+.0f} мм протягом {horizon} (зараз {cur:+.0f} мм).",
            "reasoning": "Термічне розширення та втрата маси льодовиків піднімають рівень моря.",
            "reasoning_proj": "Зростання {slope:+.2f} мм/рік (R²={r2}) за {n} років супутникової альтиметрії та мареографів.",
            "risk": "high",
            "base_prob": 0.84,
        },
        "ocean": {
            "category": "Тепло океану",
            "prediction": "Тепло океану продовжує накопичуватися протягом {horizon}.",
            "prediction_proj": "Тепловміст верхнього океану зросте до ~{proj:.0f} ЗДж протягом {horizon} (зараз {cur:.0f} ЗДж).",
            "reasoning": "Океан поглинає основну частину надлишкового планетарного тепла.",
            "reasoning_proj": "Приріст тепла {slope:+.2f} ЗДж/рік (R²={r2}) за {n} точок даних (0–2000 м).",
            "risk": "high",
            "base_prob": 0.85,
        },
        "ph": {
            "category": "Закислення океану",
            "prediction": "pH поверхневих вод океану продовжує знижуватися протягом {horizon}.",
            "prediction_proj": "pH поверхневих вод знизиться до ~{proj:.3f} протягом {horizon} (зараз {cur:.3f}).",
            "reasoning": "Поглинутий CO₂ знижує pH океану (станція ALOHA).",
            "reasoning_proj": "Тренд закислення {slope:+.3f} pH/рік (R²={r2}) за {n} років даних станції ALOHA.",
            "risk": "medium",
            "base_prob": 0.80,
        },
        "wildfire": {
            "category": "Ризик пожеж",
            "prediction": "Підвищена пожежна активність триватиме протягом {horizon}.",
            "prediction_live": "Підвищена пожежна активність триватиме протягом {horizon}; зараз активних осередків: {cur}.",
            "reasoning": "Супутникові осередки вказують на регіони з підвищеною пожежною небезпекою.",
            "reasoning_live": "{cur} активних осередків пожеж виявлено супутниками (NASA FIRMS).",
            "risk": "high",
            "base_prob": 0.74,
        },
        "cyclone": {
            "category": "Циклон",
            "prediction": "Активність тропічних циклонів триватиме протягом {horizon}.",
            "prediction_live": "Активність тропічних циклонів триватиме протягом {horizon}; зараз відстежується {cur} штормів.",
            "reasoning": "Теплі океанські води дають енергію для розвитку циклонів.",
            "reasoning_live": "{cur} тропічний(их) циклон(ів) зараз активний(их) над теплими водами Атлантики.",
            "risk": "medium",
            "base_prob": 0.68,
        },
    },
    "de": {
        "temperature": {
            "category": "Temperatur",
            "prediction": "Die globale Temperaturanomalie bleibt während {horizon} erhöht.",
            "prediction_proj": "Die globale Temperaturanomalie erreicht {proj:+.2f}°C innerhalb {horizon} (aktuell {cur:+.2f}°C).",
            "reasoning": "Basierend auf dem anhaltenden Erwärmungstrend in den Beobachtungsdaten.",
            "reasoning_proj": "Trend {slope:+.3f}°C/Jahr (R²={r2}) über {n} Jahreswerte (Referenz 1951–1980); aktuelle Anomalie {cur:+.2f}°C.",
            "risk": "high",
            "base_prob": 0.88,
        },
        "co2": {
            "category": "CO₂",
            "prediction": "Die atmosphärische CO₂-Konzentration steigt während {horizon} weiter an.",
            "prediction_proj": "CO₂ erreicht ~{proj:.1f} ppm innerhalb {horizon} (aktuell {cur:.1f} ppm).",
            "reasoning": "Das CO₂-Wachstum ist durch anhaltende Verbrennungsemissionen bedingt (NOAA GML).",
            "reasoning_proj": "Gemessene Rate ≈ {slope:+.2f} ppm/Jahr (R²={r2}) über {n} Jahre NOAA-GML-Daten.",
            "risk": "high",
            "base_prob": 0.90,
        },
        "ice": {
            "category": "Meereis",
            "prediction": "Die polare Meereisausdehnung bleibt während {horizon} unter der saisonalen Basislinie.",
            "prediction_proj": "Das arktische Jahresminimum sinkt auf ~{proj:.2f} Mio. km² innerhalb {horizon} (aktuell {cur:.2f} Mio. km²).",
            "reasoning": "Die mehrjährigen Trends von arktischem und antarktischem Meereis sind rückläufig.",
            "reasoning_proj": "Jahresminimum-Trend {slope:+.3f} Mio. km²/Jahr (R²={r2}) über {n} Jahre (NSIDC).",
            "risk": "high",
            "base_prob": 0.82,
        },
        "sea_level": {
            "category": "Meeresspiegel",
            "prediction": "Der globale Meeresspiegel steigt während {horizon} weiter an.",
            "prediction_proj": "Der Meeresspiegel steigt auf ~{proj:+.0f} mm innerhalb {horizon} (aktuell {cur:+.0f} mm).",
            "reasoning": "Thermische Ausdehnung und Eisschildmassenverlust treiben den Meeresspiegel.",
            "reasoning_proj": "Anstieg von {slope:+.2f} mm/Jahr (R²={r2}) aus {n} Jahren Satellitenaltimetrie und Pegelständen.",
            "risk": "high",
            "base_prob": 0.84,
        },
        "ocean": {
            "category": "Ozeanwärme",
            "prediction": "Der Wärmeinhalt der Ozeane nimmt während {horizon} weiter zu.",
            "prediction_proj": "Der Wärmeinhalt des oberen Ozeans steigt auf ~{proj:.0f} ZJ innerhalb {horizon} (aktuell {cur:.0f} ZJ).",
            "reasoning": "Der Ozean nimmt den Großteil überschüssiger planetarer Wärme auf.",
            "reasoning_proj": "Wärmezuwachs {slope:+.2f} ZJ/Jahr (R²={r2}) über {n} Datenpunkte (0–2000 m).",
            "risk": "high",
            "base_prob": 0.85,
        },
        "ph": {
            "category": "Ozeanversauerung",
            "prediction": "Der pH-Wert der Ozeanoberfläche sinkt während {horizon} weiter.",
            "prediction_proj": "Der pH-Wert sinkt auf ~{proj:.3f} innerhalb {horizon} (aktuell {cur:.3f}).",
            "reasoning": "Absorbiertes CO₂ senkt den pH-Wert des Ozeans (Station ALOHA).",
            "reasoning_proj": "Versauerungstrend {slope:+.3f} pH/Jahr (R²={r2}) über {n} Jahre ALOHA-Daten.",
            "risk": "medium",
            "base_prob": 0.80,
        },
        "wildfire": {
            "category": "Waldbrandrisiko",
            "prediction": "Erhöhte Waldbrandaktivität hält während {horizon} an.",
            "prediction_live": "Erhöhte Waldbrandaktivität hält während {horizon} an; aktuell {cur} aktive Brandherde.",
            "reasoning": "Satellitendetektierte Brandherde markieren erhöhte Brandgefahr.",
            "reasoning_live": "{cur} aktive Brandherde aktuell von Satelliten erkannt (NASA FIRMS).",
            "risk": "high",
            "base_prob": 0.74,
        },
        "cyclone": {
            "category": "Wirbelsturm",
            "prediction": "Die tropische Wirbelsturmaktivität hält während {horizon} an.",
            "prediction_live": "Die tropische Wirbelsturmaktivität hält während {horizon} an; {cur} Stürme derzeit verfolgt.",
            "reasoning": "Warmes Ozeanwasser liefert Energie für die Zyklonenentwicklung.",
            "reasoning_live": "{cur} tropische(r) Wirbelsturm/Wirbelstürme derzeit über warmem Atlantikwasser aktiv.",
            "risk": "medium",
            "base_prob": 0.68,
        },
    },
    "pl": {
        "temperature": {
            "category": "Temperatura",
            "prediction": "Globalna anomalia temperatury pozostaje podwyższona przez {horizon}.",
            "prediction_proj": "Globalna anomalia temperatury osiągnie {proj:+.2f}°C w ciągu {horizon} (obecnie {cur:+.2f}°C).",
            "reasoning": "Na podstawie utrzymującego się trendu ocieplenia w danych obserwacyjnych.",
            "reasoning_proj": "Trend {slope:+.3f}°C/rok (R²={r2}) z {n} danych rocznych (linia bazowa 1951–1980); obecna anomalia {cur:+.2f}°C.",
            "risk": "high",
            "base_prob": 0.88,
        },
        "co2": {
            "category": "CO₂",
            "prediction": "Stężenie CO₂ w atmosferze rośnie przez {horizon}.",
            "prediction_proj": "CO₂ osiągnie około {proj:.1f} ppm w ciągu {horizon} (obecnie {cur:.1f} ppm).",
            "reasoning": "Wzrost CO₂ wynika z trwałej emisji ze spalania paliw (NOAA GML).",
            "reasoning_proj": "Zmierzona dynamika ≈ {slope:+.2f} ppm/rok (R²={r2}) z {n} lat danych NOAA GML.",
            "risk": "high",
            "base_prob": 0.90,
        },
        "ice": {
            "category": "Lód morski",
            "prediction": "Zasięg polarnego lodu morskiego pozostaje poniżej normy sezonowej przez {horizon}.",
            "prediction_proj": "Arktyczne minimum roczne lodu spadnie do ~{proj:.2f} mln km² w ciągu {horizon} (obecnie {cur:.2f} mln km²).",
            "reasoning": "Wieloletnie trendy lodu arktycznego i antarktycznego maleją.",
            "reasoning_proj": "Trend minimum rocznego {slope:+.3f} mln km²/rok (R²={r2}) z {n} lat (NSIDC).",
            "risk": "high",
            "base_prob": 0.82,
        },
        "sea_level": {
            "category": "Poziom morza",
            "prediction": "Globalny poziom morza rośnie przez {horizon}.",
            "prediction_proj": "Globalny poziom morza wzrośnie do ~{proj:+.0f} mm w ciągu {horizon} (obecnie {cur:+.0f} mm).",
            "reasoning": "Ekspansja termiczna i utrata masy lodowców podnoszą poziom morza.",
            "reasoning_proj": "Wzrost {slope:+.2f} mm/rok (R²={r2}) z {n} lat altimetrii satelitarnej i pływomierzy.",
            "risk": "high",
            "base_prob": 0.84,
        },
        "ocean": {
            "category": "Ciepło oceanu",
            "prediction": "Ciepło oceanu gromadzi się przez {horizon}.",
            "prediction_proj": "Zasoby ciepła górnego oceanu wzrosną do ~{proj:.0f} ZJ w ciągu {horizon} (obecnie {cur:.0f} ZJ).",
            "reasoning": "Ocean pochłania większość nadmiarowego ciepła planety.",
            "reasoning_proj": "Przyrost ciepła {slope:+.2f} ZJ/rok (R²={r2}) z {n} punktów danych (0–2000 m).",
            "risk": "high",
            "base_prob": 0.85,
        },
        "ph": {
            "category": "Zakwaszenie oceanu",
            "prediction": "pH wód powierzchniowych oceanu spada przez {horizon}.",
            "prediction_proj": "pH oceanu spadnie do ~{proj:.3f} w ciągu {horizon} (obecnie {cur:.3f}).",
            "reasoning": "Absorbowany CO₂ obniża pH oceanu (stacja ALOHA).",
            "reasoning_proj": "Trend zakwaszenia {slope:+.3f} pH/rok (R²={r2}) z {n} lat danych stacji ALOHA.",
            "risk": "medium",
            "base_prob": 0.80,
        },
        "wildfire": {
            "category": "Ryzyko pożarów",
            "prediction": "Podwyższona aktywność pożarowa utrzyma się przez {horizon}.",
            "prediction_live": "Podwyższona aktywność pożarowa utrzyma się przez {horizon}; obecnie {cur} aktywnych ognisk.",
            "reasoning": "Ogniska wykryte satelitarnie wskazują obszary podwyższonego ryzyka pożarów.",
            "reasoning_live": "{cur} aktywnych ognisk pożarów wykrytych przez satelity (NASA FIRMS).",
            "risk": "high",
            "base_prob": 0.74,
        },
        "cyclone": {
            "category": "Cyklon",
            "prediction": "Aktywność cyklonów tropikalnych utrzyma się przez {horizon}.",
            "prediction_live": "Aktywność cyklonów tropikalnych utrzyma się przez {horizon}; obecnie śledzone {cur} burz.",
            "reasoning": "Ciepłe wody oceanu dostarczają energii do rozwoju cyklonów.",
            "reasoning_live": "{cur} cyklon(y) tropikalnych obecnie aktywnych nad ciepłymi wodami Atlantyku.",
            "risk": "medium",
            "base_prob": 0.68,
        },
    },
    "fr": {
        "temperature": {
            "category": "Température",
            "prediction": "L'anomalie de température mondiale reste élevée pendant {horizon}.",
            "prediction_proj": "L'anomalie de température mondiale atteindra {proj:+.2f}°C d'ici {horizon} (actuellement {cur:+.2f}°C).",
            "reasoning": "Sur la base de la tendance continue au réchauffement dans les données d'observation.",
            "reasoning_proj": "Tendance {slope:+.3f}°C/an (R²={r2}) sur {n} points annuels (référence 1951–1980) ; anomalie actuelle {cur:+.2f}°C.",
            "risk": "high",
            "base_prob": 0.88,
        },
        "co2": {
            "category": "CO₂",
            "prediction": "Le CO₂ atmosphérique continue d'augmenter pendant {horizon}.",
            "prediction_proj": "Le CO₂ atteindra environ {proj:.1f} ppm d'ici {horizon} (actuellement {cur:.1f} ppm).",
            "reasoning": "La croissance du CO₂ est due aux émissions persistantes de combustion (NOAA GML).",
            "reasoning_proj": "Taux mesuré ≈ {slope:+.2f} ppm/an (R²={r2}) sur {n} années de données NOAA GML.",
            "risk": "high",
            "base_prob": 0.90,
        },
        "ice": {
            "category": "Glace marine",
            "prediction": "L'étendue de la glace polaire reste sous la référence saisonnière pendant {horizon}.",
            "prediction_proj": "Le minimum annuel de glace arctique tombera à ~{proj:.2f} M km² d'ici {horizon} (actuellement {cur:.2f} M km²).",
            "reasoning": "Les tendances pluriannuelles de la glace arctique et antarctique sont à la baisse.",
            "reasoning_proj": "Tendance du minimum annuel {slope:+.3f} M km²/an (R²={r2}) sur {n} années (NSIDC).",
            "risk": "high",
            "base_prob": 0.82,
        },
        "sea_level": {
            "category": "Niveau de la mer",
            "prediction": "Le niveau mondial de la mer continue d'augmenter pendant {horizon}.",
            "prediction_proj": "Le niveau mondial de la mer montera à ~{proj:+.0f} mm d'ici {horizon} (actuellement {cur:+.0f} mm).",
            "reasoning": "L'expansion thermique et la perte de masse des calottes élèvent le niveau de la mer.",
            "reasoning_proj": "Hausse de {slope:+.2f} mm/an (R²={r2}) sur {n} années d'altimétrie satellitaire et de marégraphes.",
            "risk": "high",
            "base_prob": 0.84,
        },
        "ocean": {
            "category": "Chaleur océanique",
            "prediction": "La chaleur océanique continue de s'accumuler pendant {horizon}.",
            "prediction_proj": "Le contenu thermique de l'océan supérieur atteindra ~{proj:.0f} ZJ d'ici {horizon} (actuellement {cur:.0f} ZJ).",
            "reasoning": "L'océan absorbe l'essentiel de la chaleur planétaire excédentaire.",
            "reasoning_proj": "Gain de chaleur {slope:+.2f} ZJ/an (R²={r2}) sur {n} points de données (0–2000 m).",
            "risk": "high",
            "base_prob": 0.85,
        },
        "ph": {
            "category": "Acidification des océans",
            "prediction": "Le pH de surface des océans continue de baisser pendant {horizon}.",
            "prediction_proj": "Le pH de l'océan tombera à ~{proj:.3f} d'ici {horizon} (actuellement {cur:.3f}).",
            "reasoning": "Le CO₂ absorbé abaisse le pH de l'océan (station ALOHA).",
            "reasoning_proj": "Tendance d'acidification {slope:+.3f} pH/an (R²={r2}) sur {n} années de données ALOHA.",
            "risk": "medium",
            "base_prob": 0.80,
        },
        "wildfire": {
            "category": "Risque d'incendie",
            "prediction": "L'activité d'incendie élevée persiste pendant {horizon}.",
            "prediction_live": "L'activité d'incendie élevée persiste pendant {horizon}, avec {cur} foyers actifs actuellement.",
            "reasoning": "Les foyers détectés par satellite marquent les zones à risque d'incendie.",
            "reasoning_live": "{cur} foyers d'incendie actifs détectés par satellite (NASA FIRMS).",
            "risk": "high",
            "base_prob": 0.74,
        },
        "cyclone": {
            "category": "Cyclone",
            "prediction": "L'activité des cyclones tropicaux se poursuit pendant {horizon}.",
            "prediction_live": "L'activité des cyclones tropicaux se poursuit pendant {horizon} ; {cur} tempête(s) suivie(s) actuellement.",
            "reasoning": "Les eaux océaniques chaudes fournissent l'énergie du développement des cyclones.",
            "reasoning_live": "{cur} cyclone(s) tropical(aux) actif(s) au-dessus des eaux chaudes de l'Atlantique.",
            "risk": "medium",
            "base_prob": 0.68,
        },
    },
    "it": {
        "temperature": {
            "category": "Temperatura",
            "prediction": "L'anomalia di temperatura globale resta elevata per {horizon}.",
            "prediction_proj": "L'anomalia di temperatura globale raggiungerà {proj:+.2f}°C entro {horizon} (attualmente {cur:+.2f}°C).",
            "reasoning": "Basata sulla tendenza di riscaldamento persistente nei dati osservativi.",
            "reasoning_proj": "Tendenza {slope:+.3f}°C/anno (R²={r2}) su {n} punti annuali (linea base 1951–1980); anomalia attuale {cur:+.2f}°C.",
            "risk": "high",
            "base_prob": 0.88,
        },
        "co2": {
            "category": "CO₂",
            "prediction": "La CO₂ atmosferica continua a salire per {horizon}.",
            "prediction_proj": "La CO₂ raggiungerà circa {proj:.1f} ppm entro {horizon} (attualmente {cur:.1f} ppm).",
            "reasoning": "La crescita della CO₂ è dovuta alle persistenti emissioni da combustione (NOAA GML).",
            "reasoning_proj": "Tasso misurato ≈ {slope:+.2f} ppm/anno (R²={r2}) su {n} anni di dati NOAA GML.",
            "risk": "high",
            "base_prob": 0.90,
        },
        "ice": {
            "category": "Ghiaccio marino",
            "prediction": "L'estensione del ghiaccio polare resta sotto la linea base stagionale per {horizon}.",
            "prediction_proj": "Il minimo annuo artico scenderà a ~{proj:.2f} M km² entro {horizon} (attualmente {cur:.2f} M km²).",
            "reasoning": "Le tendenze pluriennali del ghiaccio artico e antartico sono in calo.",
            "reasoning_proj": "Tendenza del minimo annuo {slope:+.3f} M km²/anno (R²={r2}) su {n} anni (NSIDC).",
            "risk": "high",
            "base_prob": 0.82,
        },
        "sea_level": {
            "category": "Livello del mare",
            "prediction": "Il livello globale del mare continua a salire per {horizon}.",
            "prediction_proj": "Il livello globale del mare salirà a ~{proj:+.0f} mm entro {horizon} (attualmente {cur:+.0f} mm).",
            "reasoning": "L'espansione termica e la perdita di massa dei ghiacci sollevano il livello del mare.",
            "reasoning_proj": "Aumento di {slope:+.2f} mm/anno (R²={r2}) su {n} anni di altimetria satellitare e mareografi.",
            "risk": "high",
            "base_prob": 0.84,
        },
        "ocean": {
            "category": "Calore oceanico",
            "prediction": "Il calore oceanico continua ad accumularsi per {horizon}.",
            "prediction_proj": "Il contenuto termico dell'oceano superiore salirà a ~{proj:.0f} ZJ entro {horizon} (attualmente {cur:.0f} ZJ).",
            "reasoning": "L'oceano assorbe la maggior parte del calore planetario in eccesso.",
            "reasoning_proj": "Guadagno di calore {slope:+.2f} ZJ/anno (R²={r2}) su {n} punti dati (0–2000 m).",
            "risk": "high",
            "base_prob": 0.85,
        },
        "ph": {
            "category": "Acidificazione oceanica",
            "prediction": "Il pH di superficie dell'oceano continua a diminuire per {horizon}.",
            "prediction_proj": "Il pH dell'oceano scenderà a ~{proj:.3f} entro {horizon} (attualmente {cur:.3f}).",
            "reasoning": "La CO₂ assorbita abbassa il pH dell'oceano (stazione ALOHA).",
            "reasoning_proj": "Tendenza di acidificazione {slope:+.3f} pH/anno (R²={r2}) su {n} anni di dati ALOHA.",
            "risk": "medium",
            "base_prob": 0.80,
        },
        "wildfire": {
            "category": "Rischio incendi",
            "prediction": "L'attività di incendio elevata persiste per {horizon}.",
            "prediction_live": "L'attività di incendio elevata persiste per {horizon}, con {cur} focolai attivi ora.",
            "reasoning": "I focolai rilevati dai satelliti segnalano aree a rischio incendio.",
            "reasoning_live": "{cur} focolai di incendio attivi rilevati dai satelliti (NASA FIRMS).",
            "risk": "high",
            "base_prob": 0.74,
        },
        "cyclone": {
            "category": "Ciclone",
            "prediction": "L'attività dei cicloni tropicali continua per {horizon}.",
            "prediction_live": "L'attività dei cicloni tropicali continua per {horizon}; {cur} tempeste attualmente tracciate.",
            "reasoning": "Le acque oceaniche calde forniscono energia per lo sviluppo dei cicloni.",
            "reasoning_live": "{cur} ciclone(i) tropicale(i) attivo(i) sopra le acque calde dell'Atlantico.",
            "risk": "medium",
            "base_prob": 0.68,
        },
    },
    "ka": {
        "temperature": {
            "category": "ტემპერატურა",
            "prediction": "გლობალური ტემპერატურული ანომალია ამაღლებული რჩება {horizon}-ის განმავლობაში.",
            "prediction_proj": "გლობალური ტემპერატურული ანომალია მიაღწევს {proj:+.2f}°C-ს {horizon}-ში (ახლა {cur:+.2f}°C).",
            "reasoning": "დაკვირვებების მონაცემებში მდგრადი დათბობის ტენდენციაზე დაყრდნობით.",
            "reasoning_proj": "ტენდენცია {slope:+.3f}°C/წელი (R²={r2}) {n} წლიური წერტილით (ბაზისი 1951–1980); მიმდინარე ანომალია {cur:+.2f}°C.",
            "risk": "high",
            "base_prob": 0.88,
        },
        "co2": {
            "category": "CO₂",
            "prediction": "ატმოსფერული CO₂ იზრდება {horizon}-ის განმავლობაში.",
            "prediction_proj": "CO₂ მიაღწევს დაახლოებით {proj:.1f} ppm-ს {horizon}-ში (ახლა {cur:.1f} ppm).",
            "reasoning": "CO₂-ის ზრდა გამოწვეულია საწვავის წვის მუდმივი ემისიებით (NOAA GML).",
            "reasoning_proj": "გაზომილი ტემპი ≈ {slope:+.2f} ppm/წელი (R²={r2}) NOAA GML-ის {n} წლის მონაცემებზე.",
            "risk": "high",
            "base_prob": 0.90,
        },
        "ice": {
            "category": "ზღვის ყინული",
            "prediction": "პოლარული ყინულის ფართობი რჩება სეზონურ ნორმაზე დაბლა {horizon}-ის განმავლობაში.",
            "prediction_proj": "არქტიკული წლიური მინიმუმი დაეცემა ~{proj:.2f} მლნ კმ²-მდე {horizon}-ში (ახლა {cur:.2f} მლნ კმ²).",
            "reasoning": "არქტიკის და ანტარქტიდის ყინულის მრავალწლიანი ტენდენციები კლებულობს.",
            "reasoning_proj": "წლიური მინიმუმის ტენდენცია {slope:+.3f} მლნ კმ²/წელი (R²={r2}) {n} წლის განმავლობაში (NSIDC).",
            "risk": "high",
            "base_prob": 0.82,
        },
        "sea_level": {
            "category": "ზღვის დონე",
            "prediction": "გლობალური ზღვის დონე იზრდება {horizon}-ის განმავლობაში.",
            "prediction_proj": "გლობალური ზღვის დონე აიწევს ~{proj:+.0f} მმ-მდე {horizon}-ში (ახლა {cur:+.0f} მმ).",
            "reasoning": "თერმული გაფართოება და ყინულის მასის დაკარგვა ზრდის ზღვის დონეს.",
            "reasoning_proj": "ზრდა {slope:+.2f} მმ/წელი (R²={r2}) სატელიტური ალტიმეტრიისა და მარეოგრაფების {n} წლის განმავლობაში.",
            "risk": "high",
            "base_prob": 0.84,
        },
        "ocean": {
            "category": "ოკეანის სითბო",
            "prediction": "ოკეანის სითბო გროვდება {horizon}-ის განმავლობაში.",
            "prediction_proj": "ზედა ოკეანის სითბოშემცველობა აიწევს ~{proj:.0f} ზეტაჯოულამდე {horizon}-ში (ახლა {cur:.0f} ზეტაჯოული).",
            "reasoning": "ოკეანე შთანთქავს პლანეტარული ჭარბი სითბოს უმეტეს ნაწილს.",
            "reasoning_proj": "სითბოს მატება {slope:+.2f} ზეტაჯოული/წელი (R²={r2}) {n} მონაცემთა წერტილზე (0–2000 მ).",
            "risk": "high",
            "base_prob": 0.85,
        },
        "ph": {
            "category": "ოკეანის მჟავიანობა",
            "prediction": "ოკეანის ზედაპირული pH მცირდება {horizon}-ის განმავლობაში.",
            "prediction_proj": "ოკეანის pH დაეცემა ~{proj:.3f}-მდე {horizon}-ში (ახლა {cur:.3f}).",
            "reasoning": "შთანთქმული CO₂ ამცირებს ოკეანის pH-ს (ALOHA სადგური).",
            "reasoning_proj": "მჟავიანობის ტენდენცია {slope:+.3f} pH/წელი (R²={r2}) ALOHA სადგურის {n} წლის მონაცემებზე.",
            "risk": "medium",
            "base_prob": 0.80,
        },
        "wildfire": {
            "category": "ხანძრის რისკი",
            "prediction": "ხანძრის გაზრდილი აქტივობა გრძელდება {horizon}-ის განმავლობაში.",
            "prediction_live": "ხანძრის გაზრდილი აქტივობა გრძელდება {horizon}-ის განმავლობაში; ამჟამად {cur} აქტიური კერა.",
            "reasoning": "სატელიტური კერები მიუთითებს გაზრდილი ხანძრის საშიშროების რეგიონებზე.",
            "reasoning_live": "{cur} აქტიური ხანძრის კერა გამოვლენილია სატელიტებით (NASA FIRMS).",
            "risk": "high",
            "base_prob": 0.74,
        },
        "cyclone": {
            "category": "ციკლონი",
            "prediction": "ტროპიკული ციკლონების აქტივობა გრძელდება {horizon}-ის განმავლობაში.",
            "prediction_live": "ტროპიკული ციკლონების აქტივობა გრძელდება {horizon}-ის განმავლობაში; ამჟამად იკვლევა {cur} ქარიშხალი.",
            "reasoning": "თბილი ოკეანის წყლები ციკლონების განვითარების ენერგიას იძლევა.",
            "reasoning_live": "{cur} ტროპიკული ციკლონი აქტიურია ატლანტიკის თბილ წყლებზე.",
            "risk": "medium",
            "base_prob": 0.68,
        },
    },
}


def _horizon_scale(days: int) -> tuple:
    """Множник імовірності та напівширина довірчого інтервалу за горизонтом.

    Чим далі горизонт — тим нижча впевненість: імовірність зменшується,
    а довірчий інтервал розширюється."""
    if days <= 7:
        return 1.00, 0.06
    if days <= 30:
        return 0.96, 0.07
    if days <= 90:
        return 0.92, 0.08
    if days <= 365:
        return 0.86, 0.10
    if days <= 730:
        return 0.78, 0.12
    if days <= 1095:
        return 0.72, 0.14
    if days <= 1460:
        return 0.67, 0.16
    if days <= 1825:
        return 0.62, 0.17
    return 0.56, 0.18


_HORIZON_PRESETS = (7, 30, 90, 365, 730, 1095, 1460, 1825, 3650)

_HORIZON_LABELS: Dict[int, Dict[str, str]] = {
    7: {"en": "7 days", "uk": "7 днів", "de": "7 Tage", "pl": "7 dni", "fr": "7 jours", "it": "7 giorni", "ka": "7 დღე"},
    30: {"en": "30 days", "uk": "30 днів", "de": "30 Tage", "pl": "30 dni", "fr": "30 jours", "it": "30 giorni", "ka": "30 დღე"},
    90: {"en": "90 days", "uk": "90 днів", "de": "90 Tage", "pl": "90 dni", "fr": "90 jours", "it": "90 giorni", "ka": "90 დღე"},
    365: {"en": "1 year", "uk": "1 рік", "de": "1 Jahr", "pl": "1 rok", "fr": "1 an", "it": "1 anno", "ka": "1 წელი"},
    730: {"en": "2 years", "uk": "2 роки", "de": "2 Jahre", "pl": "2 lata", "fr": "2 ans", "it": "2 anni", "ka": "2 წელი"},
    1095: {"en": "3 years", "uk": "3 роки", "de": "3 Jahre", "pl": "3 lata", "fr": "3 ans", "it": "3 anni", "ka": "3 წელი"},
    1460: {"en": "4 years", "uk": "4 роки", "de": "4 Jahre", "pl": "4 lata", "fr": "4 ans", "it": "4 anni", "ka": "4 წელი"},
    1825: {"en": "5 years", "uk": "5 років", "de": "5 Jahre", "pl": "5 lat", "fr": "5 ans", "it": "5 anni", "ka": "5 წელი"},
    3650: {"en": "10 years", "uk": "10 років", "de": "10 Jahre", "pl": "10 lat", "fr": "10 ans", "it": "10 anni", "ka": "10 წელი"},
}


def _horizon_label(lang: str, days: int) -> str:
    """Локалізована назва горизонту для найближчого пресету (7д … 10 років)."""
    preset = min(_HORIZON_PRESETS, key=lambda p: abs(p - int(days)))
    return _HORIZON_LABELS[preset].get(_normalize_lang(lang), "10 years")


def _projected(cur: Optional[float], slope: Optional[float], years: float) -> Optional[float]:
    """Екстраполяція на горизонт: поточне значення + тренд × роки."""
    if cur is None or slope is None:
        return None
    try:
        return float(cur) + float(slope) * float(years)
    except (TypeError, ValueError):
        return None


def _indicator(snapshot: Dict[str, Any], current_key: str, analysis_key: str) -> tuple:
    """(поточне значення, нахил, R², n) зі знімка — поточні + історичні дані."""
    cur = (snapshot.get(current_key) or {}).get("value")
    trend = ((snapshot.get(analysis_key) or {}).get("trend_analysis") or {})
    slope = trend.get("recent_slope_per_year")
    if slope is None:
        slope = trend.get("slope_per_year")
    return cur, slope, trend.get("r_squared"), trend.get("n") or 0


def _template_predictions(snapshot: Dict[str, Any], lang: str, days: int = 30) -> List[Dict[str, Any]]:
    """Детерміновані фолбек-прогнози, зважені під ГОРИЗОНТ і заземлені на
    поточні значення + багаторічні тренди (slope_per_year/recent_slope_per_year).

    Короткі горизонти (≤90 днів) додають «живі» події (пожежі, циклони),
    довгі — структурні тренди (CO₂, рівень моря, тепло океану, лід, pH)."""
    lang = _normalize_lang(lang)
    days = max(7, min(int(days or 30), 3650))
    tpl = _TEMPLATE_PREDICTIONS[lang]
    years = days / 365.0
    horizon = _horizon_label(lang, days)
    k, half = _horizon_scale(days)

    def _fav(current_key: str, analysis_key: str) -> Optional[dict]:
        cur, slope, r2, n = _indicator(snapshot, current_key, analysis_key)
        if cur is None:
            return None
        return {
            "cur": float(cur),
            "slope": float(slope) if slope is not None else None,
            "r2": float(r2) if r2 is not None else 0.0,
            "n": n,
            "proj": _projected(cur, slope, years),
        }

    def _build(key: str, fav: dict) -> dict:
        payload = dict(fav)
        payload["horizon"] = horizon
        rec = tpl[key]
        p = max(0.0, min(1.0, rec["base_prob"] * k))
        lo = max(0.0, p - half)
        hi = min(1.0, p + half)
        # Екстраполяцію тренду використовуємо лише для горизонтів ≥ 90 днів —
        # на 7/30 днів погодою керують синоптичні процеси, а не багаторічний нахил.
        if payload.get("proj") is not None and days > 30:
            prediction = rec["prediction_proj"].format(**payload)
            reasoning = rec["reasoning_proj"].format(**payload)
        elif "prediction_live" in rec and payload.get("proj") is None:
            prediction = rec["prediction_live"].format(**payload)
            reasoning = rec["reasoning_live"].format(**payload)
        else:
            prediction = rec["prediction"].format(horizon=horizon)
            reasoning = rec["reasoning"].format(horizon=horizon)
        return {
            "category": rec["category"],
            "prediction": prediction,
            "probability": round(p, 2),
            "confidence_interval": [round(lo, 2), round(hi, 2)],
            "reasoning": reasoning,
            "risk_level": rec["risk"],
            "timeframe": horizon,
        }

    structural = []
    structural.append(("temperature", _fav("temperature", "temperature_analysis")))
    structural.append(("co2", _fav("co2", "co2_analysis")))
    structural.append(("ice", _fav("arctic_ice", "arctic_ice_analysis")))
    structural.append(("sea_level", _fav("sea_level", "sea_level_analysis")))
    structural.append(("ocean", _fav("ocean_heat", "ocean_heat_analysis")))
    structural.append(("ph", _fav("ocean_ph", "ocean_ph_analysis")))
    structural = [(k, f) for k, f in structural if f is not None]

    live = []
    fires = snapshot.get("fires", 0)
    if fires:
        live.append(("wildfire", {"cur": int(fires), "slope": None, "r2": 0.0, "n": 0, "proj": None}))
    storms = snapshot.get("storms", 0)
    if storms:
        live.append(("cyclone", {"cur": int(storms), "slope": None, "r2": 0.0, "n": 0, "proj": None}))

    # Температура — завжди першою (якщо є). Живі події — лише для коротких горизонтів.
    order = [it for it in structural if it[0] == "temperature"]
    if days <= 90:
        order += live
    order += [it for it in structural if it[0] != "temperature"]
    order += (live if days > 90 else [])
    order = order[:5]

    predictions = [_build(key, fav) for key, fav in order]
    if not predictions:
        rec = tpl["temperature"]
        p = max(0.0, min(1.0, rec["base_prob"] * k))
        predictions.append(
            {
                "category": rec["category"],
                "prediction": rec["prediction"].format(horizon=horizon),
                "probability": round(p, 2),
                "confidence_interval": [round(max(0.0, p - half), 2), round(min(1.0, p + half), 2)],
                "reasoning": rec["reasoning"].format(horizon=horizon),
                "risk_level": rec["risk"],
                "timeframe": horizon,
            }
        )
    return predictions[:5]


def get_ai_predictions(lang: str = "en", days: int = 30) -> List[Dict[str, Any]]:
    """Повертає прогнози на основі Groq запитуваною мовою та горизонтом."""
    lang = _normalize_lang(lang)
    days = max(7, min(int(days or 30), 3650))
    key = f"ai_predictions:{lang}:{days}"
    hit = _cache.get(key)
    if hit:
        return hit["data"]
    data = _generate_predictions(lang, days)
    _cache[key] = {"ts": time.time(), "data": data}
    return data
