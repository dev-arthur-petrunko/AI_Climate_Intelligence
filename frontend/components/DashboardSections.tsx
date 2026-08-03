"use client";

/**
 * Секції дашборда — об'єднання трьох виджетів головної сторінки:
 * KPI-картки, AI-резюме та стрічка живих подій.
 * Кожен виджет завантажує дані з API та оновлюється за власним інтервалом.
 */

import { useState, useEffect, useCallback } from "react";
import {
  Thermometer,
  Cloud,
  Snowflake,
  Flame,
  Wind,
  Gauge,
  Activity,
  Sparkles,
  CloudLightning,
  Mountain,
  CloudRain,
  Waves,
  Magnet,
} from "lucide-react";
import { api, KPIItem, ClimateEvent } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

// ---------------------------------------------------------------------------
// KPI-картки
// ---------------------------------------------------------------------------

/** Маппінг назв показників на іконки */
const iconMap: Record<string, any> = {
  "Global Temperature": Thermometer,
  "Global Temperature Anomaly": Thermometer,
  "Local Temperature": Thermometer,
  "Atmospheric CO₂": Cloud,
  "Arctic Sea Ice Extent": Snowflake,
  "Antarctic Sea Ice Extent": Snowflake,
  "Active Fire Hotspots": Flame,
  "Active Cyclones": Wind,
  "Geomagnetic Storm": Magnet,
  "Global Sea Level": Waves,
  "Ocean Heat Content": Activity,
  "Ocean pH": Gauge,
};

/** Визначення кольору за назвою показника та напрямком тренду */
function colorFor(name: string, trendUp: boolean) {
  if (name.includes("Fire")) return "text-pink";
  if (name.includes("Cyclone")) return "text-amber";
  if (name.includes("Sea Ice")) return "text-emerald";
  if (name.includes("CO₂")) return "text-amber";
  if (name.includes("Temperature")) return "text-amber";
  if (name.includes("Sea Level")) return "text-violet";
  if (name.includes("Ocean Heat")) return "text-pink";
  if (name.includes("Ocean pH")) return "text-emerald";
  if (name.includes("Geomagnetic") || name.includes("Storm")) return "text-violet";
  return trendUp ? "text-emerald" : "text-violet";
}

/** Іконка тренду — позитивний/негативний напрямок */
function TrendIcon({ name, trendUp }: { name: string; trendUp: boolean }) {
  const badWhenUp =
    name.includes("Fire") ||
    name.includes("CO₂") ||
    name.includes("Anomaly") ||
    name.includes("Cyclone") ||
    name.includes("Geomagnetic");
  const positive = badWhenUp ? !trendUp : trendUp;
  return (
    <span className={`text-sm ${positive ? "text-emerald" : "text-pink"}`}>
      {trendUp ? "▲" : "▼"}
    </span>
  );
}

