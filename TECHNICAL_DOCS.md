# Climate Intelligence — Технічна документація

## Архітектура

```
[Браузер] ──fetch──> [Next.js :3000] ──proxy──> [FastAPI :8000] ──httpx──> [Зовнішні API]
                         │                           │
                    React Three Fiber            PostgreSQL (Neon)
                    Plotly.js charts             APScheduler
                    Framer Motion                Groq AI (LLM)
```

| Шар | Мова | Фреймворк/Бібліотека | Роль |
|-----|------|---------------------|------|
| **Frontend** | TypeScript (React/Next.js 14) | Three.js, Plotly.js, Framer Motion | UI, 3D-глобус, графіки, анімації |
| **Backend** | Python 3.12 | FastAPI, httpx, numpy, scipy | API-сервер, агрегація даних, статистика |
| **AI** | Python 3.12 (зовнішній API) | Groq SDK (llama-3.3-70b-versatile) | Генерація текстових аналізів та прогнозів |
| **БД** | SQL | PostgreSQL (Neon), SQLAlchemy async, Alembic | Збереження снапшотів кліматичних даних |
| **Планувальник** | Python 3.12 | APScheduler | Фонові завдання (щогодинний snapshot) |

---

## 1. Модулі бекенду (Python)

### 1.1 data_sources.py — Збір даних з API

**Мова:** Python 3.12
**Бібліотеки:** `httpx` (HTTP-запити), `csv` (парсинг CSV), `xml.etree.ElementTree` (парсинг RSS/XML), `json`

Кожна функція `fetch_*()` робить HTTP-запит до зовнішнього API, парсить відповідь і повертає словник. Функція `get_*()` обгортає `fetch_*()` через `_cached()` для кешування.

#### Метеорологія

| Функція | API | Мова парсингу | Що повертає |
|---------|-----|---------------|------------|
| `fetch_weather(lat, lon)` | Open-Meteo Weather | JSON | `{"current": {...}, "daily": {...}}` — T, вітер, хмари, опади, УФ |
| `fetch_marine(lat, lon)` | Open-Meteo Marine | JSON | `{"hourly": {"sea_surface_temperature": [...], "wave_height": [...]}}` |
| `fetch_air_quality(lat, lon)` | Open-Meteo Air Quality | JSON | `{"current": {"us_aqi": ..., "pm2_5": ...}}` |
| `fetch_geocode(query, count)` | Open-Meteo Geocoding | JSON | `{"results": [{"name": ..., "latitude": ..., "longitude": ...}]}` |

#### Кліматичні індикатори (CSV)

| Функція | Джерело CSV | Як парсить | Що рахує |
|---------|------------|-----------|---------|
| `fetch_gistemp()` | NASA GISTEMP v4 | `csv.reader` → рядок з найновішим роком | Аномалія температури (°C vs 1951–1980 baseline) |
| `fetch_co2()` | NOAA GML Mauna Loa | `csv.reader` → рядок з найновішим місяцем | Концентрація CO₂ (ppm) |
| `fetch_sea_ice()` | NSIDC Sea Ice Index | `csv.reader` → фільтр hemisphere="N" | Площа арктичного льоду (млн км²) |
| `fetch_sea_ice_south()` | NSIDC Sea Ice Index | `csv.reader` → фільтр hemisphere="S" | Площа антарктичного льоду |
| `fetch_sea_level()` | Church & White + UHSLC | `csv.reader` → серія [date, value] | Рівень моря (мм відносно baseline) |
| `fetch_ocean_heat()` | OWID / NOAA GML | `csv.reader` → серія [year, value] | Тепловміст океану (ZJ) |
| `fetch_ocean_ph()` | Hawaii HOT | `csv.reader` → серія [date, pH] | pH океану (закислення) |

**Як працює парсинг CSV (приклад fetch_gistemp):**
```python
# Python — csv.reader
reader = csv.reader(io.StringIO(text))
header = next(reader)
rows = list(reader)
# Знаходимо стовпець "J-D" (січень-грудень, середня аномалія)
idx = header.index("J-D") if "J-D" in header else None
# Беремо останній рядок з числовим значенням → latest = {"year": 2025, "value": 1.23}
```

#### Космічна погода

