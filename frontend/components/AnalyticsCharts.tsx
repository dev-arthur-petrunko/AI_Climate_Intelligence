"use client";

import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import { api, GISTEMPSeries, CO2Series, SeaIceData } from "@/lib/api";

const Plot: any = dynamic(() => import("react-plotly.js"), {
  ssr: false,
  loading: () => <div className="glass p-8">Loading chart...</div>,
});

type ChartSource =
  | { kind: "temperature" }
  | { kind: "co2" }
  | { kind: "seaIce" };

/**
 * Аналітичні графіки — інтерактивні Plotly-графіки кліматичних даних.
 * Температура, CO₂, морський лід. Оновлюються при завантаженні.
 */
export default function AnalyticsCharts() {
  const [activeChart, setActiveChart] = useState("temperature");
  const [gistemp, setGistemp] = useState<GISTEMPSeries | null>(null);
  const [co2, setCo2] = useState<CO2Series | null>(null);
  const [seaIce, setSeaIce] = useState<SeaIceData | null>(null);

  const load = useCallback(async () => {
    try {
      const [g, c, s] = await Promise.all([api.gistemp(), api.co2(), api.seaIce()]);
      setGistemp(g);
      setCo2(c);
      setSeaIce(s);
    } catch {
      /* charts will show empty state */
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const charts = [
    { id: "temperature", label: "Global Temperature" },
    { id: "co2", label: "Atmospheric CO₂" },
    { id: "seaIce", label: "Arctic Sea Ice" },
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
              name: "Temperature Anomaly (°C)",
            },
          ]}
          layout={{
            ...plotStyle,
            yaxis: { ...plotStyle.yaxis, title: "Anomaly vs 1951–1980 (°C)" },
            hovermode: "x unified",
            annotations: [
              {
                xref: "paper",
                yref: "paper",
                x: 0,
                y: 1.08,
                showarrow: false,
                text: "NASA GISTEMP · global surface temperature anomaly",
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
              name: "CO₂ (ppm)",
            },
          ]}
          layout={{
            ...plotStyle,
            yaxis: { ...plotStyle.yaxis, title: "CO₂ concentration (ppm)" },
            hovermode: "x unified",
            annotations: [
              {
                xref: "paper",
                yref: "paper",
                x: 0,
                y: 1.08,
                showarrow: false,
                text: "NOAA GML · global monthly mean CO₂",
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
              name: "September minimum (M km²)",
            },
          ]}
          layout={{
            ...plotStyle,
            yaxis: { ...plotStyle.yaxis, title: "Sea ice extent (M km²)" },
            hovermode: "x unified",
            annotations: [
              {
                xref: "paper",
                yref: "paper",
                x: 0,
                y: 1.08,
                showarrow: false,
                text: "NSIDC Sea Ice Index · Arctic September minimum",
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
        No data loaded. Start the backend on :8000.
      </div>
    );
  };

  const renderMiniChart = (source: ChartSource) => {
    if (source.kind === "temperature" && gistemp?.series?.length) {
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
    if (source.kind === "co2" && co2?.series?.length) {
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
    if (source.kind === "seaIce" && seaIce?.annual_minimum?.length) {
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
    return <div className="h-[200px] bg-white/5 rounded-lg animate-pulse" />;
  };

  const miniData = [
    { key: "temperature", name: "Global Temperature Anomaly", source: { kind: "temperature" } as ChartSource },
    { key: "co2", name: "Atmospheric CO₂", source: { kind: "co2" } as ChartSource },
    { key: "seaIce", name: "Arctic Sea Ice (Sept min)", source: { kind: "seaIce" } as ChartSource },
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
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {miniData.map((item) => (
          <div key={item.key} className="glass p-5">
            <h3 className="text-sm font-semibold mb-3">{item.name}</h3>
            {renderMiniChart(item.source)}
          </div>
        ))}
      </div>
    </div>
  );
}
