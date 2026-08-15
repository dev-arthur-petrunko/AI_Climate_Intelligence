export interface WeatherCurrent {
  temperature_2m?: number | null;
  apparent_temperature?: number | null;
  relative_humidity_2m?: number | null;
  wind_speed_10m?: number | null;
  wind_direction_10m?: number | null;
  wind_gusts_10m?: number | null;
  cloud_cover?: number | null;
  pressure_msl?: number | null;
  precipitation?: number | null;
  weather_code?: number | null;
}

export interface WeatherForecast {
  time?: string[];
  weather_code?: number[];
  temperature_2m_max?: number[];
  temperature_2m_min?: number[];
  precipitation_probability_max?: number[];
  wind_speed_10m_max?: number[];
}

export interface WeatherData {
  current?: WeatherCurrent;
  daily?: WeatherForecast;
  timezone?: string;
  _source?: string;
}

export interface OverviewData {
  location: { lat: number; lon: number };
  weather: {
    temperature?: number | null;
    apparent_temperature?: number | null;
    humidity?: number | null;
    wind_speed?: number | null;
    wind_direction?: number | null;
    cloud_cover?: number | null;
    pressure?: number | null;
    precipitation?: number | null;
    weather_code?: number | null;
    uv_index?: number | null;
    forecast?: WeatherForecast;
    source?: string;
  };
  ocean: {
    sea_surface_temperature?: number | null;
    wave_height?: number | null;
  };
  ocean_climate?: {
    sea_level?: { date?: string; value?: number } | null;
    sea_level_trend?: number | null;
    ocean_heat?: { year?: number; value?: number } | null;
    ocean_ph?: { date?: string; value?: number } | null;
    antarctic_ice?: { date?: string; extent?: number } | null;
  };
  air_quality: {
    us_aqi?: number | null;
    pm2_5?: number | null;
    pm10?: number | null;
    ozone?: number | null;
  };
  temperature_anomaly?: { year?: number; value?: number } | null;
  co2?: { year?: number; month?: number; value?: number } | null;
  sea_ice?: { extent?: number; date?: string; anomaly?: number } | null;
  hurricanes: { active?: boolean; count?: number };
  fires: { count?: number; live?: boolean };
}

export interface TrendAnalysis {
  trend_analysis?: {
    slope_per_year?: number;
    intercept?: number;
    r_squared?: number;
    p_value?: number;
    std_error?: number;
    projected_next_year?: number;
    n?: number;
  };
  z_score_anomaly?: number;
  year_over_year?: number;
}

export interface GISTEMPSeries {
  source: string;
  reference: string;
  series: { year: number; value: number }[];
  latest: { year: number; month?: number; value: number } | null;
  analysis?: TrendAnalysis;
}

export interface CO2Series {
  source: string;
  unit: string;
  series: { year: number; month: number; value: number }[];
  latest: { year: number; month: number; value: number } | null;
  analysis?: TrendAnalysis;
}

export interface SeaIceData {
  source: string;
  hemisphere: string;
  latest: { date: string; extent: number } | null;
  anomaly: number | null;
  baseline_period: string;
  annual_minimum: { year: number; value: number }[];
  recent: { date: string; extent: number }[];
  analysis?: TrendAnalysis;
}

export interface SeaLevelData {
  source: string;
  unit: string;
  reference: string;
  series: { date: string; value: number }[];
  latest: { date: string; value: number } | null;
  trend: number | null;
  analysis?: TrendAnalysis;
}

export interface OceanHeatData {
  source: string;
  unit: string;
  reference: string;
  series: { year: number; value: number }[];
  latest: { year: number; value: number } | null;
  analysis?: TrendAnalysis;
}

export interface OceanPhData {
  source: string;
  unit: string;
  reference: string;
  series: { date: string; value: number }[];
  latest: { date: string; value: number } | null;
  analysis?: TrendAnalysis;
}