| Функція | API | Мова парсингу | Що повертає |
|---------|-----|---------------|------------|
| `fetch_kp_forecast()` | NOAA SWPC | JSON | `{"forecast": [{"kp": 5, "status": "storm"}, ...]}` |
| `fetch_goes_xray()` | NOAA SWPC GOES-18 | JSON | `{"series": [...], "current": {"flux": 1e-5}, "flare_class": "M"}` |
| `fetch_solar_cycle()` | NOAA SWPC | JSON | `{"series": [{"ssn": 150, "f10_7": 160}]}` |
| `fetch_solar_wind()` | NOAA SWPC DSCOVR | JSON | `{"speed": 450, "bz": -5, "density": 5.2}` |
| `fetch_aurora(lat, lon)` | NOAA SWPC OVATION | Binary PNG → перетворення | `{"probability": 0.65, "kp_needed": 5}` |
| `fetch_schumann()` | ResonanceOne | JSON | `{"activity_index": 12, "frequency_hz": 7.83}` |

**Особливість fetch_aurora:** Якщо OVATION недоступний, робить fallback-розрахунок за Kp-індексом з урахуванням магнітної широти:
```python
# Python — fallback за Kp + магнітна широта
MAGNETIC_LAT_OFFSET = 10.0
magnetic_lat = abs(lat) - MAGNETIC_LAT_OFFSET  # магнітний полюс ≈ 80°N географічно
boundary = 65.0 - 2.4 * kp                    # межа овалу полярного сяйва
distance = magnetic_lat - boundary
# Ймовірність ≈ 0 якщо Kp < 3, зростає до 1 при Kp ≥ 7
```

#### Геофізичні події

| Функція | API | Мова парсингу | Що повертає |
|---------|-----|---------------|------------|
| `fetch_earthquakes(min_mag, limit)` | USGS GeoJSON | JSON | `{"earthquakes": [{"magnitude": 5.2, "place": "Japan", "time": 1723...}]}` |
| `fetch_eonet(days)` | NASA EONET v3 | JSON + фільтр >90 днів | `{"events": [{"event_type": "Volcano", "coordinates": [lon, lat]}]}` |
| `fetch_hurricanes()` | NOAA NHC RSS | XML (`xml.etree.ElementTree`) | `{"storms": [{"title": "Hurricane X", "coordinates": [...]}]}` |
| `fetch_asteroids(days)` | NASA NeoWs | JSON | `{"objects": [{"name": "2024 XY", "miss_km": 5e6}]}` |
| `fetch_neo(count)` | NASA NeoWs | JSON | Астероїди (обсяг за N днів) |

**Особливість fetch_hurricanes:** Парсить RSS XML:
```python
# Python — xml.etree.ElementTree
import xml.etree.ElementTree as ET
root = ET.fromstring(r.text)
for item in root.findall(".//item"):
    title = item.find("title").text  # "Hurricane CATEGORY 3 FELIX"
    coords_text = item.find("{...}georss:point").text  # "12.3 -45.6"
    lat, lon = map(float, coords_text.split())
```

#### Пожежі (FIRMS)

| Функція | API | Мова парсингу | Що повертає |
|---------|-----|---------------|------------|
| `fetch_fires(days)` | NASA FIRMS CSV API | `csv.reader` | `{"fires": [{"coordinates": [lon, lat], "frp": 45.2, "acq_date": "2026-08-19"}]}` |

**Як працює:**
1. Спроба продуктів почергово: `VIIRS_SNPP_NRT` → `VIIRS_NOAA21_NRT` → `VIIRS_NOAA20_NRT`
2. CSV парситься рядок за рядком, кожен рядок = одне вогнище
3. Фолбэк: якщо ключ відсутній — використовує фіксовані наземні координати (_FALLBACK_FIRES) з прапором `"simulated": true`:
```python
# Python — фолбек-пожежі (23 фіксовані точки на суходолі)
_FALLBACK_FIRES = [
    [-124.0, 51.5],  # Canada / British Columbia
    [-119.5, 37.5],  # California
    [-60.0, -5.0],   # Amazon / Brazil
    [95.0, 60.0],    # Siberia
    [25.0, -20.0],   # Southern Africa
    [145.0, -19.0],  # Australia
    ...  # 24 точки загалом
]
```

#### AI-запити (Groq)

| Функція | API | Мова запиту | Що генерує |
|---------|-----|------------|-----------|
| `get_ai_analysis(lang, data)` | Groq API (llama-3.3-70b-versatile) | Python → HTTP POST JSON | Текстовий аналіз поточної ситуації |
| `get_ai_predictions(lang, days, data)` | Groq API | Python → HTTP POST JSON | JSON-масив прогнозів з ймовірностями |
| `get_ai_summary(lang, data)` | Groq API | Python → HTTP POST JSON | Короткий підсумок |

