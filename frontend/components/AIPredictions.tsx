"use client";

import { useState } from "react";
import { Thermometer, Flame, Waves, CloudRain, Wind, Sparkles, TrendingUp, AlertTriangle } from "lucide-react";
import { useI18n } from "@/lib/i18n";

interface Prediction {
  category: string;
  icon: any;
  prediction: string;
  probability: number;
  confidenceInterval: [number, number];
  reasoning: string;
  timeframe: string;
  minDays: number;
  maxDays: number;
  riskLevel: "low" | "medium" | "high";
}

const predictionsData: Prediction[] = [
  {
    category: "temperature",
    icon: Thermometer,
    prediction: "Above average temperatures expected in Southern Europe",
    probability: 0.85,
    confidenceInterval: [0.78, 0.92],
    reasoning: "Based on atmospheric pressure patterns and historical data showing persistent high-pressure systems",
    timeframe: "7-30 days",
    minDays: 7,
    maxDays: 30,
    riskLevel: "high"
  },
  {
    category: "wildfire",
    icon: Flame,
    prediction: "High wildfire risk in Mediterranean region",
    probability: 0.72,
    confidenceInterval: [0.65, 0.79],
    reasoning: "Drought conditions combined with high temperatures and low humidity create favorable conditions",
    timeframe: "7-14 days",
    minDays: 7,
    maxDays: 14,
    riskLevel: "high"
  },
  {
    category: "flood",
    icon: Waves,
    prediction: "Elevated flood risk in Southeast Asia",
    probability: 0.68,
    confidenceInterval: [0.60, 0.76],
    reasoning: "Monsoon season intensification expected with above-average precipitation forecasts",
    timeframe: "30-90 days",
    minDays: 30,
    maxDays: 90,
    riskLevel: "medium"
  },
  {
    category: "heatwaves",
    icon: TrendingUp,
    prediction: "Extended heatwave period in North America",
    probability: 0.61,
    confidenceInterval: [0.55, 0.67],
    reasoning: "Heat dome formation patterns indicate prolonged high-temperature conditions",
    timeframe: "14-30 days",
    minDays: 14,
    maxDays: 30,
    riskLevel: "medium"
  },
  {
    category: "storm",
    icon: Wind,
    prediction: "Increased tropical storm activity in Atlantic",
    probability: 0.59,
    confidenceInterval: [0.52, 0.66],
    reasoning: "Sea surface temperatures above historical averages support storm development",
    timeframe: "30-90 days",
    minDays: 30,
    maxDays: 90,
    riskLevel: "medium"
  },
  {
    category: "drought",
    icon: CloudRain,
    prediction: "Developing drought conditions in East Africa",
    probability: 0.74,
    confidenceInterval: [0.68, 0.80],
    reasoning: "Below-average rainfall forecasts combined with existing soil moisture deficits",
    timeframe: "90 days",
    minDays: 90,
    maxDays: 90,
    riskLevel: "high"
  }
];

export default function AIPredictions() {
  const { t } = useI18n();
  const timeframes = [
    { key: "days7", maxDays: 7 },
    { key: "days30", maxDays: 30 },
    { key: "days90", maxDays: 90 },
    { key: "year1", maxDays: 365 },
  ];
  const [selectedTimeframe, setSelectedTimeframe] = useState("days30");
  const [expandedPrediction, setExpandedPrediction] = useState<number | null>(null);

  const selectedMaxDays = timeframes.find((tf) => tf.key === selectedTimeframe)?.maxDays ?? 30;
  const visiblePredictions = predictionsData.filter(
    (prediction) => prediction.minDays <= selectedMaxDays
  );

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

  const cardLabel = (key: string) =>
    (t.predictions.cards as Record<string, { category: string }>)[key]?.category ?? key;

  return (
    <div className="space-y-6">
      <div className="glass p-4">
        <div className="flex items-center space-x-2 mb-4">
          <Sparkles className="w-5 h-5 text-emerald" />
          <h3 className="font-semibold">{t.predictions.ui.timeframe}</h3>
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

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {visiblePredictions.map((prediction, index) => {
          const Icon = prediction.icon;
          const isExpanded = expandedPrediction === index;
          const card = (t.predictions.cards as Record<string, any>)[prediction.category];

          return (
            <div
              key={`${prediction.category}-${index}`}
              className={`glass p-6 cursor-pointer transition-all hover:glow ${
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
                    <h3 className="font-semibold">{card?.category ?? cardLabel(prediction.category)}</h3>
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

              <p className="text-sm text-secondary mb-4">{card?.prediction ?? prediction.prediction}</p>

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
                    <div className="text-sm leading-relaxed">{card?.reasoning ?? prediction.reasoning}</div>
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
