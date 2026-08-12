"use client";

/**
 * SpaceDataPanel — объединённая панель «Космическая погода + Околоземные астероиды».
 * Десктоп: выезжает слева по вертикальному центру глобуса (слева направо).
 * Мобильные: компактная нижняя панель-триггер + bottom-sheet.
 */

import { useState, useEffect, useCallback } from "react";
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
} from "@/lib/api";
import { useI18n } from "@/lib/i18n";

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
  label: string;
  source?: string;
  lat?: number;
  lon?: number;
}

type Tab = "space" | "asteroids";

export default function SpaceDataPanel() {
  const { t } = useI18n();
  const sw = t.spaceWeather as Record<string, string>;
  const ast = t.asteroids as Record<string, string>;
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

  /** Локальная погода из /api/overview (плоская структура weather.*) */
  const loadLocalWeather = useCallback(async () => {
    try {
      const d: OverviewData = await api.overview();
      const cur = d.weather;
      if (!cur) return;
      const place = nearestName(d);
      setWeather({
        temp: cur.temperature ?? 0,
        wind: cur.wind_speed ?? 0,
        humidity: cur.humidity ?? 0,
        pressure: cur.pressure ?? 0,
        label: place,
        source: d.weather.source || "Open-Meteo",
        lat: d.location?.lat,
        lon: d.location?.lon,
      });
    } catch {
      /* без локальной погоды */
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const [geoRes, swRes, kpRes, xrayRes, scycleRes, windRes, astRes] = await Promise.allSettled([
        api.geomagnetic(),
        api.spaceWeather(7),
        api.kpForecast(),
        api.solarFlares(),
        api.solarCycle(),
        api.solarWind(),
        api.asteroids(7),
      ]);
      setGeo(geoRes.status === "fulfilled" ? geoRes.value : null);
      setSwd(swRes.status === "fulfilled" ? swRes.value : null);
      setKpFc(kpRes.status === "fulfilled" ? kpRes.value : null);
      setXray(xrayRes.status === "fulfilled" ? xrayRes.value : null);
      setScycle(scycleRes.status === "fulfilled" ? scycleRes.value : null);
      setSolarWind(windRes.status === "fulfilled" ? windRes.value : null);
      const ad = astRes.status === "fulfilled" ? astRes.value : null;
      setAstData(ad && ad.objects && ad.objects.length > 0 ? ad : null);
      await loadLocalWeather();
    } catch {
      /* игнорируем */
    } finally {
      setLoading(false);
    }
  }, [loadLocalWeather]);

  useEffect(() => {
    load();
    const id = setInterval(load, 30 * 60 * 1000);
    return () => clearInterval(id);
  }, [load]);

  const hasSpaceData =
    !!(geo && geo.current_kp != null) ||
    !!(swd && swd.events.length > 0) ||
    !!(kpFc && (kpFc.forecast || []).length > 0) ||
    !!(xray && xray.flare_class) ||
    !!(scycle && scycle.latest) ||
    !!solarWind;
  const hasData = hasSpaceData || !!astData || !!weather;

  if (loading) return null;

  const level = stormLevelOf(geo?.current_kp ?? null);
  const kpVal = geo?.current_kp ?? null;

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

  /** Общий заголовок панели (десктоп + мобильный) */
  const renderHeader = (onClose: () => void) => (
    <>
      <div className="flex items-center justify-between px-4 py-3 border-b border-violet/15 bg-violet/5">
        <div className="flex items-center space-x-2 min-w-0">
          <span className="p-1.5 rounded-lg bg-violet/12 text-cyan shrink-0">
            {tab === "space" ? <Sun className="w-4 h-4" /> : <Orbit className="w-4 h-4" />}
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold leading-tight truncate">
              {tab === "space" ? sw.title : ast.title}
            </h3>
            <div className="flex items-center space-x-1.5 text-[10px] text-secondary">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan ping-dot text-cyan shrink-0" />
              <span className="truncate">
                {tab === "space"
                  ? sw.subtitle
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

      {/* Вкладки: космическая погода / астероиды */}
      <div className="flex gap-1.5 px-4 pt-3">
        <button
          type="button"
          onClick={() => setTab("space")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
            tab === "space"
              ? "bg-emerald text-[#04211A]"
              : "bg-white/5 text-secondary hover:text-primary hover:bg-white/10"
          }`}
        >
          <Sun className="w-3 h-3" />
          {sw.title}
        </button>
        <button
          type="button"
          onClick={() => setTab("asteroids")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
            tab === "asteroids"
              ? "bg-emerald text-[#04211A]"
              : "bg-white/5 text-secondary hover:text-primary hover:bg-white/10"
          }`}
        >
          <Orbit className="w-3 h-3" />
          {ast.title}
          {astData?.objects?.length != null && (
            <span className="text-[9px] opacity-70">{astData.objects.length}</span>
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
          {/* Порожній стан, якщо даних поки немає */}
          {!hasData && (
            <div className="text-center py-6 text-secondary text-sm">{t.common.noData}</div>
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

          {/* Локальная погода */}
          {weather && (
            <div>
              <div className="flex items-center space-x-1.5 text-[10px] uppercase tracking-[0.15em] text-secondary mb-1.5">
                <Cloud className="w-3 h-3 text-[#29F2FF]" />
                <span>
                  {sw.local}
                  {weather.label ? ` · ${weather.label}` : ""}
                </span>
              </div>
              {(weather.lat != null && weather.lon != null) && (
                <div className="mb-1.5 text-[9px] text-secondary/80 font-mono">
                  {weather.lat.toFixed(2)}°, {weather.lon.toFixed(2)}°
                </div>
              )}
              {weather.source && (
                <div className="mb-1.5 text-[9px] text-secondary/80">
                  {sw.source} {weather.source}
                </div>
              )}
              <div className="grid grid-cols-2 gap-1.5">
                <div className="px-2.5 py-1.5 rounded-lg bg-white/[0.03] border border-white/5 flex items-center space-x-1.5">
                  <span className="text-[10px] text-secondary">{sw.temp}</span>
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