**Як працює (приклад get_ai_analysis):**
```python
# Python — Groq API запит
import httpx
prompt = f"""Analyze today's climate situation in {_lang_name(lang)}.
Data: temperature={temp}°C, CO2={co2} ppm, anomaly={anomaly}°C, fires={fires}..."""
response = httpx.post(_GROQ_URL, json={
    "model": "llama-3.3-70b-versatile",
    "messages": [{"role": "user", "content": prompt}],
}, headers={"Authorization": f"Bearer {api_key}"})
analysis = response.json()["choices"][0]["message"]["content"]
```

**Fallback (без ключа Groq):**
```python
# Python — шаблонний аналіз
summary = f"Global temperature anomaly is {anomaly:+.2f}°C above 1951-1980 baseline. CO₂ at {co2} ppm."
```

---

### 1.2 analytics.py — Статистичний аналіз

**Мова:** Python 3.12
**Бібліотеки:** `numpy` (масиви, обчислення), `scipy.stats` (лінійна регресія)

Застосовується до кожного climate-серії: `/api/gistemp`, `/api/co2`, `/api/sea-level`, `/api/ocean-heat`, `/api/ocean-ph`, `/api/sea-ice`, `/api/sea-ice-south`.

**Особливість CO₂:** Для статистики (trend/z-score) використовуються **річні середні** (`to_annual_average()`), а не сірі місячні значення. Сезонний цикл CO₂ (крива Келінга) створює автокорельовані залишки, через що p_value scipy.stats.linregress занижується. Річні середні знімають сезонність природним шляхом.

#### 2.1 Часова вісь — `_x_values()`

Конвертує ISO-дати у **fractional year** (дробовий рік):
```python
# Python — numpy + datetime
import numpy as np
import datetime

# Вхід: [{"date": "2024-07-15", "value": 3.2}, ...]
# Вихід: np.array([2024.534, ...])
year = 2024
month = 7; day = 15
date = datetime.date(year, month, day)
start = datetime.date(year, 1, 1)
day_of_year = (date - start).days  # 196
days_in_year = 366 if (year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)) else 365
fractional = year + day_of_year / days_in_year  # 2024.534
```

#### 2.2 Лінійний тренд — `linear_trend()`

**МНК-регресія** (method of least squares):
```python
# Python — scipy.stats.linregress
from scipy import stats

x = np.array([2020.0, 2021.0, ..., 2025.5])  # fractional years
y = np.array([1.02, 1.15, ..., 1.35])          # значення (°C, ppm, тощо)

slope, intercept, r, p_value, std_err = stats.linregress(x, y)
```

**Що рахує:**
| Поле | Формула | Що означає |
|------|---------|-----------|
| `slope_per_year` | `slope` | Зміна за рік (наприклад +0.018°C/рік) |
| `intercept` | `intercept` | Значення при x=0 (технічний параметр) |
| `r_squared` | `r ** 2` | Якість моделі (0–1, чим ближче до 1 — тим краще) |
| `p_value` | `p_value` | Статистична значущість (p < 0.05 = тренд є) |
| `std_error` | `std_err` | Стандартна помилка нахилу |
| `projected_next_year` | `slope * (last_x + 1) + intercept` | Прогноз на наступний рік |
| `n` | `len(x)` | Кількість точок |

#### 2.3 Z-оцінка аномалії — `z_score_anomaly()`

**Метод:** детрендинг через МНК-регресію, потім z-score залишків.
**Поріг:** мінімум **8 точок** (min_points=8) — при <8 ступенях自由度 std дуже шумна.

**Чому не від «сирого» середнього:** Для рядів з міцним трендом (CO₂, температура, рівень моря) z відносно середнього росте «сам по собі» — остання точка завжди далі від старого середнього. Правильно: z від залишків регресії.

```python
# Python — scipy + numpy
from scipy import stats

x = np.array([2020.0, 2021.0, ..., 2025.5])  # fractional years
y = np.array([1.02, 1.15, ..., 1.35])

# 1. Будуємо регресію
slope, intercept, *_ = stats.linregress(x, y)

# 2. Залишки = факт − прогноз_по_тренду
residuals = y - (slope * x + intercept)

# 3. Z-score останнього залишку
hist = residuals[:-1]
z = residuals[-1] / hist.std(ddof=1)
```

**Порівняння (реальні дані, серпень 2026):**

