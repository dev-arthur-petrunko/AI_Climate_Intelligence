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
import { moonDirection } from "@/lib/moon";
import AsteroidField, { AsteroidEntry, asteroidThreatColor } from "./AsteroidField";
import type { AsteroidObject, ClimateEvent, OceanHeatData, OceanPhData, SeaIceData, SeaLevelData, CO2Series } from "@/lib/api";

/** Локальні текстури — гарантовано доступні, не залежать від CDN */
const EARTH_TEXTURE = "/earth/earth-blue-marble.jpg";
const EARTH_BUMP = "/earth/earth-topology.png";

/** Радіус планети в одиницях сцени */
const EARTH_RADIUS = 5;

/** Місяць: дистанція та радіус (художній масштаб, щоб був видимий у кадрі) */
const MOON_DISTANCE = 42;
const MOON_RADIUS = 1.9;

/** Швидкість авто-обертання камери (рад/с). Time-based: ~300 с на повний оберт,
 *  однакова на будь-якій частоті кадрів (60/120/144 Гц). Уповільнено, щоб
 *  планета оберталася спокійніше; Сонце й Місяць при цьому лишаються на
 *  реальних позиціях (у світових координатах) і не прив'язані до камери. */
const ROTATE_RAD_PER_SEC = (Math.PI * 2) / 300;

/** Структура події для маркера на глобусі */
interface EventPoint {
  coordinates: [number, number];
  event_type?: string;
  severity?: string;
  location?: string;
  frp?: number;
  time?: string;
  confidence?: string;
  satellite?: string;
  ongoing?: boolean;
}

/** Службовий об'єкт під курсором — подія Землі або астероїд (для тултіпа).
 *  `_id` та `_screen` додає HoverController під час screen-space проекції. */
interface HoveredPoint {
  kind?: "asteroid";
  // Поля події Землі
  event_type?: string;
  severity?: string;
  location?: string;
  time?: string;
  coordinates?: [number, number];
  frp?: number;
  confidence?: string;
  satellite?: string;
  ongoing?: boolean;
  // Поля астероїда
  name?: string;
  hazardous?: boolean;
  miss_km?: number | null;
  velocity_kms?: number | null;
  diameter_m_max?: number | null;
  approach_date?: string;
  // Службові поля hover-контролера
  _id: string;
  _screen: { x: number; y: number };
}

/** Подія NASA EONET у сирому вигляді з відповіді бекенду */
interface RawEonetEvent {
  coordinates?: [number, number] | null;
  event_type?: string;
  severity?: string;
  title?: string;
  location?: string;
  time?: string;
  status?: string;
}

/** Записи у реєстрах для hover-контролера (screen-space proximity) */
interface MarkerEntry {
  ev: EventPoint;
  ref: { readonly current: THREE.Group | null };
}

/** Радіус (px), у якому маркер/астероїд «ловить» курсор для тултіпа */
const HOVER_RADIUS = 60;

/** Стабільний ідентифікатор маркера для hover-підсвітки та тултіпа.
 *  Координати включені, бо пожежі можуть мати однакові type/location/time
 *  (напр. кілька hotspot-ів у межах одного міста за одну добу). */
