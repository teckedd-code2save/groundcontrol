"use client";

import { useRef, useMemo } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { PerspectiveCamera } from "@react-three/drei";
import * as THREE from "three";

const ACCENT = new THREE.Color("#ff5500");
const ACCENT_SECONDARY = new THREE.Color("#c77dff");
const BG = "#0a0a0a";

export type LoaderVariant =
  | "container"
  | "image"
  | "project"
  | "deploy"
  | "proxy"
  | "compose"
  | "generic";

interface LoaderOverlay3DProps {
  open: boolean;
  variant?: LoaderVariant;
  title?: string;
  subtitle?: string;
}

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function ContainerScene() {
  const group = useRef<THREE.Group>(null);
  const box = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (group.current) group.current.rotation.y = t * 0.6;
    if (box.current) {
      box.current.rotation.x = Math.sin(t * 0.8) * 0.1;
      box.current.rotation.z = Math.cos(t * 0.6) * 0.1;
    }
  });

  return (
    <group ref={group}>
      <mesh ref={box}>
        <boxGeometry args={[1.6, 1.6, 1.6]} />
        <meshStandardMaterial color={ACCENT} emissive={ACCENT} emissiveIntensity={0.5} roughness={0.3} metalness={0.6} wireframe={false} />
      </mesh>
      <mesh>
        <boxGeometry args={[1.7, 1.7, 1.7]} />
        <meshBasicMaterial color={ACCENT} transparent opacity={0.15} wireframe />
      </mesh>
      {[-0.95, 0.95].map((y, i) => (
        <mesh key={i} position={[0, y, 0]}>
          <boxGeometry args={[1.2, 0.08, 1.2]} />
          <meshStandardMaterial color={ACCENT_SECONDARY} emissive={ACCENT_SECONDARY} emissiveIntensity={0.4} />
        </mesh>
      ))}
      {[0, 1, 2, 3].map((i) => (
        <mesh key={i} position={[Math.cos(i * 1.57) * 1.4, Math.sin(i * 1.57) * 0.3, Math.sin(i * 1.57) * 1.4]}>
          <boxGeometry args={[0.2, 0.2, 0.2]} />
          <meshStandardMaterial color={ACCENT_SECONDARY} emissive={ACCENT_SECONDARY} emissiveIntensity={0.6} />
        </mesh>
      ))}
    </group>
  );
}

function ImageScene() {
  const group = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (group.current) {
      group.current.rotation.y = t * 0.5;
      group.current.rotation.x = Math.sin(t * 0.4) * 0.1;
    }
  });

  return (
    <group ref={group}>
      {[0, 0.25, 0.5].map((y, i) => (
        <mesh key={i} position={[0, y - 0.25, 0]}>
          <cylinderGeometry args={[1.1 - i * 0.15, 1.1 - i * 0.15, 0.12, 64]} />
          <meshStandardMaterial
            color={i === 0 ? ACCENT : ACCENT_SECONDARY}
            emissive={i === 0 ? ACCENT : ACCENT_SECONDARY}
            emissiveIntensity={0.4}
            roughness={0.2}
            metalness={0.7}
          />
        </mesh>
      ))}
    </group>
  );
}

function ProjectScene() {
  const group = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (group.current) {
      group.current.rotation.y = t * 0.4;
      group.current.position.y = Math.sin(t * 0.8) * 0.1;
    }
  });

  return (
    <group ref={group}>
      <mesh>
        <boxGeometry args={[1.8, 1.2, 0.25]} />
        <meshStandardMaterial color={ACCENT} emissive={ACCENT} emissiveIntensity={0.4} roughness={0.3} metalness={0.5} />
      </mesh>
      <mesh position={[0.15, 0.15, 0.15]}>
        <boxGeometry args={[1.5, 0.9, 0.2]} />
        <meshStandardMaterial color={ACCENT_SECONDARY} emissive={ACCENT_SECONDARY} emissiveIntensity={0.3} roughness={0.3} metalness={0.5} />
      </mesh>
      <mesh position={[-0.6, 0.1, 0.16]}>
        <boxGeometry args={[0.4, 0.08, 0.22]} />
        <meshStandardMaterial color={BG} />
      </mesh>
    </group>
  );
}

function DeployScene() {
  const group = useRef<THREE.Group>(null);
  const particles = useMemo(() => {
    const arr = new Float32Array(24);
    const rand = mulberry32(7);
    for (let i = 0; i < 8; i++) {
      arr[i * 3] = (rand() - 0.5) * 0.6;
      arr[i * 3 + 1] = -1.2 - rand() * 1.5;
      arr[i * 3 + 2] = (rand() - 0.5) * 0.6;
    }
    return arr;
  }, []);
  const pointsRef = useRef<THREE.Points>(null);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (group.current) {
      group.current.position.y = Math.sin(t * 1.5) * 0.15;
      group.current.rotation.z = Math.sin(t * 1.2) * 0.05;
    }
    if (pointsRef.current) {
      const positions = pointsRef.current.geometry.attributes.position.array as Float32Array;
      for (let i = 0; i < 8; i++) {
        positions[i * 3 + 1] += 0.04;
        if (positions[i * 3 + 1] > -0.6) positions[i * 3 + 1] = -2.2;
      }
      pointsRef.current.geometry.attributes.position.needsUpdate = true;
    }
  });

  return (
    <group>
      <group ref={group}>
        <mesh position={[0, 0.2, 0]}>
          <coneGeometry args={[0.5, 1.2, 32]} />
          <meshStandardMaterial color={ACCENT} emissive={ACCENT} emissiveIntensity={0.6} roughness={0.2} metalness={0.6} />
        </mesh>
        <mesh position={[0, -0.6, 0]}>
          <cylinderGeometry args={[0.5, 0.2, 0.6, 32]} />
          <meshStandardMaterial color={ACCENT_SECONDARY} emissive={ACCENT_SECONDARY} emissiveIntensity={0.4} roughness={0.3} metalness={0.5} />
        </mesh>
      </group>
      <points ref={pointsRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[particles, 3]} />
        </bufferGeometry>
        <pointsMaterial size={0.08} color={ACCENT} transparent opacity={0.8} sizeAttenuation />
      </points>
    </group>
  );
}