| Ряд | z (detrended) | Інтерпретація |
|-----|--------------|--------------|
| GISTEMP (146 річних точок, 1880–2024) | +2.66 | Аномалія вище тренду (2024 = рекордний рік) |
| CO₂ річні середні (48 точок, 1979–2026) | +2.40 | Аномально високий зростання відносно тренду |
| Sea Level (1189 точок, 1993–2026) | +0.88 | В межах норми (шум навколо тренду) |

**Інтерпретація:**
| z | Значення |
|---|---------|
| z < -2 | Сильно нижче тренду |
| -2 ≤ z ≤ 2 | В межах норми (шум навколо тренду) |
| z > 2 | Сильно вище тренду (реальна аномалія) |

#### 2.4 Рік-до-року — `year_over_year()`

**Автоматичне визначення кроку:**
```python
# Python — numpy
gaps = np.diff(x)                  # різниці між сусідніми точками
gaps = gaps[np.isfinite(gaps) & (gaps > 0)]  # фільтруємо дублікати дат (gap=0)
median_gap = np.median(gaps)       # медіанний крок (наприклад 1.0 = річні дані)
steps = max(1, round(1.0 / median_gap))  # steps = 1 для річних, 12 для місячних, 365 для денних
delta = series[-1]["value"] - series[-steps - 1]["value"]
```

#### 2.5 Агрегований аналіз — `describe()`

Повертає всі три метрики разом (викликає `linear_trend` + `z_score_anomaly` + `year_over_year`):
```json
{
  "trend_analysis": { "slope_per_year": 0.018, "r_squared": 0.85, "p_value": 0.0001, "projected_next_year": 1.42 },
  "z_score_anomaly": 2.34,
  "year_over_year": 0.035
}
```

---

### 1.3 ai_groq.py — AI-аналіз та прогнози

**Мова:** Python 3.12
**Бібліотеки:** `httpx` (HTTP до Groq API), `json`, `zoneinfo` (часові пояси)

**Модель:** `llama-3.3-70b-versatile` (Groq, сумісний з OpenAI chat completions)

#### AI-аналіз (`/api/ai-analysis`)
- Генерується **двічі на день**: 09:00 та 17:00 за Київським часом
- Кешується в `_cache` dict (перевірка slot за поточним часом)
- Мова відповіді = мова інтерфейсу (en/uk/de/pl/fr/it/ka)

#### AI-прогнози (`/api/predictions`)
- Горизонт: 7 / 30 / 90 / 365 / 730 / 1095 / 1460 / 1825 / 3650 днів
- Повертає JSON-масив з категоріями, ймовірностями, довірчими інтервалами, рівнем ризику

---

### 1.4 db.py — База даних

**Мова:** Python 3.12
**Бібліотеки:** `sqlalchemy.ext.asyncio` (ORM), `asyncpg` (драйвер PostgreSQL)

**Таблиця:** `climate_snapshots`
| Стовпець | Тип | Опис |
|----------|-----|------|
| id | Integer (PK) | Автоінкремент |
| captured_at | DateTime | Час збереження снапшоту |
| metric | String(64) | Назва метрики (temperature_anomaly, co2, ...) |
| value | Float | Значення |
| meta | JSON | Додаткові дані (рік, джерело, тощо) |

**Індекси:** `ix_climate_snapshots_captured_at`, `ix_climate_snapshots_metric`

### 1.5 scheduler.py — Фонові завдання

**Мова:** Python 3.12
**Бібліотеки:** `apscheduler` (BackgroundScheduler)

- **Завдання:** `store_climate_snapshot()` — кожну годину
- Записує 6 метрик: temperature_anomaly, co2, sea_ice_north, sea_level, ocean_heat, ocean_ph
- Фолбэк: якщо БД недоступна — дані просто не зберігаються (не падає)

---

## 2. Модулі фронтенду (TypeScript)

### 2.1 lib/api.ts — HTTP-клієнт

**Мова:** TypeScript (React/Next.js)
**Бібліотеки:** нативний `fetch`

```typescript
// TypeScript — retry-логіка з exponential backoff
async function getJSON<T>(path: string, params?: Record<string, string | number>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`API ${path} failed: ${res.status}`);
    return (await res.json()) as T;
  }
}
```

### 2.2 EarthGlobe.tsx — 3D-глобус

**Мова:** TypeScript (React)
**Бібліотеки:** `@react-three/fiber` (Three.js wrapper), `@react-three/drei` (OrbitControls, Stars)

