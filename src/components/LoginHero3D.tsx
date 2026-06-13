"use client";

import { useRef, useMemo, useState, useEffect } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { PerspectiveCamera } from "@react-three/drei";
import * as THREE from "three";

const ACCENT = new THREE.Color("#ff5500");
const ACCENT_SECONDARY = new THREE.Color("#c77dff");
const BG = "#0a0a0a";

interface OrbiterConfig {
  radius: number;
  speed: number;
  size: number;
  color: THREE.Color;
  shape: "box" | "icosahedron" | "octahedron";
  offset: number;
  yPhase: number;
}

const ORBITERS: OrbiterConfig[] = [
  { radius: 4.2, speed: 0.25, size: 0.35, color: ACCENT_SECONDARY, shape: "box", offset: 0, yPhase: 0.3 },
  { radius: 5.5, speed: 0.18, size: 0.45, color: ACCENT, shape: "icosahedron", offset: 2.1, yPhase: 0.7 },
  { radius: 6.8, speed: 0.12, size: 0.3, color: ACCENT_SECONDARY, shape: "octahedron", offset: 4.2, yPhase: 1.1 },
  { radius: 5.0, speed: 0.22, size: 0.25, color: ACCENT, shape: "octahedron", offset: 5.0, yPhase: 0.5 },
  { radius: 7.5, speed: 0.09, size: 0.4, color: ACCENT_SECONDARY, shape: "box", offset: 1.4, yPhase: 0.9 },
  { radius: 3.5, speed: 0.35, size: 0.2, color: ACCENT, shape: "icosahedron", offset: 3.6, yPhase: 0.2 },
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
      meshRef.current.rotation.y = t * 0.15;
      meshRef.current.rotation.x = Math.sin(t * 0.4) * 0.08;
    }
    if (ringRef.current) {
      ringRef.current.rotation.z = t * 0.08;
      ringRef.current.rotation.x = Math.sin(t * 0.2) * 0.15;
    }
  });

  return (
    <group>
      <mesh ref={meshRef}>
        <sphereGeometry args={[1, 64, 64]} />
        <meshStandardMaterial
          color={ACCENT}
          emissive={ACCENT}
          emissiveIntensity={1.2}
          roughness={0.2}
          metalness={0.9}
        />
      </mesh>
      <mesh ref={ringRef}>
        <torusGeometry args={[1.6, 0.015, 16, 128]} />
        <meshBasicMaterial color={ACCENT} transparent opacity={0.35} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[2.2, 0.01, 16, 128]} />
        <meshBasicMaterial color={ACCENT_SECONDARY} transparent opacity={0.2} />
      </mesh>
    </group>
  );
}

function OrbiterNode({ config }: { config: OrbiterConfig }) {
  const groupRef = useRef<THREE.Group>(null);
  const meshRef = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);

  const geometry = useMemo(() => {
    switch (config.shape) {
      case "box":
        return new THREE.BoxGeometry(config.size, config.size, config.size);
      case "icosahedron":
        return new THREE.IcosahedronGeometry(config.size, 0);
      case "octahedron":
        return new THREE.OctahedronGeometry(config.size, 0);
    }
  }, [config.shape, config.size]);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (groupRef.current) {
      const angle = t * config.speed + config.offset;
      const x = Math.cos(angle) * config.radius;
      const z = Math.sin(angle) * config.radius;
      const y = Math.sin(t * config.yPhase) * 0.6;
      groupRef.current.position.set(x, y, z);
      groupRef.current.lookAt(0, 0, 0);
    }
    if (meshRef.current) {
      meshRef.current.rotation.x += 0.01;
      meshRef.current.rotation.y += 0.015;
      const targetScale = hovered ? 1.6 : 1;
      meshRef.current.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), 0.1);
    }
  });

  return (
    <group ref={groupRef}>
      <mesh
        ref={meshRef}
        geometry={geometry}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
      >
        <meshStandardMaterial
          color={config.color}
          emissive={config.color}
          emissiveIntensity={hovered ? 1.2 : 0.4}
          roughness={0.3}
          metalness={0.7}
        />
      </mesh>
      <line>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[new Float32Array([0, 0, 0, -config.radius, 0, 0]), 3]}
          />
        </bufferGeometry>
        <lineBasicMaterial color={config.color} transparent opacity={0.15} />
      </line>
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
      <lineBasicMaterial color={ACCENT_SECONDARY} transparent opacity={0.08} />
    </lineSegments>
  );
}

function ParticleField({ count = 250 }: { count?: number }) {
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
      ref.current.rotation.y = clock.getElapsedTime() * 0.02;
      ref.current.rotation.x = Math.sin(clock.getElapsedTime() * 0.05) * 0.05;
    }
  });

  return (
    <points ref={ref} geometry={geometry}>
      <pointsMaterial
        size={0.05}
        color={ACCENT_SECONDARY}
        transparent
        opacity={0.5}
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
      target.current.x += (mouseRef.current.x * 1.2 - target.current.x) * 0.04;
      target.current.y += (mouseRef.current.y * 0.8 - target.current.y) * 0.04;
      groupRef.current.position.x = target.current.x;
      groupRef.current.position.y = target.current.y;
      groupRef.current.rotation.y = state.clock.getElapsedTime() * 0.015;
    }
  });

  return (
    <group ref={groupRef}>
      <PerspectiveCamera makeDefault position={[0, 0, 14]} fov={45} />
      <ambientLight intensity={0.3} />
      <pointLight position={[10, 10, 10]} intensity={1.5} color={ACCENT} />
      <pointLight position={[-10, -10, -5]} intensity={1} color={ACCENT_SECONDARY} />
      <ControlNode />
      {ORBITERS.map((config, i) => (
        <OrbiterNode key={i} config={config} />
      ))}
      <ConnectionLines />
      <ParticleField count={250} />
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
        <fog attach="fog" args={[BG, 15, 40]} />
        <Scene mouseRef={mouseRef} />
      </Canvas>
    </div>
  );
}
