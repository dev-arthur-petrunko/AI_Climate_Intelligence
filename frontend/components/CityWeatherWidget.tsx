"use client";

/**
 * CityWeatherWidget — вибір міста/країни та перегляд погоди для нього.
 * Пошук через Open-Meteo Geocoding (/api/geocode), погода — /api/weather.
 * Використовує скляні стилі (glassmorphism) для узгодженості з дашбордом.
 */

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Search,
  MapPin,
  Thermometer,
  Wind,
  Gauge,
  Cloud,
  Sun,
  CloudRain,
  CloudSnow,
  CloudLightning,
  ChevronDown,
} from "lucide-react";
import { api, GeocodeResult, WeatherData } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

/** Короткий опис коду погоди WMO (спрощений) */
function weatherLabel(code: number | null | undefined): string {
  if (code == null) return "—";
  if (code === 0) return "Clear";
  if (code <= 1) return "Mainly clear";
  if (code <= 2) return "Partly cloudy";
  if (code <= 3) return "Overcast";
  if (code >= 95) return "Thunderstorm";
  if (code >= 80) return "Rain showers";
  if (code >= 71) return "Snow";
  if (code >= 61) return "Rain";
  if (code >= 51) return "Drizzle";
  if (code >= 45) return "Fog";
  return "—";
}

/** Іконка за кодом погоди WMO */
function WeatherIcon({ code, className }: { code: number | null | undefined; className?: string }) {
  if (code == null) return <Sun className={className} />;
  if (code === 0 || code <= 2) return <Sun className={className} />;
  if (code <= 3) return <Cloud className={className} />;
  if (code >= 95) return <CloudLightning className={className} />;
  if (code >= 71) return <CloudSnow className={className} />;
  if (code >= 51) return <CloudRain className={className} />;
  return <Cloud className={className} />;
}

