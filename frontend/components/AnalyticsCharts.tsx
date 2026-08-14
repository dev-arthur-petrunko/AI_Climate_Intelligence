"use client";

import { useState, useEffect, useCallback, ReactNode } from "react";
import dynamic from "next/dynamic";
import { Globe, Sun, Orbit, Activity } from "lucide-react";
import {
  api,
  GISTEMPSeries,
  CO2Series,
  SeaIceData,
  SeaLevelData,
  OceanHeatData,
  OceanPhData,
  AsteroidsData,
  KpForecastData,
  GoesXrayData,
  SolarWindData,
  SolarCycleData,
  EarthquakesData,
  SchumannData,
} from "@/lib/api";
import { useI18n } from "@/lib/i18n";

// `any` навмисно: бібліотека react-plotly.js не має власних типів
// (потрібен @types/react-plotly.js), а динамічний імпорт обов'язковий для SSR.
const Plot: any = dynamic(() => import("react-plotly.js"), {
  ssr: false,
  loading: () => <div className="glass p-8">Loading chart...</div>,
});

function settle<T>(r: PromiseSettledResult<T>): T | null {
  return r.status === "fulfilled" ? r.value : null;
}

function Placeholder() {
  return <div className="h-[260px] bg-white/5 rounded-lg animate-pulse" />;
}

