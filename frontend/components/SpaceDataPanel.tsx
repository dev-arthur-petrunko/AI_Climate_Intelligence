"use client";

/**
 * SpaceDataPanel — объединённая панель «Космическая погода + Околоземные астероиды».
 * Десктоп: выезжает слева по вертикальному центру глобуса (слева направо).
 * Мобильные: компактная нижняя панель-триггер + bottom-sheet.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Orbit,
  X,
  RefreshCw,
  AlertTriangle,
  Sun,
  Magnet,
  Flame,
  Radio,
  TrendingUp,
  Cloud,
  Wind,
  Gauge,
  Droplets,
  Satellite,
  Search,
  MapPin,
  Globe,
  Activity,
  Moon,
  Sparkles,
  Crosshair,
} from "lucide-react";
import {
  api,
  AsteroidsData,
  GeomagneticData,
  SpaceWeatherData,
  KpForecastData,
  GoesXrayData,
  SolarCycleData,
  SolarWindData,
  OverviewData,
  GeocodeResult,
  EarthquakesData,
  AuroraData,
  SchumannData,
} from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { moonPhase } from "@/lib/moon";

/** Уровень геомагнитной бури по шкале NOAA G */
function stormLevelOf(kp: number | null): "none" | "minor" | "strong" | "severe" {
  if (kp == null) return "none";
  if (kp >= 8) return "severe";
  if (kp >= 6) return "strong";
  if (kp >= 5) return "minor";
  return "none";
}

/** Человекочитаемое имя локации из /api/overview (lat/lon fallback). */
function nearestName(d: OverviewData): string {
  const loc = d.location;
  if (!loc) return "Local";
  const { lat, lon } = loc;
  // Якщо це Київ (за замовчуванням) — так і підписуємо, інакше просто координати
  if (Math.abs(lat - 50.45) < 0.1 && Math.abs(lon - 30.52) < 0.1) return "Kyiv, Ukraine";
  return `≈ ${lat.toFixed(2)}°, ${lon.toFixed(2)}°`;
}

const stormColor: Record<string, string> = {
  none: "#2EE6A6",
  minor: "#FFC24D",
  strong: "#FF8A3D",
  severe: "#FF5D6C",
};

/** Колір індикатора ймовірності полярного сяйва. */
function auroraColorOf(prob: number | null): string {
  if (prob == null) return "#8B9AB5";
  if (prob < 10) return "#29F2FF";
  if (prob < 30) return "#2EE6A6";
  if (prob < 60) return "#FFC24D";
  return "#FF5D6C";
}

/** Палитра Aurora — для JS-логики индикаторов */
const C = {
  emerald: "#2EE6A6",
  cyan: "#29F2FF",
  blue: "#36A3FF",
  amber: "#FFC24D",
  orange: "#FF8A3D",
  pink: "#FF5D6C",
};

interface LocalWeather {
  temp: number;
  wind: number;
  humidity: number;
  pressure: number;
  uv: number | null;
  aqi: number | null;
  label: string;
  source?: string;
  lat?: number;
  lon?: number;
}

type Tab = "space" | "earth" | "asteroids";