export default function CityWeatherWidget() {
  const { t } = useI18n();
  const widget = t.weatherWidget as Record<string, string>;
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [selected, setSelected] = useState<GeocodeResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  /** Пошук міст/країн з дебаунсом */
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const data = await api.geocode(query.trim(), 8);
        setResults(data.results || []);
        setDropdownOpen(true);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [query]);

  /** Закриття дропдауну при кліку поза межами */
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  /** Вибір міста + завантаження погоди */
  const choose = useCallback(async (place: GeocodeResult) => {
    setSelected(place);
    setDropdownOpen(false);
    setQuery(`${place.name}${place.country ? `, ${place.country}` : ""}`);
    setLoading(true);
    setError(false);
    setWeather(null);
    try {
      const data = await api.weather(place.latitude, place.longitude);
      setWeather(data);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  const current = weather?.current;
  const daily = weather?.daily;
  const forecastDays = (daily?.time || []).slice(0, 5);

  return (
    <div ref={boxRef} className="glass-strong rounded-2xl p-6 animate-fade-up">
      <div className="flex items-center space-x-2 mb-4">
        <span className="p-2 rounded-lg bg-violet/12 text-cyan">
          <MapPin className="w-4 h-4" />
        </span>
        <h2 className="text-xl font-semibold">{widget.title}</h2>
      </div>

      {/* Пошук міста/країни */}
      <div className="relative">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-secondary" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => results.length > 0 && setDropdownOpen(true)}
            placeholder={widget.placeholder}
            className="w-full pl-9 pr-8 py-2.5 rounded-xl bg-surface-2 border border-violet/10 text-sm text-primary placeholder:text-secondary/60 focus:border-cyan/40 focus:outline-none focus:ring-1 focus:ring-cyan/30 transition-colors"
          />
          {searching && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 border-2 border-cyan/40 border-t-transparent rounded-full animate-spin" />
          )}
        </div>

        {/* Дропдаун результатів */}
        {dropdownOpen && results.length > 0 && (
          <div className="absolute left-0 right-0 top-full mt-1.5 z-20 glass-strong rounded-xl border border-violet/10 overflow-hidden max-h-64 overflow-y-auto custom-scroll shadow-[0_16px_48px_rgba(0,0,0,0.55)]">
            {results.map((r) => (
              <button
                key={`${r.name}-${r.latitude}-${r.longitude}`}
                type="button"
                onClick={() => choose(r)}
                className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-white/5 transition-colors"
              >
                <span className="flex items-center space-x-2 text-sm text-primary">
                  <MapPin className="w-3.5 h-3.5 text-cyan/70" />
                  <span>{r.name}</span>
                </span>
                <span className="text-[11px] text-secondary truncate ml-3">
                  {[r.admin1, r.country].filter(Boolean).join(", ")}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Завантаження / помилка */}
      {loading && (
        <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 bg-surface-2 rounded-xl skeleton" />
          ))}
        </div>
      )}

      {error && !weather && (
        <div className="mt-5 text-center text-secondary text-sm py-6">{t.common.noData}</div>
      )}

      {/* Поточна погода */}
      {weather && current && (
        <div className="mt-5">
          <div className="flex items-center justify-between p-4 rounded-xl bg-gradient-to-r from-cyan/10 to-violet/10 border border-violet/10">
            <div className="flex items-center space-x-3">
              <div className="p-3 rounded-xl bg-violet/12 text-cyan">
                <WeatherIcon code={current.weather_code} className="w-7 h-7" />
              </div>
              <div>
                <div className="text-3xl font-bold text-primary">
                  {current.temperature_2m != null ? `${Math.round(current.temperature_2m)}°C` : "—"}
                </div>
                <div className="text-xs text-secondary">
                  {weatherLabel(current.weather_code)}
                  {current.apparent_temperature != null &&
                    ` · ${widget.feels} ${Math.round(current.apparent_temperature)}°C`}
                </div>
              </div>
            </div>
            {selected && (
              <div className="text-right">
                <div className="text-sm font-medium text-primary">{selected.name}</div>
                <div className="text-[11px] text-secondary">{selected.country}</div>
                <div className="text-[10px] text-secondary/60 mt-0.5">
                  {selected.latitude.toFixed(2)}°, {selected.longitude.toFixed(2)}°
                </div>
              </div>
            )}
          </div>

          {/* Деталі */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-3">
            <div className="px-3 py-2.5 rounded-xl bg-white/[0.03] border border-white/5 flex items-center space-x-2">
              <Thermometer className="w-4 h-4 text-[#FFB648]" />
              <span className="text-xs text-secondary">{widget.humidity}</span>
              <span className="ml-auto text-xs font-semibold text-primary">
                {current.relative_humidity_2m != null ? `${Math.round(current.relative_humidity_2m)}%` : "—"}
              </span>
            </div>
            <div className="px-3 py-2.5 rounded-xl bg-white/[0.03] border border-white/5 flex items-center space-x-2">
              <Wind className="w-4 h-4 text-[#29F2FF]" />
              <span className="text-xs text-secondary">{widget.wind}</span>
              <span className="ml-auto text-xs font-semibold text-primary">
                {current.wind_speed_10m != null ? `${Math.round(current.wind_speed_10m)} km/h` : "—"}
              </span>
            </div>
            <div className="px-3 py-2.5 rounded-xl bg-white/[0.03] border border-white/5 flex items-center space-x-2">
              <Gauge className="w-4 h-4 text-[#FFC24D]" />
              <span className="text-xs text-secondary">{widget.pressure}</span>
              <span className="ml-auto text-xs font-semibold text-primary">
                {current.pressure_msl != null ? `${Math.round(current.pressure_msl)} hPa` : "—"}
              </span>
            </div>
            <div className="px-3 py-2.5 rounded-xl bg-white/[0.03] border border-white/5 flex items-center space-x-2">
              <Cloud className="w-4 h-4 text-[#36A3FF]" />
              <span className="text-xs text-secondary">{widget.clouds}</span>
              <span className="ml-auto text-xs font-semibold text-primary">
                {current.cloud_cover != null ? `${Math.round(current.cloud_cover)}%` : "—"}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Прогноз на 5 днів */}
      {weather && daily && forecastDays.length > 0 && (
        <div className="mt-4">
          <div className="flex items-center space-x-1.5 text-[10px] uppercase tracking-[0.15em] text-secondary mb-2">
            <ChevronDown className="w-3 h-3 text-cyan" />
            <span>{widget.forecast}</span>
          </div>
          <div className="grid grid-cols-5 gap-2">
            {forecastDays.map((day, i) => {
              const max = daily.temperature_2m_max?.[i];
              const min = daily.temperature_2m_min?.[i];
              const code = daily.weather_code?.[i];
              const date = new Date(day + "T00:00:00");
              return (
                <div
                  key={day}
                  className="flex flex-col items-center py-2.5 rounded-xl bg-white/[0.03] border border-white/5 hover:bg-white/[0.06] transition-colors"
                >
                  <span className="text-[10px] text-secondary mb-1.5">
                    {i === 0 ? widget.today : date.toLocaleDateString(undefined, { weekday: "short" })}
                  </span>
                  <WeatherIcon code={code} className="w-4 h-4 mb-1 text-cyan/80" />
                  <span className="text-xs font-semibold text-primary">
                    {max != null ? `${Math.round(max)}°` : "—"}
                    {min != null && <span className="text-secondary/70 font-normal"> / {Math.round(min)}°</span>}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