function ProxyScene() {
  const group = useRef<THREE.Group>(null);
  const arrow1 = useRef<THREE.Mesh>(null);
  const arrow2 = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (group.current) group.current.rotation.y = t * 0.3;
    if (arrow1.current) arrow1.current.position.x = -1 + (Math.sin(t * 2) + 1) * 0.5;
    if (arrow2.current) arrow2.current.position.x = 1 - (Math.sin(t * 2 + Math.PI) + 1) * 0.5;
  });

  return (
    <group ref={group}>
      <mesh>
        <boxGeometry args={[0.3, 1.6, 1.2]} />
        <meshStandardMaterial color={ACCENT_SECONDARY} emissive={ACCENT_SECONDARY} emissiveIntensity={0.3} roughness={0.3} metalness={0.6} />
      </mesh>
      <mesh ref={arrow1} position={[-1, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
        <coneGeometry args={[0.25, 0.6, 32]} />
        <meshStandardMaterial color={ACCENT} emissive={ACCENT} emissiveIntensity={0.5} />
      </mesh>
      <mesh ref={arrow2} position={[1, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <coneGeometry args={[0.25, 0.6, 32]} />
        <meshStandardMaterial color={ACCENT} emissive={ACCENT} emissiveIntensity={0.5} />
      </mesh>
    </group>
  );
}

function ComposeScene() {
  const group = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (group.current) group.current.rotation.y = t * 0.35;
  });

  return (
    <group ref={group}>
      {[0, 1, 2].map((i) => (
        <mesh key={i} position={[0, i * 0.35 - 0.35, 0]}>
          <boxGeometry args={[1.4 - i * 0.15, 0.25, 1.4 - i * 0.15]} />
          <meshStandardMaterial
            color={i % 2 === 0 ? ACCENT : ACCENT_SECONDARY}
            emissive={i % 2 === 0 ? ACCENT : ACCENT_SECONDARY}
            emissiveIntensity={0.4}
            roughness={0.3}
            metalness={0.5}
          />
        </mesh>
      ))}
    </group>
  );
}

function GenericScene() {
  const group = useRef<THREE.Group>(null);
  const ring1 = useRef<THREE.Mesh>(null);
  const ring2 = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (group.current) group.current.rotation.y = t * 0.4;
    if (ring1.current) ring1.current.rotation.x = t * 0.6;
    if (ring2.current) ring2.current.rotation.z = t * 0.5;
  });

  return (
    <group ref={group}>
      <mesh>
        <sphereGeometry args={[0.6, 32, 32]} />
        <meshStandardMaterial color={ACCENT} emissive={ACCENT} emissiveIntensity={1} roughness={0.2} metalness={0.8} />
      </mesh>
      <mesh ref={ring1}>
        <torusGeometry args={[1, 0.04, 16, 64]} />
        <meshBasicMaterial color={ACCENT_SECONDARY} transparent opacity={0.5} />
      </mesh>
      <mesh ref={ring2} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[1.3, 0.03, 16, 64]} />
        <meshBasicMaterial color={ACCENT} transparent opacity={0.35} />
      </mesh>
    </group>
  );
}

function Scene({ variant }: { variant: LoaderVariant }) {
  return (
    <>
      <PerspectiveCamera makeDefault position={[0, 0, 5]} fov={50} />
      <ambientLight intensity={0.4} />
      <pointLight position={[5, 5, 5]} intensity={1.5} color={ACCENT} />
      <pointLight position={[-5, -5, -3]} intensity={1} color={ACCENT_SECONDARY} />
      {variant === "container" && <ContainerScene />}
      {variant === "image" && <ImageScene />}
      {variant === "project" && <ProjectScene />}
      {variant === "deploy" && <DeployScene />}
      {variant === "proxy" && <ProxyScene />}
      {variant === "compose" && <ComposeScene />}
      {variant === "generic" && <GenericScene />}
    </>
  );
}

export function LoaderOverlay3D({ open, variant = "generic", title, subtitle }: LoaderOverlay3DProps) {
  if (!open) return null;

  const displayTitle = title || {
    container: "Working with containers...",
    image: "Working with images...",
    project: "Working with projects...",
    deploy: "Deploying...",
    proxy: "Updating proxy...",
    compose: "Running compose...",
    generic: "Loading...",
  }[variant];

  return (
    <div className="fixed inset-0 z-[80] flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="w-64 h-64">
        <Canvas dpr={[1, 1.5]} gl={{ antialias: true, alpha: true }}>
          <Scene variant={variant} />
        </Canvas>
      </div>
      <div className="text-center -mt-4">
        <h3 className="text-lg font-semibold text-foreground animate-pulse">{displayTitle}</h3>
        {subtitle && <p className="text-sm text-muted mt-1 max-w-xs">{subtitle}</p>}
      </div>
    </div>
  );
}