function markerId(ev: EventPoint): string {
  const c = ev.coordinates
    ? `${ev.coordinates[0].toFixed(3)}|${ev.coordinates[1].toFixed(3)}`
    : "";
  return `m:${ev.event_type || ""}|${ev.location || ""}|${ev.time || ""}|${c}`;
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

function freshnessOf(time?: string, ongoing?: boolean): Freshness {
  if (ongoing) return "live";
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
  { coordinates: [-123.0, 49.5], event_type: "Wildfire", severity: "high", location: "British Columbia, Canada", time: new Date().toISOString().slice(0, 10) },
  { coordinates: [-119.0, 38.5], event_type: "Wildfire", severity: "high", location: "California, USA", time: new Date().toISOString().slice(0, 10) },
  { coordinates: [-60.0, -4.0], event_type: "Wildfire", severity: "high", location: "Amazonas, Brazil", time: new Date().toISOString().slice(0, 10) },
  { coordinates: [22.0, 38.5], event_type: "Wildfire", severity: "high", location: "Greece", time: new Date().toISOString().slice(0, 10) },
  { coordinates: [145.0, -19.0], event_type: "Wildfire", severity: "medium", location: "Queensland, Australia", time: new Date().toISOString().slice(0, 10) },
];

/** Резервні астероїди — коли API без NASA_API_KEY повертає порожній список.
 *  Всі типи/розміри реалістичні (типові навколоземні об'єкти). */
const fallbackAsteroids: AsteroidObject[] = [
  { name: "2024 CA1", hazardous: false, approach_date: "today", miss_km: 3.2e7, velocity_kms: 14.2, diameter_m_min: 45, diameter_m_max: 110 },
  { name: "2024 RB2", hazardous: true, approach_date: "today", miss_km: 7.8e6, velocity_kms: 19.6, diameter_m_min: 180, diameter_m_max: 420 },
  { name: "2024 JF3", hazardous: false, approach_date: "today", miss_km: 5.6e7, velocity_kms: 9.8, diameter_m_min: 30, diameter_m_max: 75 },
  { name: "2024 XT7", hazardous: false, approach_date: "tomorrow", miss_km: 4.1e7, velocity_kms: 16.1, diameter_m_min: 60, diameter_m_max: 140 },
  { name: "2024 MN9", hazardous: true, approach_date: "tomorrow", miss_km: 1.2e7, velocity_kms: 22.4, diameter_m_min: 240, diameter_m_max: 540 },
  { name: "2024 QH2", hazardous: false, approach_date: "in 2 days", miss_km: 6.4e7, velocity_kms: 11.5, diameter_m_min: 25, diameter_m_max: 60 },
  { name: "2024 LW5", hazardous: false, approach_date: "in 3 days", miss_km: 3.9e7, velocity_kms: 13.7, diameter_m_min: 55, diameter_m_max: 130 },
  { name: "2024 KZ8", hazardous: true, approach_date: "in 4 days", miss_km: 9.4e6, velocity_kms: 21.8, diameter_m_min: 200, diameter_m_max: 460 },
  { name: "2024 HE6", hazardous: false, approach_date: "in 5 days", miss_km: 5.1e7, velocity_kms: 12.9, diameter_m_min: 40, diameter_m_max: 95 },
  { name: "2024 GQ4", hazardous: false, approach_date: "in 6 days", miss_km: 4.7e7, velocity_kms: 15.3, diameter_m_min: 70, diameter_m_max: 160 },
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
    case "arctic ice": return "#C8D2E6";
    case "extreme rainfall": return "#36A3FF";
    case "arctic ice loss": return "#C8D2E6";
    case "coastal flood": return "#2EE6A6";
    case "sea level": return "#FFC24D";
    case "ocean heat": return "#FF7043";
    case "ocean ph": return "#00E5FF";
    case "antarctic ice": return "#29F2FF";
    case "atmospheric co₂": return "#FFB648";
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
  { key: "co2", color: "#FFB648" },
  { key: "asteroidHazard", color: "#FF5D6C" },
  { key: "asteroidWatch", color: "#FFB648" },
  { key: "asteroidSafe", color: "#28E08F" },
];

/** Земля: кольори Blue Marble + рельєф bump map + атмосфера + маркери + астероїди */
function Earth({
  events,
  asteroids,
  hovered,
  sunRef,
  markerRegistry,
  asteroidRegistry,
}: {
  events: EventPoint[];
  asteroids: AsteroidObject[];
  hovered: HoveredPoint | null;
  sunRef?: React.MutableRefObject<THREE.Vector3 | null>;
  markerRegistry: React.MutableRefObject<MarkerEntry[]>;
  asteroidRegistry: React.MutableRefObject<AsteroidEntry[]>;
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
  // Сонце обчислюється за фактичним UTC-часом (субсолярна точка) і лишається
  // нерухомим у світових координатах (далеко, на своїй реальній позиції).
  // Земля не обертається навколо своєї осі, тому субсолярна довгота завжди
  // дивиться на Сонце — термінатор день/ніч відповідає реальному часу доби
  // і географії (які регіони зараз удень).
  useFrame((_, delta) => {
    // Напрямок на Сонце у світових координатах — фіксований за реальним часом (UTC).
    if (sunRef) {
      const sub = sunDirection(new Date(), 1);
      sunRef.current = new THREE.Vector3(sub[0], sub[1], sub[2]);
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
      <mesh raycast={() => null}>
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
        <Marker key={i} ev={ev} index={i} markerRegistry={markerRegistry} active={hovered?._id === markerId(ev)} />
      ))}

      {/* Навколоземні астероїди — анімовані орбіти */}
      <AsteroidField
        asteroids={asteroids}
        asteroidRegistry={asteroidRegistry}
        activeId={hovered?._id}
      />

      {/* Атмосферне сяйво */}
      <mesh raycast={() => null}>
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
 * Тултіп та підсвітка при наведенні обробляються через screen-space
 * proximity (HoverController), а не через raycast R3F — це надійніше.
 */
function Marker({
  ev,
  index,
  markerRegistry,
  active,
}: {
  ev: EventPoint;
  index: number;
  markerRegistry: React.MutableRefObject<MarkerEntry[]>;
  active: boolean;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const glowMatRef = useRef<THREE.MeshBasicMaterial>(null);
  const coreMatRef = useRef<THREE.MeshBasicMaterial>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const ringMatRef = useRef<THREE.MeshBasicMaterial>(null);
  const { camera } = useThree();

  // Реєстрація маркера у спільному реєстрі для screen-space hover.
  // Записи оновлюються при зміні ev (оновлення даних з API).
  useEffect(() => {
    const entry: MarkerEntry = { ev, ref: groupRef };
    markerRegistry.current.push(entry);
    return () => {
      markerRegistry.current = markerRegistry.current.filter((x) => x !== entry);
    };
  }, [ev, markerRegistry]);

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

    // При наведенні маркер злегка збільшується; завжди — ледь помітне "дихання"
    const hoverBoost = active ? 1.2 : 1;
    const breathe = reducedMotion() ? 1 : 1 + 0.04 * Math.sin(t * 1.8 + position.x);
    // Маркери компактні: не закривають поверхню планети, але лишаються помітними.
    // Масштаб пропорційний відстані до камери, при zoom-in зменшується.
    const scale = (dist / 15) * hoverBoost * (0.35 + 0.45 * easePop) * breathe;
    g.scale.setScalar(scale);

    // М'якше сяйво та біле ядро при наведенні
    if (glowMatRef.current) {
      glowMatRef.current.opacity = active ? 0.4 : 0.2;
    }
    if (coreMatRef.current) {
      coreMatRef.current.color.set(active ? "#ffffff" : color);
    }

    // Повільне розширення "хвилі" навколо маркера — ледь помітне. Вимикається при reduced-motion.
    if (ringRef.current && ringMatRef.current) {
      if (!reducedMotion() && pop > 0.5) {
        const cycle = (t * 0.3 + index * 0.37) % 1;
        ringRef.current.scale.setScalar(0.8 + cycle * 1.6);
        ringMatRef.current.opacity = (1 - cycle) * (active ? 0.3 : 0.12);
        ringRef.current.visible = true;
      } else {
        ringRef.current.visible = false;
      }
    }
  });

  return (
    <group ref={groupRef} position={position}>
      {/* Сяйво навколо маркера */}
      <mesh>
        <sphereGeometry args={[0.15, 12, 12]} />
        <meshBasicMaterial
          ref={glowMatRef}
          color={color}
          transparent
          opacity={0.2}
          depthWrite={false}
        />
      </mesh>
      {/* Ядро маркера */}
      <mesh>
        <sphereGeometry args={[0.065, 10, 10]} />
        <meshBasicMaterial ref={coreMatRef} color={color} />
      </mesh>
      {/* Хвиля-кільце — декоративне, не перехоплює наведення */}
      <mesh ref={ringRef} visible={false} raycast={() => null}>
        <sphereGeometry args={[0.26, 20, 20]} />
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

/** Screen-space proximity hover: детерміновано визначає, над яким маркером/астероїдом
 *  перебуває курсор, проєктуючи світові позиції на екран (без raycast R3F).
 *  Враховує видимість (лише передня півкуля планети) та обирає найближчий об'єкт
 *  у радіусі HOVER_RADIUS px. Це гарантує роботу тултіпів незалежно від
 *  внутрішньої системи подій R3F.
 *  Клік по маркеру відкриває вікно з детальною інформацією (onSelect).
 *  Фолбэк: якщо реестр маркерів порожній — проециуємо безпосередньо з масиву events. */
function HoverController({
  markers,
  asteroids,
  events,
  onHover,
  onSelect,
}: {
  markers: React.MutableRefObject<MarkerEntry[]>;
  asteroids: React.MutableRefObject<AsteroidEntry[]>;
  events: EventPoint[];
  onHover: (ev: HoveredPoint | null) => void;
  onSelect: (ev: HoveredPoint | null) => void;
}) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const size = useThree((s) => s.size);
  const onHoverRef = useRef(onHover);
  onHoverRef.current = onHover;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  // Остання позиція курсора у координатах канваса (null — курсор поза канвасом)
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const lastEmit = useRef<{ key: string; x: number; y: number } | null>(null);

  // Спільний пошук найближчого маркера/астероїда під точкою (screen-space проекція).
  // Використовується і для hover (кожен кадр), і для кліку (відкриття вікна).
  const findBest = useCallback(
    (px: number, py: number): HoveredPoint | null => {
      const v = new THREE.Vector3();
      const pv = new THREE.Vector3();
      const w = size.width;
      const h = size.height;
      let bestDist = HOVER_RADIUS;
      let bestKey = "";
      let best: HoveredPoint | null = null;

      const scanMarkers = (list: MarkerEntry[]) => {
        for (const m of list) {
          const g = m.ref.current;
          if (!g || !g.visible) continue;
          g.getWorldPosition(v);
          if (v.dot(camera.position) < 0) continue;
          pv.copy(v).project(camera);
          if (pv.z > 1) continue;
          const sx = (pv.x * 0.5 + 0.5) * w;
          const sy = (-pv.y * 0.5 + 0.5) * h;
          const d = Math.hypot(sx - px, sy - py);
          if (d < bestDist) {
            bestDist = d;
            bestKey = markerId(m.ev);
            best = { ...m.ev, _id: bestKey, _screen: { x: sx, y: sy } };
          }
        }
      };
      const scanEvents = (list: EventPoint[]) => {
        for (const ev of list) {
          const pos = latLonToVec3(ev.coordinates[1], ev.coordinates[0], EARTH_RADIUS * 1.002);
          v.copy(pos);
          if (v.dot(camera.position) < 0) continue;
          pv.copy(v).project(camera);
          if (pv.z > 1) continue;
          const sx = (pv.x * 0.5 + 0.5) * w;
          const sy = (-pv.y * 0.5 + 0.5) * h;
          const d = Math.hypot(sx - px, sy - py);
          if (d < bestDist) {
            bestDist = d;
            bestKey = markerId(ev);
            best = { ...ev, _id: bestKey, _screen: { x: sx, y: sy } };
          }
        }
      };
      const scanAsteroids = (list: AsteroidEntry[]) => {
        for (const a of list) {
          const g = a.ref.current;
          if (!g || !g.visible) continue;
          g.getWorldPosition(v);
          if (v.dot(camera.position) < 0) continue;
          pv.copy(v).project(camera);
          if (pv.z > 1) continue;
          const sx = (pv.x * 0.5 + 0.5) * w;
          const sy = (-pv.y * 0.5 + 0.5) * h;
          const d = Math.hypot(sx - px, sy - py);
          if (d < bestDist) {
            bestDist = d;
            bestKey = `a:${a.obj.name}`;
            best = { ...a.obj, kind: "asteroid", _id: bestKey, _screen: { x: sx, y: sy } };
          }
        }
      };

      if (markers.current.length > 0) {
        scanMarkers(markers.current);
      }
      // Фолбек: якщо реєстр порожній (mount timing) — проєкція напряму з events
      if (bestDist === HOVER_RADIUS && markers.current.length === 0) {
        scanEvents(events);
      }
      scanAsteroids(asteroids.current);
      return best;
    },
    [camera, size.width, size.height, markers, asteroids, events]
  );

  useEffect(() => {
    const el = gl.domElement;
    const onMove = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      pointer.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    const onLeave = () => {
      pointer.current = null;
      lastEmit.current = null;
      onHoverRef.current(null);
    };
    // Клік по маркеру/астероїду — відкриває вікно з деталями
    const onClick = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      const hit = findBest(e.clientX - rect.left, e.clientY - rect.top);
      if (hit) onSelectRef.current(hit);
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    el.addEventListener("click", onClick);
    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      el.removeEventListener("click", onClick);
    };
  }, [gl, findBest]);

  useFrame(() => {
    const p = pointer.current;
    // При першому кадрі, якщо курсор ще не отриманий (user ще не рухав мишкою),
    // все одно проецируємо перший маркер/астероїд і показуємо тултіп (накладно для доступу та дебагу).
    const isFirstFrameWithoutPointer = !p && size.width > 0 && size.height > 0;
    if (isFirstFrameWithoutPointer && events.length > 0) {
      // Показуємо тултіп на ПЕРШІМ маркері з подій Землі (wildfire, cyclone тощо)
      const ev = events[0];
      const v = new THREE.Vector3();
      const pos = latLonToVec3(ev.coordinates[1], ev.coordinates[0], EARTH_RADIUS * 1.002);
      v.copy(pos);
      if (v.dot(camera.position) < 0) return;
      const pv = new THREE.Vector3().copy(v).project(camera);
      if (pv.z > 1) return;
      const sx = (pv.x * 0.5 + 0.5) * size.width;
      const sy = (-pv.y * 0.5 + 0.5) * size.height;
      const key = markerId(ev);
      // Емітимо лише при зміні об'єкта або русі — інакше тултіп «залипає»
      // при першому русі миші по порожньому простору.
      if (
        !lastEmit.current ||
        lastEmit.current.key !== key ||
        Math.abs(lastEmit.current.x - sx) > 4 ||
        Math.abs(lastEmit.current.y - sy) > 4
      ) {
        lastEmit.current = { key, x: sx, y: sy };
        onHoverRef.current({ ...ev, _id: key, _screen: { x: sx, y: sy } });
      }
      return;
    }
    if (!p) return;
    const best = findBest(p.x, p.y);
    if (best) {
      const s = best._screen;
      const prev = lastEmit.current;
      // Пере-емітимо лише при зміні об'єкта або помітному русі тултіпа
      if (!prev || prev.key !== best._id || Math.abs(prev.x - s.x) > 4 || Math.abs(prev.y - s.y) > 4) {
        lastEmit.current = { key: best._id, x: s.x, y: s.y };
        onHoverRef.current(best);
      }
    } else if (lastEmit.current) {
      lastEmit.current = null;
      onHoverRef.current(null);
    }
  });

  return null;
}

/** Сцена: світло, зірки, Земля, керування камерою */
function Scene({
  events,
  asteroids,
  onHover,
  onSelect,
  hovered,
  markerRegistry,
  asteroidRegistry,
}: {
  events: EventPoint[];
  asteroids: AsteroidObject[];
  onHover: (ev: HoveredPoint | null) => void;
  onSelect: (ev: HoveredPoint | null) => void;
  hovered: HoveredPoint | null;
  markerRegistry: React.MutableRefObject<MarkerEntry[]>;
  asteroidRegistry: React.MutableRefObject<AsteroidEntry[]>;
}) {
  const sunRef = useRef<THREE.Vector3 | null>(null);
  return (
    <>
      <ambientLight intensity={0.35} />
      {/* Реальне Сонце: напрямок = субсолярна точка (UTC), освітлює денний бік */}
      <SunLight sunRef={sunRef} />
      <directionalLight position={[-8, -3, -6]} intensity={0.8} color="#8B9AB5" />
      <pointLight position={[-10, -5, -5]} intensity={0.6} color="#7C4DFF" />
      <pointLight position={[0, 8, 0]} intensity={0.4} color="#2EE6A6" />
      <Stars radius={100} depth={50} count={10000} factor={2} fade speed={0.5} />
      <Earth
        events={events}
        asteroids={asteroids}
        hovered={hovered}
        sunRef={sunRef}
        markerRegistry={markerRegistry}
        asteroidRegistry={asteroidRegistry}
      />
      {/* Місяць на реальній сублунарній позиції (фаза — від освітлення Сонцем) */}
      <Moon />
      {/* Screen-space hover: проєктує маркери/астероїди на екран і обирає найближчий
          до курсора — детерміновано, незалежно від raycast R3F.
          *  Фолбэк: якщо pointer.current ще null (first frame), все одно обчислюємо дальнішу позицію
          *  і даємо user feedback, щоб тултіпи почали працювати без очіку на перший `pointermove`. */}
      <HoverController
        markers={markerRegistry}
        asteroids={asteroidRegistry}
        events={events}
        onHover={onHover}
        onSelect={onSelect}
      />
      <OrbitControls
        enableZoom={true}
        zoomSpeed={0.4}
        minDistance={8}
        maxDistance={18}
        enablePan={false}
        enableDamping={false}
      />
      <IdleOrbit />
    </>
  );
}

/** Плавне авто-обертання камери навколо планети. Time-based (рад/с), тому
 *  швидкість не залежить від частоти кадрів монітора. Виконується до
 *  `controls.update()` (priority -2 < -1), тож OrbitControls перечитує нову
 *  позицію камери і коректно зберігає зум/нахил та взаємодію користувача. */
function IdleOrbit() {
  useFrame((state, delta) => {
    const a = Math.min(delta, 0.1) * ROTATE_RAD_PER_SEC;
    if (a <= 0) return;
    const p = state.camera.position;
    const x = p.x * Math.cos(a) + p.z * Math.sin(a);
    const z = -p.x * Math.sin(a) + p.z * Math.cos(a);
    p.set(x, p.y, z);
  }, -2);
  return null;
}

/** Видиме Сонце + спрямоване світло з реальної субсолярної точки.
 *  Позиція читається з sunRef (фіксована у світових координатах, оновлюється Землею).
 *  Сонце знаходиться далеко — як справжнє джерело світла, а не орбітальний супутник.
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
      lightRef.current.position.copy(d.multiplyScalar(100));
      lightRef.current.target.position.set(0, 0, 0);
    }
    // Видиме Сонце — далеко, щоб виглядало як реальне джерело світла
    if (sunGroupRef.current) {
      sunGroupRef.current.position.copy(dir.clone().normalize().multiplyScalar(60));
      sunGroupRef.current.lookAt(0, 0, 0);
    }
    // Пульсація сонячної корони
    if (sunMatRef.current && !reducedMotion()) {
      sunMatRef.current.opacity = 0.9 + 0.1 * Math.sin(performance.now() / 800);
    }
    if (haloMatRef.current && !reducedMotion()) {
      haloMatRef.current.opacity = 0.14 + 0.06 * Math.sin(performance.now() / 1200);
    }
  });

  return (
    <>
      <directionalLight ref={lightRef} intensity={3.6} color="#FFF4D6" />
      {/* Яскраве ядро Сонця */}
      <group ref={sunGroupRef}>
        <mesh>
          <sphereGeometry args={[1.1, 16, 16]} />
          <meshBasicMaterial ref={sunMatRef} color="#FFF9E6" toneMapped={false} />
        </mesh>
        {/* Гало/корона Сонця */}
        <mesh>
          <sphereGeometry args={[3.2, 24, 24]} />
          <meshBasicMaterial
            ref={haloMatRef}
            color="#FFD98A"
            transparent
            opacity={0.14}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            toneMapped={false}
          />
        </mesh>
        {/* Промені сонця — тонкі діагональні смуги */}
        <mesh rotation={[0, 0, Math.PI / 4]}>
          <boxGeometry args={[7, 0.02, 0.02]} />
          <meshBasicMaterial color="#FFE9A8" transparent opacity={0.12} depthWrite={false} toneMapped={false} />
        </mesh>
        <mesh rotation={[0, 0, -Math.PI / 4]}>
          <boxGeometry args={[7, 0.02, 0.02]} />
          <meshBasicMaterial color="#FFE9A8" transparent opacity={0.12} depthWrite={false} toneMapped={false} />
        </mesh>
      </group>
    </>
  );
}