#### Побудова маркерів — `buildOceanPoints()`
```typescript
// TypeScript — побудова маркерів океанічних даних
const co2Value = co2?.latest?.value;
if (typeof co2Value === "number") {
  points.push({
    coordinates: [-155.58, 19.54],  // Mauna Loa
    event_type: "Atmospheric CO₂",
    location: `${co2Value.toFixed(1)} ppm`,
    time: co2Date,                   // "2026-05"
  });
}
```

#### Оцінка актуальності — `freshnessOf()`
```typescript
// TypeScript — визначення свіжості даних
function freshnessOf(time?: string, ongoing?: boolean): Freshness {
  if (ongoing) return "live";
  const days = (Date.now() - Date.parse(time)) / 86400000;
  if (days <= 545) return "fresh";     // до ~1.5 років
  if (days <= 800) return "stale";     // до ~2.2 років
  // Для climate-індикаторів: річні дані можуть відставати на 1-2 роки
  const years = new Date(Date.parse(time)).getFullYear();
  if (years < new Date().getFullYear() - 2) return "outdated";
  return "stale";
}
```

#### Обертання астероїдів — `AsteroidField.tsx`
```typescript
// TypeScript — Three.js анимация обертання
useFrame((state) => {
  ref.current.rotation.y += 0.001 * speed;  // обертання навколо осі
  ref.current.position.x = Math.cos(angle) * radius;  // орбіта
  ref.current.position.z = Math.sin(angle) * radius;
});
```

### 2.3 AnalyticsCharts.tsx — Графіки

**Мова:** TypeScript (React)
**Бібліотеки:** `react-plotly.js` (обгортка Plotly.js)

```typescript
// TypeScript — побудова графіка з Plotly.js
const trace = {
  x: series.map((p) => p.date),     // ISO-дати
  y: series.map((p) => p.value),    // значення
  type: "scatter",
  mode: "lines",
  name: t.analytics.seaLevel,
};
const layout = {
  xaxis: { type: "date", ... },  // ОБОВ'ЯЗКОВО type: "date" для часових рядів!
  yaxis: { title: "mm", ... },
};
```

**10 графіків:**
| Графік | Тип | дані X | дані Y |
|--------|-----|--------|--------|
| Аномалія температури | line + regression band | роки | °C |
| CO₂ | line + trend | роки-місяці | ppm |
| Морський лід (арктика) | line | дати | млн км² |
| Морський лід (антарктика) | line | дати | млн км² |
| Рівень моря | line + trend | дати | мм |
| Ocean heat | line + trend | роки | ZJ |
| Ocean pH | line + trend | дати | pH |
| Kp-прогноз | bar | time_tag | Kp |
| Сонячні спалахи | line | time_tag | W/m² |
| Сонячний цикл | dual-axis line | time_tag | SSN + F10.7 |

### 2.4 DashboardSections.tsx — KPI-картки

**Мова:** TypeScript (React)
**Бібліотеки:** `framer-motion` ( анімації)

```typescript
// TypeScript — KPI-картка з анімацією
<motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
  <span className="text-2xl font-bold">{kpi.value}</span>     {/* "1.23°C" */}
  <span className="text-sm">{kpi.trend}</span>                  {/* "+0.05 vs last year" */}
  <span className="text-xs">{kpi.insight}</span>                {/* "NASA GISTEMP, 2025" */}
</motion.div>
```

### 2.5 lib/i18n.tsx — Мультимовність

**Мова:** TypeScript (React Hook)
**Бібліотеки:** ніяких зовнішніх

```typescript
// TypeScript — хук перекладу
export function useI18n() {
  const [lang, setLang] = useState<Locale>("en");
  const t = translations[lang];  // повний словник перекладів
  return { t, lang, setLang };
}
```

- 7 мов: en, uk, de, pl, fr, it, ka
- AI-відповіді генеруються запитуваною мовою

---

## 3. Інтеграція між шарами

### Запит фронтенду → бекенд → зовнішній API

```
1. [TS] fetch("/api/overview?lat=50.45&lon=30.52")
2. [Python] FastAPI: overview() — викликає 8 async.to_thread(get_*, ...)
3. [Python] get_weather() → _cached() → httpx.get("https://api.open-meteo.com/...")
4. [Python] JSON-відповідь з Open-Meteo → агрегація → повернення фронтенду
5. [TS] Отриманий JSON → React state → рендеринг компонентів
```

### Запит AI-аналізу

```
1. [TS] fetch("/api/ai-analysis?lang=uk")
2. [Python] ai_groq.py: get_ai_analysis("uk", current_data)
3. [Python] httpx.post("https://api.groq.com/...") з prompt + current climate data
4. [Python] Groq → llama-3.3-70b-versatile → текст аналізу
5. [TS] Текст аналізу → AIPredictions.tsx → рендеринг
```

