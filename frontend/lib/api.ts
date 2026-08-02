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
  latest: { year: number; value: number } | null;
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

export interface ClimateEvent {
  event_type: string;
  location: string;
  time: string;
  severity: string;
  coordinates?: [number, number] | null;
}

export interface KPIItem {
  name: string;
  value: string;
  trend: string;
  trend_up: boolean;
  insight: string;
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
  kpi: () => getJSON<KPIItem[]>("/api/kpi"),
  events: () => getJSON<ClimateEvent[]>("/api/events"),
  gistemp: () => getJSON<GISTEMPSeries>("/api/gistemp"),
  co2: () => getJSON<CO2Series>("/api/co2"),
  seaIce: () => getJSON<SeaIceData>("/api/sea-ice"),
  aiSummary: () => getJSON<{ summary: string; last_updated: string; confidence: number }>("/api/ai-summary"),
};
