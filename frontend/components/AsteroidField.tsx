"use client";

/**
 * AsteroidField — анімовані навколоземні астероїди навколо глобуса.
 * Кожен астероїд рухається власною орбітою (нахил + висхідний вузол),
 * обертається навколо осі, має сяйво та кометний хвіст.
 * Орбіти промальовані ТОНКИМИ ПУНКТИРНИМИ ЛІНІЯМИ (не суцільні тори).
 * Небезпечні (PHO) — рожеві, решта — блакитні. Розмір ~ діаметру.
 * При наведенні показує тултіп із даними NASA NeoWs.
 */

import { useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import * as THREE from "three";
import type { AsteroidObject } from "@/lib/api";

/** Мінімальна/максимальна дистанція зближення у даних (км) — для нормування орбіт */
const MISS_MIN_KM = 4.5e6;
const MISS_MAX_KM = 7.5e7;

/** Нормалізація діаметра (м) у розмір моделі на сцені */
function diameterToSize(diamMax: number | null): number {
  const d = diamMax && diamMax > 0 ? diamMax : 100;
  return 0.045 + Math.min(1, d / 1200) * 0.16;
}

/** Кольори: небезпечний — рожевий (danger), безпечний — блакитний (accent) */
const HAZARD_COLOR = "#FF5C8A";
const SAFE_COLOR = "#36A3FF";

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
  const speed = (0.018 + ((index % 7) / 7) * 0.022) * (7.4 / radius);
  const size = diameterToSize(obj.diameter_m_max);
  return { radius, inclination, node, phase, speed, size };
}

/** Один астероїд з орбітою, кометним хвостом і сяйвом */
function Asteroid({
  obj,
  index,
  onHover,
}: {
  obj: AsteroidObject;
  index: number;
  onHover: (info: any) => void;
}) {
  const orbit = useMemo(() => orbitParams(obj, index), [obj, index]);
  const orbitRef = useRef<THREE.Group>(null);
  const moverRef = useRef<THREE.Group>(null);
  const rockRef = useRef<THREE.Mesh>(null);
  const glowMatRef = useRef<THREE.MeshBasicMaterial>(null);
  const tailRefs = useRef<(THREE.Mesh | null)[]>([]);
  const tailMats = useRef<(THREE.MeshBasicMaterial | null)[]>([]);
  const { camera } = useThree();
  const [hovered, setHovered] = useState(false);

  const color = obj.hazardous ? HAZARD_COLOR : SAFE_COLOR;

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
      glowMatRef.current.opacity = (hovered ? 0.5 : 0.22) + pulse * (hovered ? 0.2 : 0.1);
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
        const dist = orbit.size * (1.8 + k * 1.1);
        m.position.set(
          moverRef.current.position.x + bx * dist,
          moverRef.current.position.y + by * dist,
          0
        );
        const s = Math.max(0.02, orbit.size * (1.3 - k * 0.2));
        m.scale.setScalar(s);
        const mat = tailMats.current[i];
        if (mat) {
          mat.opacity = Math.max(0, (hovered ? 0.4 : 0.22) - k * 0.04);
        }
      }
    }
  });

  const getScreenPos = () => {
    if (!moverRef.current) return null;
    const v = new THREE.Vector3();
    moverRef.current.getWorldPosition(v);
    v.project(camera);
    return {
      x: (v.x * 0.5 + 0.5) * window.innerWidth,
      y: (-v.y * 0.5 + 0.5) * window.innerHeight,
    };
  };

  const handleOver = (e: any) => {
    e.stopPropagation();
    setHovered(true);
    onHover({ ...obj, kind: "asteroid", _screen: getScreenPos() });
  };
  const handleOut = () => {
    setHovered(false);
    onHover(null);
  };

  return (
    <group
      ref={orbitRef}
      rotation={[orbit.inclination, orbit.node, 0]}
      onPointerOver={handleOver}
      onPointerOut={handleOut}
    >
      {/* Орбіта — ТОНКА ПУНКТИРНА ЛІНІЯ у площині руху */}
      <Line
        points={orbitCircle}
        color={color}
        lineWidth={0.4}
        dashed
        dashScale={2}
        dashSize={0.8}
        gapSize={0.6}
        transparent
        opacity={hovered ? 0.35 : 0.12}
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
            opacity={0.3}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
        {/* Камінь — груба скеля */}
        <mesh ref={rockRef}>
          <icosahedronGeometry args={[orbit.size, 1]} />
          <meshStandardMaterial
            color={obj.hazardous ? "#5a3340" : "#3a4a63"}
            emissive={color}
            emissiveIntensity={hovered ? 0.55 : 0.22}
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
  onHover,
}: {
  asteroids: AsteroidObject[];
  onHover: (info: any) => void;
}) {
  return (
    <>
      {asteroids.map((obj, i) => (
        <Asteroid key={`${obj.name}-${i}`} obj={obj} index={i} onHover={onHover} />
      ))}
    </>
  );
}
