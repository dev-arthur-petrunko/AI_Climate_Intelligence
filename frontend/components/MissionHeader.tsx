"use client";

/**
 * Місіонний заголовок — верхній панель з показниками клімату в реальному часі.
 * Відображає CO₂, морський лід, пожежі, циклони, годинник та перемикач мови.
 */

import { useEffect, useState, useCallback } from "react";
import { Radio } from "lucide-react";
import { api, OverviewData } from "@/lib/api";
import LanguageSwitcher from "./LanguageSwitcher";
import { useI18n } from "@/lib/i18n";

/** Хук отримання загальних даних клімату (оновлюється кожні N мс) */
function useOverview(intervalMs = 60000) {
  const [data, setData] = useState<OverviewData | null>(null);
  const load = useCallback(async () => {
    try {
      setData(await api.overview(50.45, 30.52));
    } catch {
      /* зберігаємо останні відомі дані */
    }
  }, []);
  useEffect(() => {
    load();
    const id = setInterval(load, intervalMs);
    return () => clearInterval(id);
  }, [load, intervalMs]);
  return data;
}

export default function MissionHeader() {
  const data = useOverview();
  const [now, setNow] = useState<Date | null>(null);
  const { t } = useI18n();

  /** Оновлення годинника кожну секунду.
   *  Початковий стан null: на сервері рендериться прочерк, щоб уникнути
   *  розбіжності гідрації (серверний і клієнтський час різні).
   */
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const co2 = data?.co2?.value;
  const iceAnomaly = data?.sea_ice?.anomaly;
  const fires = data?.fires?.count ?? 0;
  const cyclones = data?.hurricanes?.count ?? 0;

  /** Рендер окремого показника в хедері */
  const statItem = (label: string, value: string, color: string) => (
    <div className="flex items-center space-x-2 px-3 py-1.5 border-l border-violet/20 first:border-l-0">
      <span className="text-[9px] uppercase tracking-[0.2em] text-secondary">{label}</span>
      <span className={`text-sm font-semibold font-mono ${color}`}>{value}</span>
    </div>
  );

  return (
    <header className="fixed top-0 left-0 right-0 z-30 pointer-events-none">
      <div className="flex justify-center pt-4 px-5">
        <div className="pointer-events-auto glass rounded-xl px-4 py-2 flex items-center space-x-2 animate-fade-up" style={{ animationDelay: "100ms" }}>
          {/* Показники клімату — приховані на мобільних */}
          <div className="hidden lg:flex items-center">
            {statItem(t.mission.co2, co2 ? `${co2.toFixed(0)} ppm` : "—", "text-amber")}
            {statItem(t.mission.seaIce, iceAnomaly != null ? `${iceAnomaly.toFixed(1)}M` : "—", "text-pink")}
            {statItem(t.mission.fires, String(fires), "text-amber")}
            {statItem(t.mission.cyclones, String(cyclones), "text-violet")}
          </div>

          <div className="hidden md:block w-px h-8 bg-violet/20" />

          {/* Індикатор "Live" та поточний час */}
          <div className="flex items-center space-x-3">
            <div className="flex items-center space-x-1.5">
              <Radio className="w-3 h-3 text-emerald animate-pulse" />
              <span className="text-[9px] uppercase tracking-widest text-emerald">{t.common.live}</span>
            </div>
            <span className="text-xs font-mono text-secondary tabular-nums">
              {now ? now.toLocaleTimeString("en-GB", { hour12: false }) : "—"}
            </span>
          </div>

          <LanguageSwitcher />
        </div>
      </div>
    </header>
  );
}