export interface ClimateEvent {
  event_type: string;
  location: string;
  time: string;
  severity: string;
  coordinates?: [number, number] | null;
  frp?: number | null;
  confidence?: string | null;
  satellite?: string | null;
}

export interface KPIItem {
  name: string;
  value: string;
  trend: string;
  trend_up: boolean;
  insight: string;
}

export interface AIAnalysis {
  analysis: string;
  model?: string;
  generated_at?: string;
  live?: boolean;
}

export interface AIPrediction {
  category: string;
  prediction: string;
  probability: number;
  confidence_interval: [number, number];
  reasoning: string;
  risk_level?: string;
  timeframe?: string;
}

export interface AsteroidObject {
  name: string;
  hazardous: boolean;
  approach_date: string;
  miss_km: number | null;
  velocity_kms: number | null;
  diameter_m_min: number | null;
  diameter_m_max: number | null;
}

export interface AsteroidsData {
  source: string;
  range?: { start: string; end: string };
  count?: number;
  objects: AsteroidObject[];
  error?: boolean;
}

export interface GeomagneticData {
  source: string;
  current_kp: number | null;
  storm_level: string;
  series?: { time_tag: string; kp: number }[];
  error?: boolean;
}

export interface SolarEvent {
  type: string;
  start_time: string;
  class_?: string | null;
  source_location?: string | null;
  linked_activity?: string | null;
  speed?: number | null;
  isEarthGB?: boolean | null;
}

export interface SpaceWeatherData {
  source: string;
  range?: { start: string; end: string };
  count?: number;
  events: SolarEvent[];
  error?: boolean;
}

export interface GeocodeResult {
  name: string;
  latitude: number;
  longitude: number;
  country?: string | null;
  admin1?: string | null;
  timezone?: string | null;
}

export interface GeocodeData {
  results: GeocodeResult[];
  source: string;
  error?: boolean;
}

export interface KpForecastData {
  source: string;
  forecast?: { time_tag?: string; kp: number; status?: string }[];
  error?: boolean;
}

export interface GoesXrayData {
  source: string;
  current?: { time_tag: string; flux: number } | null;
  flare_class?: string | null;
  max_flux?: number | null;
  series?: { time_tag: string; flux: number }[];
  error?: boolean;
}

export interface SolarCycleData {
  source: string;
  latest?: { time_tag: string; ssn: number; f10_7: number } | null;
  series?: { time_tag: string; ssn: number; f10_7: number }[];
  error?: boolean;
}

export interface SolarWindData {
  source: string;
  time_tag?: string | null;
  speed?: number | null;
  density?: number | null;
  bt?: number | null;
  bz?: number | null;
  series?: { time_tag?: string; speed?: number | null }[];
  error?: boolean;
}

export interface EarthquakeObject {
  id: string;
  magnitude: number | null;
  place: string;
  time: number | null;
  depth_km: number | null;
  coordinates: [number, number] | null;
  tsunami: boolean;
  url?: string | null;
}

export interface EarthquakesData {
  source: string;
  count: number;
  updated?: number | null;
  earthquakes: EarthquakeObject[];
  error?: boolean;
}

export interface AuroraData {
  source: string;
  observed_time?: string | null;
  forecast_time?: string | null;
  max_intensity?: number | null;
  probability: number | null;
  latitude?: number;
  longitude?: number;
  error?: boolean;
}

export interface SchumannData {
  source: string;
  activity_index?: number | null;
  activity_index_label?: string | null;
  schumann_index?: number | null;
  schumann_frequency_hz?: number | null;
  kp_index?: number | null;
  kp_label?: string | null;
  solar_flare_index?: number | null;
  solar_flare_class?: string | null;
  geomagnetic_status?: string | null;
  summary?: string | null;
  data_source?: string | null;
  updated_at?: string | null;
  observation_window?: { start?: string; end?: string } | null;
  weighting?: { schumann_pct?: number; kp_pct?: number; solar_pct?: number } | null;
  attribution?: Record<string, string> | null;
  methodology_url?: string | null;
  citation?: string | null;
  error?: boolean;
}

