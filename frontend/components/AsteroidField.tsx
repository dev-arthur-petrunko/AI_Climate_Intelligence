"use client";

/**
 * AsteroidField — анімовані навколоземні астероїди навколо глобуса.
 * Кожен астероїд рухається власною орбітою (нахил + висхідний вузол),
 * обертається навколо осі, має сяйво та кометний хвіст.
 * Орбіти промальовані ТОНКИМИ ПУНКТИРНИМИ ЛІНІЯМИ (не суцільні тори).
 * Колір — за ступенем загрози: небезпечні (PHO) — червоні, близьке
 * зближення — жовті, безпечні — зелені. Розмір ~ діаметру.
 * При наведенні показує тултіп із даними NASA NeoWs.
 */

import { useMemo, useRef, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import * as THREE from "three";
import type { AsteroidObject } from "@/lib/api";

/** Реєстрація астероїда для screen-space hover (HoverController в EarthGlobe) */
export interface AsteroidEntry {
  obj: AsteroidObject;
  ref: { readonly current: THREE.Group | null };
}

/** Мінімальна/максимальна дистанція зближення у даних (км) — для нормування орбіт */
const MISS_MIN_KM = 4.5e6;
const MISS_MAX_KM = 7.5e7;

/** Нормалізація діаметра (м) у розмір моделі на сцені */
function diameterToSize(diamMax: number | null): number {
  const d = diamMax && diamMax > 0 ? diamMax : 100;
  return 0.02 + Math.min(1, d / 1200) * 0.07;
}

/** Кольори за ступенем загрози: небезпечний — червоний, близьке зближення — жовтий, безпечний — зелений */
const HAZARD_COLOR = "#FF5D6C";
const WATCH_COLOR = "#FFB648";
const SAFE_COLOR = "#28E08F";

/** Поріг зближення (км) — менше вважається «жовтим» рівнем уваги */
const WATCH_MISS_KM = 4e7;

/** Колір за ступенем загрози (спільний для легенди та тултіпа) */
export function asteroidThreatColor(obj: {
  hazardous?: boolean;
  miss_km?: number | null;
}): string {
  if (obj.hazardous) return HAZARD_COLOR;
  const miss = obj.miss_km;
  if (miss != null && miss < WATCH_MISS_KM) return WATCH_COLOR;
  return SAFE_COLOR;
}

/** База каменя під колір загрози */
const ROCK_BASE: Record<string, string> = {
  [HAZARD_COLOR]: "#5a3340",
  [WATCH_COLOR]: "#57422f",
  [SAFE_COLOR]: "#2f4a3c",
};

/** Кількість сегментів у пунктирній орбіті та ланок кометного хвоста */
const ORBIT_SEGMENTS = 128;
const TAIL_LINKS = 5;

interface OrbitParams {
  radius: number;
  inclination: number;
  node: number;
  phase: number;
  speed: number;
  size: number;
}

function orbitParams(obj: AsteroidObject, index: number): OrbitParams {
  const miss = obj.miss_km ?? 3.5e7;
  const t = Math.max(0, Math.min(1, (miss - MISS_MIN_KM) / (MISS_MAX_KM - MISS_MIN_KM)));
  const radius = 6.5 + t * 2.7;
  const inclination = ((index * 0.61) % 1) * 0.6 - 0.3;
  const node = (index * 2.39996) % (Math.PI * 2);
  const phase = (index * 1.618) % (Math.PI * 2);
  // Реалістична кутова швидкість: реальні NEO на зближенні рухаються ~1–10°/год
  // = 5e-6 – 5e-5 rad/frame (при 60 fps). Масштабуємо за радіусом орбіти.
  // Трохи прискорено для наочності на глобусі.
  const speed = (3e-5 + ((index % 7) / 7) * 1.2e-4) * (7.4 / radius);
  const size = diameterToSize(obj.diameter_m_max);
  return { radius, inclination, node, phase, speed, size };
}

/** Один астероїд з орбітою, кометним хвостом і сяйвом */
function Asteroid({
  obj,
  index,
  asteroidRegistry,
  active,
}: {
  obj: AsteroidObject;
  index: number;
  asteroidRegistry: React.MutableRefObject<AsteroidEntry[]>;
  active: boolean;
}) {
  const orbit = useMemo(() => orbitParams(obj, index), [obj, index]);
  const orbitRef = useRef<THREE.Group>(null);
  const moverRef = useRef<THREE.Group>(null);
  const rockRef = useRef<THREE.Mesh>(null);
  const glowMatRef = useRef<THREE.MeshBasicMaterial>(null);
  const tailRefs = useRef<(THREE.Mesh | null)[]>([]);
  const tailMats = useRef<(THREE.MeshBasicMaterial | null)[]>([]);

  // Реєстрація позиції астероїда (moverRef) для screen-space hover.
  // Записи оновлюються при зміні obj (оновлення даних з API).
  useEffect(() => {
    const entry: AsteroidEntry = { obj, ref: moverRef };
    asteroidRegistry.current.push(entry);
    return () => {
      asteroidRegistry.current = asteroidRegistry.current.filter((x) => x !== entry);
    };
  }, [obj, asteroidRegistry]);

  const color = asteroidThreatColor(obj);

  /** Точки пунктирної орбіти (у площині XY до нахилу групи) */
  const orbitCircle = useMemo(() => {
    const pts: [number, number, number][] = [];
    for (let i = 0; i <= ORBIT_SEGMENTS; i++) {
      const a = (i / ORBIT_SEGMENTS) * Math.PI * 2;
      pts.push([orbit.radius * Math.cos(a), orbit.radius * Math.sin(a), 0]);
    }
    return pts;
  }, [orbit.radius]);

  useFrame((state, delta) => {
    const g = orbitRef.current;
    if (!g) return;
    const t = state.clock.elapsedTime;
    const a = orbit.phase + t * orbit.speed;

    // Позиція астероїда на орбіті
    if (moverRef.current) {
      moverRef.current.position.set(orbit.radius * Math.cos(a), orbit.radius * Math.sin(a), 0);
    }
    if (rockRef.current) {
      rockRef.current.rotation.x += delta * 0.35;
      rockRef.current.rotation.y += delta * 0.5;
    }
    if (glowMatRef.current) {
      const pulse = 0.5 + 0.5 * Math.sin(t * 1.7 + index * 0.9);
      glowMatRef.current.opacity = (active ? 0.7 : 0.4) + pulse * (active ? 0.2 : 0.12);
    }

    // Кометний хвіст — ланки позаду астероїда вздовж напрямку руху
    if (moverRef.current) {
      // Тангенс напрямку руху (зростання кута): (-sin, cos). Хвіст — протилежний напрямок
      const bx = Math.sin(a);
      const by = -Math.cos(a);
      for (let i = 0; i < TAIL_LINKS; i++) {
        const m = tailRefs.current[i];
        if (!m) continue;
        const k = i + 1;
        const dist = orbit.size * (1.5 + k * 0.9);
        m.position.set(
          moverRef.current.position.x + bx * dist,
          moverRef.current.position.y + by * dist,
          0
        );
        const s = Math.max(0.02, orbit.size * (1.3 - k * 0.2));
        m.scale.setScalar(s);
        const mat = tailMats.current[i];
        if (mat) {
          mat.opacity = Math.max(0, (active ? 0.4 : 0.22) - k * 0.04);
        }
      }
    }
  });

  return (
    <group
      ref={orbitRef}
      rotation={[orbit.inclination, orbit.node, 0]}
    >
      {/* Орбіта — ТОНКА ПУНКТИРНА ЛІНІЯ у площині руху */}
      <Line
        points={orbitCircle}
        color={color}
        lineWidth={0.6}
        dashed
        dashScale={2}
        dashSize={0.8}
        gapSize={0.6}
        transparent
        opacity={active ? 0.55 : 0.25}
        depthWrite={false}
      />

      {/* Позиція астероїда на орбіті (обертається через useFrame) */}
      <group ref={moverRef}>
        {/* Сяйво навколо астероїда */}
        <mesh>
          <sphereGeometry args={[orbit.size * 1.6, 12, 12]} />
          <meshBasicMaterial
            ref={glowMatRef}
            color={color}
            transparent
            opacity={0.4}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
        {/* Камінь — груба скеля */}
        <mesh ref={rockRef}>
          <icosahedronGeometry args={[orbit.size, 1]} />
          <meshStandardMaterial
            color={ROCK_BASE[color] ?? "#3a4a63"}
            emissive={color}
            emissiveIntensity={active ? 0.8 : 0.45}
            roughness={0.9}
            metalness={0.1}
          />
        </mesh>
      </group>

      {/* Кометний хвіст — послідовні сяйливі ланки, що гаснуть */}
      {Array.from({ length: TAIL_LINKS }).map((_, i) => (
        <mesh key={`tail-${i}`} ref={(el) => { tailRefs.current[i] = el; }}>
          <sphereGeometry args={[1, 8, 8]} />
          <meshBasicMaterial
            ref={(el) => { tailMats.current[i] = el; }}
            color={color}
            transparent
            opacity={0}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  );
}

/** Поле астероїдів навколо глобуса */
export default function AsteroidField({
  asteroids,
  asteroidRegistry,
  activeId,
}: {
  asteroids: AsteroidObject[];
  asteroidRegistry: React.MutableRefObject<AsteroidEntry[]>;
  activeId?: string | null;
}) {
  return (
    <>
      {asteroids.map((obj, i) => (
        <Asteroid
          key={`${obj.name}-${i}`}
          obj={obj}
          index={i}
          asteroidRegistry={asteroidRegistry}
          active={activeId === `a:${obj.name}`}
        />
      ))}
    </>
  );
}