---

## 4. Кешування

| Рівень | Мова | Механізм | TTL |
|--------|------|----------|-----|
| Python `_cached()` | Python | Словник `dict` в пам'яті | 10–60 хв |
| DB snapshots | Python + SQL | PostgreSQL (Neon) | Постійно (1 годинний інтервал) |
| Frontend fetch | TypeScript | `cache: "no-store"` | Немає |
| AI cache | Python | Словник `_cache` в ai_groq.py | До наступного slot (09:00/17:00) |

**Стратегія кешування:**
| Джерело | Мова | TTL кешу |
|---------|------|---------|
| Погода, море, AQI | Python | 10 хв |
| Fires, hurricanes, quakes | Python | 10 хв |
| GISTEMP, CO₂, sea ice, sea level, ocean heat, ocean pH | Python | 60 хв |
| EONET, Kp, solar, aurora, schumann | Python | 30 хв |
| Sources status | Python | 30 хв |

---

## 5. Деплой

| Сервіс | URL | Мова | Порт |
|--------|-----|------|------|
| Frontend | Vercel (aiclimateintelligence.vercel.app) | TypeScript | 443 |
| Backend | Render (ai-climate-intelligence.onrender.com) | Python | $PORT |
| Database | Neon (PostgreSQL) | SQL | 5432 |

**Змінні середовища:**
| Змінна | Де використовується | Мова |
|--------|-------------------|------|
| `NEXT_PUBLIC_API_URL` | TS: fetch() base URL | TypeScript |
| `GROQ_API_KEY` | Python: Groq API auth | Python |
| `FIRMS_API_KEY` | Python: NASA FIRMS auth | Python |
| `DATABASE_URL` | Python: SQLAlchemy підключення | Python |
| `CORS_ORIGINS` | Python: FastAPI CORS middleware | Python |

---

## 6. Обмеження та фолбэки

| Сценарій | Мова | Поведінка |
|----------|------|----------|
| Немає FIRMS_API_KEY | Python | Фіксовані наземні координати (_FALLBACK_FIRES, 24 точки на суходолі, acq_date = today, `simulated: true`) |
| Немає GROQ_API_KEY | Python | AI-аналіз/прогнози: шаблонні відповіді з актуальних даних |
| Немає NASA_API_KEY | Python | Астероїди/сонячна погода: fallback-заглушки |
| Groq API недоступний | Python | Ті самі шаблони (fallback завжди працює) |
| БД недоступна | Python | Снапшоти не зберігаються, все інше працює |
| Зовнішній API недоступний | Python | `_safe()` повертає default-значення |
| EONET подія > 90 днів | Python | Фільтрується в `fetch_eonet()` |
| xaxis.type не задано | TypeScript | Plotly.js показує X як категорії (графік ламається) — ВИПРАВЛЕНО |

---

## 7. Актуальність даних на глобусі

Дані на 3D-глобусі надходять з різних джерел з різною затримкою публікації:

### Актуальні (2026)
| Маркер | Джерело | Остання дата | Оновлення | Тренд (slope/yr) |
|--------|---------|-------------|----------|-----------------|
| CO₂ | NOAA GML | 2026-05 | Щомісяця | +1.91 ppm/рік |
| Sea Level | Church & White + UHSLC | 2026-02 | Щотижня | +3.36 mm/рік |
| Sea Ice (N+S) | NSIDC | 2026-08-22 | Щоденно | — |
| Wildfires | NASA FIRMS | Поточний день | Реальний час |
| Cyclones | NOAA NHC | Активні | Реальний час |
| Earthquakes | USGS | За тиждень | Реальний час |
| EONET | NASA | До 90 днів | Реальний час |

### Затримка публікації (не показуємо рік на глобусі)
| Маркер | Джерело | Остання дата | Затримка | Причина |
|--------|---------|-------------|----------|---------|
| Ocean Heat | OWID / NOAA | 2025 | ~1 рік | Річні сводки NOAA |
| Ocean pH | Hawaii HOT | 2024-12 | ~1.5 року | Корабельні вимірювання |

**Рішення:** Для ocean heat та ocean pH рік прибрано з label'а на глобусі (лише значення: `33 ZJ`, `pH 8.061`), оскільки ці дані фізично не можуть бути 2026-го року — upstream-джерела ще не опублікували свіжіші дані. Z-score та trend аналіз працюють коректно завдяки detrending (див. розділ 2.3).