/** Проксіювана текстура Місяця: база, шум, темні моря та кратери на canvas. */
function createMoonTexture(): THREE.CanvasTexture {
  const W = 512;
  const H = 256;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;

  // База
  ctx.fillStyle = "#b4b8c0";
  ctx.fillRect(0, 0, W, H);

  // Дрібний шум
  for (let i = 0; i < 14000; i++) {
    const x = Math.random() * W;
    const y = Math.random() * H;
    const s = 70 + Math.floor(Math.random() * 90);
    ctx.fillStyle = `rgba(${s},${s},${s + 6},0.4)`;
    ctx.fillRect(x, y, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }

  // Темні "моря"
  const maria: [number, number, number][] = [
    [0.42, 0.34, 0.17],
    [0.64, 0.27, 0.13],
    [0.5, 0.6, 0.11],
    [0.27, 0.54, 0.09],
    [0.72, 0.49, 0.08],
    [0.55, 0.42, 0.06],
  ];
  for (const [mx, my, mr] of maria) {
    const g = ctx.createRadialGradient(mx * W, my * H, 2, mx * W, my * H, mr * W);
    g.addColorStop(0, "rgba(96,100,112,0.55)");
    g.addColorStop(1, "rgba(96,100,112,0)");
    ctx.fillStyle = g;
    ctx.fillRect(mx * W - mr * W, my * H - mr * H, mr * W * 2, mr * H * 2);
  }

  // Кратери
  for (let i = 0; i < 46; i++) {
    const x = Math.random() * W;
    const y = Math.random() * H;
    const r = 2 + Math.random() * 6;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.07)";
    ctx.fill();
    ctx.strokeStyle = "rgba(58,62,72,0.55)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Місяць на реальній сублунарній позиції (Meeus), у світових координатах.
 *  Фаза відтворюється природно: Місяць освітлюється тим самим світлом Сонця.
 *  Позиція перераховується за фактичним UTC-часом, як і для Сонця, тому Місяць
 *  рухається з реальною швидкістю (~13°/добу) і не прив'язаний до камери. */
function Moon() {
  const groupRef = useRef<THREE.Group>(null);
  const tex = useMemo(() => (typeof document !== "undefined" ? createMoonTexture() : null), []);

  useFrame(() => {
    const d = moonDirection(new Date(), 1);
    const g = groupRef.current;
    if (!g) return;
    g.position.set(d[0] * MOON_DISTANCE, d[1] * MOON_DISTANCE, d[2] * MOON_DISTANCE);
    g.lookAt(0, 0, 0);
  });

  return (
    <group ref={groupRef}>
      <mesh raycast={() => null}>
        <sphereGeometry args={[MOON_RADIUS, 32, 32]} />
        <meshPhongMaterial
          key={tex ? "textured" : "plain"}
          map={tex || undefined}
          color={tex ? "#ffffff" : "#b0b4bc"}
          specular="#333333"
          shininess={6}
        />
      </mesh>
    </group>
  );
}

/**
 * Головний компонент глобуса — завантажує події з бекенду,
 * рендерить 3D-планету, легенду та тултіпи.
 */
export default function EarthGlobe() {
  const [events, setEvents] = useState<EventPoint[]>(fallbackEvents);
  const [asteroids, setAsteroids] = useState<AsteroidObject[]>(fallbackAsteroids);
  const [hovered, setHovered] = useState<HoveredPoint | null>(null);
  const [selected, setSelected] = useState<HoveredPoint | null>(null);
  const markerRegistry = useRef<MarkerEntry[]>([]);
  const asteroidRegistry = useRef<AsteroidEntry[]>([]);
  const { t } = useI18n();

  /** Побудова океанічних кліматичних точок з API даних */
  const buildOceanPoints = useCallback(
    (
      sl: SeaLevelData | null,
      oh: OceanHeatData | null,
      ph: OceanPhData | null,
      south: SeaIceData | null,
      north: SeaIceData | null,
      co2: CO2Series | null
    ): EventPoint[] => {
      const points: EventPoint[] = [];

      // CO₂ — Мона-Лоя (джерело даних NOAA)
      const co2Value = co2?.latest?.value;
      if (typeof co2Value === "number") {
        const co2Date = co2?.latest?.year && co2?.latest?.month
          ? `${co2.latest.year}-${String(co2.latest.month).padStart(2, "0")}`
          : undefined;
        points.push({
          coordinates: [-155.58, 19.54],
          event_type: "Atmospheric CO₂",
          severity: "high",
          location: `${co2Value.toFixed(1)} ppm · ${t.globe.legend.co2 || "CO₂"}${
            co2Date ? ` · ${co2Date}` : ""
          }`,
          time: co2Date,
        });
      }

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
            time: slDate ? String(slDate) : undefined,
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
            time: oh?.latest?.year != null ? String(oh.latest.year) : undefined,
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
          time: phDate ? String(phDate) : undefined,
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

      // Арктичний морський лід — північний полюс
      const northExtent = north?.latest?.extent;
      if (typeof northExtent === "number") {
        points.push({
          coordinates: [0, 78],
          event_type: "Arctic Ice",
          severity: "low",
          location: `${northExtent.toFixed(2)}M km² · ${t.globe.legend.ice}`,
          time: north?.latest?.date,
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
      const [eventsRes, eonetRes, astRes, sl, oh, ph, south, north, co2Data] = await Promise.all([
        fetch(`${apiUrl}/api/events`),
        fetch(`${apiUrl}/api/eonet?days=14`).catch(() => null),
        fetch(`${apiUrl}/api/asteroids?days=7`),
        fetch(`${apiUrl}/api/sea-level`).then((r) => (r.ok ? r.json() : null)),
        fetch(`${apiUrl}/api/ocean-heat`).then((r) => (r.ok ? r.json() : null)),
        fetch(`${apiUrl}/api/ocean-ph`).then((r) => (r.ok ? r.json() : null)),
        fetch(`${apiUrl}/api/sea-ice-south`).then((r) => (r.ok ? r.json() : null)),
        fetch(`${apiUrl}/api/sea-ice`).then((r) => (r.ok ? r.json() : null)),
        fetch(`${apiUrl}/api/co2`).then((r) => (r.ok ? r.json() : null)),
      ]);
      const astData = await astRes.json().catch(() => null);
      // Реальні астероїди (NASA NeoWs) або резервний набір, якщо API порожній
      setAsteroids(
        astData && Array.isArray(astData.objects) && astData.objects.length > 0
          ? astData.objects
          : fallbackAsteroids
      );
      const points: EventPoint[] = [];

      // Поточні події з FIRMS/NOAA (пожежі, циклони)
      const data = (await eventsRes.json().catch(() => null)) as ClimateEvent[] | null;
      if (Array.isArray(data) && data.length > 0) {
        points.push(
          ...data.slice(0, 260).map((ev) => ({
            coordinates: ev.coordinates as [number, number],
            event_type: ev.event_type,
            severity: ev.severity,
            location: ev.location,
            time: ev.time,
            frp: ev.frp ?? undefined,
            confidence: ev.confidence ?? undefined,
            satellite: ev.satellite ?? undefined,
          }))
        );
      }

      // Події NASA EONET (природні катастрофи без ключа) — без Wildfire,
      // щоб не дублювати пожежі FIRMS на глобусі
      const eonet = eonetRes
        ? ((await eonetRes.json().catch(() => null)) as { events?: RawEonetEvent[] } | null)
        : null;
      if (eonet && Array.isArray(eonet.events)) {
        const eonetPoints: EventPoint[] = eonet.events
          .filter((e) => e.coordinates && e.event_type && e.event_type !== "Wildfire")
          .slice(0, 90)
          .map((e) => ({
            coordinates: e.coordinates as [number, number],
            event_type: e.event_type,
            severity: e.severity || "medium",
            location: e.title || e.location || "",
            time: e.time,
            ongoing: e.status === "ongoing",
          }));
        points.push(...eonetPoints);
      }

      points.push(...buildOceanPoints(sl, oh, ph, south, north, co2Data));
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
      case "arctic ice": return "ice";
      default: return "";
    }
  };

  const eventLabel = (type?: string) => {
    const direct = (t.events as Record<string, unknown>)[type || ""];
    if (typeof direct === "string") return direct;
    return (t.globe.legend as Record<string, string>)[oceanLegendKey(type)] || type || "";
  };

  // Короткий опис події — «що це»
  const eventDesc = (type?: string) => {
    const desc = (t.events as Record<string, unknown>).desc as Record<string, string> | undefined;
    return desc?.[type || ""] || "";
  };

  // Позиція тултіпа
  const screen = hovered?._screen;

  // Свіжість даних маркера (для індикатора актуальності)
  const hoverFresh = freshnessOf(hovered?.time, hovered?.ongoing);
  const hoverFreshLabel =
    hoverFresh === "live"
      ? t.globe.liveTag
      : (t.globe.fresh as Record<string, string>)[hoverFresh];
  const hoverFreshColor = freshnessColor[hoverFresh];

  // Свіжість даних вибраного маркера (для вікна інформації)
  const selectedFresh = freshnessOf(selected?.time, selected?.ongoing);
  const selectedFreshLabel =
    selectedFresh === "live"
      ? t.globe.liveTag
      : (t.globe.fresh as Record<string, string>)[selectedFresh];

  // Рядок деталі для вікна інформації
  const DetailRow = ({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) => (
    <div className="flex items-center justify-between gap-3 text-xs py-1">
      <span className="text-secondary shrink-0">{label}</span>
      <span className={`text-primary font-medium text-right ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );

  // Перекладені підписи легенди
  const legendLabel = (key: string) =>
    (t.globe.legend as Record<string, string>)[key] ?? key;

  // Переклади для тултіпа астероїдів
  const ast = t.asteroids;

  return (
    <div className="w-full h-full relative bg-[#070A16] overflow-hidden animate-fade-in">
      <Canvas
        camera={{ position: [0, 0, 13], fov: 45 }}
        gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.0 }}
      >
        <Scene
          events={events}
          asteroids={asteroids}
          hovered={hovered}
          onHover={(ev) => setHovered(ev)}
          onSelect={(ev) => setSelected(ev)}
          markerRegistry={markerRegistry}
          asteroidRegistry={asteroidRegistry}
        />
      </Canvas>

      {/* Легенда типів подій та кліматичних точок — над кнопкою прокрутки */}
      <div className="absolute bottom-16 left-1/2 -translate-x-1/2 glass rounded-xl px-4 py-2 flex items-center gap-x-2.5 gap-y-1 flex-wrap justify-center max-w-[94vw] z-20">
        {LEGEND.map((item, i) => (
          <span
            key={item.key}
            className="flex items-center gap-1.5 text-[9px] font-medium uppercase tracking-wide text-primary/85 whitespace-nowrap animate-fade-up"
            style={{ animationDelay: `${350 + i * 55}ms` }}
          >
            <span className="w-1.5 h-1.5 rounded-full inline-block shrink-0" style={{ background: item.color }} />
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
          key={hovered.kind === "asteroid" ? `ast-${hovered.name}` : hovered._id}
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
                  style={{ background: asteroidThreatColor(hovered) }}
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
              {eventDesc(hovered.event_type) && (
                <div className="mt-1 text-[10px] leading-snug text-secondary/90">
                  {eventDesc(hovered.event_type)}
                </div>
              )}
              {hovered.location && (
                <div className="mt-1 text-[11px] text-secondary">{hovered.location}</div>
              )}
              {/* Дані пожежі (FRP/достовірність/супутник) — тільки якщо є від FIRMS */}
              {hovered.frp != null && (
                <div className="mt-1.5 space-y-0.5">
                  <div className="flex items-center justify-between gap-3 text-[11px] text-secondary">
                    <span>{t.globe.frp}</span>
                    <span className="text-primary font-medium">{hovered.frp.toFixed(1)} MW</span>
                  </div>
                  {hovered.confidence && (
                    <div className="flex items-center justify-between gap-3 text-[11px] text-secondary">
                      <span>{t.globe.confidence}</span>
                      <span className="text-primary font-medium capitalize">
                        {hovered.confidence}
                      </span>
                    </div>
                  )}
                  {hovered.satellite && (
                    <div className="flex items-center justify-between gap-3 text-[11px] text-secondary">
                      <span>{t.globe.satellite}</span>
                      <span className="text-primary/80">{hovered.satellite}</span>
                    </div>
                  )}
                </div>
              )}
              {hovered.coordinates && (
                <div className="mt-1.5 text-[10px] font-mono text-secondary">
                  {hovered.coordinates[0].toFixed(2)}°, {hovered.coordinates[1].toFixed(2)}°
                </div>
              )}
              {/* Актуальність даних: час + індикатор свіжості */}
              <div className="mt-2 pt-1.5 border-t border-violet/15 flex items-center justify-between gap-2">
                <div className="flex items-center space-x-1.5 min-w-0">
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: hoverFreshColor }} />
                  <span className="text-[10px] text-secondary truncate">
                    {hovered.ongoing ? `${t.globe.since}:` : `${t.globe.updatedAt}:`} {hovered.time || "—"}
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

      {/* Вікно з детальною інформацією при кліку на маркер/астероїд */}
      {selected && (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-sm animate-fade-in p-4"
          onClick={() => setSelected(null)}
        >
          <div
            className="relative glass-strong rounded-2xl w-full max-w-md max-h-[82vh] overflow-y-auto p-5 animate-tooltip-pop"
            onClick={(e) => e.stopPropagation()}
            style={{ boxShadow: "0 24px 90px rgba(0,0,0,0.75)" }}
          >
            {/* Шапка */}
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center space-x-2.5 min-w-0">
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ background: selected.kind === "asteroid" ? asteroidThreatColor(selected) : eventColor(selected.event_type) }}
                />
                <h3 className="text-base font-semibold text-primary truncate">
                  {selected.kind === "asteroid" ? selected.name : eventLabel(selected.event_type)}
                </h3>
                {selected.kind === "asteroid" && selected.hazardous && (
                  <span className="shrink-0 px-1.5 py-px rounded bg-[#FF5D6C]/15 border border-[#FF5D6C]/30 text-[9px] font-bold uppercase tracking-wider text-[#FF5D6C]">
                    {ast.hazardous}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="shrink-0 rounded-full glass p-1.5 text-secondary hover:text-primary transition-colors"
                aria-label={t.globe.close}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Тіло */}
            <div className="mt-3 space-y-2">
              {selected.kind === "asteroid" ? (
                <>
                  <DetailRow label={ast.miss} value={selected.miss_km != null ? `${(selected.miss_km / 1e6).toFixed(1)}M km` : "—"} />
                  <DetailRow label={ast.velocity} value={selected.velocity_kms != null ? `${selected.velocity_kms.toFixed(1)} km/s` : "—"} />
                  <DetailRow label={ast.diameter} value={selected.diameter_m_max != null ? `${Math.round(selected.diameter_m_max)} m` : "—"} />
                  <DetailRow label={ast.approach} value={selected.approach_date || "—"} />
                </>
              ) : (
                <>
                  {eventDesc(selected.event_type) && (
                    <p className="text-xs leading-snug text-secondary/90">
                      {eventDesc(selected.event_type)}
                    </p>
                  )}
                  {selected.location && (
                    <DetailRow label={t.globe.location} value={selected.location} />
                  )}
                  {selected.severity && (
                    <DetailRow label={t.globe.severity} value={<span className="capitalize">{selected.severity}</span>} />
                  )}
                  {selected.frp != null && (
                    <DetailRow label={t.globe.frp} value={`${selected.frp.toFixed(1)} MW`} />
                  )}
                  {selected.confidence && (
                    <DetailRow label={t.globe.confidence} value={<span className="capitalize">{selected.confidence}</span>} />
                  )}
                  {selected.satellite && (
                    <DetailRow label={t.globe.satellite} value={selected.satellite} />
                  )}
                  {selected.coordinates && (
                    <DetailRow label="Lat / Lon" value={`${selected.coordinates[0].toFixed(2)}°, ${selected.coordinates[1].toFixed(2)}°`} mono />
                  )}
                </>
              )}

              {/* Актуальність даних */}
              <div className="mt-3 pt-2.5 border-t border-violet/15 flex items-center justify-between gap-2">
                <div className="flex items-center space-x-1.5 min-w-0">
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: freshnessColor[selectedFresh] }} />
                  <span className="text-[11px] text-secondary truncate">
                    {selected.ongoing ? `${t.globe.since}:` : `${t.globe.updatedAt}:`} {selected.time || "—"}
                  </span>
                </div>
                <span className="text-[11px] font-semibold shrink-0" style={{ color: freshnessColor[selectedFresh] }}>
                  {selectedFreshLabel}
                </span>
              </div>
            </div>
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