function Section({ icon: Icon, title, children }: { icon: any; title: string; children: ReactNode }) {
  return (
    <section className="glass-strong p-6 space-y-5">
      <div className="flex items-center gap-2.5">
        <Icon className="w-5 h-5 text-cyan" />
        <h2 className="text-lg font-bold text-gradient">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function ChartCard({ title, source, children }: { title: string; source?: string; children: ReactNode }) {
  return (
    <div className="glass p-5 flex flex-col">
      <h3 className="text-sm font-semibold mb-1">{title}</h3>
      {source && <div className="text-[10px] text-secondary/70 mb-3">{source}</div>}
      <div className="flex-1">{children}</div>
    </div>
  );
}

const MONTHS: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

function astroDateToIso(d: string): string {
  const m = d.match(/^(\d{4})-([A-Z][a-z]{2})-(\d{2})/);
  if (!m) return d;
  return `${m[1]}-${MONTHS[m[2]] || "01"}-${m[3]}`;
}

function kpColor(v: number | undefined | null): string {
  if (v == null) return "#28E08F";
  if (v >= 7) return "#FF5D6C";
  if (v >= 5) return "#FFB648";
  if (v >= 4) return "#FFC24D";
  return "#28E08F";
}

type ChartId =
  | "temperature"
  | "co2"
  | "seaIce"
  | "seaIceSouth"
  | "seaLevel"
  | "oceanHeat"
  | "oceanPh";

/**
 * Аналітичні графіки — інтерактивні Plotly-графіки за розділами:
 * Планета (клімат), Космос (космічна погода), Загроза астероїдів,
 * Небезпеки Землі (землетруси).
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
  const [asteroids, setAsteroids] = useState<AsteroidsData | null>(null);
  const [kp, setKp] = useState<KpForecastData | null>(null);
  const [flares, setFlares] = useState<GoesXrayData | null>(null);
  const [wind, setWind] = useState<SolarWindData | null>(null);
  const [scycle, setScycle] = useState<SolarCycleData | null>(null);
  const [eqs, setEqs] = useState<EarthquakesData | null>(null);
  const [schumann, setSchumann] = useState<SchumannData | null>(null);
  const { t } = useI18n();
  const ch = t.charts;
  const sw = t.spaceWeather;
  const ast = t.asteroids;
  const ew = t.earthWeather;

  const load = useCallback(async () => {
    const [g, c, s, ss, sl, oh, ph, astr, kpr, flr, wnd, sc, eq, sch] = await Promise.allSettled([
      api.gistemp(),
      api.co2(),
      api.seaIce(),
      api.seaIceSouth(),
      api.seaLevel(),
      api.oceanHeat(),
      api.oceanPh(),
      api.asteroids(7),
      api.kpForecast(),
      api.solarFlares(),
      api.solarWind(),
      api.solarCycle(),
      api.earthquakes(),
      api.schumann(),
    ]);
    setGistemp(settle(g));
    setCo2(settle(c));
    setSeaIce(settle(s));
    setSeaIceSouth(settle(ss));
    setSeaLevel(settle(sl));
    setOceanHeat(settle(oh));
    setOceanPh(settle(ph));
    setAsteroids(settle(astr));
    setKp(settle(kpr));
    setFlares(settle(flr));
    setWind(settle(wnd));
    setScycle(settle(sc));
    setEqs(settle(eq));
    setSchumann(settle(sch));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

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

  const charts = [
    { id: "temperature" as ChartId, label: ch.temperature },
    { id: "co2" as ChartId, label: ch.co2 },
    { id: "seaIce" as ChartId, label: ch.seaIce },
    { id: "seaIceSouth" as ChartId, label: ch.seaIceSouth },
    { id: "seaLevel" as ChartId, label: ch.seaLevel },
    { id: "oceanHeat" as ChartId, label: ch.oceanHeat },
    { id: "oceanPh" as ChartId, label: ch.oceanPh },
  ];

  const renderMainChart = () => {
    if (activeChart === "temperature" && gistemp?.series?.length) {
      return (
        <Plot
          data={[{
            x: gistemp.series.map((d) => d.year),
            y: gistemp.series.map((d) => d.value),
            type: "scatter",
            mode: "lines",
            line: { color: "#36A3FF", width: 2 },
            fill: "tozeroy",
            fillcolor: "rgba(54, 163, 255, 0.12)",
            name: ch.temperature,
          }]}
          layout={{
            ...plotStyle,
            yaxis: { ...plotStyle.yaxis, title: ch.tempAxis },
            hovermode: "x unified",
            annotations: [{ xref: "paper", yref: "paper", x: 0, y: 1.08, showarrow: false, text: ch.tempSource, font: { size: 11, color: "#8B9AB5" } }],
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
          data={[{
            x: co2.series.map((d) => d.year + (d.month - 1) / 12),
            y: co2.series.map((d) => d.value),
            type: "scatter",
            mode: "lines",
            line: { color: "#FF5D6C", width: 2 },
            fill: "tozeroy",
            fillcolor: "rgba(255, 93, 108, 0.12)",
            name: ch.co2,
          }]}
          layout={{
            ...plotStyle,
            yaxis: { ...plotStyle.yaxis, title: ch.co2Axis },
            hovermode: "x unified",
            annotations: [{ xref: "paper", yref: "paper", x: 0, y: 1.08, showarrow: false, text: ch.co2Source, font: { size: 11, color: "#8B9AB5" } }],
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
          data={[{
            x: seaIce.annual_minimum.map((d) => d.year),
            y: seaIce.annual_minimum.map((d) => d.value),
            type: "scatter",
            mode: "lines+markers",
            line: { color: "#29F2FF", width: 2 },
            marker: { color: "#29F2FF", size: 4 },
            name: ch.seaIceShort,
          }]}
          layout={{
            ...plotStyle,
            yaxis: { ...plotStyle.yaxis, title: ch.seaIceAxis },
            hovermode: "x unified",
            annotations: [{ xref: "paper", yref: "paper", x: 0, y: 1.08, showarrow: false, text: ch.seaIceSource, font: { size: 11, color: "#8B9AB5" } }],
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
          data={[{
            x: seaIceSouth.annual_minimum.map((d) => d.year),
            y: seaIceSouth.annual_minimum.map((d) => d.value),
            type: "scatter",
            mode: "lines+markers",
            line: { color: "#2EE6A6", width: 2 },
            marker: { color: "#2EE6A6", size: 4 },
            name: ch.seaIceSouthShort,
          }]}
          layout={{
            ...plotStyle,
            yaxis: { ...plotStyle.yaxis, title: ch.seaIceAxis },
            hovermode: "x unified",
            annotations: [{ xref: "paper", yref: "paper", x: 0, y: 1.08, showarrow: false, text: ch.seaIceSouthSource, font: { size: 11, color: "#8B9AB5" } }],
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
          data={[{
            x: seaLevel.series.map((d) => d.date),
            y: seaLevel.series.map((d) => d.value),
            type: "scatter",
            mode: "lines",
            line: { color: "#FFC24D", width: 2 },
            fill: "tozeroy",
            fillcolor: "rgba(255, 194, 77, 0.12)",
            name: ch.seaLevelShort,
          }]}
          layout={{
            ...plotStyle,
            yaxis: { ...plotStyle.yaxis, title: ch.seaLevelAxis },
            hovermode: "x unified",
            annotations: [{ xref: "paper", yref: "paper", x: 0, y: 1.08, showarrow: false, text: ch.seaLevelSource, font: { size: 11, color: "#8B9AB5" } }],
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
          data={[{
            x: oceanHeat.series.map((d) => d.year),
            y: oceanHeat.series.map((d) => d.value),
            type: "scatter",
            mode: "lines",
            line: { color: "#FF5C8A", width: 2 },
            fill: "tozeroy",
            fillcolor: "rgba(255, 92, 138, 0.12)",
            name: ch.oceanHeatShort,
          }]}
          layout={{
            ...plotStyle,
            yaxis: { ...plotStyle.yaxis, title: ch.oceanHeatAxis },
            hovermode: "x unified",
            annotations: [{ xref: "paper", yref: "paper", x: 0, y: 1.08, showarrow: false, text: ch.oceanHeatSource, font: { size: 11, color: "#8B9AB5" } }],
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
          data={[{
            x: oceanPh.series.map((d) => d.date),
            y: oceanPh.series.map((d) => d.value),
            type: "scatter",
            mode: "lines",
            line: { color: "#7C4DFF", width: 2 },
            fill: "tozeroy",
            fillcolor: "rgba(124, 77, 255, 0.12)",
            name: ch.oceanPhShort,
          }]}
          layout={{
            ...plotStyle,
            yaxis: { ...plotStyle.yaxis, title: ch.oceanPhAxis },
            hovermode: "x unified",
            annotations: [{ xref: "paper", yref: "paper", x: 0, y: 1.08, showarrow: false, text: ch.oceanPhSource, font: { size: 11, color: "#8B9AB5" } }],
          }}
          style={{ width: "100%", height: "420px" }}
          useResizeHandler
          config={{ responsive: true, displayModeBar: false }}
        />
      );
    }
    return (
      <div className="flex items-center justify-center h-[420px] text-secondary text-sm">
        {ch.noData}
      </div>
    );
  };

  const renderMiniChart = (id: ChartId) => {
    if (id === "temperature" && gistemp?.series?.length) {
      const series = gistemp.series.slice(-24);
      return (
        <Plot
          data={[{ x: series.map((d) => d.year), y: series.map((d) => d.value), type: "scatter", mode: "lines", line: { color: "#36A3FF", width: 2 } }]}
          layout={{ ...plotStyle, margin: { t: 10, r: 10, b: 30, l: 45 }, showlegend: false }}
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
          data={[{ x: series.map((d) => d.year + (d.month - 1) / 12), y: series.map((d) => d.value), type: "scatter", mode: "lines", line: { color: "#FF5D6C", width: 2 } }]}
          layout={{ ...plotStyle, margin: { t: 10, r: 10, b: 30, l: 45 }, showlegend: false }}
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
          data={[{ x: series.map((d) => d.year), y: series.map((d) => d.value), type: "scatter", mode: "lines", line: { color: "#29F2FF", width: 2 } }]}
          layout={{ ...plotStyle, margin: { t: 10, r: 10, b: 30, l: 45 }, showlegend: false }}
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
          data={[{ x: series.map((d) => d.year), y: series.map((d) => d.value), type: "scatter", mode: "lines", line: { color: "#2EE6A6", width: 2 } }]}
          layout={{ ...plotStyle, margin: { t: 10, r: 10, b: 30, l: 45 }, showlegend: false }}
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
          data={[{ x: series.map((d) => d.date), y: series.map((d) => d.value), type: "scatter", mode: "lines", line: { color: "#FFC24D", width: 2 } }]}
          layout={{ ...plotStyle, margin: { t: 10, r: 10, b: 30, l: 45 }, showlegend: false }}
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
          data={[{ x: series.map((d) => d.year), y: series.map((d) => d.value), type: "scatter", mode: "lines", line: { color: "#FF5C8A", width: 2 } }]}
          layout={{ ...plotStyle, margin: { t: 10, r: 10, b: 30, l: 45 }, showlegend: false }}
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
          data={[{ x: series.map((d) => d.date), y: series.map((d) => d.value), type: "scatter", mode: "lines", line: { color: "#7C4DFF", width: 2 } }]}
          layout={{ ...plotStyle, margin: { t: 10, r: 10, b: 30, l: 45 }, showlegend: false }}
          style={{ width: "100%", height: "200px" }}
          useResizeHandler
          config={{ responsive: true, displayModeBar: false }}
        />
      );
    }
    return <div className="h-[200px] bg-white/5 rounded-lg animate-pulse" />;
  };

  const miniData = [
    { key: "temperature" as ChartId, name: ch.temperatureFull },
    { key: "co2" as ChartId, name: ch.co2 },
    { key: "seaIce" as ChartId, name: ch.seaIceShort },
    { key: "seaIceSouth" as ChartId, name: ch.seaIceSouthShort },
    { key: "seaLevel" as ChartId, name: ch.seaLevelShort },
    { key: "oceanHeat" as ChartId, name: ch.oceanHeatShort },
    { key: "oceanPh" as ChartId, name: ch.oceanPhShort },
  ];

  /* ---------- Космос: Kp forecast ---------- */
  const renderKpForecast = () => {
    const fore = (kp?.forecast || []).filter((p) => p.time_tag && p.kp != null);
    if (!fore.length) return <Placeholder />;
    return (
      <Plot
        data={[{
          x: fore.map((p) => p.time_tag),
          y: fore.map((p) => p.kp),
          type: "bar",
          marker: { color: fore.map((p) => kpColor(p.kp)) },
          hovertemplate: "%{x}<br>Kp <b>%{y}</b><extra></extra>",
        }]}
        layout={{
          ...plotStyle,
          yaxis: { ...plotStyle.yaxis, title: sw.kp },
          bargap: 0.35,
        }}
        style={{ width: "100%", height: "260px" }}
        useResizeHandler
        config={{ responsive: true, displayModeBar: false }}
      />
    );
  };

  /* ---------- Космос: рентгенівський потік Сонця ---------- */
  const renderSolarFlares = () => {
    const ser = (flares?.series || []).filter((p) => p.time_tag && p.flux != null);
    if (!ser.length) return <Placeholder />;
    return (
      <Plot
        data={[{
          x: ser.map((p) => p.time_tag),
          y: ser.map((p) => p.flux),
          type: "scatter",
          mode: "lines",
          line: { color: "#FFC24D", width: 1.5 },
          fill: "tozeroy",
          fillcolor: "rgba(255, 194, 77, 0.08)",
          name: sw.xrayFlux,
        }]}
        layout={{
          ...plotStyle,
          yaxis: { ...plotStyle.yaxis, type: "log", title: sw.xrayFlux },
          hovermode: "x unified",
        }}
        style={{ width: "100%", height: "260px" }}
        useResizeHandler
        config={{ responsive: true, displayModeBar: false }}
      />
    );
  };

  /* ---------- Космос: швидкість сонячного вітру (24 год) ---------- */
  const renderSolarWind = () => {
    const ser = (wind?.series || []).filter((p) => p.time_tag && p.speed != null);
    if (!ser.length) return <Placeholder />;
    return (
      <Plot
        data={[{
          x: ser.map((p) => p.time_tag),
          y: ser.map((p) => p.speed),
          type: "scatter",
          mode: "lines",
          line: { color: "#29F2FF", width: 1.5 },
          fill: "tozeroy",
          fillcolor: "rgba(41, 242, 255, 0.08)",
          name: sw.solarWind,
        }]}
        layout={{
          ...plotStyle,
          yaxis: { ...plotStyle.yaxis, title: sw.windSpeed },
          hovermode: "x unified",
        }}
        style={{ width: "100%", height: "260px" }}
        useResizeHandler
        config={{ responsive: true, displayModeBar: false }}
      />
    );
  };

  /* ---------- Космос: сонячний цикл (SSN + F10.7) ---------- */
  const renderSolarCycle = () => {
    const ser = (scycle?.series || []).filter((p) => p.time_tag && p.ssn != null);
    if (!ser.length) return <Placeholder />;
    return (
      <Plot
        data={[
          {
            x: ser.map((p) => p.time_tag),
            y: ser.map((p) => p.ssn),
            type: "scatter",
            mode: "lines",
            line: { color: "#FF5C8A", width: 2 },
            name: sw.sunspot,
            hovertemplate: "%{x}<br>SSN <b>%{y}</b><extra></extra>",
          },
          {
            x: ser.map((p) => p.time_tag),
            y: ser.map((p) => p.f10_7),
            type: "scatter",
            mode: "lines",
            line: { color: "#36A3FF", width: 1.5, dash: "dot" },
            name: sw.f107,
            yaxis: "y2",
            hovertemplate: "%{x}<br>F10.7 <b>%{y}</b><extra></extra>",
          },
        ]}
        layout={{
          ...plotStyle,
          yaxis: { ...plotStyle.yaxis, title: sw.sunspot },
          yaxis2: {
            title: sw.f107,
            overlaying: "y",
            side: "right",
            gridcolor: "rgba(0,0,0,0)",
            color: "#8B9AB5",
          },
          hovermode: "x unified",
        }}
        style={{ width: "100%", height: "260px" }}
        useResizeHandler
        config={{ responsive: true, displayModeBar: false }}
      />
    );
  };

  /* ---------- Астероїди ---------- */
  const astroObjs = (asteroids?.objects || []).filter((o) => o.miss_km != null && o.approach_date);
  const hazCount = astroObjs.filter((o) => o.hazardous).length;

  const renderAstroTimeline = () => {
    if (!astroObjs.length) return <Placeholder />;
    return (
      <Plot
        data={[{
          x: astroObjs.map((o) => astroDateToIso(o.approach_date)),
          y: astroObjs.map((o) => o.miss_km! / 1e6),
          type: "scatter",
          mode: "markers",
          marker: {
            size: astroObjs.map((o) => Math.min(22, 5 + Math.log10((o.diameter_m_max ?? 10) + 1) * 4)),
            color: astroObjs.map((o) => (o.hazardous ? "#FF5D6C" : "#36A3FF")),
            line: { color: "rgba(255,255,255,0.15)", width: 1 },
          },
          hovertext: astroObjs.map((o) => o.name),
          hovertemplate: "<b>%{hovertext}</b><br>miss: %{y:.2f} M km<extra></extra>",
        }]}
        layout={{
          ...plotStyle,
          yaxis: { ...plotStyle.yaxis, type: "log", title: ch.astMissAxis },
          xaxis: { ...plotStyle.xaxis, type: "date" },
          showlegend: false,
        }}
        style={{ width: "100%", height: "260px" }}
        useResizeHandler
        config={{ responsive: true, displayModeBar: false }}
      />
    );
  };

  const renderAstroHazard = () => {
    if (!astroObjs.length) return <Placeholder />;
    return (
      <Plot
        data={[{
          type: "pie",
          labels: [ast.hazardous, ch.astSafe],
          values: [hazCount, Math.max(0, astroObjs.length - hazCount)],
          hole: 0.55,
          marker: { colors: ["#FF5D6C", "#36A3FF"] },
          textinfo: "label+percent",
          textfont: { size: 11, color: "#F5F7FA" },
          hoverinfo: "label+value",
        }]}
        layout={{
          ...plotStyle,
          margin: { t: 10, r: 10, b: 10, l: 10 },
          showlegend: false,
          annotations: [
            {
              xref: "paper", yref: "paper", x: 0.5, y: 0.5, showarrow: false,
              text: `<b>${astroObjs.length}</b><br><span style="font-size:10px">${ch.astNum}</span>`,
              font: { size: 16, color: "#F5F7FA" },
            },
          ],
        }}
        style={{ width: "100%", height: "260px" }}
        useResizeHandler
        config={{ responsive: true, displayModeBar: false }}
      />
    );
  };

  const renderAstroSize = () => {
    const sizes = astroObjs.map((o) => o.diameter_m_max).filter((s): s is number => s != null);
    if (!sizes.length) return <Placeholder />;
    return (
      <Plot
        data={[{
          type: "histogram",
          x: sizes,
          nbinsx: 12,
          marker: { color: "rgba(54, 163, 255, 0.55)" },
          hovertemplate: "<b>%{x} m</b><br>count: %{y}<extra></extra>",
        }]}
        layout={{
          ...plotStyle,
          yaxis: { ...plotStyle.yaxis, title: ch.astNum },
          xaxis: { ...plotStyle.xaxis, title: ch.astSizeAxis },
        }}
        style={{ width: "100%", height: "260px" }}
        useResizeHandler
        config={{ responsive: true, displayModeBar: false }}
      />
    );
  };

  const renderAstroSpeedSize = () => {
    const pts = astroObjs.filter((o) => o.diameter_m_max != null && o.velocity_kms != null);
    if (!pts.length) return <Placeholder />;
    return (
      <Plot
        data={[{
          x: pts.map((o) => o.diameter_m_max),
          y: pts.map((o) => o.velocity_kms),
          type: "scatter",
          mode: "markers",
          marker: {
            size: pts.map((o) => Math.min(18, 4 + Math.log10((o.diameter_m_max ?? 10) + 1) * 4)),
            color: pts.map((o) => (o.hazardous ? "#FF5D6C" : "#36A3FF")),
            line: { color: "rgba(255,255,255,0.15)", width: 1 },
          },
          hovertext: pts.map((o) => o.name),
          hovertemplate: "<b>%{hovertext}</b><br>size: %{x:.0f} m<br>speed: %{y:.1f} km/s<extra></extra>",
        }]}
        layout={{
          ...plotStyle,
          xaxis: { ...plotStyle.xaxis, title: ch.astSizeAxis },
          yaxis: { ...plotStyle.yaxis, title: ch.astSpeedAxis },
          showlegend: false,
        }}
        style={{ width: "100%", height: "260px" }}
        useResizeHandler
        config={{ responsive: true, displayModeBar: false }}
      />
    );
  };

  /* ---------- Землетруси ---------- */
  const eqObjects = (eqs?.earthquakes || []).filter((e) => e.time && e.magnitude != null);

  const renderEqTimeline = () => {
    if (!eqObjects.length) return <Placeholder />;
    const depths = eqObjects.map((e) => e.depth_km ?? 0);
    return (
      <Plot
        data={[{
          x: eqObjects.map((e) => new Date(e.time!).toISOString()),
          y: eqObjects.map((e) => e.magnitude),
          type: "scatter",
          mode: "markers",
          marker: {
            size: eqObjects.map((e) => Math.max(6, (e.magnitude ?? 0) * 3.2)),
            color: depths,
            colorscale: "Jet",
            showscale: true,
            colorbar: { title: ch.eqDepthAxis, thickness: 10, len: 0.8, outlinewidth: 0 },
            line: { color: "rgba(255,255,255,0.2)", width: 0.6 },
          },
          hovertext: eqObjects.map((e) => `${e.place}${e.tsunami ? ` · ${ch.tsun}` : ""}`),
          hovertemplate: "<b>%{hovertext}</b><br>M %{y} · depth %{marker.color} km<extra></extra>",
        }]}
        layout={{
          ...plotStyle,
          yaxis: { ...plotStyle.yaxis, title: ew.magnitude },
          xaxis: { ...plotStyle.xaxis, type: "date" },
          showlegend: false,
        }}
        style={{ width: "100%", height: "260px" }}
        useResizeHandler
        config={{ responsive: true, displayModeBar: false }}
      />
    );
  };

  const renderEqHist = () => {
    const mags = eqObjects.map((e) => e.magnitude).filter((m): m is number => m != null);
    if (!mags.length) return <Placeholder />;
    return (
      <Plot
        data={[{
          type: "histogram",
          x: mags,
          nbinsx: 18,
          marker: { color: "rgba(255, 93, 108, 0.55)" },
          hovertemplate: "<b>M %{x}</b><br>count: %{y}<extra></extra>",
        }]}
        layout={{
          ...plotStyle,
          yaxis: { ...plotStyle.yaxis, title: ch.eqCount },
          xaxis: { ...plotStyle.xaxis, title: ew.magnitude },
        }}
        style={{ width: "100%", height: "260px" }}
        useResizeHandler
        config={{ responsive: true, displayModeBar: false }}
      />
    );
  };

  const closestAstros = [...astroObjs].sort((a, b) => (a.miss_km ?? Infinity) - (b.miss_km ?? Infinity)).slice(0, 5);
  const maxEqMag = eqObjects.length ? Math.max(...eqObjects.map((e) => e.magnitude ?? 0)) : null;

  return (
    <div className="space-y-8">
      {/* Розділ 1: Планета та клімат */}
      <Section icon={Globe} title={ch.sectionPlanet}>
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
        <div className="glass p-6">{renderMainChart()}</div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {miniData.map((item) => (
            <div key={item.key} className="glass p-5">
              <h3 className="text-sm font-semibold mb-3">{item.name}</h3>
              {renderMiniChart(item.key)}
            </div>
          ))}
        </div>
      </Section>

      {/* Розділ 2: Космічна погода */}
      <Section icon={Sun} title={ch.sectionSpace}>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <ChartCard title={sw.kpForecast} source={sw.sourceNASA}>
            {renderKpForecast()}
          </ChartCard>
          <ChartCard title={sw.flares} source={sw.sourceNASA}>
            {renderSolarFlares()}
          </ChartCard>
          <ChartCard title={`${sw.solarWind} (24 h)`} source={sw.sourceNASA}>
            {renderSolarWind()}
          </ChartCard>
          <ChartCard title={sw.solarCycle} source={sw.sourceNASA}>
            {renderSolarCycle()}
          </ChartCard>
        </div>
        {schumann && !schumann.error && (
          <div className="glass p-5">
            <h3 className="text-sm font-semibold mb-3">{sw.schumann}</h3>
            <div className="grid grid-cols-3 gap-3">
              <div className="px-3 py-2 rounded-lg bg-white/[0.03] border border-white/5 text-center">
                <div className="text-[9px] text-secondary uppercase tracking-wider">{sw.schumannFreq}</div>
                <div className="text-lg font-bold font-mono text-[#36A3FF]">
                  {schumann.schumann_frequency_hz != null ? `${schumann.schumann_frequency_hz.toFixed(2)} Hz` : "—"}
                </div>
              </div>
              <div className="px-3 py-2 rounded-lg bg-white/[0.03] border border-white/5 text-center">
                <div className="text-[9px] text-secondary uppercase tracking-wider">{sw.schumannIndex}</div>
                <div className="text-lg font-bold font-mono text-primary">
                  {schumann.schumann_index != null ? schumann.schumann_index : "—"}
                </div>
              </div>
              <div className="px-3 py-2 rounded-lg bg-white/[0.03] border border-white/5 text-center">
                <div className="text-[9px] text-secondary uppercase tracking-wider">{sw.activityIndex}</div>
                <div className="text-lg font-bold font-mono" style={{ color: kpColor(schumann.activity_index) }}>
                  {schumann.activity_index != null ? schumann.activity_index : "—"}
                </div>
              </div>
            </div>
            <div className="mt-2 text-[10px] text-secondary/70">{sw.sourceResonance}</div>
          </div>
        )}
      </Section>

      {/* Розділ 3: Загроза астероїдів */}
      <Section icon={Orbit} title={ch.sectionAsteroids}>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span className="glass px-3 py-1.5 rounded-full text-secondary">
            {ast.title}: <b className="text-primary font-mono">{astroObjs.length}</b> {ch.astNum}
          </span>
          <span className="glass px-3 py-1.5 rounded-full text-[#FF5D6C]">
            {ast.hazardous}: <b className="font-mono">{hazCount}</b>
          </span>
          <span className="glass px-3 py-1.5 rounded-full text-secondary">
            {ch.astSource}
          </span>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <ChartCard title={ch.astTimeline} source={ch.astSource}>
            {renderAstroTimeline()}
          </ChartCard>
          <ChartCard title={ch.astHazard} source={ch.astSource}>
            {renderAstroHazard()}
          </ChartCard>
          <ChartCard title={ch.astSize} source={ch.astSource}>
            {renderAstroSize()}
          </ChartCard>
          <ChartCard title={ch.astSpeedSize} source={ch.astSource}>
            {renderAstroSpeedSize()}
          </ChartCard>
        </div>
        {closestAstros.length > 0 && (
          <div className="glass p-5">
            <h3 className="text-sm font-semibold mb-3">{ch.astClosest}</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-secondary/70 border-b border-white/5 text-left">
                    <th className="py-2 pr-3 font-medium">{ast.title}</th>
                    <th className="py-2 pr-3 font-medium">{ch.astMissAxis}</th>
                    <th className="py-2 pr-3 font-medium">{ast.velocity}</th>
                    <th className="py-2 pr-3 font-medium">{ast.diameter}</th>
                    <th className="py-2 font-medium">{ast.hazardous}</th>
                  </tr>
                </thead>
                <tbody>
                  {closestAstros.map((o) => (
                    <tr key={o.name} className="border-b border-white/5 last:border-0">
                      <td className="py-2 pr-3 text-primary truncate max-w-[160px]">{o.name}</td>
                      <td className="py-2 pr-3 font-mono text-secondary">{(o.miss_km ?? 0) / 1e6 >= 10 ? `${((o.miss_km ?? 0) / 1e6).toFixed(0)} M` : `${((o.miss_km ?? 0) / 1e6).toFixed(2)} M`} km</td>
                      <td className="py-2 pr-3 font-mono text-secondary">{o.velocity_kms != null ? `${o.velocity_kms.toFixed(1)} km/s` : "—"}</td>
                      <td className="py-2 pr-3 font-mono text-secondary">{o.diameter_m_max != null ? `${Math.round(o.diameter_m_max)} m` : "—"}</td>
                      <td className="py-2">
                        {o.hazardous ? (
                          <span className="px-1.5 py-px rounded bg-[#FF5D6C]/15 border border-[#FF5D6C]/30 text-[9px] font-bold uppercase text-[#FF5D6C]">{ast.hazardous}</span>
                        ) : (
                          <span className="px-1.5 py-px rounded bg-emerald/15 border border-emerald/30 text-[9px] font-bold uppercase text-emerald">{ch.astSafe}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Section>

      {/* Розділ 4: Небезпеки Землі */}
      <Section icon={Activity} title={ch.sectionHazards}>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span className="glass px-3 py-1.5 rounded-full text-secondary">
            {ew.earthquakes}: <b className="text-primary font-mono">{eqs?.count ?? eqObjects.length}</b> {ch.eqCount}
          </span>
          {maxEqMag != null && (
            <span className="glass px-3 py-1.5 rounded-full text-secondary">
              Max M: <b className="text-primary font-mono">{maxEqMag.toFixed(1)}</b>
            </span>
          )}
          <span className="glass px-3 py-1.5 rounded-full text-secondary">{sw.sourceUSGS}</span>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <ChartCard title={ch.eqTimeline} source={sw.sourceUSGS}>
            {renderEqTimeline()}
          </ChartCard>
          <ChartCard title={ch.eqHist} source={sw.sourceUSGS}>
            {renderEqHist()}
          </ChartCard>
        </div>
      </Section>
    </div>
  );
}