В тултіпі та detail card для цих маркерів показується `latest (annual)` / `latest (ship-based)` замість застарілої дати (функція `displayTime()` в EarthGlobe.tsx).

---

## 8. Історія змін (чого ми домоглися)

### Проблема: Пусті графіки в «Аналітика»
**Статус:** ВИПРАВЛЕНО (commit `fa0b8d1`)

Plotly.js не мав `xaxis.type: "date"` — всі графіки з часовими рядами (Kp, спалахи, вітер, sea level, ocean pH тощо) показували порожні осі X. Додано `xaxis: { type: "date" }` до 8 графіків у AnalyticsCharts.tsx.

### Проблема: Мусор в кодовій базі
**Статус:** ВИПРАВЛЕНО (commit `fadec2b`)

- Видалено 4 ad-hoc debug-скрипти (`test_data.py`, `test_eonet.py`, `test_events.py`, `test_overview.py`) — не pytest, ніде не підключені, містили `print()` та реальні API-виклики
- Видалено невикористовувані залежності з `requirements.txt`: `pandas` (важка, ніде не імпортується), `python-multipart` (лише для form-data, не використовується)
- Видалено випадковий файл `0` (10 байт) з кореня репозиторія
- Виправлено російськомовний коментар в `data_sources.py` → українська
- Видалено застарілий коментар «Париж залишається єдиним»
- Виправлено опечатку `NOAА` (кирилична А) → `NOAA`
- Виправлено зсув коментаря в `ai_groq.py:258`

### Проблема: Застарілі дані на глобусі (2024/2025)
**Статус:** ВИПРАВЛЕНО (commits `edc86f1`, `77bbac9`, `4f57c36`, `d8339af`)

**Кореневі причини:**
1. **EONET** — події з позначкою "ongoing" могли мати дати геометрії з 2024 року
2. **freshnessOf()** — пороги були занадто агресивні (400 днів = stale) для climate-індикаторів
3. **Ocean Heat / Ocean pH** — upstream-джерела мають вбудовану затримку (1–1.5 року), але рік показувався на глобусі

**Виправлення:**
| Що | Як | Файл |
|----|----|----|
| EONET > 90 днів | Бекенд фільтрує події з geometry date старішою за 90 днів | `data_sources.py` |
| freshnessOf() | Пороги: fresh ≤ 545 днів, stale ≤ 800 днів, outdated лише якщо year < currentYear − 2 | `EarthGlobe.tsx` |
| Ocean Heat label | Прибрано рік з label (`33 ZJ · Ocean Heat` замість `33 ZJ · Ocean Heat · 2025`) | `EarthGlobe.tsx` |
| Ocean pH label | Прибрано рік з label (`pH 8.061 · Ocean pH` замість `pH 8.061 · Ocean pH · 2024`) | `EarthGlobe.tsx` |
| Тултіп / detail card | Для ocean heat/pH показує `latest (annual)` / `latest (ship-based)` замість застарілої дати | `EarthGlobe.tsx` |

### Проблема: Методологічні помилки в статистиці
**Статус:** ВИПРАВЛЕНО (commit `4ae996b`)

| Помилка | Наслідок | Виправлення |
|---------|---------|-------------|
| **z_score_anomaly** — z від «сирого» середнього | Для трендових рядів (CO₂, температура) z росте «сам по собі» — хибнопозитивні аномалії | Детрендинг: z рахується від залишків регресії (residuals = факт − прогноз) |
| **year_over_year** — overflow при дублікатах дат | `median_gap = 0` → `round(1.0/0.0)` → OverflowError → 500 помилка | Фільтрація `gaps[gaps > 0]` перед обчисленням median |
| **std при коротких рядах** — NaN | `std(ddof=1)` з 1 елемента = NaN | Мінімум 8 точок для z-score (раніше 4) |
| **Fallback aurora** — ігнорував lat/lon | Київ і Мурманск давали однакову ймовірність | Додано `MAGNETIC_LAT_OFFSET = 10°` для магнітної широти |

### Проблема: Биті артефакти в документації
**Статус:** ВИПРАВЛЕНО

- Китайські ієрогліфи `闰年` та `时间标签` у Python-кодах → замінено на валидний Python
- Хибний опис fallback-пожеж (`random.uniform` в океанах) → оновлено: 24 фіксовані наземні координати з прапором `simulated: true`

### Проблема: Аудит статистичних розрахунків (analytics.py)
**Статус:** ВИПРАВЛЕНО (серпень 2026)

