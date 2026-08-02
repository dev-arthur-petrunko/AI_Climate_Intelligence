"use client";

/**
 * EarthGlobe — 3D-планета на базі Three.js (React Three Fiber).
 * Використовує локальні текстури NASA Blue Marble (кольори) та bump map (рельєф).
 * Відображає маркери поточних кліматичних подій (пожежі, циклони, вулкани тощо)
 * з тултіпами при наведенні та легендою типів.
 */

import { useMemo, useState, useEffect, useCallback, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Stars } from "@react-three/drei";
import * as THREE from "three";
import { useI18n } from "@/lib/i18n";

/** Локальні текстури — гарантовано доступні, не залежать від CDN */
const EARTH_TEXTURE = "/earth/earth-blue-marble.jpg";
const EARTH_BUMP = "/earth/earth-topology.png";

/** Радіус планети в одиницях сцени */
const EARTH_RADIUS = 5;

/** Структура події для маркера на глобусі */
interface EventPoint {
  coordinates: [number, number];
  event_type?: string;
  severity?: string;
  location?: string;
  frp?: number;
}

/** Резервні події на випадок, якщо бекенд недоступний */
const fallbackEvents: EventPoint[] = [
  { coordinates: [-123.0, 49.5], event_type: "Wildfire", severity: "high", location: "British Columbia, Canada" },
  { coordinates: [-119.0, 38.5], event_type: "Wildfire", severity: "high", location: "California, USA" },
  { coordinates: [-60.0, -4.0], event_type: "Wildfire", severity: "high", location: "Amazonas, Brazil" },
  { coordinates: [22.0, 38.5], event_type: "Wildfire", severity: "high", location: "Greece" },
  { coordinates: [145.0, -19.0], event_type: "Wildfire", severity: "medium", location: "Queensland, Australia" },
  { coordinates: [-155.28, 19.42], event_type: "Volcano", severity: "high", location: "Kilauea, Hawaii" },
  { coordinates: [15.0, 37.75], event_type: "Volcano", severity: "medium", location: "Etna, Sicily" },
  { coordinates: [110.44, -7.54], event_type: "Volcano", severity: "high", location: "Merapi, Indonesia" },
  { coordinates: [76.27, 10.85], event_type: "Extreme Rainfall", severity: "high", location: "Kerala, India" },
  { coordinates: [-42.0, 72.0], event_type: "Arctic Ice Loss", severity: "high", location: "Greenland" },
  { coordinates: [90.41, 23.7], event_type: "Coastal Flood", severity: "high", location: "Bangladesh" },
  { coordinates: [12.34, 45.44], event_type: "Coastal Flood", severity: "medium", location: "Venice, Italy" },
];

/** Перетворення широти/довготи у 3D-позицію на сфері */
function latLonToVec3(lat: number, lon: number, radius: number): THREE.Vector3 {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta)
  );
}

/** Колір маркера за типом події (Aurora палітра) */
function eventColor(type?: string): string {
  switch ((type || "").toLowerCase()) {
    case "wildfire": return "#FF5C8A";
    case "cyclone": return "#7C4DFF";
    case "volcano": return "#FFC24D";
    case "extreme rainfall": return "#36A3FF";
    case "arctic ice loss": return "#C8D2E6";
    case "coastal flood": return "#2EE6A6";
    case "sea level": return "#FFC24D";
    case "ocean heat": return "#FF5C8A";
    case "ocean ph": return "#7C4DFF";
    case "antarctic ice": return "#29F2FF";
    default: return "#2EE6A6";
  }
}

/** Легенда типів подій та кліматичних точок */
interface LegendItem {
  key: string;
  color: string;
}

const LEGEND: LegendItem[] = [
  { key: "fire", color: "#FF5C8A" },
  { key: "cyclone", color: "#7C4DFF" },
  { key: "volcano", color: "#FFC24D" },
  { key: "rainfall", color: "#36A3FF" },
  { key: "ice", color: "#C8D2E6" },
  { key: "flood", color: "#2EE6A6" },
  { key: "seaLevel", color: "#FFC24D" },
  { key: "oceanHeat", color: "#FF5C8A" },
  { key: "ph", color: "#7C4DFF" },
];