export function KPICards() {
  const [kpis, setKpis] = useState<KPIItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const { t } = useI18n();

  /** Завантаження даних з API */
  const load = useCallback(async () => {
    try {
      setKpis(await api.kpi());
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 120000);
    return () => clearInterval(id);
  }, [load]);

  /** Перекладена назва показника */
  const kpiLabel = (name: string) =>
    (t.kpi as Record<string, string>)[name] ?? name;

  /** Скелетон завантаження */
  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="glass p-6 skeleton">
            <div className="h-4 w-24 bg-white/10 rounded mb-4" />
            <div className="h-8 w-20 bg-white/10 rounded mb-2" />
            <div className="h-3 w-28 bg-white/5 rounded" />
          </div>
        ))}
      </div>
    );
  }

  /** Повідомлення про помилку або відсутність даних */
  if (error || kpis.length === 0) {
    return (
      <div className="glass-strong p-8 text-center text-secondary">
        <Activity className="w-6 h-6 mx-auto mb-3 text-amber" />
        <p className="text-sm">{t.common.noData}</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
      {kpis.map((kpi, index) => {
        const Icon = iconMap[kpi.name] || Gauge;
        const color = colorFor(kpi.name, kpi.trend_up);
        return (
          <div
            key={`${kpi.name}-${index}`}
            className="glass p-6 hover:shadow-glow hover:-translate-y-1 transition-all duration-300 group animate-fade-up"
            style={{ animationDelay: `${Math.min(index * 55, 380)}ms` }}
          >
            <div className="flex items-center justify-between mb-4">
              <div className={`p-3 rounded-lg ${color} bg-violet/12 transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-6`}>
                <Icon className="w-5 h-5" />
              </div>
              <TrendIcon name={kpi.name} trendUp={kpi.trend_up} />
            </div>
            <div className="text-2xl font-bold mb-1 text-primary">{kpi.value}</div>
            <div className="text-sm text-secondary mb-3">{kpiLabel(kpi.name)}</div>
            <div className="text-xs text-secondary opacity-60 group-hover:opacity-100 transition-opacity">
              {kpi.insight}
            </div>
            <div className="mt-3 pt-3 border-t border-violet/10 text-[11px] text-secondary">
              <span className={kpi.trend_up ? "text-emerald" : "text-pink"}>
                {kpi.trend_up ? "▲" : "▼"}
              </span>{" "}
              <span className="opacity-80">{kpi.trend}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AI-резюме клімату
// ---------------------------------------------------------------------------

export function AIClimateSummary() {
  const [summary, setSummary] = useState<string | null>(null);
  const [updated, setUpdated] = useState<string>("live");
  const { t } = useI18n();

  /** Завантаження резюме з API */
  const load = useCallback(async () => {
    try {
      const res = await api.aiSummary();
      setSummary(res.summary);
      setUpdated(res.last_updated);
    } catch {
      /* зберігаємо попереднє резюме */
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 180000);
    return () => clearInterval(id);
  }, [load]);

  return (
    <div className="glass-strong p-6 hover:shadow-glow transition-all duration-300 animate-fade-up" style={{ animationDelay: "150ms" }}>
      <div className="flex items-center space-x-2 mb-4">
        <span className="p-2 rounded-lg bg-violet/12 text-emerald">
          <Sparkles className="w-4 h-4" />
        </span>
        <h2 className="text-xl font-semibold">{t.widgets.aiSummary}</h2>
      </div>
      <div className="space-y-4">
        <p className="text-sm text-secondary leading-relaxed">
          {summary ?? t.common.noData}
        </p>
        <div className="flex items-center space-x-2 text-xs text-secondary">
          <div className="w-2 h-2 bg-emerald rounded-full ping-dot text-emerald" />
          <span>{t.common.updated} {updated}</span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Стрічка живих подій
// ---------------------------------------------------------------------------

/** Маппінг типів подій на іконки */
const eventIconMap: Record<string, any> = {
  Wildfire: Flame,
  Cyclone: CloudLightning,
  Volcano: Mountain,
  "Extreme Rainfall": CloudRain,
  "Arctic Ice Loss": Snowflake,
  "Coastal Flood": Waves,
};

/** Маппінг типів подій на кольори */
const eventColorMap: Record<string, string> = {
  Wildfire: "text-pink",
  Cyclone: "text-amber",
  Volcano: "text-amber",
  "Extreme Rainfall": "text-violet",
  "Arctic Ice Loss": "text-secondary",
  "Coastal Flood": "text-emerald",
};

/** Маппінг типів подій на hex-кольори (для акцентної смужки) */
const eventBarColorMap: Record<string, string> = {
  Wildfire: "#FF5C8A",
  Cyclone: "#FFC24D",
  Volcano: "#FFC24D",
  "Extreme Rainfall": "#7C4DFF",
  "Arctic Ice Loss": "#8B93B8",
  "Coastal Flood": "#2EE6A6",
};

export function LiveEventFeed() {
  const [events, setEvents] = useState<ClimateEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const { t } = useI18n();

  /** Завантаження подій з API */
  const load = useCallback(async () => {
    try {
      setEvents(await api.events());
    } catch {
      /* зберігаємо попередні дані */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 120000);
    return () => clearInterval(id);
  }, [load]);

  return (
    <div className="glass-strong p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">{t.widgets.liveEventFeed}</h2>
        <div className="flex items-center space-x-2">
          <div className="w-2 h-2 bg-emerald rounded-full ping-dot text-emerald" />
          <span className="text-xs text-secondary">{t.common.live}</span>
        </div>
      </div>
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-14 bg-surface-2 rounded-lg skeleton" />
          ))}
        </div>
      ) : events.length === 0 ? (
        <div className="flex items-center justify-center py-8 text-secondary text-sm">
          <Activity className="w-4 h-4 mr-2" />
          {t.common.noActiveEvents}
        </div>
      ) : (
        <div className="space-y-3">
          {events.slice(0, 6).map((event, index) => {
            const Icon = eventIconMap[event.event_type] || Activity;
            const color = eventColorMap[event.event_type] || "text-secondary";
            const barColor = eventBarColorMap[event.event_type] || "#7C4DFF";
            return (
              <div
                key={`${event.event_type}-${index}`}
                className="group relative flex items-center space-x-3 p-3 pl-4 rounded-lg bg-surface-2 hover:bg-surface-hover transition-colors cursor-pointer overflow-hidden animate-fade-up"
                style={{ animationDelay: `${index * 45}ms` }}
              >
                {/* Акцентна смужка зліва — з'являється при наведенні */}
                <span
                  className="absolute left-0 top-0 bottom-0 w-0.5 rounded-r-full opacity-0 group-hover:opacity-100 transition-opacity duration-200"
                  style={{ background: barColor }}
                />
                <div className={`p-2 rounded-lg bg-violet/12 ${color} transition-transform duration-300 group-hover:scale-110`}>
                  <Icon className="w-4 h-4" />
                </div>
                <div className="flex-1 transition-transform duration-300 group-hover:translate-x-0.5">
                  <div className="text-sm font-medium">{event.location}</div>
                  <div className="text-xs text-violet">{event.event_type}</div>
                </div>
                <div className="text-xs text-secondary">{event.time}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