| Що | Було | Стало | Файл |
|----|------|-------|------|
| z_score_anomaly min_points | 4 | **8** — при 3 ступенях自由ности std шумний | `analytics.py:88` |
| CO₂ статистика | на місячних (автокореляція) | **річні середні** (`to_annual_average()`) | `main.py:188` |
| Aurora fallback | без посилань на літературу | Додано Starkov (1994), Feldstein (1967), Troyer (2021) | `data_sources.py:1645` |
| Fallback-пожежі | без позначення | `"simulated": true` на кожному об'єкті | `data_sources.py:914` |
| Тести | відсутні | `tests/test_analytics.py` — 34 кейси, всі зелені | `backend/tests/` |
| Baseline | відсутній | `tests/baseline_after_fix.json` — реальні цифри | `backend/tests/` |

### Створено документацію
**Статус:** ВИПРАВЛЕНО

Створено `TECHNICAL_DOCS.md` — повна технічна документація проекту:
- Архітектура (шари, мови, фреймворки)
- Модулі бекенду (Python): data_sources, analytics, ai_groq, db, scheduler
- Модулі фронтенду (TypeScript): api, EarthGlobe, AnalyticsCharts, DashboardSections, i18n
- Формули розрахунків з прикладами коду
- Актуальність даних на глобусі
- Історія змін (цей розділ)

### Підсумок комітів

| Коміт | Дата | Опис |
|-------|------|------|
| `fa0b8d1` | 2026-08-19 | Fix: xaxis.type: "date" для всіх графіків Plotly |
| `fadec2b` | 2026-08-19 | Chore: видалення debug-скриптів, невикористовуваних залежностей, мусору |
| `edc86f1` | 2026-08-19 | Fix: фільтр EONET > 90 днів, розширення freshnessOf() порогів |
| `4ae996b` | 2026-08-19 | Fix: detrended z-score, YoY guard, aurora magnetic lat, docs |
| `77bbac9` | 2026-08-19 | Fix: прибрано рік з label ocean heat/pH на глобусі |
| `7965936` | 2026-08-19 | Docs: розділ «Актуальність даних», виправлення fires fallback |
| `4f57c36` | 2026-08-19 | Fix: displayTime() — приховано дати в тултіпі/detail card |
| `d8339af` | 2026-08-19 | Fix: "latest (annual/ship-based)" замість порожніх дат |
| `14ac2b3` | 2026-08-24 | Analytics audit: min_points=8, annual CO₂, aurora coeff 2.4, 34 tests |

### v1.2.9 — Нові API-джерела даних (без ключів)

| Проблема | Було | Стало | Де |
|----------|------|-------|----|
| Астероїди NeoWs — потребує NASA_API_KEY | API_KEY обов'язковий | **JPL SBDB CAD** — без ключа, до 365 днів, real-time | `data_sources.py:936` |
| CH₄ — відсутній | відсутній | **NOAA GML** `ch4_mm_gl.csv` — щомісячний метан + analyze() | `data_sources.py:1623` |
| N₂O — відсутній | відсутній | **NOAA GML** `n2o_mm_gl.csv` — щомісячний N₂O + analyze() | `data_sources.py:1662` |
| GDACS — природні катастрофи | відсутній | **GDACS (UN OCHA + EU JRC)** — повені, циклони, вулкани, пожежі | `data_sources.py:1585` |
| Coral Reef Watch — стрес коралів | відсутній | **NOAA CRW** — термічний стрес, ризик блікування | `data_sources.py:1720` |
| GWIS — fallback пожеж | hardcoded static 23 points | **GWIS Copernicus** — live fallback + `"simulated": true` | `data_sources.py:1705` |
| _SOURCE_CHECKS | NeoWs (NASA_KEY) | **JPL SBDB** (без ключа) + GDACS + NOAA CH₄ + N₂O | `data_sources.py:1808` |
| Фронтенд: "Параметри" | settings | **Оновлення/Updates** — 7 мов | `translations.ts` |
| Версія | 1.2.8 | **1.2.9** | `translations.ts` |

### Нові ендпоінти API

| Ендпоінт | Опис | Джерело |
|----------|------|---------|
| `GET /api/ch4` | Глобальний метан (CH₄) + analyze() | NOAA GML |
| `GET /api/n2o` | Глобальний закис азоту (N₂O) + analyze() | NOAA GML |
| `GET /api/gdacs?event_type=` | Природні катастрофи (FL/TC/VO/WF/EQ) | GDACS (UN + EU) |
| `GET /api/coral-reef` | Термічний стрес коралів | NOAA CRW |