/** Земля: кольори Blue Marble + рельєф bump map + атмосфера + маркери */
function Earth({
  events,
  autoRotate,
  onHover,
}: {
  events: EventPoint[];
  autoRotate: boolean;
  onHover: (ev: EventPoint | null) => void;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const [colorMap, setColorMap] = useState<THREE.Texture | null>(null);
  const [bumpMap, setBumpMap] = useState<THREE.Texture | null>(null);

  // Завантаження текстури кольорів та рельєфу
  useEffect(() => {
    let cancelled = false;
    const loader = new THREE.TextureLoader();

    // Кольорова карта має рендеритися в sRGB-просторі, інакше планета виглядає сірою
    loader.load(
      EARTH_TEXTURE,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 8;
        if (!cancelled) setColorMap(tex);
      },
      undefined,
      () => { /* фолбек — колір матеріалу */ }
    );

    // Bump map лишається лінійним (не колірний)
    loader.load(
      EARTH_BUMP,
      (tex) => { if (!cancelled) setBumpMap(tex); },
      undefined,
      () => { /* без рельєфу */ }
    );
    return () => { cancelled = true; };
  }, []);

  // Автообертання планети
  useFrame((_, delta) => {
    if (groupRef.current && autoRotate) {
      groupRef.current.rotation.y += delta * 0.06;
    }
  });

  return (
    <group ref={groupRef}>
      {/* Земля з текстурою та рельєфом */}
      <mesh>
        <sphereGeometry args={[EARTH_RADIUS, 64, 64]} />
        <meshPhongMaterial
          map={colorMap || undefined}
          bumpMap={bumpMap || undefined}
          bumpScale={0.25}
          color={colorMap ? "#ffffff" : "#1a2a4a"}
          specular="#222222"
          shininess={14}
        />
      </mesh>

      {/* Тонке ореол підсвічування континентів (емісія за текстурою) */}
      <mesh>
        <sphereGeometry args={[EARTH_RADIUS * 1.005, 64, 64]} />
        <meshBasicMaterial
          color="#29F2FF"
          transparent
          opacity={0.06}
          depthWrite={false}
        />
      </mesh>

      {/* Маркери подій */}
      {events.map((ev, i) => (
        <Marker key={i} ev={ev} onHover={onHover} />
      ))}

      {/* Атмосферне сяйво */}
      <mesh>
        <sphereGeometry args={[EARTH_RADIUS * 1.035, 64, 64]} />
        <meshPhongMaterial
          color="#7C4DFF"
          transparent
          opacity={0.14}
          side={THREE.BackSide}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

/** Маркер події на поверхні планети.
 * Кругла 3D-сфера з сяйвом. Масштаб підтримується таким, щоб при
 * наближенні камери маркер зменшувався відносно планети — так він
 * точніше вказує точку на поверхні.
 */
function Marker({
  ev,
  onHover,
}: {
  ev: EventPoint;
  onHover: (ev: EventPoint | null) => void;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const { camera } = useThree();

  const position = useMemo(
    () => latLonToVec3(ev.coordinates[1], ev.coordinates[0], EARTH_RADIUS * 1.002),
    [ev]
  );
  const color = eventColor(ev.event_type);

  // Масштабування за відстанню до камери: маркер лишається помітним,
  // але при zoom-in зменшується, щоб точніше показувати локалізацію.
  useFrame((state) => {
    if (!groupRef.current) return;
    const dist = camera.position.distanceTo(position);
    const t = state.clock.elapsedTime;
    // 13 — початкова відстань камери; 1.0 — базовий масштаб
    const scale = (dist / 13) * (1 + 0.12 * Math.sin(t * 3 + position.x));
    groupRef.current.scale.setScalar(scale);
  });

  // Проєкція позиції маркера у екранні координати для тултіпа
  const getScreenPos = () => {
    if (!groupRef.current) return null;
    const v = new THREE.Vector3();
    groupRef.current.getWorldPosition(v);
    v.project(camera);
    return {
      x: (v.x * 0.5 + 0.5) * window.innerWidth,
      y: (-v.y * 0.5 + 0.5) * window.innerHeight,
    };
  };

  const handleOver = (e: any) => {
    e.stopPropagation();
    onHover({ ...ev, _screen: getScreenPos() } as EventPoint);
  };

  return (
    <group ref={groupRef} position={position}>
      {/* Сяйво навколо маркера */}
      <mesh onPointerOver={handleOver} onPointerOut={() => onHover(null)}>
        <sphereGeometry args={[0.3, 16, 16]} />
        <meshBasicMaterial color={color} transparent opacity={0.2} depthWrite={false} />
      </mesh>
      {/* Ядро маркера */}
      <mesh onPointerOver={handleOver} onPointerOut={() => onHover(null)}>
        <sphereGeometry args={[0.12, 16, 16]} />
        <meshBasicMaterial color={color} />
      </mesh>
    </group>
  );
}

/** Сцена: світло, зірки, Земля, керування камерою */
function Scene({
  events,
  onHover,
}: {
  events: EventPoint[];
  onHover: (ev: EventPoint | null) => void;
}) {
  const [interacting, setInteracting] = useState(false);
  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[8, 4, 5]} intensity={1.8} color="#ffffff" />
      <directionalLight position={[-8, -3, -6]} intensity={0.35} color="#8B9AB5" />
      <pointLight position={[-10, -5, -5]} intensity={0.6} color="#7C4DFF" />
      <pointLight position={[0, 8, 0]} intensity={0.4} color="#2EE6A6" />
      <Stars radius={100} depth={50} count={4000} factor={4} fade speed={0.5} />
      <Earth events={events} autoRotate={!interacting} onHover={onHover} />
      <OrbitControls
        enableZoom={true}
        zoomSpeed={0.4}
        minDistance={8}
        maxDistance={18}
        enablePan={false}
        autoRotate={false}
        onStart={() => setInteracting(true)}
        onEnd={() => setInteracting(false)}
      />
    </>
  );
}

/**
 * Головний компонент глобуса — завантажує події з бекенду,
 * рендерить 3D-планету, легенду та тултіпи.
 */
export default function EarthGlobe() {
  const [events, setEvents] = useState<EventPoint[]>(fallbackEvents);
  const [hovered, setHovered] = useState<EventPoint | null>(null);
  const { t } = useI18n();

  /** Побудова океанічних кліматичних точок з API даних */
  const buildOceanPoints = useCallback(
    (sl: any, oh: any, ph: any, south: any): EventPoint[] => {
      const points: EventPoint[] = [];

      // Рівень моря — прибережні точки з поточним значенням
      const slValue = sl?.latest?.value;
      if (typeof slValue === "number") {
        const coasts: [number, number][] = [
          [-80.19, 25.76], // Miami
          [4.9, 52.37],    // Amsterdam
          [90.41, 23.7],   // Bangladesh
          [139.69, 35.68], // Tokyo
          [-43.21, -22.9], // Rio de Janeiro
        ];
        coasts.forEach(([lon, lat]) => {
          points.push({
            coordinates: [lon, lat],
            event_type: "Sea Level",
            severity: "medium",
            location: `${slValue >= 0 ? "+" : ""}${slValue.toFixed(1)} mm · ${t.globe.legend.seaLevel}`,
          });
        });
      }

      // Тепло океану — океанічні басейни
      const ohValue = oh?.latest?.value;
      if (typeof ohValue === "number") {
        const basins: [number, number][] = [
          [-140, 0],  // Pacific
          [-30, 10],  // Atlantic
          [80, -10],  // Indian
          [150, -30], // South Pacific
        ];
        basins.forEach(([lon, lat]) => {
          points.push({
            coordinates: [lon, lat],
            event_type: "Ocean Heat",
            severity: "high",
            location: `${ohValue.toFixed(0)} ZJ · ${t.globe.legend.oceanHeat}`,
          });
        });
      }

      // Закислення океану — станція Гаваї (джерело даних)
      const phValue = ph?.latest?.value;
      if (typeof phValue === "number") {
        points.push({
          coordinates: [-155.28, 19.42],
          event_type: "Ocean pH",
          severity: "medium",
          location: `pH ${phValue.toFixed(3)} · ${t.globe.legend.ph}`,
        });
      }

      // Антарктичний морський лід — південний полюс
      const southExtent = south?.latest?.extent;
      if (typeof southExtent === "number") {
        points.push({
          coordinates: [0, -78],
          event_type: "Antarctic Ice",
          severity: "low",
          location: `${southExtent.toFixed(2)}M km² · ${t.globe.legend.ice}`,
        });
      }

      return points;
    },
    [t]
  );

  /** Завантаження подій та океанічних даних з API бекенду */
  const load = useCallback(async () => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
    try {
      const [eventsRes, sl, oh, ph, south] = await Promise.all([
        fetch(`${apiUrl}/api/events`),
        fetch(`${apiUrl}/api/sea-level`).then((r) => (r.ok ? r.json() : null)),
        fetch(`${apiUrl}/api/ocean-heat`).then((r) => (r.ok ? r.json() : null)),
        fetch(`${apiUrl}/api/ocean-ph`).then((r) => (r.ok ? r.json() : null)),
        fetch(`${apiUrl}/api/sea-ice-south`).then((r) => (r.ok ? r.json() : null)),
      ]);
      const data = await eventsRes.json();
      const points: EventPoint[] = [];
      if (Array.isArray(data) && data.length > 0) {
        points.push(
          ...data.slice(0, 200).map((ev: any) => ({
            coordinates: ev.coordinates as [number, number],
            event_type: ev.event_type,
            severity: ev.severity,
            location: ev.location,
          }))
        );
      }
      points.push(...buildOceanPoints(sl, oh, ph, south));
      if (points.length > 0) {
        setEvents(points);
      }
    } catch {
      /* залишаємо резервні події */
    }
  }, [buildOceanPoints]);

  useEffect(() => {
    load();
    const id = setInterval(load, 120000);
    return () => clearInterval(id);
  }, [load]);

  // Перекладений тип події
  const oceanLegendKey = (type?: string) => {
    switch ((type || "").toLowerCase()) {
      case "sea level": return "seaLevel";
      case "ocean heat": return "oceanHeat";
      case "ocean ph": return "ph";
      case "antarctic ice": return "ice";
      default: return "";
    }
  };

  const eventLabel = (type?: string) =>
    (t.events as any)[type || ""] ||
    (t.globe.legend as any)[oceanLegendKey(type)] ||
    type ||
    "";

  // Позиція тултіпа
  const screen = (hovered as any)?._screen;

  // Перекладені підписи легенди
  const legendLabel = (key: string) =>
    (t.globe.legend as any)[key] ?? key;

  return (
    <div className="w-full h-full relative bg-[#070A16] overflow-hidden">
      <Canvas
        camera={{ position: [0, 0, 13], fov: 45 }}
        gl={{ antialias: true, toneMapping: THREE.NoToneMapping, toneMappingExposure: 1.2 }}
      >
        <Scene events={events} onHover={(ev) => setHovered(ev)} />
      </Canvas>

      {/* Легенда типів подій та кліматичних точок — над кнопкою прокрутки */}
      <div className="absolute bottom-16 left-1/2 -translate-x-1/2 glass rounded-full px-4 py-2 flex items-center gap-3 flex-wrap justify-center z-20">
        {LEGEND.map((item) => (
          <span key={item.key} className="flex items-center space-x-1.5 text-[10px] text-secondary">
            <span className="w-2 h-2 rounded-full inline-block" style={{ background: item.color }} />
            <span>{legendLabel(item.key)}</span>
          </span>
        ))}
      </div>

      {/* Кнопка прокрутки до дашборда — у самому низу екрана */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center">
        <button
          type="button"
          onClick={() =>
            document.getElementById("climate-dashboard")?.scrollIntoView({ behavior: "smooth" })
          }
          className="group relative flex items-center gap-2 rounded-full glass px-4 py-2.5 transition-all duration-500 hover:pr-6 hover:shadow-[0_0_40px_rgba(41,242,255,0.25)]"
          aria-label={t.globe.scrollToDashboard}
        >
          {/* Текст, що розкривається при наведенні */}
          <span className="max-w-0 overflow-hidden whitespace-nowrap text-[11px] uppercase tracking-[0.2em] text-accent-cyan opacity-0 transition-all duration-500 group-hover:max-w-[220px] group-hover:opacity-100 group-hover:mr-1">
            {t.globe.scrollToDashboard}
          </span>
          {/* Стрілка */}
          <span className="animate-bounce inline-flex text-accent-cyan transition-transform duration-300 group-hover:translate-y-0.5">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </span>
        </button>
      </div>

      {/* Тултіп при наведенні на маркер */}
      {hovered && screen && (
        <div
          className="absolute z-30 glass-strong rounded-xl px-3.5 py-2.5 max-w-[220px] pointer-events-none"
          style={{
            left: Math.min(screen.x + 14, window.innerWidth - 240),
            top: screen.y + 14,
            boxShadow: "0 8px 40px rgba(0,0,0,0.6)",
          }}
        >
          <div className="flex items-center space-x-2">
            <span className="w-2 h-2 rounded-full" style={{ background: eventColor(hovered.event_type) }} />
            <span className="text-sm font-semibold text-primary">
              {eventLabel(hovered.event_type)}
            </span>
          </div>
          {hovered.location && (
            <div className="mt-1 text-[11px] text-secondary">{hovered.location}</div>
          )}
          <div className="mt-1.5 text-[10px] font-mono text-secondary">
            {hovered.coordinates[0].toFixed(2)}°, {hovered.coordinates[1].toFixed(2)}°
          </div>
        </div>
      )}

      {/* Підказка про взаємодію */}
      <div className="absolute top-5 left-1/2 -translate-x-1/2 flex items-center space-x-1.5 text-[9px] text-secondary/60 uppercase tracking-[0.2em]">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald animate-pulse" />
        <span>{t.globe.hover}</span>
      </div>
    </div>
  );
}
