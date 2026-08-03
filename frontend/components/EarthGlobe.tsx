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
import { sunDirection } from "@/lib/solar";
import AsteroidField from "./AsteroidField";
import type { AsteroidObject } from "@/lib/api";

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
  time?: string;
}

/** Кешована перевірка "зменшеного руху" — вимикає пульсацію та дихання */
let reducedMotionCache: boolean | null = null;
function reducedMotion(): boolean {
  if (reducedMotionCache === null && typeof window !== "undefined") {
    reducedMotionCache = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }
  return reducedMotionCache === true;
}

/** Свіжість даних: live (подія/резервні дані) або за віком дати */
type Freshness = "live" | "fresh" | "stale" | "outdated";

function freshnessOf(time?: string): Freshness {
  if (!time) return "live";
  const t = Date.parse(time);
  if (Number.isNaN(t)) return "live";
  const days = (Date.now() - t) / 86400000;
  // Кліматичні індикатори (ocean heat/pH/sea level) оновлюються рідко —
  // найсвіжіше значення може мати дату попереднього року. Точку з датою
  // у поточному або минулому році вважаємо актуальною, а не "outdated".
  const years = new Date(t).getFullYear();
  const currentYear = new Date().getFullYear();
  if (years < currentYear - 1) return "outdated";
  if (days <= 400) return "fresh";
  if (days <= 800) return "stale";
  return "outdated";
}

/** Колір індикатора свіжості (Aurora палітра) */
const freshnessColor: Record<Freshness, string> = {
  live: "#2EE6A6",
  fresh: "#2EE6A6",
  stale: "#FFC24D",
  outdated: "#FF5C8A",
};

/** Резервні події на випадок, якщо бекенд недоступний (тільки реальні типи) */
const fallbackEvents: EventPoint[] = [
  { coordinates: [-123.0, 49.5], event_type: "Wildfire", severity: "high", location: "British Columbia, Canada" },
  { coordinates: [-119.0, 38.5], event_type: "Wildfire", severity: "high", location: "California, USA" },
  { coordinates: [-60.0, -4.0], event_type: "Wildfire", severity: "high", location: "Amazonas, Brazil" },
  { coordinates: [22.0, 38.5], event_type: "Wildfire", severity: "high", location: "Greece" },
  { coordinates: [145.0, -19.0], event_type: "Wildfire", severity: "medium", location: "Queensland, Australia" },
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
    case "severe storm": return "#29F2FF";
    case "volcano": return "#FFC24D";
    case "flood": return "#36A3FF";
    case "drought": return "#FF7043";
    case "dust storm": return "#D9A066";
    case "earthquake": return "#FF8A3D";
    case "landslide": return "#A1887F";
    case "ice": return "#C8D2E6";
    case "extreme rainfall": return "#36A3FF";
    case "arctic ice loss": return "#C8D2E6";
    case "coastal flood": return "#2EE6A6";
    case "sea level": return "#FFC24D";
    case "ocean heat": return "#FF7043";
    case "ocean ph": return "#00E5FF";
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
  { key: "storm", color: "#29F2FF" },
  { key: "volcano", color: "#FFC24D" },
  { key: "flood", color: "#36A3FF" },
  { key: "drought", color: "#FF7043" },
  { key: "dust", color: "#D9A066" },
  { key: "earthquake", color: "#FF8A3D" },
  { key: "landslide", color: "#A1887F" },
  { key: "ice", color: "#C8D2E6" },
  { key: "seaLevel", color: "#FFC24D" },
  { key: "oceanHeat", color: "#FF7043" },
  { key: "ph", color: "#00E5FF" },
  { key: "asteroid", color: "#36A3FF" },
];

