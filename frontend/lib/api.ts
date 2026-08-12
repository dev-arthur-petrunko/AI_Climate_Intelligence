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
    forecast?: WeatherForecast;
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

export interface GISTEMPSeries {
  source: string;
  reference: string;
  series: { year: number; value: number }[];
  latest: { year: number; month?: number; value: number } | null;
}

export interface CO2Series {
  source: string;
  unit: string;
  series: { year: number; month: number; value: number }[];
  latest: { year: number; month: number; value: number } | null;
}

export interface SeaIceData {
  source: string;
  hemisphere: string;
  latest: { date: string; extent: number } | null;
  anomaly: number | null;
  baseline_period: string;
  annual_minimum: { year: number; value: number }[];
  recent: { date: string; extent: number }[];
}

export interface SeaLevelData {
  source: string;
  unit: string;
  reference: string;
  series: { date: string; value: number }[];
  latest: { date: string; value: number } | null;
  trend: number | null;
}

export interface OceanHeatData {
  source: string;
  unit: string;
  reference: string;
  series: { year: number; value: number }[];
  latest: { year: number; value: number } | null;
}

export interface OceanPhData {
  source: string;
  unit: string;
  reference: string;
  series: { date: string; value: number }[];
  latest: { date: string; value: number } | null;
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

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

async function getJSON<T>(path: string, params?: Record<string, string | number>): Promise<T> {
  const url = new URL(`${API_BASE}${path}`);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  }
  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`API ${path} failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
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
  aiSummary: () => getJSON<{ summary: string; last_updated: string; confidence: number }>("/api/ai-summary"),
  aiAnalysis: (lang?: string) =>
    getJSON<AIAnalysis>("/api/ai-analysis", lang ? { lang } : undefined),
  predictions: (lang?: string) =>
    getJSON<AIPrediction[]>("/api/predictions", lang ? { lang } : undefined),
  asteroids: (days = 7) => getJSON<AsteroidsData>("/api/asteroids", { days }),
  geomagnetic: () => getJSON<GeomagneticData>("/api/geomagnetic"),
  spaceWeather: (days = 7) => getJSON<SpaceWeatherData>("/api/space-weather", { days }),
  geocode: (q: string, count = 8) => getJSON<GeocodeData>("/api/geocode", { q, count }),
  kpForecast: () => getJSON<KpForecastData>("/api/kp-forecast"),
  solarFlares: () => getJSON<GoesXrayData>("/api/solar-flares"),
  solarCycle: () => getJSON<SolarCycleData>("/api/solar-cycle"),
};