export interface SourceStatusItem {
  key: string;
  name: string;
  description?: string;
  category?: string;
  url: string;
  needs_key?: boolean;
  key_env?: string;
  status: "online" | "offline";
  reason?: string | null;
  latency_ms?: number | null;
  checked_at?: string;
}

export interface SourcesData {
  source?: string;
  checked_at?: string;
  online?: number;
  offline?: number;
  total?: number;
  sources: SourceStatusItem[];
  error?: boolean;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

async function getJSON<T>(path: string, params?: Record<string, string | number>): Promise<T> {
  const url = new URL(`${API_BASE}${path}`);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  }
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url.toString(), { cache: "no-store" });
      if (!res.ok) {
        throw new Error(`API ${path} failed: ${res.status}`);
      }
      const data = (await res.json()) as T;
      if (data && typeof data === "object" && (data as { error?: boolean }).error === true) {
        throw new Error(`API ${path} returned fallback error`);
      }
      return data;
    } catch (err) {
      lastError = err;
      if (attempt < 2) await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  throw lastError as Error;
}

export const api = {
  overview: (lat?: number, lon?: number) =>
    getJSON<OverviewData>("/api/overview", { lat: lat ?? 50.45, lon: lon ?? 30.52 }),
  weather: (lat?: number, lon?: number) =>
    getJSON<WeatherData>("/api/weather", { lat: lat ?? 50.45, lon: lon ?? 30.52 }),
  kpi: () => getJSON<KPIItem[]>("/api/kpi"),
  events: () => getJSON<ClimateEvent[]>("/api/events"),
  gistemp: () => getJSON<GISTEMPSeries>("/api/gistemp"),
  co2: () => getJSON<CO2Series>("/api/co2"),
  seaIce: () => getJSON<SeaIceData>("/api/sea-ice"),
  seaIceSouth: () => getJSON<SeaIceData>("/api/sea-ice-south"),
  seaLevel: () => getJSON<SeaLevelData>("/api/sea-level"),
  oceanHeat: () => getJSON<OceanHeatData>("/api/ocean-heat"),
  oceanPh: () => getJSON<OceanPhData>("/api/ocean-ph"),
  aiSummary: (lang?: string) =>
    getJSON<{ summary: string; last_updated: string; confidence: number; lang?: string }>(
      "/api/ai-summary",
      lang ? { lang } : undefined
    ),
  aiAnalysis: (lang?: string) =>
    getJSON<AIAnalysis>("/api/ai-analysis", lang ? { lang } : undefined),
  predictions: (lang?: string, days?: number) =>
    getJSON<AIPrediction[]>("/api/predictions", { ...(lang ? { lang } : {}), ...(days ? { days } : {}) }),
  asteroids: (days = 7) => getJSON<AsteroidsData>("/api/asteroids", { days }),
  geomagnetic: () => getJSON<GeomagneticData>("/api/geomagnetic"),
  spaceWeather: (days = 7) => getJSON<SpaceWeatherData>("/api/space-weather", { days }),
  geocode: (q: string, count = 8) => getJSON<GeocodeData>("/api/geocode", { q, count }),
  kpForecast: () => getJSON<KpForecastData>("/api/kp-forecast"),
  solarFlares: () => getJSON<GoesXrayData>("/api/solar-flares"),
  solarCycle: () => getJSON<SolarCycleData>("/api/solar-cycle"),
  solarWind: () => getJSON<SolarWindData>("/api/solar-wind"),
  earthquakes: () => getJSON<EarthquakesData>("/api/earthquakes"),
  aurora: (lat?: number, lon?: number) =>
    getJSON<AuroraData>("/api/aurora", { lat: lat ?? 50.45, lon: lon ?? 30.52 }),
  schumann: () => getJSON<SchumannData>("/api/schumann"),
  sources: () => getJSON<SourcesData>("/api/sources"),
};
