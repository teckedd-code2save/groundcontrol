"use client";

import { useRef, useMemo, useState, useEffect } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { PerspectiveCamera } from "@react-three/drei";
import * as THREE from "three";

const ACCENT = new THREE.Color("#7c9cff");
const ACCENT_SECONDARY = new THREE.Color("#c77dff");
const BG = "#0a0a0a";

interface OrbiterConfig {
  radius: number;
  speed: number;
  size: number;
  color: THREE.Color;
  offset: number;
}

const ORBITERS: OrbiterConfig[] = [
  { radius: 3.8, speed: 0.12, size: 0.22, color: ACCENT_SECONDARY, offset: 0 },
  { radius: 5.2, speed: 0.08, size: 0.32, color: ACCENT, offset: 1.8 },
  { radius: 6.5, speed: 0.05, size: 0.18, color: ACCENT_SECONDARY, offset: 3.6 },
  { radius: 4.6, speed: 0.09, size: 0.14, color: ACCENT, offset: 5.2 },
];

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function ControlNode() {
  const meshRef = useRef<THREE.Mesh>(null);
  const ringRef = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (meshRef.current) {
      meshRef.current.rotation.y = t * 0.08;
      meshRef.current.rotation.x = Math.sin(t * 0.25) * 0.05;
    }
    if (ringRef.current) {
      ringRef.current.rotation.z = t * 0.04;
    }
  });

  return (
    <group>
      <mesh ref={meshRef}>
        <sphereGeometry args={[1, 64, 64]} />
        <meshStandardMaterial
          color={ACCENT}
          emissive={ACCENT}
          emissiveIntensity={0.9}
          roughness={0.2}
          metalness={0.9}
        />
      </mesh>
      <mesh ref={ringRef}>
        <torusGeometry args={[1.55, 0.012, 16, 128]} />
        <meshBasicMaterial color={ACCENT} transparent opacity={0.25} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[2.1, 0.008, 16, 128]} />
        <meshBasicMaterial color={ACCENT_SECONDARY} transparent opacity={0.12} />
      </mesh>
    </group>
  );
}

function OrbiterNode({ config }: { config: OrbiterConfig }) {
  const groupRef = useRef<THREE.Group>(null);
  const meshRef = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (groupRef.current) {
      const angle = t * config.speed + config.offset;
      const x = Math.cos(angle) * config.radius;
      const z = Math.sin(angle) * config.radius;
      const y = Math.sin(t * 0.15 + config.offset) * 0.35;
      groupRef.current.position.set(x, y, z);
      groupRef.current.lookAt(0, 0, 0);
    }
    if (meshRef.current) {
      meshRef.current.rotation.x += 0.005;
      meshRef.current.rotation.y += 0.008;
      const targetScale = hovered ? 1.5 : 1;
      meshRef.current.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), 0.08);
    }
  });

  return (
    <group ref={groupRef}>
      <mesh
        ref={meshRef}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
      >
        <icosahedronGeometry args={[config.size, 0]} />
        <meshStandardMaterial
          color={config.color}
          emissive={config.color}
          emissiveIntensity={hovered ? 0.9 : 0.35}
          roughness={0.3}
          metalness={0.7}
        />
      </mesh>
    </group>
  );
}

function ConnectionLines() {
  const points = useMemo(() => {
    const arr: number[] = [];
    ORBITERS.forEach((o) => {
      const t = o.offset;
      const x = Math.cos(t) * o.radius;
      const z = Math.sin(t) * o.radius;
      arr.push(0, 0, 0, x, 0, z);
    });
    return new Float32Array(arr);
  }, []);

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(points, 3));
    return geo;
  }, [points]);

  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial color={ACCENT_SECONDARY} transparent opacity={0.06} />
    </lineSegments>
  );
}

function ParticleField({ count = 120 }: { count?: number }) {
  const geometry = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const rand = mulberry32(42);
    for (let i = 0; i < count; i++) {
      const r = 10 + rand() * 25;
      const theta = rand() * Math.PI * 2;
      const phi = Math.acos(2 * rand() - 1);
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return geo;
  }, [count]);

  const ref = useRef<THREE.Points>(null);

  useFrame(({ clock }) => {
    if (ref.current) {
      ref.current.rotation.y = clock.getElapsedTime() * 0.01;
    }
  });

  return (
    <points ref={ref} geometry={geometry}>
      <pointsMaterial
        size={0.04}
        color={ACCENT_SECONDARY}
        transparent
        opacity={0.35}
        sizeAttenuation
      />
    </points>
  );
}

function Scene({ mouseRef }: { mouseRef: React.RefObject<{ x: number; y: number } | null> }) {
  const groupRef = useRef<THREE.Group>(null);
  const target = useRef({ x: 0, y: 0 });

  useFrame((state) => {
    if (groupRef.current && mouseRef.current) {
      target.current.x += (mouseRef.current.x * 0.8 - target.current.x) * 0.03;
      target.current.y += (mouseRef.current.y * 0.5 - target.current.y) * 0.03;
      groupRef.current.position.x = target.current.x;
      groupRef.current.position.y = target.current.y;
      groupRef.current.rotation.y = state.clock.getElapsedTime() * 0.008;
    }
  });

  return (
    <group ref={groupRef}>
      <PerspectiveCamera makeDefault position={[0, 0, 13]} fov={48} />
      <ambientLight intensity={0.25} />
      <pointLight position={[6, 6, 8]} intensity={1.2} color={ACCENT} />
      <pointLight position={[-6, -4, -4]} intensity={0.8} color={ACCENT_SECONDARY} />
      <ControlNode />
      {ORBITERS.map((config, i) => (
        <OrbiterNode key={i} config={config} />
      ))}
      <ConnectionLines />
      <ParticleField count={120} />
    </group>
  );
}

export default function LoginHero3D() {
  const mouseRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      mouseRef.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouseRef.current.y = -(e.clientY / window.innerHeight) * 2 + 1;
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, []);

  return (
    <div className="fixed inset-0 -z-10" style={{ background: BG }}>
      <Canvas
        dpr={[1, 1.5]}
        gl={{
          antialias: true,
          alpha: false,
          powerPreference: "high-performance",
        }}
      >
        <color attach="background" args={[BG]} />
        <fog attach="fog" args={[BG, 16, 42]} />
        <Scene mouseRef={mouseRef} />
      </Canvas>
    </div>
  );
}
