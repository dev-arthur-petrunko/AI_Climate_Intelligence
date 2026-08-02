"use client";

/**
 * AIAnalysisPanel — окреме вікно, що спливає з правого боку глобуса.
 * Показує AI-аналіз сьогоднішньої кліматичної ситуації.
 * Аналіз оновлюється на бекенді 2 рази на день (AI Groq).
 */

import { useState, useEffect, useCallback } from "react";
import { Sparkles, X, RefreshCw, BrainCircuit, ChevronRight } from "lucide-react";
import { api, AIAnalysis } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

export default function AIAnalysisPanel() {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [analysis, setAnalysis] = useState<AIAnalysis | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  /** Завантаження AI-аналізу з API (мовою інтерфейсу) */
  const load = useCallback(async () => {
    try {
      const data = await api.aiAnalysis(locale);
      setAnalysis(data);
    } catch {
      /* зберігаємо попередній аналіз */
    } finally {
      setLoading(false);
    }
  }, [locale]);

  useEffect(() => {
    setLoading(true);
    load();
    const id = setInterval(load, 30 * 60 * 1000); // перевірка оновлень кожні 30 хв
    return () => clearInterval(id);
  }, [load]);

  // Спливаюче вікно з'являється автоматично з невеликою затримкою
  useEffect(() => {
    const id = setTimeout(() => setOpen(true), 1200);
    return () => clearTimeout(id);
  }, []);

  /** Форматування часу генерації */
  const formatTime = (iso?: string) => {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const modelLabel =
    analysis && analysis.model && analysis.model !== "fallback"
      ? analysis.model.replace(/-\d+b.*/, "").replace(/-/g, " ")
      : (t.analysis as any).offline;

  return (
    <div className="absolute top-24 right-4 z-30 pointer-events-none">
      {/* Панель, що виїжджає справа */}
      <div
        className={`pointer-events-auto glass-strong rounded-2xl overflow-hidden transition-all duration-500 shadow-[0_12px_48px_rgba(0,0,0,0.55)] ${
          open
            ? "translate-x-0 opacity-100"
            : "translate-x-[calc(100%+32px)] opacity-0 pointer-events-none"
        }`}
        style={{ width: collapsed ? 320 : 340, maxWidth: "calc(100vw - 40px)" }}
      >
        {/* Заголовок панелі */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-violet/15 bg-violet/5">
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className="flex items-center space-x-2 group text-left"
            aria-label={t.analysis.toggle}
          >
            <span className="p-1.5 rounded-lg bg-violet/12 text-emerald group-hover:scale-110 transition-transform">
              <BrainCircuit className="w-4 h-4" />
            </span>
            <div>
              <h3 className="text-sm font-semibold leading-tight">{t.analysis.title}</h3>
              <div className="flex items-center space-x-1.5 text-[10px] text-secondary">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald ping-dot text-emerald" />
                <span>{t.analysis.schedule}</span>
              </div>
            </div>
          </button>
          <div className="flex items-center space-x-1">
            <button
              type="button"
              onClick={load}
              className="p-1.5 rounded-lg hover:bg-white/10 text-secondary hover:text-primary transition-colors"
              aria-label={t.analysis.refresh}
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="p-1.5 rounded-lg hover:bg-white/10 text-secondary hover:text-primary transition-colors"
              aria-label={t.analysis.close}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Тіло панелі */}
        {!collapsed && (
          <div className="px-4 py-3">
            {loading ? (
              <div className="space-y-2">
                <div className="h-3 w-3/4 bg-white/10 rounded skeleton" />
                <div className="h-3 w-full bg-white/10 rounded skeleton" />
                <div className="h-3 w-5/6 bg-white/10 rounded skeleton" />
                <div className="h-3 w-2/3 bg-white/10 rounded skeleton" />
              </div>
            ) : (
              <>
                <p className="text-[13px] leading-relaxed text-primary/90 whitespace-pre-line">
                  {analysis?.analysis ?? t.common.noData}
                </p>

                {/* Футер: час генерації та модель */}
                <div className="mt-3 pt-2.5 border-t border-violet/15 flex items-center justify-between text-[10px] text-secondary">
                  <div className="flex items-center space-x-1">
                    <Sparkles className="w-3 h-3 text-emerald" />
                    <span>
                      {t.common.updated} {formatTime(analysis?.generated_at)}
                    </span>
                  </div>
                  <span className="uppercase tracking-wider truncate ml-2">{modelLabel}</span>
                </div>
              </>
            )}

            {/* Посилання на сторінку прогнозів */}
            <a
              href="/predictions"
              className="mt-3 flex items-center justify-between px-3 py-2 rounded-lg bg-violet/10 border border-violet/15 text-violet text-xs font-medium hover:bg-violet/20 hover:border-violet/30 transition-all group"
            >
              <span>{t.analysis.viewPredictions}</span>
              <ChevronRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
            </a>
          </div>
        )}
      </div>

      {/* Компактна кнопка повторного відкриття — видно, коли панель прихована */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="pointer-events-auto flex items-center space-x-2 px-3 py-2.5 glass-strong rounded-xl text-emerald text-xs font-medium hover:bg-violet/10 transition-colors"
          aria-label={t.analysis.open}
        >
          <BrainCircuit className="w-4 h-4" />
          <span>{t.analysis.title}</span>
        </button>
      )}
    </div>
  );
}
