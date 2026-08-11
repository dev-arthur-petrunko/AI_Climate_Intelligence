"use client";

/**
 * AIAnalysisPanel — панель AI-анализа, выезжает справа (справа налево).
 * Десктоп: открывается при наведении курсора на край/панель и автоматически
 * скрывается, когда курсор покидает зону панели. Мобильные: bottom-sheet по тапу.
 */

import { useState, useEffect, useCallback } from "react";
import {
  Sparkles,
  X,
  RefreshCw,
  BrainCircuit,
  ChevronRight,
} from "lucide-react";
import { api, AIAnalysis } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

export default function AIAnalysisPanel() {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [analysis, setAnalysis] = useState<AIAnalysis | null>(null);

  /** На десктопі/ноутбуці вікно AI відкрите зразу (справа);
   *  при зменшенні екрана до планшета/телефона закривається. */
  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth < 1024) setOpen(false);
    };
    if (window.innerWidth >= 1024) setOpen(true);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  /** Загрузка AI-анализа из API (на языке интерфейса) */
  const load = useCallback(async () => {
    try {
      const data = await api.aiAnalysis(locale);
      setAnalysis(data);
    } catch {
      /* сохраняем предыдущий анализ */
    } finally {
      setLoading(false);
    }
  }, [locale]);

  useEffect(() => {
    setLoading(true);
    load();
    const id = setInterval(load, 30 * 60 * 1000);
    return () => clearInterval(id);
  }, [load]);

  /** Форматирование времени генерации */
  const formatTime = (iso?: string) => {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const modelLabel =
    analysis && analysis.model && analysis.model !== "fallback"
      ? analysis.model.replace(/-\d+b.*/, "").replace(/-/g, " ")
      : t.analysis.offline;

  /** Общий заголовок панели (десктоп + мобильный) */
  const renderHeader = (onClose: () => void) => (
    <div className="flex items-center justify-between px-4 py-3 border-b border-violet/15 bg-violet/5">
      <div className="flex items-center space-x-2 min-w-0">
        <span className="p-1.5 rounded-lg bg-violet/12 text-emerald shrink-0">
          <BrainCircuit className="w-4 h-4" />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold leading-tight truncate">{t.analysis.title}</h3>
          <div className="flex items-center space-x-1.5 text-[10px] text-secondary">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald ping-dot text-emerald shrink-0" />
            <span className="truncate">{t.analysis.schedule}</span>
          </div>
        </div>
      </div>
      <div className="flex items-center space-x-1 shrink-0">
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
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-white/10 text-secondary hover:text-primary transition-colors"
          aria-label={t.analysis.close}
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );

  /** Содержимое панели */
  const renderBody = () => (
    <div className="px-4 py-3 overflow-y-auto custom-scroll">
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

          {/* Футер: время генерации и модель */}
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

      {/* Ссылка на страницу прогнозов */}
      <a
        href="/predictions"
        className="mt-3 flex items-center justify-between px-3 py-2 rounded-lg bg-violet/10 border border-violet/15 text-violet text-xs font-medium hover:bg-violet/20 hover:border-violet/30 transition-all group"
      >
        <span>{t.analysis.viewPredictions}</span>
        <ChevronRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
      </a>
    </div>
  );

  return (
    <>
      {/* Десктоп/ноутбук: постійне вікно праворуч.
          Закривається хрестиком; знову відкривається кнопкою-вкладкою на краю. */}
      <div className="hidden md:block absolute right-0 top-1/2 -translate-y-1/2 z-30 pointer-events-none">
        {/* Триггер-вкладка на правом краю (скрыта, когда панель открыта) */}
        {!open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            data-ai-trigger
            className="pointer-events-auto absolute right-3 top-1/2 -translate-y-1/2 flex flex-col items-center gap-1.5 px-2 py-3 glass-strong rounded-xl text-emerald hover:bg-violet/10 transition-colors"
            aria-label={t.analysis.open}
          >
            <BrainCircuit className="w-4 h-4" />
            <span className="w-1.5 h-1.5 rounded-full bg-emerald ping-dot text-emerald" />
          </button>
        )}

        {/* Сама панель */}
        <div
          data-ai-panel
          className={`pointer-events-auto absolute right-3 top-1/2 -translate-y-1/2 w-[280px] lg:w-[320px] xl:w-[340px] max-w-[calc(100vw-40px)] glass-strong rounded-2xl overflow-hidden flex flex-col shadow-[0_16px_56px_rgba(0,0,0,0.55)] transition-all duration-500 ${
            open
              ? "translate-x-0 opacity-100"
              : "translate-x-[calc(100%+24px)] opacity-0 pointer-events-none"
          }`}
          style={{ maxHeight: "min(72vh, 640px)" }}
        >
          {renderHeader(() => setOpen(false))}
          {renderBody()}
        </div>
      </div>

      {/* Мобильные: компактная кнопка сверху справа + bottom-sheet по тапу */}
      <div className="md:hidden fixed inset-x-3 bottom-3 z-40 pointer-events-none">
        {!open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            data-ai-trigger-mobile
            className="pointer-events-auto fixed top-24 right-3 flex items-center gap-2 px-3.5 py-2.5 glass-strong rounded-xl text-emerald text-xs font-medium hover:bg-violet/10 transition-colors shadow-[0_12px_48px_rgba(0,0,0,0.5)]"
            aria-label={t.analysis.open}
          >
            <BrainCircuit className="w-4 h-4" />
            <span className="hidden sm:inline">{t.analysis.title}</span>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald ping-dot text-emerald" />
          </button>
        )}
        <div
          data-ai-panel-mobile
          className={`pointer-events-auto glass-strong rounded-2xl overflow-hidden flex flex-col shadow-[0_16px_56px_rgba(0,0,0,0.55)] transition-all duration-500 ${
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
