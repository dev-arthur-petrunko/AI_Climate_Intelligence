"use client";

/**
 * AsteroidField — анімовані навколоземні астероїди навколо глобуса.
 * Кожен астероїд рухається власною орбітою (нахил + висхідний вузол),
 * обертається навколо осі, має сяйво та орбітальне кільце.
 * Небезпечні (PHO) — рожеві, решта — блакитні. Розмір ~ діаметру.
 * При наведенні показує тултіп із даними NASA NeoWs.
 */

import { useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
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
  const speed = (0.045 + ((index % 7) / 7) * 0.05) * (7.4 / radius);
  const size = diameterToSize(obj.diameter_m_max);
  return { radius, inclination, node, phase, speed, size };
}

/** Один астероїд з орбітою, обертанням і сяйвом */
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
  const rockRef = useRef<THREE.Mesh>(null);
  const glowMatRef = useRef<THREE.MeshBasicMaterial>(null);
  const ringMatRef = useRef<THREE.MeshBasicMaterial>(null);
  const { camera } = useThree();
  const [hovered, setHovered] = useState(false);

  const color = obj.hazardous ? HAZARD_COLOR : SAFE_COLOR;

  useFrame((state, delta) => {
    const g = orbitRef.current;
    if (!g) return;
    const t = state.clock.elapsedTime;
    const a = orbit.phase + t * orbit.speed;
    const child = g.children[0] as THREE.Group | undefined;
    if (child) {
      child.position.set(orbit.radius * Math.cos(a), orbit.radius * Math.sin(a), 0);
    }
    if (rockRef.current) {
      rockRef.current.rotation.x += delta * 0.35;
      rockRef.current.rotation.y += delta * 0.5;
    }
    if (glowMatRef.current) {
      const pulse = 0.5 + 0.5 * Math.sin(t * 1.7 + index * 0.9);
      glowMatRef.current.opacity = (hovered ? 0.55 : 0.28) + pulse * (hovered ? 0.3 : 0.14);
    }
    if (ringMatRef.current) {
      ringMatRef.current.opacity = hovered ? 0.5 : 0.16;
    }
  });

  const getScreenPos = () => {
    if (!orbitRef.current) return null;
    const v = new THREE.Vector3();
    orbitRef.current.getWorldPosition(v);
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
      {/* Орбітальне кільце — лежить у площині руху астероїда */}
      <mesh>
        <torusGeometry args={[orbit.radius, 0.004, 4, 96]} />
        <meshBasicMaterial
          ref={ringMatRef}
          color={color}
          transparent
          opacity={0.16}
          depthWrite={false}
        />
      </mesh>

      {/* Позиція астероїда на орбіті (обертається через useFrame) */}
      <group>
        {/* Сяйво навколо астероїда */}
        <mesh>
          <sphereGeometry args={[orbit.size * 2.4, 12, 12]} />
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
