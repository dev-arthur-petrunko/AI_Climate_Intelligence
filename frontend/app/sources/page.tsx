"use client";

/**
 * Сторінка «Джерела» — статус усіх постачальників даних платформи.
 * Перевірка виконується раз на 30 хв (кеш на бекенді), без спаму запитів.
 */

import { useState, useEffect, useCallback } from "react";
import { RefreshCw, ExternalLink, Wifi, WifiOff, Clock } from "lucide-react";
import SideNavigation from "@/components/SideNavigation";
import MissionHeader from "@/components/MissionHeader";
import { api, SourcesData } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

const STATUS_COLORS = {
  online: "#28E08F",
  offline: "#FF5D6C",
};

export default function SourcesPage() {
  const { t } = useI18n();
  const src = t.pages.sources as Record<string, string>;
  const [data, setData] = useState<SourcesData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const d = await api.sources();
      setData(d);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 30 * 60 * 1000);
    return () => clearInterval(id);
  }, [load]);

  const fmtTime = (iso?: string): string => {
    if (!iso) return "—";
    try {
      const d = new Date(iso);
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${d.getUTCDate()}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
    } catch {
      return iso;
    }
  };

  const online = data?.online ?? 0;
  const offline = data?.offline ?? 0;
  const total = data?.total ?? data?.sources?.length ?? 0;

  return (
    <main className="min-h-screen bg-background">
      <SideNavigation />
      <MissionHeader />
      <div className="pt-24 px-6 pb-8">
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-4xl font-bold text-gradient mb-2">{src.title}</h1>
              <p className="text-secondary">{src.subtitle}</p>
            </div>
            <button
              type="button"
              onClick={load}
              disabled={loading}
              className="inline-flex items-center gap-2 glass px-4 py-2.5 rounded-xl text-sm text-primary hover:bg-white/10 transition-colors disabled:opacity-60"
              aria-label={src.refresh}
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              {src.refresh}
            </button>
          </div>

          {/* Зведення */}
          <div className="grid grid-cols-3 gap-4">
            <div className="glass p-5 text-center">
              <div className="text-2xl font-bold font-mono" style={{ color: STATUS_COLORS.online }}>
                {online}
              </div>
              <div className="text-xs text-secondary mt-1 uppercase tracking-wider">{src.online}</div>
            </div>
            <div className="glass p-5 text-center">
              <div className="text-2xl font-bold font-mono" style={{ color: STATUS_COLORS.offline }}>
                {offline}
              </div>
              <div className="text-xs text-secondary mt-1 uppercase tracking-wider">{src.offline}</div>
            </div>
            <div className="glass p-5 text-center">
              <div className="text-2xl font-bold font-mono text-primary">{total}</div>
              <div className="text-xs text-secondary mt-1 uppercase tracking-wider">{src.total}</div>
            </div>
          </div>

          {/* Час останньої перевірки */}
          {data?.checked_at && (
            <div className="flex items-center gap-2 text-xs text-secondary">
              <Clock className="w-3.5 h-3.5 text-cyan" />
              <span>
                {src.lastCheck}: {fmtTime(data.checked_at)}
              </span>
            </div>
          )}

          {loading && data === null ? (
            <div className="text-center py-16 text-secondary text-sm">{t.common.loading}</div>
          ) : !data || (data.sources || []).length === 0 ? (
            <div className="text-center py-16 text-secondary text-sm">{t.common.noData}</div>
          ) : (
            <div className="space-y-2.5">
              {data.sources.map((s) => {
                const isOnline = s.status === "online";
                const color = isOnline ? STATUS_COLORS.online : STATUS_COLORS.offline;
                return (
                  <div
                    key={s.key}
                    className="glass p-4 flex items-start justify-between gap-4 hover:bg-white/[0.04] transition-colors"
                  >
                    <div className="flex items-start space-x-3 min-w-0">
                      <span
                        className="mt-0.5 w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ background: color, boxShadow: isOnline ? `0 0 10px ${color}66` : undefined }}
                      />
                      <div className="min-w-0">
                        <div className="flex items-center flex-wrap gap-x-2 gap-y-1">
                          <span className="text-sm font-semibold text-primary">{s.name}</span>
                          {s.category && (
                            <span className="text-[9px] px-1.5 py-px rounded bg-white/10 text-secondary uppercase tracking-wider">
                              {src.category}: {s.category}
                            </span>
                          )}
                        </div>
                        {s.description && (
                          <p className="text-xs text-secondary mt-0.5">{s.description}</p>
                        )}
                        <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mt-1.5 text-[10px] text-secondary/80 font-mono">
                          {s.latency_ms != null && (
                            <span>
                              {src.latency}: {s.latency_ms} ms
                            </span>
                          )}
                          {s.checked_at && (
                            <span>
                              {src.checked}: {fmtTime(s.checked_at)}
                            </span>
                          )}
                        </div>
                        {s.needs_key && (
                          <span className="inline-flex items-center gap-1 mt-1.5 text-[10px] text-[#FFC24D]">
                            ⚠ {src.noKey}
                          </span>
                        )}
                        {!isOnline && s.reason && (
                          <span className="inline-flex items-center gap-1 mt-1.5 text-[10px] text-[#FF5D6C]">
                            {s.reason}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col items-end shrink-0 gap-1.5">
                      <span
                        className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider"
                        style={{ color }}
                      >
                        {isOnline ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
                        {isOnline ? src.available : src.unavailable}
                      </span>
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[10px] text-cyan hover:underline"
                      >
                        <ExternalLink className="w-3 h-3" />
                        {s.url.replace(/^https?:\/\//, "").split("/")[0]}
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