export default function SpaceDataPanel() {
  const { t } = useI18n();
  const sw = t.spaceWeather as Record<string, string>;
  const ast = t.asteroids as Record<string, string>;
  const ew = t.earthWeather as Record<string, string>;
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("space");

  /** На десктопі/ноутбуці панель відкрита зразу (вікно ліворуч);
   *  при зменшенні екрана до планшета/телефона закривається. */
  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth < 1024) setOpen(false);
    };
    if (window.innerWidth >= 1024) setOpen(true);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const [loading, setLoading] = useState(true);
  const [geo, setGeo] = useState<GeomagneticData | null>(null);
  const [swd, setSwd] = useState<SpaceWeatherData | null>(null);
  const [kpFc, setKpFc] = useState<KpForecastData | null>(null);
  const [xray, setXray] = useState<GoesXrayData | null>(null);
  const [scycle, setScycle] = useState<SolarCycleData | null>(null);
  const [solarWind, setSolarWind] = useState<SolarWindData | null>(null);
  const [weather, setWeather] = useState<LocalWeather | null>(null);
  const [astData, setAstData] = useState<AsteroidsData | null>(null);
  const [earthquakes, setEarthquakes] = useState<EarthquakesData | null>(null);
  const [aurora, setAurora] = useState<AuroraData | null>(null);
  const [schumann, setSchumann] = useState<SchumannData | null>(null);
  const [geoLoading, setGeoLoading] = useState(false);

  // Local weather location selection
  const [weatherLocation, setWeatherLocation] = useState<{ lat: number; lon: number; name: string } | null>(null);
  const [weatherQuery, setWeatherQuery] = useState("");
  const [weatherResults, setWeatherResults] = useState<GeocodeResult[]>([]);
  const [weatherSearching, setWeatherSearching] = useState(false);
  const [weatherDropdownOpen, setWeatherDropdownOpen] = useState(false);
  const weatherSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const weatherBoxRef = useRef<HTMLDivElement>(null);

  /** Save selected weather location to localStorage */
  useEffect(() => {
    if (weatherLocation) {
      localStorage.setItem("ci-weather-location", JSON.stringify(weatherLocation));
    }
  }, [weatherLocation]);

  /** Локальная погода из /api/overview (плоская структура weather.*) */
  const loadLocalWeather = useCallback(async () => {
    try {
      const lat = weatherLocation?.lat ?? 50.45;
      const lon = weatherLocation?.lon ?? 30.52;
      const d: OverviewData = await api.overview(lat, lon);
      const cur = d.weather;
      if (!cur) return;
      const place = weatherLocation?.name || nearestName(d);
      setWeather({
        temp: cur.temperature ?? 0,
        wind: cur.wind_speed ?? 0,
        humidity: cur.humidity ?? 0,
        pressure: cur.pressure ?? 0,
        uv: cur.uv_index ?? null,
        aqi: d.air_quality?.us_aqi ?? null,
        label: place,
        source: d.weather.source || "Open-Meteo",
        lat: d.location?.lat,
        lon: d.location?.lon,
      });
    } catch {
      /* без локальной погоды */
    }
  }, [weatherLocation]);

  const load = useCallback(async () => {
    try {
      const wlat = weatherLocation?.lat ?? 50.45;
      const wlon = weatherLocation?.lon ?? 30.52;
      const [geoRes, swRes, kpRes, xrayRes, scycleRes, windRes, astRes, eqRes, auroraRes, schRes] =
        await Promise.allSettled([
          api.geomagnetic(),
          api.spaceWeather(7),
          api.kpForecast(),
          api.solarFlares(),
          api.solarCycle(),
          api.solarWind(),
          api.asteroids(7),
          api.earthquakes(),
          api.aurora(wlat, wlon),
          api.schumann(),
        ]);
      setGeo(geoRes.status === "fulfilled" ? geoRes.value : null);
      setSwd(swRes.status === "fulfilled" ? swRes.value : null);
      setKpFc(kpRes.status === "fulfilled" ? kpRes.value : null);
      setXray(xrayRes.status === "fulfilled" ? xrayRes.value : null);
      setScycle(scycleRes.status === "fulfilled" ? scycleRes.value : null);
      setSolarWind(windRes.status === "fulfilled" ? windRes.value : null);
      const ad = astRes.status === "fulfilled" ? astRes.value : null;
      setAstData(ad && ad.objects && ad.objects.length > 0 ? ad : null);
      const eq = eqRes.status === "fulfilled" ? eqRes.value : null;
      setEarthquakes(eq && eq.earthquakes && eq.earthquakes.length > 0 ? eq : null);
      setAurora(auroraRes.status === "fulfilled" ? auroraRes.value : null);
      setSchumann(schRes.status === "fulfilled" ? schRes.value : null);
      await loadLocalWeather();
    } catch {
      /* игнорируем */
    } finally {
      setLoading(false);
    }
  }, [loadLocalWeather, weatherLocation]);

  useEffect(() => {
    load();
    const id = setInterval(load, 30 * 60 * 1000);
    return () => clearInterval(id);
  }, [load]);

  /** Автовизначення локації (якщо ручний/збережений вибір ще не встановлений). */
  const detectLocation = useCallback(() => {
    if (weatherLocation) return;
    if (!navigator.geolocation) return;
    setGeoLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setWeatherLocation({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          name: "My location",
        });
        setGeoLoading(false);
      },
      () => setGeoLoading(false),
      { timeout: 8000, maximumAge: 600000 }
    );
  }, [weatherLocation]);

  useEffect(() => {
    const saved = localStorage.getItem("ci-weather-location");
    if (saved) {
      try {
        setWeatherLocation(JSON.parse(saved));
      } catch {
        detectLocation();
      }
    } else {
      detectLocation();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Geocode search with debounce */
  useEffect(() => {
    if (weatherSearchTimer.current) clearTimeout(weatherSearchTimer.current);
    if (weatherQuery.trim().length < 2) {
      setWeatherResults([]);
      return;
    }
    weatherSearchTimer.current = setTimeout(async () => {
      setWeatherSearching(true);
      try {
        const data = await api.geocode(weatherQuery.trim(), 8);
        setWeatherResults(data.results || []);
        setWeatherDropdownOpen(true);
      } catch {
        setWeatherResults([]);
      } finally {
        setWeatherSearching(false);
      }
    }, 350);
    return () => {
      if (weatherSearchTimer.current) clearTimeout(weatherSearchTimer.current);
    };
  }, [weatherQuery]);

  /** Close dropdown on outside click */
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (weatherBoxRef.current && !weatherBoxRef.current.contains(e.target as Node)) {
        setWeatherDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const hasSpaceData =
    !!(geo && geo.current_kp != null) ||
    !!(swd && swd.events.length > 0) ||
    !!(kpFc && (kpFc.forecast || []).length > 0) ||
    !!(xray && xray.flare_class) ||
    !!(scycle && scycle.latest) ||
    !!solarWind ||
    !!aurora ||
    !!schumann;
  const hasEarthData = !!earthquakes || !!weather;

  if (loading) return null;

  const level = stormLevelOf(geo?.current_kp ?? null);
  const kpVal = geo?.current_kp ?? null;

  const moon = moonPhase(new Date());
  const moonGlyphs = ["🌑", "🌒", "🌓", "🌔", "🌕", "🌖", "🌗", "🌘"];

  const flareEvents = (swd?.events || [])
    .filter((e) => (e.type || "").toLowerCase().includes("flr"))
    .slice(0, 3);
  const cmeEvents = (swd?.events || [])
    .filter((e) => (e.type || "").toLowerCase().includes("cme"))
    .slice(0, 3);

  const kpForecast = (kpFc?.forecast || [])
    .filter((s) => s.status !== "observed")
    .slice(0, 6);
  const flareClass = xray?.flare_class ?? null;
  const flareFlux = xray?.max_flux ?? null;
  const ssn = scycle?.latest?.ssn ?? null;
  const f107 = scycle?.latest?.f10_7 ?? null;
  const windSpeed = solarWind?.speed ?? null;
  const windDensity = solarWind?.density ?? null;
  const windBz = solarWind?.bz ?? null;
  const windBt = solarWind?.bt ?? null;

  const astList = [...(astData?.objects || [])].sort((a, b) => {
    const da = a.miss_km ?? Infinity;
    const db = b.miss_km ?? Infinity;
    return da - db;
  });

  /** Форматирование больших чисел в компактный вид (M km / k km) */
  const fmtDistance = (km: number | null): string => {
    if (km == null) return "—";
    if (km >= 1e6) return `${(km / 1e6).toFixed(1)}M km`;
    if (km >= 1e3) return `${(km / 1e3).toFixed(1)}k km`;
    return `${km.toFixed(0)} km`;
  };

  const fmtDate = (raw: string): string => {
    const m = raw.match(/(\d{4})-(\w{3})-(\d{2})/);
    if (!m) return raw;
    return `${m[3]} ${m[2]} ${m[1]}`;
  };

  const fmtTime = (raw: number | null): string => {
    if (raw == null) return "—";
    const d = new Date(raw);
    const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getUTCDate()} ${mon[d.getUTCMonth()]} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  };

  /** Общий заголовок панели (десктоп + мобильный) */
  const renderHeader = (onClose: () => void) => (
    <>
      <div className="flex items-center justify-between px-4 py-3 border-b border-violet/15 bg-violet/5">
        <div className="flex items-center space-x-2 min-w-0">
          <span className="p-1.5 rounded-lg bg-violet/12 text-cyan shrink-0">
            {tab === "space" ? <Sun className="w-4 h-4" /> : tab === "earth" ? <Globe className="w-4 h-4" /> : <Orbit className="w-4 h-4" />}
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold leading-tight truncate">
              {tab === "space" ? sw.title : tab === "earth" ? ew.title : ast.title}
            </h3>
            <div className="flex items-center space-x-1.5 text-[10px] text-secondary">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan ping-dot text-cyan shrink-0" />
              <span className="truncate">
                {tab === "space"
                  ? sw.subtitle
                  : tab === "earth"
                    ? ew.subtitle
                    : astData?.range
                      ? `${astData.range.start} — ${astData.range.end}`
                      : ast.subtitle}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center space-x-1 shrink-0">
          <button
            type="button"
            onClick={load}
            className="p-1.5 rounded-lg hover:bg-white/10 text-secondary hover:text-primary transition-colors"
            aria-label={sw.refresh}
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/10 text-secondary hover:text-primary transition-colors"
            aria-label={sw.close}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Вкладки: космическая погода / погода Земли / астероиды */}
      <div className="flex gap-1.5 px-4 pt-3">
        <button
          type="button"
          onClick={() => setTab("space")}
          className={`flex-1 min-w-0 inline-flex items-center justify-center gap-1 px-1.5 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
            tab === "space"
              ? "bg-emerald text-[#04211A]"
              : "bg-white/5 text-secondary hover:text-primary hover:bg-white/10"
          }`}
        >
          <Sun className="w-3 h-3 shrink-0" />
          <span className="truncate">{sw.title}</span>
        </button>
        <button
          type="button"
          onClick={() => setTab("earth")}
          className={`flex-1 min-w-0 inline-flex items-center justify-center gap-1 px-1.5 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
            tab === "earth"
              ? "bg-emerald text-[#04211A]"
              : "bg-white/5 text-secondary hover:text-primary hover:bg-white/10"
          }`}
        >
          <Globe className="w-3 h-3 shrink-0" />
          <span className="truncate">{ew.title}</span>
          {earthquakes?.count != null && (
            <span className="text-[9px] opacity-70 shrink-0">{earthquakes.count}</span>
          )}
        </button>
        <button
          type="button"
          onClick={() => setTab("asteroids")}
          className={`flex-1 min-w-0 inline-flex items-center justify-center gap-1 px-1.5 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
            tab === "asteroids"
              ? "bg-emerald text-[#04211A]"
              : "bg-white/5 text-secondary hover:text-primary hover:bg-white/10"
          }`}
        >
          <Orbit className="w-3 h-3 shrink-0" />
          <span className="truncate">{ast.title}</span>
          {astData?.objects?.length != null && (
            <span className="text-[9px] opacity-70 shrink-0">{astData.objects.length}</span>
          )}
        </button>
      </div>
    </>
  );

  /** Содержимое вкладок */
  const renderBody = () => (
    <>
      {tab === "space" ? (
        <div className="px-4 py-3 max-h-[44vh] overflow-y-auto custom-scroll space-y-3">
          {/* Порожній стан, якщо даних космічної погоди немає */}
          {!hasSpaceData && (
            <div className="text-center py-6 text-secondary text-sm">{sw.noData}</div>
          )}
          {/* Текущий Kp и уровень бури */}
          {kpVal != null && (
            <div
              className="rounded-xl border px-3 py-2.5"
              style={{ borderColor: `${stormColor[level]}44`, background: `${stormColor[level]}0d` }}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-1.5 text-[10px] uppercase tracking-[0.15em] text-secondary">
                  <Magnet className="w-3 h-3" style={{ color: stormColor[level] }} />
                  <span>{sw.kp}</span>
                </div>
                <span
                  className="text-[10px] font-bold uppercase tracking-wider"
                  style={{ color: stormColor[level] }}
                >
                  {sw.storms} {sw[level] || sw.none}
                </span>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <span className="text-2xl font-bold font-mono" style={{ color: stormColor[level] }}>
                  {kpVal.toFixed(1)}
                </span>
                <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.min(100, (kpVal / 9) * 100)}%`,
                      background: stormColor[level],
                    }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Солнечные вспышки */}
          {flareEvents.length > 0 && (
            <div>
              <div className="flex items-center space-x-1.5 text-[10px] uppercase tracking-[0.15em] text-secondary mb-1.5">
                <Flame className="w-3 h-3 text-[#FFB648]" />
                <span>{sw.flares}</span>
              </div>
              <ul className="space-y-1">
                {flareEvents.map((e, i) => (
                  <li
                    key={`flr-${i}`}
                    className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-white/[0.03] border border-white/5"
                  >
                    <span className="text-[10px] text-secondary truncate">{e.class_ || "—"}</span>
                    <span className="text-[9px] font-mono text-primary/70 truncate ml-2">
                      {e.start_time}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Текущий рентгеновский класс вспышки (GOES) */}
          {flareClass && (
            <div
              className="rounded-xl border px-3 py-2.5"
              style={{ borderColor: "#FF8A3D44", background: "#FF8A3D0d" }}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-1.5 text-[10px] uppercase tracking-[0.15em] text-secondary">
                  <Flame className="w-3 h-3 text-[#FF8A3D]" />
                  <span>{sw.flareClass}</span>
                </div>
                <span className="text-sm font-bold font-mono text-[#FF8A3D]">{flareClass}</span>
              </div>
              {flareFlux != null && (
                <div className="mt-1 text-[9px] text-secondary">max {flareFlux.toExponential(1)} W/m²</div>
              )}
            </div>
          )}

          {/* Прогноз Kp на 3 дня (NOAA SWPC) */}
          {kpForecast.length > 0 && (
            <div>
              <div className="flex items-center space-x-1.5 text-[10px] uppercase tracking-[0.15em] text-secondary mb-1.5">
                <TrendingUp className="w-3 h-3 text-[#29F2FF]" />
                <span>{sw.kpForecast}</span>
              </div>
              <div className="flex items-end gap-1.5">
                {kpForecast.map((p, i) => {
                  const c = p.kp >= 5 ? C.pink : p.kp >= 4 ? C.amber : C.emerald;
                  return (
                    <div key={`kp-${i}`} className="flex-1 flex flex-col items-center gap-1">
                      <span className="text-[9px] font-mono" style={{ color: c }}>
                        {p.kp.toFixed(0)}
                      </span>
                      <div
                        className="w-full rounded-sm"
                        style={{
                          height: `${Math.max(4, Math.min(100, (p.kp / 9) * 100) * 0.7)}px`,
                          background: c,
                        }}
                        title={p.time_tag}
                      />
                      <span className="text-[8px] text-secondary">
                        {(p.time_tag || "").slice(5, 16)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Солнечный цикл: SSN + F10.7 */}
          {(ssn != null || f107 != null) && (
            <div className="grid grid-cols-2 gap-1.5">
              {ssn != null && (
                <div className="px-2.5 py-1.5 rounded-lg bg-white/[0.03] border border-white/5">
                  <div className="text-[9px] text-secondary uppercase tracking-wider">{sw.sunspot}</div>
                  <div className="text-sm font-semibold text-primary">{Math.round(ssn)}</div>
                </div>
              )}
              {f107 != null && (
                <div className="px-2.5 py-1.5 rounded-lg bg-white/[0.03] border border-white/5">
                  <div className="text-[9px] text-secondary uppercase tracking-wider">{sw.f107}</div>
                  <div className="text-sm font-semibold text-primary">{Math.round(f107)}</div>
                </div>
              )}
            </div>
          )}

          {/* Корональные выбросы */}
          {cmeEvents.length > 0 ? (
            <div>
              <div className="flex items-center space-x-1.5 text-[10px] uppercase tracking-[0.15em] text-secondary mb-1.5">
                <Radio className="w-3 h-3 text-[#36A3FF]" />
                <span>{sw.cmes}</span>
              </div>
              <ul className="space-y-1">
                {cmeEvents.map((e, i) => {
                  const cmeType = e.class_ || "CME";
                  const speed = e.speed != null ? `${Math.round(e.speed)} km/s` : null;
                  const earth =
                    e.isEarthGB === true ? (sw.earthDirected || "→ Earth") : null;
                  const loc = e.source_location || e.linked_activity || null;
                  return (
                    <li
                      key={`cme-${i}`}
                      className="px-2.5 py-1.5 rounded-lg bg-white/[0.03] border border-white/5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] text-primary/80 font-medium truncate">
                          {cmeType}
                          {loc ? ` · ${loc}` : ""}
                        </span>
                        <span className="text-[9px] font-mono text-primary/70 truncate ml-2 shrink-0">
                          {e.start_time || ""}
                        </span>
                      </div>
                      {(speed || earth) && (
                        <div className="mt-1 flex items-center gap-2 text-[9px]">
                          {speed && <span className="text-cyan">{speed}</span>}
                          {earth && (
                            <span className="px-1.5 py-px rounded bg-[#FF5D6C]/15 border border-[#FF5D6C]/30 text-[#FF5D6C] font-bold uppercase tracking-wider">
                              {earth}
                            </span>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : (
            <div className="text-center py-3 text-secondary/60 text-[11px]">
              {sw.cmes}: {sw.noData}
            </div>
          )}

          {/* Сонячний вітер: швидкість, густина, Bz, Bt */}
          {(windSpeed != null || windDensity != null || windBz != null || (solarWind?.bt != null)) && (
            <div>
              <div className="flex items-center space-x-1.5 text-[10px] uppercase tracking-[0.15em] text-secondary mb-1.5">
                <Wind className="w-3 h-3 text-[#29F2FF]" />
                <span>{sw.solarWind}</span>
                {windSpeed != null && (
                  <span className="ml-auto text-[9px] font-mono text-cyan">
                    {(solarWind?.time_tag || "").slice(5, 16)}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {windSpeed != null && (
                  <div className="px-2 py-1.5 rounded-lg bg-white/[0.03] border border-white/5">
                    <div className="text-[9px] text-secondary uppercase tracking-wider">{sw.windSpeed}</div>
                    <div className="text-xs font-semibold text-primary">{Math.round(windSpeed)} km/s</div>
                  </div>
                )}
                {windDensity != null && (
                  <div className="px-2 py-1.5 rounded-lg bg-white/[0.03] border border-white/5">
                    <div className="text-[9px] text-secondary uppercase tracking-wider">{sw.density}</div>
                    <div className="text-xs font-semibold text-primary">
                      {windDensity.toFixed(1)} p/cm³
                    </div>
                  </div>
                )}
                {windBz != null && (
                  <div className="px-2 py-1.5 rounded-lg bg-white/[0.03] border border-white/5">
                    <div className="text-[9px] text-secondary uppercase tracking-wider">{sw.bzLabel}</div>
                    <div className="text-xs font-semibold" style={{ color: windBz < 0 ? "#29F2FF" : "#FFC24D" }}>
                      {windBz > 0 ? "+" : ""}
                      {windBz.toFixed(1)} nT
                    </div>
                  </div>
                )}
                {solarWind?.bt != null && (
                  <div className="px-2 py-1.5 rounded-lg bg-white/[0.03] border border-white/5">
                    <div className="text-[9px] text-secondary uppercase tracking-wider">{sw.btLabel}</div>
                    <div className="text-xs font-semibold text-primary">{solarWind.bt.toFixed(1)} nT</div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Рентгеновский поток (GOES) — история 6 часов */}
          {xray?.series && xray.series.length > 0 && (
            <div>
              <div className="flex items-center space-x-1.5 text-[10px] uppercase tracking-[0.15em] text-secondary mb-1.5">
                <Radio className="w-3 h-3 text-[#FF8A3D]" />
                <span>{sw.xrayFlux}</span>
                {xray.current && (
                  <span className="ml-auto text-[9px] font-mono text-[#FF8A3D]">
                    {xray.current.flux.toExponential(1)} W/m²
                  </span>
                )}
              </div>
              <div className="h-20 bg-white/[0.02] border border-white/5 rounded-lg overflow-hidden">
                <svg width="100%" height="100%" viewBox="0 0 300 80" preserveAspectRatio="none">
                  <defs>
                    <linearGradient id="xrayGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#FF8A3D" stopOpacity="0.3" />
                      <stop offset="100%" stopColor="#FF8A3D" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  {(() => {
                    const data = xray.series!.slice(-180);
                    if (data.length < 2) return null;
                    const maxFlux = Math.max(...data.map(d => d.flux || 0), 1e-8);
                    const minFlux = Math.min(...data.map(d => d.flux || 0), 1e-8);
                    const logMax = Math.log10(maxFlux);
                    const logMin = Math.log10(minFlux);
                    const points = data.map((d, i) => {
                      const x = (i / (data.length - 1)) * 300;
                      const logVal = Math.log10(Math.max(d.flux || 1e-8, 1e-8));
                      const y = 80 - ((logVal - logMin) / (logMax - logMin || 1)) * 70;
                      return `${x},${y}`;
                    }).join(" ");
                    return (
                      <>
                        <polygon points={`${points} 300,80 0,80`} fill="url(#xrayGrad)" />
                        <polyline points={points} fill="none" stroke="#FF8A3D" strokeWidth="1.5" />
                      </>
                    );
                  })()}
                </svg>
              </div>
              <div className="flex justify-between text-[8px] text-secondary/60 mt-1">
                <span>6h ago</span>
                <span>Now</span>
              </div>
            </div>
          )}

          {/* Полярное сияние (NOAA SWPC OVATION) */}
          {aurora && (
            <div
              className="rounded-xl border px-3 py-2.5"
              style={{
                borderColor: `${auroraColorOf(aurora.probability)}44`,
                background: `${auroraColorOf(aurora.probability)}0d`,
              }}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-1.5 text-[10px] uppercase tracking-[0.15em] text-secondary">
                  <Sparkles className="w-3 h-3" style={{ color: auroraColorOf(aurora.probability) }} />
                  <span>{sw.aurora}</span>
                </div>
                <span className="text-[9px] text-secondary/70">{sw.sourceNASA}</span>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <span
                  className="text-2xl font-bold font-mono"
                  style={{ color: auroraColorOf(aurora.probability) }}
                >
                  {aurora.probability != null ? `${Math.round(aurora.probability)}%` : "—"}
                </span>
                <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${aurora.probability != null ? Math.min(100, aurora.probability) : 0}%`,
                      background: auroraColorOf(aurora.probability),
                    }}
                  />
                </div>
              </div>
              {aurora.forecast_time && (
                <div className="mt-1 text-[9px] text-secondary/70">
                  {aurora.forecast_time}
                </div>
              )}
            </div>
          )}

          {/* Фаза Луны (локальный расчёт) */}
          <div>
            <div className="flex items-center space-x-1.5 text-[10px] uppercase tracking-[0.15em] text-secondary mb-1.5">
              <Moon className="w-3 h-3 text-[#C9A7FF]" />
              <span>{sw.moonPhase}</span>
              <span className="ml-auto text-[9px] text-secondary/70">{sw.sourceLocal}</span>
            </div>
            <div className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2.5">
              <span className="text-3xl leading-none">{moonGlyphs[moon.phaseIndex]}</span>
              <div>
                <div className="text-sm font-semibold text-primary">
                  {Math.round(moon.illumination * 100)}%
                </div>
                <div className="text-[9px] text-secondary">
                  {sw.moonAge} · {Math.round(moon.ageDays)} d
                </div>
              </div>
              <div className="ml-auto flex items-center gap-0.5">
                {moonGlyphs.map((g, i) => (
                  <span
                    key={i}
                    className={i === moon.phaseIndex ? "text-sm" : "text-[10px] opacity-25"}
                  >
                    {g}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Шуманівський резонанс — ResonanceOne (Томськ TSU) */}
          {schumann && !schumann.error ? (
            <div className="rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-1.5 text-[10px] uppercase tracking-[0.15em] text-secondary">
                  <Radio className="w-3 h-3 text-[#36A3FF]" />
                  <span>{sw.schumann}</span>
                </div>
                <span className="text-[9px] text-secondary/70">
                  {schumann.updated_at ? fmtTime(new Date(schumann.updated_at).getTime()) : ""}
                </span>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-1.5">
                <div className="px-2 py-1.5 rounded-lg bg-white/[0.03] border border-white/5 text-center">
                  <div className="text-[8px] text-secondary uppercase tracking-wider">{sw.schumannFreq}</div>
                  <div className="text-sm font-bold font-mono text-[#36A3FF]">
                    {schumann.schumann_frequency_hz != null
                      ? `${schumann.schumann_frequency_hz.toFixed(2)} Hz`
                      : "—"}
                  </div>
                </div>
                <div className="px-2 py-1.5 rounded-lg bg-white/[0.03] border border-white/5 text-center">
                  <div className="text-[8px] text-secondary uppercase tracking-wider">{sw.schumannIndex}</div>
                  <div className="text-sm font-bold font-mono text-primary">
                    {schumann.schumann_index != null ? schumann.schumann_index : "—"}
                  </div>
                </div>
                <div className="px-2 py-1.5 rounded-lg bg-white/[0.03] border border-white/5 text-center">
                  <div className="text-[8px] text-secondary uppercase tracking-wider">{sw.activityIndex}</div>
                  <div className="text-sm font-bold font-mono" style={{ color: auroraColorOf(schumann.activity_index ?? null) }}>
                    {schumann.activity_index != null ? schumann.activity_index : "—"}
                  </div>
                </div>
              </div>
              <div className="mt-1.5 text-[9px] text-secondary/70">{sw.sourceResonance}</div>
            </div>
          ) : (
            <div className="rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-1.5 text-[10px] uppercase tracking-[0.15em] text-secondary">
                  <Radio className="w-3 h-3 text-[#36A3FF]" />
                  <span>{sw.schumann}</span>
                </div>
                <span className="px-1.5 py-px rounded bg-white/10 text-[8px] font-bold uppercase tracking-wider text-secondary">
                  {sw.notAvailable}
                </span>
              </div>
            </div>
          )}
        </div>
      ) : tab === "earth" ? (
        <div className="px-4 py-3 max-h-[44vh] overflow-y-auto custom-scroll space-y-3">
          {!hasEarthData && (
            <div className="text-center py-6 text-secondary text-sm">{ew.noData}</div>
          )}

          {/* Землетрясения (USGS) */}
          {earthquakes && earthquakes.earthquakes.length > 0 && (
            <div>
              <div className="flex items-center space-x-1.5 text-[10px] uppercase tracking-[0.15em] text-secondary mb-1.5">
                <Activity className="w-3 h-3 text-[#FF5D6C]" />
                <span>{ew.earthquakes}</span>
                <span className="ml-auto text-[9px] text-secondary/70">{sw.sourceUSGS}</span>
              </div>
              <ul className="space-y-1.5">
                {earthquakes.earthquakes.map((q, i) => (
                  <li
                    key={q.id || `eq-${i}`}
                    className="px-2.5 py-1.5 rounded-lg bg-white/[0.03] border border-white/5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-bold font-mono text-[#FF5D6C]">
                        M{q.magnitude != null ? q.magnitude.toFixed(1) : "—"}
                      </span>
                      <span className="text-[9px] font-mono text-primary/60">{fmtTime(q.time)}</span>
                    </div>
                    <div className="mt-0.5 text-[10px] text-primary/85 truncate">{q.place}</div>
                    <div className="text-[9px] text-secondary">
                      {ew.depth}: {q.depth_km != null ? `${q.depth_km} km` : "—"}
                      {q.tsunami ? " · ⚠" : ""}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Локальная погода */}
          {weather && (
            <div>
              <div className="flex items-center space-x-1.5 text-[10px] uppercase tracking-[0.15em] text-secondary mb-1.5">
                <Cloud className="w-3 h-3 text-[#29F2FF]" />
                <span>
                  {ew.localWeather}
                  {weather.label ? ` · ${weather.label}` : ""}
                </span>
              </div>

              {/* Пошук міста для локальної погоди + визначення локації */}
              <div ref={weatherBoxRef} className="relative mb-2">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-secondary" />
                  <input
                    type="text"
                    value={weatherQuery}
                    onChange={(e) => setWeatherQuery(e.target.value)}
                    onFocus={() => weatherResults.length > 0 && setWeatherDropdownOpen(true)}
                    placeholder={ew.placeholder || "Пошук міста..."}
                    className="w-full pl-8 pr-9 py-1.5 rounded-lg bg-white/[0.03] border border-white/5 text-xs text-primary placeholder:text-secondary/60 focus:border-cyan/40 focus:outline-none focus:ring-1 focus:ring-cyan/30 transition-colors"
                  />
                  {weatherSearching ? (
                    <div className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 border-2 border-cyan/40 border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <button
                      type="button"
                      onClick={detectLocation}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-secondary hover:text-primary transition-colors"
                      aria-label={ew.locate || "Locate"}
                      title={ew.locate || "Locate"}
                    >
                      <Crosshair className={`w-3.5 h-3.5 ${geoLoading ? "animate-spin text-cyan" : ""}`} />
                    </button>
                  )}
                </div>

                {weatherDropdownOpen && weatherResults.length > 0 && (
                  <div className="absolute left-0 right-0 top-full mt-1 z-10 glass-strong rounded-lg border border-violet/10 overflow-hidden max-h-48 overflow-y-auto custom-scroll shadow-[0_16px_48px_rgba(0,0,0,0.55)]">
                    {weatherResults.map((r) => (
                      <button
                        key={`${r.name}-${r.latitude}-${r.longitude}`}
                        type="button"
                        onClick={() => {
                          setWeatherLocation({
                            lat: r.latitude,
                            lon: r.longitude,
                            name: `${r.name}${r.admin1 ? `, ${r.admin1}` : ""}${r.country ? `, ${r.country}` : ""}`,
                          });
                          setWeatherQuery(`${r.name}${r.admin1 ? `, ${r.admin1}` : ""}${r.country ? `, ${r.country}` : ""}`);
                          setWeatherDropdownOpen(false);
                        }}
                        className="w-full flex items-center justify-between px-2.5 py-2 text-left hover:bg-white/5 transition-colors"
                      >
                        <span className="flex items-center space-x-1.5 text-xs text-primary">
                          <MapPin className="w-3 h-3 text-cyan/70" />
                          <span>{r.name}</span>
                        </span>
                        <span className="text-[9px] text-secondary truncate ml-2">
                          {[r.admin1, r.country].filter(Boolean).join(", ")}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {(weather.lat != null && weather.lon != null) && (
                <div className="mb-1.5 text-[9px] text-secondary/80 font-mono">
                  {weather.lat.toFixed(2)}°, {weather.lon.toFixed(2)}°
                </div>
              )}
              {weather.source && (
                <div className="mb-1.5 text-[9px] text-secondary/80">
                  {ew.source} {weather.source} · Open-Meteo
                </div>
              )}
              <div className="grid grid-cols-2 gap-1.5">
                <div className="px-2.5 py-1.5 rounded-lg bg-white/[0.03] border border-white/5 flex items-center space-x-1.5">
                  <span className="text-[10px] text-secondary">{ew.temperature}</span>
                  <span className="text-xs font-semibold text-primary">{Math.round(weather.temp)}°</span>
                </div>
                <div className="px-2.5 py-1.5 rounded-lg bg-white/[0.03] border border-white/5 flex items-center space-x-1.5">
                  <Wind className="w-3 h-3 text-[#29F2FF]" />
                  <span className="text-xs font-semibold text-primary">{Math.round(weather.wind)} km/h</span>
                </div>
                <div className="px-2.5 py-1.5 rounded-lg bg-white/[0.03] border border-white/5 flex items-center space-x-1.5">
                  <Droplets className="w-3 h-3 text-[#36A3FF]" />
                  <span className="text-xs font-semibold text-primary">{Math.round(weather.humidity)}%</span>
                </div>
                <div className="px-2.5 py-1.5 rounded-lg bg-white/[0.03] border border-white/5 flex items-center space-x-1.5">
                  <Gauge className="w-3 h-3 text-[#FFC24D]" />
                  <span className="text-xs font-semibold text-primary">{Math.round(weather.pressure)} hPa</span>
                </div>
                <div className="px-2.5 py-1.5 rounded-lg bg-white/[0.03] border border-white/5 flex items-center space-x-1.5">
                  <Sun className="w-3 h-3 text-[#FFC24D]" />
                  <span className="text-xs font-semibold text-primary">
                    {weather.uv != null ? Math.round(weather.uv) : "—"}
                  </span>
                </div>
                <div className="px-2.5 py-1.5 rounded-lg bg-white/[0.03] border border-white/5 flex items-center space-x-1.5">
                  <span className="text-[10px] text-secondary">{ew.aqi || "AQI"}</span>
                  <span className="text-xs font-semibold text-primary">
                    {weather.aqi != null ? Math.round(weather.aqi) : "—"}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="px-4 py-3 max-h-[44vh] overflow-y-auto custom-scroll">
          <div className="flex items-center justify-between mb-2 text-[10px] text-secondary uppercase tracking-[0.15em]">
            <span>{ast.subtitle}</span>
            <span className="text-primary/80 font-semibold">{astList.length}</span>
          </div>
          {astList.length === 0 ? (
            <div className="text-center py-6 text-secondary text-sm">{ast.noData}</div>
          ) : (
            <ul className="space-y-1.5">
              {astList.map((obj, i) => {
                const avgDiam = obj.diameter_m_max ? Math.round(obj.diameter_m_max) : null;
                return (
                  <li
                    key={`${obj.name}-${i}`}
                    className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-white/[0.03] border border-white/5 hover:border-violet/25 transition-colors"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center space-x-1.5 min-w-0">
                        <span className="text-xs font-medium text-primary truncate">{obj.name}</span>
                        {obj.hazardous && (
                          <span className="inline-flex items-center shrink-0 px-1 py-px rounded bg-[#FF5D6C]/15 border border-[#FF5D6C]/30 text-[8px] font-bold uppercase tracking-wider text-[#FF5D6C]">
                            <AlertTriangle className="w-2 h-2 mr-0.5" />
                            {ast.hazardous}
                          </span>
                        )}
                      </div>
                      <div className="text-[9px] text-secondary truncate">
                        {ast.diameter}: {avgDiam ? `${avgDiam} m` : "—"} · {fmtDate(obj.approach_date)}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[11px] font-semibold text-cyan">
                        {fmtDistance(obj.miss_km)}
                      </div>
                      <div className="text-[9px] text-secondary">
                        {obj.velocity_kms != null ? `${obj.velocity_kms.toFixed(1)} km/s` : "—"}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </>
  );

  return (
    <>
      {/* Десктоп: панель выезжает слева, по вертикальному центру глобуса */}
      <div className="hidden md:block absolute inset-y-0 left-0 z-30 pointer-events-none">
        {/* Триггер-вкладка на левом краю (скрыта, когда панель открыта) */}
        {!open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            data-space-trigger
            className="pointer-events-auto absolute left-3 top-1/2 -translate-y-1/2 z-10 flex flex-col items-center gap-1.5 px-2 py-3 glass-strong rounded-xl text-cyan hover:bg-violet/10 transition-colors"
            aria-label={sw.toggle}
          >
            <Satellite className="w-4 h-4" />
            {kpVal != null && (
              <span
                className="text-[8px] px-1 py-0.5 rounded-full font-bold"
                style={{ background: `${stormColor[level]}22`, color: stormColor[level] }}
              >
                Kp {kpVal.toFixed(0)}
              </span>
            )}
            {astData?.objects?.length != null && (
              <span className="text-[8px] px-1 py-0.5 rounded-full bg-cyan/15 text-cyan font-bold">
                {astData.objects.length}
              </span>
            )}
            <span className="w-1.5 h-1.5 rounded-full bg-cyan ping-dot text-cyan" />
          </button>
        )}

        {/* Сама панель */}
        <div
          data-space-panel
          className={`pointer-events-auto absolute left-3 top-1/2 -translate-y-1/2 w-[260px] lg:w-[300px] xl:w-[320px] max-w-[calc(100vw-40px)] glass-strong rounded-2xl overflow-hidden flex flex-col shadow-[0_16px_56px_rgba(0,0,0,0.55)] transition-all duration-500 ${
            open
              ? "translate-x-0 opacity-100"
              : "-translate-x-[calc(100%+20px)] opacity-0 pointer-events-none"
          }`}
          style={{ maxHeight: "min(72vh, 640px)" }}
        >
          {renderHeader(() => setOpen(false))}
          {renderBody()}
        </div>
      </div>

      {/* Мобильные: компактная кнопка внизу слева + bottom-sheet */}
      <div className="md:hidden fixed bottom-3 left-3 z-40 pointer-events-none">
        {!open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            data-space-trigger-mobile
            className="pointer-events-auto absolute bottom-0 left-0 glass-strong rounded-xl px-3.5 py-2.5 flex items-center gap-2 text-cyan text-xs font-medium hover:bg-violet/10 transition-colors"
            aria-label={sw.open}
          >
            <Sun className="w-4 h-4" />
            <span className="hidden sm:inline">{sw.title}</span>
            <span className="w-px h-4 bg-white/10 hidden sm:block" />
            <Orbit className="w-4 h-4" />
            {astData?.objects?.length != null && (
              <span className="text-[9px] px-1 py-0.5 rounded-full bg-cyan/15 text-cyan font-bold">
                {astData.objects.length}
              </span>
            )}
          </button>
        )}
        <div
          data-space-panel-mobile
          className={`pointer-events-auto absolute bottom-0 left-0 glass-strong rounded-2xl overflow-hidden flex flex-col shadow-[0_16px_56px_rgba(0,0,0,0.55)] transition-all duration-500 ${
            open
              ? "translate-y-0 opacity-100"
              : "translate-y-[calc(100%+20px)] opacity-0 pointer-events-none"
          }`}
          style={{ maxHeight: "min(62vh, 560px)" }}
        >
          {renderHeader(() => setOpen(false))}
          {renderBody()}
        </div>
      </div>
    </>
  );
}
