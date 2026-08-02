"use client";

import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import {
  api,
  GISTEMPSeries,
  CO2Series,
  SeaIceData,
  SeaLevelData,
  OceanHeatData,
  OceanPhData,
} from "@/lib/api";
import { useI18n } from "@/lib/i18n";

const Plot: any = dynamic(() => import("react-plotly.js"), {
  ssr: false,
  loading: () => <div className="glass p-8">Loading chart...</div>,
});

type ChartId =
  | "temperature"
  | "co2"
  | "seaIce"
  | "seaIceSouth"
  | "seaLevel"
  | "oceanHeat"
  | "oceanPh";

/**
 * Аналітичні графіки — інтерактивні Plotly-графіки кліматичних даних.
 * Температура, CO₂, морський лід (Арктика/Антарктика), рівень моря,
 * тепло океану та закислення. Оновлюються при завантаженні.
 */
export default function AnalyticsCharts() {
  const [activeChart, setActiveChart] = useState<ChartId>("temperature");
  const [gistemp, setGistemp] = useState<GISTEMPSeries | null>(null);
  const [co2, setCo2] = useState<CO2Series | null>(null);
  const [seaIce, setSeaIce] = useState<SeaIceData | null>(null);
  const [seaIceSouth, setSeaIceSouth] = useState<SeaIceData | null>(null);
  const [seaLevel, setSeaLevel] = useState<SeaLevelData | null>(null);
  const [oceanHeat, setOceanHeat] = useState<OceanHeatData | null>(null);
  const [oceanPh, setOceanPh] = useState<OceanPhData | null>(null);
  const { t } = useI18n();

  const load = useCallback(async () => {
    try {
      const [g, c, s, ss, sl, oh, ph] = await Promise.all([
        api.gistemp(),
        api.co2(),
        api.seaIce(),
        api.seaIceSouth(),
        api.seaLevel(),
        api.oceanHeat(),
        api.oceanPh(),
      ]);
      setGistemp(g);
      setCo2(c);
      setSeaIce(s);
      setSeaIceSouth(ss);
      setSeaLevel(sl);
      setOceanHeat(oh);
      setOceanPh(ph);
    } catch {
      /* charts will show empty state */
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const charts = [
    { id: "temperature" as ChartId, label: t.charts.temperature },
    { id: "co2" as ChartId, label: t.charts.co2 },
    { id: "seaIce" as ChartId, label: t.charts.seaIce },
    { id: "seaIceSouth" as ChartId, label: t.charts.seaIceSouth },
    { id: "seaLevel" as ChartId, label: t.charts.seaLevel },
    { id: "oceanHeat" as ChartId, label: t.charts.oceanHeat },
    { id: "oceanPh" as ChartId, label: t.charts.oceanPh },
  ];

  const plotStyle = {
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font: { color: "#8B9AB5", size: 11 },
    xaxis: {
      gridcolor: "rgba(255,255,255,0.05)",
      zerolinecolor: "rgba(255,255,255,0.05)",
    },
    yaxis: {
      gridcolor: "rgba(255,255,255,0.05)",
      zerolinecolor: "rgba(255,255,255,0.05)",
    },
    margin: { t: 40, r: 30, b: 60, l: 70 },
  };

  const renderMainChart = () => {
    if (activeChart === "temperature" && gistemp?.series?.length) {
      return (
        <Plot
          data={[
            {
              x: gistemp.series.map((d) => d.year),
              y: gistemp.series.map((d) => d.value),
              type: "scatter",
              mode: "lines",
              line: { color: "#36A3FF", width: 2 },
              fill: "tozeroy",
              fillcolor: "rgba(54, 163, 255, 0.12)",
              name: t.charts.temperature,
            },
          ]}
          layout={{
            ...plotStyle,
            yaxis: { ...plotStyle.yaxis, title: t.charts.tempAxis },
            hovermode: "x unified",
            annotations: [
              {
                xref: "paper",
                yref: "paper",
                x: 0,
                y: 1.08,
                showarrow: false,
                text: t.charts.tempSource,
                font: { size: 11, color: "#8B9AB5" },
              },
            ],
          }}
          style={{ width: "100%", height: "420px" }}
          useResizeHandler
          config={{ responsive: true, displayModeBar: false }}
        />
      );
    }

    if (activeChart === "co2" && co2?.series?.length) {
      return (
        <Plot
          data={[
            {
              x: co2.series.map((d) => d.year + (d.month - 1) / 12),
              y: co2.series.map((d) => d.value),
              type: "scatter",
              mode: "lines",
              line: { color: "#FF5D6C", width: 2 },
              fill: "tozeroy",
              fillcolor: "rgba(255, 93, 108, 0.12)",
              name: t.charts.co2,
            },
          ]}
          layout={{
            ...plotStyle,
            yaxis: { ...plotStyle.yaxis, title: t.charts.co2Axis },
            hovermode: "x unified",
            annotations: [
              {
                xref: "paper",
                yref: "paper",
                x: 0,
                y: 1.08,
                showarrow: false,
                text: t.charts.co2Source,
                font: { size: 11, color: "#8B9AB5" },
              },
            ],
          }}
          style={{ width: "100%", height: "420px" }}
          useResizeHandler
          config={{ responsive: true, displayModeBar: false }}
        />
      );
    }

    if (activeChart === "seaIce" && seaIce?.annual_minimum?.length) {
      return (
        <Plot
          data={[
            {
              x: seaIce.annual_minimum.map((d) => d.year),
              y: seaIce.annual_minimum.map((d) => d.value),
              type: "scatter",
              mode: "lines+markers",
              line: { color: "#29F2FF", width: 2 },
              marker: { color: "#29F2FF", size: 4 },
              name: t.charts.seaIceShort,
            },
          ]}
          layout={{
            ...plotStyle,
            yaxis: { ...plotStyle.yaxis, title: t.charts.seaIceAxis },
            hovermode: "x unified",
            annotations: [
              {
                xref: "paper",
                yref: "paper",
                x: 0,
                y: 1.08,
                showarrow: false,
                text: t.charts.seaIceSource,
                font: { size: 11, color: "#8B9AB5" },
              },
            ],
          }}
          style={{ width: "100%", height: "420px" }}
          useResizeHandler
          config={{ responsive: true, displayModeBar: false }}
        />
      );
    }

    if (activeChart === "seaIceSouth" && seaIceSouth?.annual_minimum?.length) {
      return (
        <Plot
          data={[
            {
              x: seaIceSouth.annual_minimum.map((d) => d.year),
              y: seaIceSouth.annual_minimum.map((d) => d.value),
              type: "scatter",
              mode: "lines+markers",
              line: { color: "#2EE6A6", width: 2 },
              marker: { color: "#2EE6A6", size: 4 },
              name: t.charts.seaIceSouthShort,
            },
          ]}
          layout={{
            ...plotStyle,
            yaxis: { ...plotStyle.yaxis, title: t.charts.seaIceAxis },
            hovermode: "x unified",
            annotations: [
              {
                xref: "paper",
                yref: "paper",
                x: 0,
                y: 1.08,
                showarrow: false,
                text: t.charts.seaIceSouthSource,
                font: { size: 11, color: "#8B9AB5" },
              },
            ],
          }}
          style={{ width: "100%", height: "420px" }}
          useResizeHandler
          config={{ responsive: true, displayModeBar: false }}
        />
      );
    }

    if (activeChart === "seaLevel" && seaLevel?.series?.length) {
      return (
        <Plot
          data={[
            {
              x: seaLevel.series.map((d) => d.date),
              y: seaLevel.series.map((d) => d.value),
              type: "scatter",
              mode: "lines",
              line: { color: "#FFC24D", width: 2 },
              fill: "tozeroy",
              fillcolor: "rgba(255, 194, 77, 0.12)",
              name: t.charts.seaLevelShort,
            },
          ]}
          layout={{
            ...plotStyle,
            yaxis: { ...plotStyle.yaxis, title: t.charts.seaLevelAxis },
            hovermode: "x unified",
            annotations: [
              {
                xref: "paper",
                yref: "paper",
                x: 0,
                y: 1.08,
                showarrow: false,
                text: t.charts.seaLevelSource,
                font: { size: 11, color: "#8B9AB5" },
              },
            ],
          }}
          style={{ width: "100%", height: "420px" }}
          useResizeHandler
          config={{ responsive: true, displayModeBar: false }}
        />
      );
    }

    if (activeChart === "oceanHeat" && oceanHeat?.series?.length) {
      return (
        <Plot
          data={[
            {
              x: oceanHeat.series.map((d) => d.year),
              y: oceanHeat.series.map((d) => d.value),
              type: "scatter",
              mode: "lines",
              line: { color: "#FF5C8A", width: 2 },
              fill: "tozeroy",
              fillcolor: "rgba(255, 92, 138, 0.12)",
              name: t.charts.oceanHeatShort,
            },
          ]}
          layout={{
            ...plotStyle,
            yaxis: { ...plotStyle.yaxis, title: t.charts.oceanHeatAxis },
            hovermode: "x unified",
            annotations: [
              {
                xref: "paper",
                yref: "paper",
                x: 0,
                y: 1.08,
                showarrow: false,
                text: t.charts.oceanHeatSource,
                font: { size: 11, color: "#8B9AB5" },
              },
            ],
          }}
          style={{ width: "100%", height: "420px" }}
          useResizeHandler
          config={{ responsive: true, displayModeBar: false }}
        />
      );
    }

    if (activeChart === "oceanPh" && oceanPh?.series?.length) {
      return (
        <Plot
          data={[
            {
              x: oceanPh.series.map((d) => d.date),
              y: oceanPh.series.map((d) => d.value),
              type: "scatter",
              mode: "lines",
              line: { color: "#7C4DFF", width: 2 },
              fill: "tozeroy",
              fillcolor: "rgba(124, 77, 255, 0.12)",
              name: t.charts.oceanPhShort,
            },
          ]}
          layout={{
            ...plotStyle,
            yaxis: { ...plotStyle.yaxis, title: t.charts.oceanPhAxis },
            hovermode: "x unified",
            annotations: [
              {
                xref: "paper",
                yref: "paper",
                x: 0,
                y: 1.08,
                showarrow: false,
                text: t.charts.oceanPhSource,
                font: { size: 11, color: "#8B9AB5" },
              },
            ],
          }}
          style={{ width: "100%", height: "420px" }}
          useResizeHandler
          config={{ responsive: true, displayModeBar: false }}
        />
      );
    }

    return (
      <div className="flex items-center justify-center h-[420px] text-secondary text-sm">
        {t.charts.noData}
      </div>
    );
  };

  const renderMiniChart = (id: ChartId) => {
    if (id === "temperature" && gistemp?.series?.length) {
      const series = gistemp.series.slice(-24);
      return (
        <Plot
          data={[
            {
              x: series.map((d) => d.year),
              y: series.map((d) => d.value),
              type: "scatter",
              mode: "lines",
              line: { color: "#36A3FF", width: 2 },
            },
          ]}
          layout={{
            ...plotStyle,
            margin: { t: 10, r: 10, b: 30, l: 45 },
            showlegend: false,
          }}
          style={{ width: "100%", height: "200px" }}
          useResizeHandler
          config={{ responsive: true, displayModeBar: false }}
        />
      );
    }
    if (id === "co2" && co2?.series?.length) {
      const series = co2.series.slice(-36);
      return (
        <Plot
          data={[
            {
              x: series.map((d) => d.year + (d.month - 1) / 12),
              y: series.map((d) => d.value),
              type: "scatter",
              mode: "lines",
              line: { color: "#FF5D6C", width: 2 },
            },
          ]}
          layout={{
            ...plotStyle,
            margin: { t: 10, r: 10, b: 30, l: 45 },
            showlegend: false,
          }}
          style={{ width: "100%", height: "200px" }}
          useResizeHandler
          config={{ responsive: true, displayModeBar: false }}
        />
      );
    }
    if (id === "seaIce" && seaIce?.annual_minimum?.length) {
      const series = seaIce.annual_minimum.slice(-24);
      return (
        <Plot
          data={[
            {
              x: series.map((d) => d.year),
              y: series.map((d) => d.value),
              type: "scatter",
              mode: "lines",
              line: { color: "#29F2FF", width: 2 },
            },
          ]}
          layout={{
            ...plotStyle,
            margin: { t: 10, r: 10, b: 30, l: 45 },
            showlegend: false,
          }}
          style={{ width: "100%", height: "200px" }}
          useResizeHandler
          config={{ responsive: true, displayModeBar: false }}
        />
      );
    }
    if (id === "seaIceSouth" && seaIceSouth?.annual_minimum?.length) {
      const series = seaIceSouth.annual_minimum.slice(-24);
      return (
        <Plot
          data={[
            {
              x: series.map((d) => d.year),
              y: series.map((d) => d.value),
              type: "scatter",
              mode: "lines",
              line: { color: "#2EE6A6", width: 2 },
            },
          ]}
          layout={{
            ...plotStyle,
            margin: { t: 10, r: 10, b: 30, l: 45 },
            showlegend: false,
          }}
          style={{ width: "100%", height: "200px" }}
          useResizeHandler
          config={{ responsive: true, displayModeBar: false }}
        />
      );
    }
    if (id === "seaLevel" && seaLevel?.series?.length) {
      const series = seaLevel.series.slice(-40);
      return (
        <Plot
          data={[
            {
              x: series.map((d) => d.date),
              y: series.map((d) => d.value),
              type: "scatter",
              mode: "lines",
              line: { color: "#FFC24D", width: 2 },
            },
          ]}
          layout={{
            ...plotStyle,
            margin: { t: 10, r: 10, b: 30, l: 45 },
            showlegend: false,
          }}
          style={{ width: "100%", height: "200px" }}
          useResizeHandler
          config={{ responsive: true, displayModeBar: false }}
        />
      );
    }
    if (id === "oceanHeat" && oceanHeat?.series?.length) {
      const series = oceanHeat.series.slice(-30);
      return (
        <Plot
          data={[
            {
              x: series.map((d) => d.year),
              y: series.map((d) => d.value),
              type: "scatter",
              mode: "lines",
              line: { color: "#FF5C8A", width: 2 },
            },
          ]}
          layout={{
            ...plotStyle,
            margin: { t: 10, r: 10, b: 30, l: 45 },
            showlegend: false,
          }}
          style={{ width: "100%", height: "200px" }}
          useResizeHandler
          config={{ responsive: true, displayModeBar: false }}
        />
      );
    }
    if (id === "oceanPh" && oceanPh?.series?.length) {
      const series = oceanPh.series.slice(-60);
      return (
        <Plot
          data={[
            {
              x: series.map((d) => d.date),
              y: series.map((d) => d.value),
              type: "scatter",
              mode: "lines",
              line: { color: "#7C4DFF", width: 2 },
            },
          ]}
          layout={{
            ...plotStyle,
            margin: { t: 10, r: 10, b: 30, l: 45 },
            showlegend: false,
          }}
          style={{ width: "100%", height: "200px" }}
          useResizeHandler
          config={{ responsive: true, displayModeBar: false }}
        />
      );
    }
    return <div className="h-[200px] bg-white/5 rounded-lg animate-pulse" />;
  };

  const miniData = [
    { key: "temperature" as ChartId, name: t.charts.temperatureFull },
    { key: "co2" as ChartId, name: t.charts.co2 },
    { key: "seaIce" as ChartId, name: t.charts.seaIceShort },
    { key: "seaLevel" as ChartId, name: t.charts.seaLevelShort },
    { key: "oceanHeat" as ChartId, name: t.charts.oceanHeatShort },
    { key: "oceanPh" as ChartId, name: t.charts.oceanPhShort },
  ];

  return (
    <div className="space-y-6">
      {/* Chart Selector */}
      <div className="flex flex-wrap gap-2">
        {charts.map((chart) => (
          <button
            key={chart.id}
            onClick={() => setActiveChart(chart.id)}
            className={`px-4 py-2 rounded-lg transition-all ${
              activeChart === chart.id
                ? "bg-emerald text-[#04211A] font-semibold"
                : "glass text-secondary hover:text-primary"
            }`}
          >
            {chart.label}
          </button>
        ))}
      </div>

      {/* Main Chart */}
      <div className="glass-strong p-6">{renderMainChart()}</div>

      {/* Mini Charts Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {miniData.map((item) => (
          <div key={item.key} className="glass p-5">
            <h3 className="text-sm font-semibold mb-3">{item.name}</h3>
            {renderMiniChart(item.key)}
          </div>
        ))}
      </div>
    </div>
  );
}
