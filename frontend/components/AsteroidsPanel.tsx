"use client";

/**
 * AsteroidsPanel — панель навколоземних астероїдів біля глобуса.
 * Дані з NASA NeoWs (зворотний бік через /api/asteroids).
 * Показує лише реальні об'єкти; якщо API недоступний — приховується.
 */

import { useState, useEffect, useCallback } from "react";
import { Orbit, X, RefreshCw, AlertTriangle } from "lucide-react";
import { api, AsteroidsData } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

export default function AsteroidsPanel() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<AsteroidsData | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.asteroids(7);
      setData(res.objects && res.objects.length > 0 ? res : null);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    load();
    const id = setInterval(load, 6 * 60 * 60 * 1000);
    return () => clearInterval(id);
  }, [load]);

  // Автоматичне відкриття, якщо є реальні астероїди
  useEffect(() => {
    if (data && data.objects.length > 0 && !open) {
      const id = setTimeout(() => setOpen(true), 2600);
      return () => clearTimeout(id);
    }
  }, [data, open]);

  if (loading) return null;
  if (!data || data.objects.length === 0) return null;

  const list = [...data.objects].sort((a, b) => {
    const da = a.miss_km ?? Infinity;
    const db = b.miss_km ?? Infinity;
    return da - db;
  });

  /** Форматування великих чисел у компактний вигляд (M km / k km) */
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

  const ast = t.asteroids as {
    title: string;
    subtitle: string;
    close: string;
    refresh: string;
    toggle: string;
    open: string;
    miss: string;
    velocity: string;
    diameter: string;
    hazardous: string;
    noData: string;
  };

  return (
    <div className="absolute bottom-24 left-4 z-30 pointer-events-none">
      <div
        className={`pointer-events-auto glass-strong rounded-2xl overflow-hidden transition-all duration-500 shadow-[0_12px_48px_rgba(0,0,0,0.55)] ${
          open
            ? "translate-y-0 opacity-100"
            : "translate-y-[calc(100%+32px)] opacity-0 pointer-events-none"
        }`}
        style={{ width: collapsed ? 280 : 300, maxWidth: "calc(100vw - 32px)" }}
      >
        {/* Заголовок панелі */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-violet/15 bg-violet/5">
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className="flex items-center space-x-2 group text-left"
            aria-label={ast.toggle}
          >
            <span className="p-1.5 rounded-lg bg-violet/12 text-cyan group-hover:scale-110 transition-transform">
              <Orbit className="w-4 h-4" />
            </span>
            <div>
              <h3 className="text-sm font-semibold leading-tight">{ast.title}</h3>
              <div className="flex items-center space-x-1.5 text-[10px] text-secondary">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan ping-dot text-cyan" />
                <span>{data.range ? `${data.range.start} — ${data.range.end}` : ast.subtitle}</span>
              </div>
            </div>
          </button>
          <div className="flex items-center space-x-1">
            <button
              type="button"
              onClick={load}
              className="p-1.5 rounded-lg hover:bg-white/10 text-secondary hover:text-primary transition-colors"
              aria-label={ast.refresh}
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="p-1.5 rounded-lg hover:bg-white/10 text-secondary hover:text-primary transition-colors"
              aria-label={ast.close}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Список астероїдів, відсортованих за відстанню до Землі */}
        {!collapsed && (
          <div className="px-4 py-3 max-h-72 overflow-y-auto custom-scroll">
            <div className="flex items-center justify-between mb-2 text-[10px] text-secondary uppercase tracking-[0.15em]">
              <span>{ast.subtitle}</span>
              <span className="text-primary/80 font-semibold">{list.length}</span>
            </div>
            <ul className="space-y-1.5">
              {list.map((obj, i) => {
                const avgDiam = obj.diameter_m_max
                  ? Math.round(obj.diameter_m_max)
                  : null;
                return (
                  <li
                    key={`${obj.name}-${i}`}
                    className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-white/[0.03] border border-white/5 hover:border-violet/25 transition-colors"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center space-x-1.5 min-w-0">
                        <span className="text-xs font-medium text-primary truncate">
                          {obj.name}
                        </span>
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
          </div>
        )}
      </div>

      {/* Компактна кнопка повторного відкриття */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="pointer-events-auto flex items-center space-x-2 px-3 py-2.5 glass-strong rounded-xl text-cyan text-xs font-medium hover:bg-violet/10 transition-colors"
          aria-label={ast.open}
        >
          <Orbit className="w-4 h-4" />
          <span>{ast.title}</span>
          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-cyan/15 text-cyan font-bold">
            {list.length}
          </span>
        </button>
      )}
    </div>
  );
}
