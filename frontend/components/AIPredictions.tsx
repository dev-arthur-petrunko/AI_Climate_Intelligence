"use client";

/**
 * AI-прогнози — дані генерує AI Groq на бекенді (/api/predictions).
 * Показує ймовірності, довірчі інтервали та рівні ризику.
 * У разі недоступності бекенду — резервні локальні прогнози.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Thermometer,
  Flame,
  Waves,
  CloudRain,
  Wind,
  Sparkles,
  TrendingUp,
  AlertTriangle,
  Snowflake,
  Activity,
  Gauge,
  Mountain,
  type LucideIcon,
} from "lucide-react";
import { api, AIPrediction } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

interface PredictionCard {
  category: string;
  icon: LucideIcon;
  prediction: string;
  probability: number;
  confidenceInterval: [number, number];
  reasoning: string;
  timeframe: string;
  riskLevel: "low" | "medium" | "high";
}

/** Fallback-прогнози на випадок, якщо бекенд недоступний */
const fallbackPredictions: PredictionCard[] = [
  {
    category: "Temperature",
    icon: Thermometer,
    prediction: "Above average temperatures expected in Southern Europe",
    probability: 0.85,
    confidenceInterval: [0.78, 0.92],
    reasoning: "Based on atmospheric pressure patterns and historical data showing persistent high-pressure systems",
    timeframe: "7-30 days",
    riskLevel: "high",
  },
  {
    category: "Wildfire Risk",
    icon: Flame,
    prediction: "High wildfire risk in Mediterranean region",
    probability: 0.72,
    confidenceInterval: [0.65, 0.79],
    reasoning: "Drought conditions combined with high temperatures and low humidity create favorable conditions",
    timeframe: "7-14 days",
    riskLevel: "high",
  },
  {
    category: "Flood Risk",
    icon: Waves,
    prediction: "Elevated flood risk in Southeast Asia",
    probability: 0.68,
    confidenceInterval: [0.60, 0.76],
    reasoning: "Monsoon season intensification expected with above-average precipitation forecasts",
    timeframe: "30-90 days",
    riskLevel: "medium",
  },
  {
    category: "Sea Ice",
    icon: Snowflake,
    prediction: "Arctic sea ice extent remains below the seasonal baseline",
    probability: 0.88,
    confidenceInterval: [0.82, 0.94],
    reasoning: "Current extent anomaly relative to the 1981-2010 baseline (NSIDC)",
    timeframe: "30-90 days",
    riskLevel: "high",
  },
  {
    category: "Ocean Heat",
    icon: Activity,
    prediction: "Ocean heat content continues to accumulate",
    probability: 0.85,
    confidenceInterval: [0.78, 0.92],
    reasoning: "Upper-ocean heat storage keeps increasing year over year",
    timeframe: "90 days",
    riskLevel: "high",
  },
];

/** Підбір іконки за ключовими словами в категорії */
function iconFor(category: string) {
  const c = (category || "").toLowerCase();
  if (c.includes("fire") || c.includes("wildfire")) return Flame;
  if (c.includes("flood")) return Waves;
  if (c.includes("ice")) return Snowflake;
  if (c.includes("heat") || c.includes("temperatur")) return Thermometer;
  if (c.includes("cyclone") || c.includes("storm") || c.includes("wind")) return Wind;
  if (c.includes("rain") || c.includes("drought")) return CloudRain;
  if (c.includes("ocean") || c.includes("sea level")) return Waves;
  if (c.includes("volcano")) return Mountain;
  if (c.includes("ph")) return Gauge;
  return TrendingUp;
}

/** Визначення рівня ризику з рядка */
function riskLevelOf(level?: string): "low" | "medium" | "high" {
  const l = (level || "").toLowerCase();
  if (l === "low") return "low";
  if (l === "high") return "high";
  return "medium";
}