/** Земля: кольори Blue Marble + рельєф bump map + атмосфера + маркери + астероїди */
function Earth({
  events,
  asteroids,
  autoRotate,
  onHover,
  sunRef,
}: {
  events: EventPoint[];
  asteroids: AsteroidObject[];
  autoRotate: boolean;
  onHover: (ev: EventPoint | any | null) => void;
  sunRef?: React.MutableRefObject<THREE.Vector3 | null>;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const atmosphereRef = useRef<THREE.MeshPhongMaterial>(null);
  const glowShellRef = useRef<THREE.MeshBasicMaterial>(null);
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

  // Автообертання планети, реальна позиція Сонця та "дихання" атмосферного сяйва.
  // Сонце обчислюється за фактичним UTC-часом (субсолярна точка) і повертається
  // разом із глобусом — тому термінатор день/ніч лишається географічно коректним
  // навіть при швидкому декоративному обертанні.
  useFrame((_, delta) => {
    const g = groupRef.current;
    if (g && autoRotate) {
      g.rotation.y += delta * 0.06;
    }
    // Напрямок на Сонце у локальній системі глобуса (необерненому)…
    const sub = sunDirection(new Date(), 1);
    // …а потім повертаємо разом із глобусом, щоб реальна сторона планети дивилася на Сонце.
    if (g && sunRef) {
      const rot = g.rotation.y;
      const cos = Math.cos(rot);
      const sin = Math.sin(rot);
      const x = sub[0] * cos - sub[2] * sin;
      const z = sub[0] * sin + sub[2] * cos;
      sunRef.current = new THREE.Vector3(x, sub[1], z);
    }
    // М'яка пульсація сяйва — вимкнена при reduced-motion
    if (reducedMotion()) return;
    const t = performance.now() / 1000;
    if (atmosphereRef.current) {
      atmosphereRef.current.opacity = 0.14 + 0.022 * Math.sin(t * 0.7);
    }
    if (glowShellRef.current) {
      glowShellRef.current.opacity = 0.06 + 0.022 * Math.sin(t * 0.7 + 1.3);
    }
  });

  return (
    <group ref={groupRef}>
      {/* Земля з текстурою та рельєфом.
          key примушує перестворити матеріал після завантаження текстури —
          інакше шейдер не перекомпілюється і планета лишається без текстури. */}
      <mesh>
        <sphereGeometry args={[EARTH_RADIUS, 64, 64]} />
        <meshPhongMaterial
          key={colorMap ? "textured" : "plain"}
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
          ref={glowShellRef}
          color="#29F2FF"
          transparent
          opacity={0.06}
          depthWrite={false}
        />
      </mesh>

      {/* Маркери подій */}
      {events.map((ev, i) => (
        <Marker key={i} ev={ev} onHover={onHover} index={i} />
      ))}

      {/* Навколоземні астероїди — анімовані орбіти */}
      <AsteroidField asteroids={asteroids} onHover={onHover} />

      {/* Атмосферне сяйво */}
      <mesh>
        <sphereGeometry args={[EARTH_RADIUS * 1.035, 64, 64]} />
        <meshPhongMaterial
          ref={atmosphereRef}
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
  index,
}: {
  ev: EventPoint;
  onHover: (ev: EventPoint | null) => void;
  index: number;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const glowMatRef = useRef<THREE.MeshBasicMaterial>(null);
  const coreMatRef = useRef<THREE.MeshBasicMaterial>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const ringMatRef = useRef<THREE.MeshBasicMaterial>(null);
  const { camera } = useThree();
  const [hovered, setHovered] = useState(false);

  const position = useMemo(
    () => latLonToVec3(ev.coordinates[1], ev.coordinates[0], EARTH_RADIUS * 1.002),
    [ev]
  );
  const color = eventColor(ev.event_type);
  // Старт появи маркера: каскадний вхід залежно від порядкового номера
  const enterDelay = useMemo(() => (index % 14) * 65, [index]);
  const enteredAt = useRef(0);

  // Масштабування за відстанню до камери: маркер лишається помітним,
  // але при zoom-in зменшується, щоб точніше показувати локалізацію.
  // Додатково: поява (pop-in), пульс розміру, розширення хвилі-кільця.
  useFrame((state) => {
    const g = groupRef.current;
    if (!g) return;
    const t = state.clock.elapsedTime;
    if (!enteredAt.current) enteredAt.current = t;
    const dist = camera.position.distanceTo(position);

    // Поява маркера: pop-in з ease-out cubic (≈0.4с)
    const age = t - enteredAt.current - enterDelay / 1000;
    const pop = age <= 0 ? 0 : Math.min(1, age / 0.4);
    const easePop = 1 - Math.pow(1 - pop, 3);
    g.visible = pop > 0.001;
    if (!g.visible) return;

    // При наведенні маркер злегка збільшується; завжди — м'яке "дихання"
    const hoverBoost = hovered ? 1.4 : 1;
    const breathe = reducedMotion() ? 1 : 1 + 0.09 * Math.sin(t * 2.6 + position.x);
    const scale = (dist / 13) * hoverBoost * (0.15 + 0.85 * easePop) * breathe;
    g.scale.setScalar(scale);

    // Яскравіше сяйво та біле ядро при наведенні
    if (glowMatRef.current) {
      glowMatRef.current.opacity = hovered ? 0.45 : 0.2;
    }
    if (coreMatRef.current) {
      coreMatRef.current.color.set(hovered ? "#ffffff" : color);
    }

    // Розширення "хвилі" навколо маркера — як сонер. Вимикається при reduced-motion.
    if (ringRef.current && ringMatRef.current) {
      if (!reducedMotion() && pop > 0.5) {
        const cycle = (t * 0.55 + index * 0.37) % 1;
        ringRef.current.scale.setScalar(0.9 + cycle * 2.1);
        ringMatRef.current.opacity = (1 - cycle) * (hovered ? 0.55 : 0.3);
        ringRef.current.visible = true;
      } else {
        ringRef.current.visible = false;
      }
    }
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
    setHovered(true);
    onHover({ ...ev, _screen: getScreenPos() } as EventPoint);
  };

  const handleOut = () => {
    setHovered(false);
    onHover(null);
  };

  return (
    <group ref={groupRef} position={position}>
      {/* Сяйво навколо маркера */}
      <mesh onPointerOver={handleOver} onPointerOut={handleOut}>
        <sphereGeometry args={[0.3, 12, 12]} />
        <meshBasicMaterial
          ref={glowMatRef}
          color={color}
          transparent
          opacity={0.2}
          depthWrite={false}
        />
      </mesh>
      {/* Ядро маркера */}
      <mesh onPointerOver={handleOver} onPointerOut={handleOut}>
        <sphereGeometry args={[0.12, 10, 10]} />
        <meshBasicMaterial ref={coreMatRef} color={color} />
      </mesh>
      {/* Хвиля-кільце — декоративне, не перехоплює наведення */}
      <mesh ref={ringRef} visible={false}>
        <sphereGeometry args={[0.5, 20, 20]} />
        <meshBasicMaterial
          ref={ringMatRef}
          color={color}
          transparent
          opacity={0}
          side={THREE.BackSide}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

/** Сцена: світло, зірки, Земля, керування камерою */
function Scene({
  events,
  asteroids,
  onHover,
}: {
  events: EventPoint[];
  asteroids: AsteroidObject[];
  onHover: (ev: EventPoint | any | null) => void;
}) {
  const [interacting, setInteracting] = useState(false);
  const sunRef = useRef<THREE.Vector3 | null>(null);
  return (
    <>
      <ambientLight intensity={0.35} />
      {/* Реальне Сонце: напрямок = субсолярна точка (UTC), освітлює денний бік */}
      <SunLight sunRef={sunRef} />
      <directionalLight position={[-8, -3, -6]} intensity={0.8} color="#8B9AB5" />
      <pointLight position={[-10, -5, -5]} intensity={0.6} color="#7C4DFF" />
      <pointLight position={[0, 8, 0]} intensity={0.4} color="#2EE6A6" />
      <Stars radius={100} depth={50} count={4000} factor={4} fade speed={0.5} />
      <Earth events={events} asteroids={asteroids} autoRotate={!interacting} onHover={onHover} sunRef={sunRef} />
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

/** Видиме Сонце + спрямоване світло з реальної субсолярної точки.
 *  Позиція світла читається з sunRef (обновлюється Землею кожен кадр).
 */
function SunLight({ sunRef }: { sunRef: React.MutableRefObject<THREE.Vector3 | null> }) {
  const lightRef = useRef<THREE.DirectionalLight>(null);
  const sunGroupRef = useRef<THREE.Group>(null);
  const sunMatRef = useRef<THREE.MeshBasicMaterial>(null);
  const haloMatRef = useRef<THREE.MeshBasicMaterial>(null);

  useFrame(() => {
    const dir = sunRef.current;
    if (!dir) return;
    const d = dir.clone().normalize();
    // Спрямоване світло з боку Сонця
    if (lightRef.current) {
      lightRef.current.position.copy(d.multiplyScalar(20));
      lightRef.current.target.position.set(0, 0, 0);
    }
    // Видиме Сонце далеко на орбіті, але ближче за межі камери
    if (sunGroupRef.current) {
      sunGroupRef.current.position.copy(dir.clone().normalize().multiplyScalar(16));
      sunGroupRef.current.lookAt(0, 0, 0);
    }
    // Пульсація сонячної корони
    if (sunMatRef.current && !reducedMotion()) {
      sunMatRef.current.opacity = 0.9 + 0.1 * Math.sin(performance.now() / 800);
    }
    if (haloMatRef.current && !reducedMotion()) {
      haloMatRef.current.opacity = 0.18 + 0.08 * Math.sin(performance.now() / 1200);
    }
  });

  return (
    <>
      <directionalLight ref={lightRef} intensity={4.2} color="#FFF4D6" />
      {/* Яскраве ядро Сонця */}
      <group ref={sunGroupRef}>
        <mesh>
          <sphereGeometry args={[0.45, 16, 16]} />
          <meshBasicMaterial ref={sunMatRef} color="#FFF9E6" toneMapped={false} />
        </mesh>
        {/* Гало/корона Сонця */}
        <mesh>
          <sphereGeometry args={[1.3, 24, 24]} />
          <meshBasicMaterial
            ref={haloMatRef}
            color="#FFD98A"
            transparent
            opacity={0.18}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            toneMapped={false}
          />
        </mesh>
      </group>
    </>
  );
}

/**
 * Головний компонент глобуса — завантажує події з бекенду,
 * рендерить 3D-планету, легенду та тултіпи.
 */
export default function EarthGlobe() {
  const [events, setEvents] = useState<EventPoint[]>(fallbackEvents);
  const [asteroids, setAsteroids] = useState<AsteroidObject[]>([]);
  const [hovered, setHovered] = useState<EventPoint | any | null>(null);
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
          const slDate = sl?.latest?.date;
          points.push({
            coordinates: [lon, lat],
            event_type: "Sea Level",
            severity: "medium",
            location: `${slValue >= 0 ? "+" : ""}${slValue.toFixed(1)} mm · ${t.globe.legend.seaLevel}${
              slDate ? ` · ${String(slDate).slice(0, 4)}` : ""
            }`,
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
          [-150, -30], // South Pacific (150E would sit on Australia)
        ];
        basins.forEach(([lon, lat]) => {
          points.push({
            coordinates: [lon, lat],
            event_type: "Ocean Heat",
            severity: "high",
            location: `${ohValue.toFixed(0)} ZJ · ${t.globe.legend.oceanHeat}${
              oh?.latest?.year != null ? ` · ${oh.latest.year}` : ""
            }`,
          });
        });
      }

      // Закислення океану — станція Гаваї (джерело даних)
      const phValue = ph?.latest?.value;
      if (typeof phValue === "number") {
        const phDate = ph?.latest?.date;
        points.push({
          coordinates: [-155.28, 19.42],
          event_type: "Ocean pH",
          severity: "medium",
          location: `pH ${phValue.toFixed(3)} · ${t.globe.legend.ph}${
            phDate ? ` · ${String(phDate).slice(0, 4)}` : ""
          }`,
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
          time: south?.latest?.date,
        });
      }

      return points;
    },
    [t]
  );

  /** Завантаження подій, EONET, астероїдів та океанічних даних з API бекенду */
  const load = useCallback(async () => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
    try {
      const [eventsRes, eonetRes, astRes, sl, oh, ph, south] = await Promise.all([
        fetch(`${apiUrl}/api/events`),
        fetch(`${apiUrl}/api/eonet?days=14`).catch(() => null),
        fetch(`${apiUrl}/api/asteroids?days=7`),
        fetch(`${apiUrl}/api/sea-level`).then((r) => (r.ok ? r.json() : null)),
        fetch(`${apiUrl}/api/ocean-heat`).then((r) => (r.ok ? r.json() : null)),
        fetch(`${apiUrl}/api/ocean-ph`).then((r) => (r.ok ? r.json() : null)),
        fetch(`${apiUrl}/api/sea-ice-south`).then((r) => (r.ok ? r.json() : null)),
      ]);
      const astData = await astRes.json().catch(() => null);
      if (astData && Array.isArray(astData.objects) && astData.objects.length > 0) {
        setAsteroids(astData.objects);
      }
      const points: EventPoint[] = [];

      // Поточні події з FIRMS/NOAA (пожежі, циклони)
      const data = await eventsRes.json().catch(() => null);
      if (Array.isArray(data) && data.length > 0) {
        points.push(
          ...data.slice(0, 160).map((ev: any) => ({
            coordinates: ev.coordinates as [number, number],
            event_type: ev.event_type,
            severity: ev.severity,
            location: ev.location,
            time: ev.time,
          }))
        );
      }

      // Події NASA EONET (природні катастрофи без ключа) — без Wildfire,
      // щоб не дублювати пожежі FIRMS на глобусі
      const eonet = eonetRes ? await eonetRes.json().catch(() => null) : null;
      if (eonet && Array.isArray(eonet.events)) {
        const eonetPoints: EventPoint[] = eonet.events
          .filter((e: any) => e.coordinates && e.event_type && e.event_type !== "Wildfire")
          .slice(0, 90)
          .map((e: any) => ({
            coordinates: e.coordinates as [number, number],
            event_type: e.event_type,
            severity: e.severity || "medium",
            location: e.title || e.location,
            time: e.time,
          }));
        points.push(...eonetPoints);
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

  // Свіжість даних маркера (для індикатора актуальності)
  const hoverFresh = freshnessOf(hovered?.time);
  const hoverFreshLabel =
    hoverFresh === "live"
      ? t.globe.liveTag
      : (t.globe.fresh as Record<string, string>)[hoverFresh];
  const hoverFreshColor = freshnessColor[hoverFresh];

  // Перекладені підписи легенди
  const legendLabel = (key: string) =>
    (t.globe.legend as any)[key] ?? key;

  // Переклади для тултіпа астероїдів
  const ast = t.asteroids as any;

  return (
    <div className="w-full h-full relative bg-[#070A16] overflow-hidden animate-fade-in">
      <Canvas
        camera={{ position: [0, 0, 13], fov: 45 }}
        gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.0 }}
      >
        <Scene events={events} asteroids={asteroids} onHover={(ev) => setHovered(ev)} />
      </Canvas>

      {/* Легенда типів подій та кліматичних точок — над кнопкою прокрутки */}
      <div className="absolute bottom-16 left-1/2 -translate-x-1/2 glass rounded-full px-4 py-2 flex items-center gap-3 flex-wrap justify-center z-20">
        {LEGEND.map((item, i) => (
          <span
            key={item.key}
            className="flex items-center space-x-1.5 text-[10px] text-secondary animate-fade-up"
            style={{ animationDelay: `${350 + i * 55}ms` }}
          >
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

      {/* Тултіп при наведенні на маркер або астероїд */}
      {hovered && screen && (
        <div
          key={hovered.kind === "asteroid" ? `ast-${hovered.name}` : `${hovered.event_type}-${hovered.location}-${hovered.time}`}
          className="absolute z-30 glass-strong rounded-xl px-3.5 py-2.5 max-w-[240px] pointer-events-none animate-tooltip-pop"
          style={{
            left: Math.min(screen.x + 14, window.innerWidth - 260),
            top: screen.y + 14,
            boxShadow: "0 8px 40px rgba(0,0,0,0.6)",
          }}
        >
          {hovered.kind === "asteroid" ? (
            <>
              {/* Заголовок астероїда */}
              <div className="flex items-center space-x-2">
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ background: hovered.hazardous ? "#FF5C8A" : "#36A3FF" }}
                />
                <span className="text-sm font-semibold text-primary truncate">{hovered.name}</span>
                {hovered.hazardous && (
                  <span className="shrink-0 px-1.5 py-px rounded bg-[#FF5D6C]/15 border border-[#FF5D6C]/30 text-[8px] font-bold uppercase tracking-wider text-[#FF5D6C]">
                    {ast.hazardous}
                  </span>
                )}
              </div>
              {/* Дані зближення */}
              <div className="mt-1.5 text-[11px] text-secondary">
                {ast.miss}:{" "}
                <span className="text-primary font-medium">
                  {hovered.miss_km != null ? `${(hovered.miss_km / 1e6).toFixed(1)}M km` : "—"}
                </span>
              </div>
              <div className="mt-0.5 text-[11px] text-secondary">
                {ast.velocity}:{" "}
                <span className="text-primary font-medium">
                  {hovered.velocity_kms != null ? `${hovered.velocity_kms.toFixed(1)} km/s` : "—"}
                </span>
              </div>
              <div className="mt-0.5 text-[11px] text-secondary">
                {ast.diameter}:{" "}
                <span className="text-primary font-medium">
                  {hovered.diameter_m_max != null ? `${Math.round(hovered.diameter_m_max)} m` : "—"}
                </span>
              </div>
              <div className="mt-0.5 text-[10px] text-secondary">
                {ast.approach}:{" "}
                <span className="text-primary/80">{hovered.approach_date || "—"}</span>
              </div>
            </>
          ) : (
            <>
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
              {/* Актуальність даних: час + індикатор свіжості */}
              <div className="mt-2 pt-1.5 border-t border-violet/15 flex items-center justify-between gap-2">
                <div className="flex items-center space-x-1.5 min-w-0">
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: hoverFreshColor }} />
                  <span className="text-[10px] text-secondary truncate">
                    {t.globe.updatedAt}: {hovered.time || "—"}
                  </span>
                </div>
                <span className="text-[10px] font-semibold shrink-0" style={{ color: hoverFreshColor }}>
                  {hoverFreshLabel}
                </span>
              </div>
            </>
          )}
        </div>
      )}

      {/* Підказка про взаємодію */}
      <div className="absolute top-5 left-1/2 -translate-x-1/2 flex items-center space-x-1.5 text-[9px] text-secondary/60 uppercase tracking-[0.2em]">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald ping-dot text-emerald" />
        <span>{t.globe.hover}</span>
      </div>
    </div>
  );
}