export default function AIPredictions() {
  const { t, locale } = useI18n();
  const [cards, setCards] = useState<PredictionCard[]>(fallbackPredictions);
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState(false);
  const [aiComment, setAiComment] = useState<string | null>(null);
  const [commentLoading, setCommentLoading] = useState(false);
  const [commentLive, setCommentLive] = useState(false);
  const [selectedTimeframe, setSelectedTimeframe] = useState("days30");
  const [expandedPrediction, setExpandedPrediction] = useState<number | null>(null);

  const timeframes = useMemo(
    () => [
      { key: "days7", maxDays: 7 },
      { key: "days30", maxDays: 30 },
      { key: "days90", maxDays: 90 },
      { key: "year1", maxDays: 365 },
      { key: "year2", maxDays: 730 },
      { key: "year3", maxDays: 1095 },
      { key: "year4", maxDays: 1460 },
      { key: "year5", maxDays: 1825 },
      { key: "year10", maxDays: 3650 },
    ],
    []
  );

  const daysFor = useCallback(
    (key: string) => timeframes.find((t) => t.key === key)?.maxDays ?? 30,
    [timeframes]
  );

  /** Завантаження прогнозів з API (AI Groq через бекенд, мовою інтерфейсу + горизонт днів) */
  const load = useCallback(
    async (days = daysFor(selectedTimeframe)) => {
      try {
        const data: AIPrediction[] = await api.predictions(locale, days);
        if (Array.isArray(data) && data.length > 0) {
          setCards(
            data.map((p) => ({
              category: p.category,
              icon: iconFor(p.category),
              prediction: p.prediction,
              probability: p.probability,
              confidenceInterval: p.confidence_interval ?? [p.probability, p.probability],
              reasoning: p.reasoning,
              timeframe: p.timeframe || (days > 365 ? `${Math.round(days / 365)} years` : `${days}-${Math.max(days * 3, days + 60)} days`),
              riskLevel: riskLevelOf(p.risk_level),
            }))
          );
          setLive(true);
        }
      } catch {
        /* зберігаємо резервні прогнози */
      } finally {
        setLoading(false);
      }
    },
    [locale, selectedTimeframe, daysFor]
  );

  /** Завантаження AI-коментаря до цього горизонту прогнозу */
  const loadComment = useCallback(
    async (days = daysFor(selectedTimeframe)) => {
      setCommentLoading(true);
      try {
        const data = await api.predictionComment(locale, days);
        if (data && data.comment) {
          setAiComment(data.comment);
          setCommentLive(!!data.live);
        }
      } catch {
        setAiComment(
          locale === "uk"
            ? "Аналіз даних недоступний зараз — спробуйте пізніше."
            : "Data analysis is temporarily unavailable — please try again later."
        );
        setCommentLive(false);
      } finally {
        setCommentLoading(false);
      }
    },
    [locale, selectedTimeframe, daysFor]
  );

  useEffect(() => {
    setLoading(true);
    load();
    loadComment();
    const id = setInterval(load, 30 * 60 * 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadComment, load]);

  const getRiskColor = (level: string) => {
    switch (level) {
      case "high": return "text-pink";
      case "medium": return "text-amber";
      case "low": return "text-emerald";
      default: return "text-secondary";
    }
  };

  const getRiskBg = (level: string) => {
    switch (level) {
      case "high": return "bg-pink/10 border-pink/20";
      case "medium": return "bg-amber/10 border-amber/20";
      case "low": return "bg-emerald/10 border-emerald/20";
      default: return "bg-white/5 border-border";
    }
  };

  return (
    <div className="space-y-6">
      <div className="glass p-4">
        <div className="flex items-center space-x-2 mb-4">
          <Sparkles className="w-5 h-5 text-emerald" />
          <h3 className="font-semibold">{t.predictions.ui.timeframe}</h3>
          <div className="ml-auto flex items-center space-x-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald ping-dot text-emerald" />
            <span className="text-[10px] text-secondary uppercase tracking-wider">
              {live ? "AI Groq" : t.common.offline}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {timeframes.map((timeframe) => (
            <button
              key={timeframe.key}
              onClick={() => setSelectedTimeframe(timeframe.key)}
              className={`px-4 py-2 rounded-lg transition-all ${
                selectedTimeframe === timeframe.key
                  ? "bg-emerald text-[#04211A] font-semibold"
                  : "bg-surface-2 text-secondary hover:text-primary hover:bg-surface-hover"
              }`}
            >
              {t.predictions.ui[timeframe.key as keyof typeof t.predictions.ui]}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="glass p-6 skeleton">
              <div className="h-10 w-10 bg-white/10 rounded-lg mb-4" />
              <div className="h-4 w-1/2 bg-white/10 rounded mb-3" />
              <div className="h-8 w-16 bg-white/10 rounded mb-3" />
              <div className="h-3 w-full bg-white/5 rounded mb-2" />
              <div className="h-3 w-2/3 bg-white/5 rounded" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {cards.map((prediction, index) => {
            const Icon = prediction.icon;
            const isExpanded = expandedPrediction === index;

            return (
              <div
                key={`${prediction.category}-${index}`}
                className={`glass p-6 cursor-pointer transition-all hover:shadow-glow hover:-translate-y-1 ${
                  isExpanded ? "ring-2 ring-violet" : ""
                }`}
                onClick={() => setExpandedPrediction(isExpanded ? null : index)}
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center space-x-3">
                    <div className={`p-3 rounded-lg bg-violet/12 ${getRiskColor(prediction.riskLevel)}`}>
                      <Icon className="w-6 h-6" />
                    </div>
                    <div>
                      <h3 className="font-semibold">{prediction.category}</h3>
                      <div className={`text-xs ${getRiskColor(prediction.riskLevel)} flex items-center space-x-1`}>
                        <AlertTriangle className="w-3 h-3" />
                        <span className="capitalize">
                          {t.predictions.risk[prediction.riskLevel]} {t.predictions.ui.risk}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold text-violet">
                      {Math.round(prediction.probability * 100)}%
                    </div>
                    <div className="text-xs text-secondary">{t.predictions.ui.probability}</div>
                  </div>
                </div>

                <p className="text-sm text-secondary mb-4">{prediction.prediction}</p>

                <div className="mb-4">
                  <div className="flex justify-between text-xs text-secondary mb-1">
                    <span>{t.predictions.ui.confidence}</span>
                    <span>
                      {Math.round(prediction.confidenceInterval[0] * 100)}% - {Math.round(prediction.confidenceInterval[1] * 100)}%
                    </span>
                  </div>
                  <div className="h-2 bg-surface-2 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-violet to-emerald rounded-full transition-all"
                      style={{ width: `${prediction.probability * 100}%` }}
                    />
                  </div>
                </div>

                {isExpanded && (
                  <div className="pt-4 border-t border-violet/15 space-y-3">
                    <div>
                      <div className="text-xs text-secondary mb-1">{t.predictions.ui.timeframeLabel}</div>
                      <div className="text-sm">{prediction.timeframe}</div>
                    </div>
                    <div>
                      <div className="text-xs text-secondary mb-1">{t.predictions.ui.aiReasoning}</div>
                      <div className="text-sm leading-relaxed">{prediction.reasoning}</div>
                    </div>
                    <div className={`p-3 rounded-lg border ${getRiskBg(prediction.riskLevel)}`}>
                      <div className="text-xs text-secondary mb-1">{t.predictions.ui.riskAssessment}</div>
                      <div className={`text-sm font-medium ${getRiskColor(prediction.riskLevel)}`}>
                        {prediction.riskLevel.toUpperCase()} {t.predictions.ui.riskLevel}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="glass p-6">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center space-x-2">
            <Sparkles className="w-5 h-5 text-violet" />
            <h3 className="font-semibold text-sm">{t.predictions.ui.aiComment}</h3>
          </div>
          <span className="text-[10px] text-secondary uppercase tracking-wider">
            {commentLive ? "AI Groq" : t.common.offline}
          </span>
        </div>
        {commentLoading ? (
          <div className="space-y-2">
            <div className="h-4 w-3/4 bg-white/5 rounded skeleton" />
            <div className="h-4 w-2/3 bg-white/5 rounded skeleton" />
            <div className="h-4 w-1/2 bg-white/5 rounded skeleton" />
          </div>
        ) : aiComment ? (
          <div className="text-secondary text-sm leading-relaxed whitespace-pre-line">{aiComment}</div>
        ) : null}
      </div>

      <div className="glass-strong p-6">
        <div className="flex items-center space-x-2 mb-4">
          <Sparkles className="w-5 h-5 text-emerald" />
          <h3 className="font-semibold">{t.predictions.ui.aiSummary}</h3>
        </div>
        <p className="text-secondary leading-relaxed">
          {t.predictions.ui.summaryText}
        </p>
      </div>
    </div>
  );
}
