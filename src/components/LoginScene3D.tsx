"use client";

import { useRef, useMemo, useEffect, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { PerspectiveCamera } from "@react-three/drei";
import * as THREE from "three";

const ACCENT = new THREE.Color("#ff5500");
const ACCENT_GLOW = new THREE.Color("#ff7b29");
const ACCENT_SECONDARY = new THREE.Color("#c77dff");
const CYAN = new THREE.Color("#00d4ff");
const CLOUD = new THREE.Color("#e2e8f0");
const BG = "#08080a";

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ */
/* Central mission-control hub                                        */
/* ------------------------------------------------------------------ */
function ControlHub() {
  const coreRef = useRef<THREE.Mesh>(null);
  const ringARef = useRef<THREE.Mesh>(null);
  const ringBRef = useRef<THREE.Mesh>(null);
  const ringCRef = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (coreRef.current) {
      coreRef.current.rotation.y = t * 0.12;
      coreRef.current.rotation.x = Math.sin(t * 0.3) * 0.04;
    }
    if (ringARef.current) ringARef.current.rotation.z = t * 0.08;
    if (ringBRef.current) ringBRef.current.rotation.x = t * 0.05;
    if (ringCRef.current) ringCRef.current.rotation.y = -t * 0.03;
  });

  return (
    <group position={[-3.2, 0, 0]}>
      <mesh ref={coreRef}>
        <sphereGeometry args={[1.1, 64, 64]} />
        <meshStandardMaterial
          color={ACCENT}
          emissive={ACCENT}
          emissiveIntensity={1.4}
          roughness={0.15}
          metalness={0.95}
        />
      </mesh>
      <mesh ref={ringARef} rotation={[0.3, 0.2, 0]}>
        <torusGeometry args={[1.7, 0.02, 16, 128]} />
        <meshBasicMaterial color={ACCENT} transparent opacity={0.35} />
      </mesh>
      <mesh ref={ringBRef} rotation={[Math.PI / 2.2, 0.5, 0]}>
        <torusGeometry args={[2.2, 0.015, 16, 128]} />
        <meshBasicMaterial color={ACCENT_SECONDARY} transparent opacity={0.2} />
      </mesh>
      <mesh ref={ringCRef} rotation={[0.1, 0, 0.4]}>
        <torusGeometry args={[2.7, 0.01, 16, 128]} />
        <meshBasicMaterial color={CYAN} transparent opacity={0.12} />
      </mesh>
      {/* base platform */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.8, 0]}>
        <ringGeometry args={[1.4, 2.6, 64]} />
        <meshBasicMaterial color={ACCENT} transparent opacity={0.06} />
      </mesh>
      {/* pulse rings */}
      <PulseRing radius={3} color={ACCENT} speed={0.6} />
      <PulseRing radius={4.2} color={ACCENT_SECONDARY} speed={0.45} delay={1.5} />
    </group>
  );
}

function PulseRing({
  radius,
  color,
  speed,
  delay = 0,
}: {
  radius: number;
  color: THREE.Color;
  speed: number;
  delay?: number;
}) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = (clock.getElapsedTime() + delay) * speed;
    const phase = t % 1;
    const scale = 1 + phase * 0.25;
    ref.current.scale.set(scale, scale, scale);
    const mat = ref.current.material as THREE.MeshBasicMaterial;
    mat.opacity = 0.25 * (1 - phase);
  });
  return (
    <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.8, 0]}>
      <ringGeometry args={[radius * 0.85, radius, 128]} />
      <meshBasicMaterial color={color} transparent opacity={0.25} />
    </mesh>
  );
}

/* ------------------------------------------------------------------ */
/* VPS server rack                                                    */
/* ------------------------------------------------------------------ */
function ServerRack({ position }: { position: [number, number, number] }) {
  const groupRef = useRef<THREE.Group>(null);
  const lightsRef = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    if (groupRef.current) {
      groupRef.current.rotation.y = Math.sin(clock.getElapsedTime() * 0.2) * 0.08;
      groupRef.current.position.y = position[1] + Math.sin(clock.getElapsedTime() * 0.5 + position[0]) * 0.08;
    }
    if (lightsRef.current) {
      lightsRef.current.children.forEach((child, i) => {
        const mat = (child as THREE.Mesh).material as THREE.MeshBasicMaterial;
        const t = clock.getElapsedTime() * 2 + i * 1.3;
        mat.opacity = 0.4 + Math.max(0, Math.sin(t)) * 0.6;
      });
    }
  });

  return (
    <group ref={groupRef} position={position}>
      {/* chassis */}
      <mesh>
        <boxGeometry args={[1.2, 2, 0.9]} />
        <meshStandardMaterial color="#1a1a20" roughness={0.4} metalness={0.8} />
      </mesh>
      {/* faceplate */}
      <mesh position={[0, 0, 0.46]}>
        <boxGeometry args={[1.1, 1.9, 0.04]} />
        <meshStandardMaterial color="#0f0f12" roughness={0.5} metalness={0.6} />
      </mesh>
      {/* slots + lights */}
      <group ref={lightsRef}>
        {Array.from({ length: 6 }).map((_, i) => (
          <group key={i} position={[0, -0.65 + i * 0.26, 0.5]}>
            <mesh position={[-0.35, 0, 0]}>
              <boxGeometry args={[0.35, 0.04, 0.02]} />
              <meshBasicMaterial color="#333" />
            </mesh>
            <mesh position={[0.35, 0, 0]}>
              <circleGeometry args={[0.04, 16]} />
              <meshBasicMaterial color={i % 3 === 0 ? ACCENT : i % 3 === 1 ? CYAN : ACCENT_SECONDARY} transparent opacity={0.8} />
            </mesh>
          </group>
        ))}
      </group>
      {/* label */}
      <mesh position={[0, -1.15, 0.5]}>
        <planeGeometry args={[0.6, 0.12]} />
        <meshBasicMaterial color="#222" />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Database stack                                                     */
/* ------------------------------------------------------------------ */
function DatabaseStack({ position }: { position: [number, number, number] }) {
  const groupRef = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (groupRef.current) {
      groupRef.current.rotation.y = clock.getElapsedTime() * 0.15;
      groupRef.current.position.y = position[1] + Math.sin(clock.getElapsedTime() * 0.4 + 2) * 0.06;
    }
  });

  return (
    <group ref={groupRef} position={position}>
      {Array.from({ length: 3 }).map((_, i) => (
        <mesh key={i} position={[0, -0.35 + i * 0.35, 0]}>
          <cylinderGeometry args={[0.45, 0.45, 0.22, 32]} />
          <meshStandardMaterial
            color={i === 1 ? ACCENT_SECONDARY : "#2a2a35"}
            emissive={i === 1 ? ACCENT_SECONDARY : "#000"}
            emissiveIntensity={i === 1 ? 0.3 : 0}
            roughness={0.3}
            metalness={0.8}
          />
        </mesh>
      ))}
      {/* glow cap */}
      <mesh position={[0, 0.25, 0]}>
        <cylinderGeometry args={[0.46, 0.46, 0.02, 32]} />
        <meshBasicMaterial color={ACCENT_SECONDARY} transparent opacity={0.4} />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Container ship / box                                               */
/* ------------------------------------------------------------------ */
function ContainerBox({ position }: { position: [number, number, number] }) {
  const groupRef = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (groupRef.current) {
      groupRef.current.rotation.y = clock.getElapsedTime() * 0.25;
      groupRef.current.rotation.z = Math.sin(clock.getElapsedTime() * 0.7) * 0.05;
      groupRef.current.position.y = position[1] + Math.sin(clock.getElapsedTime() * 0.6 + 4) * 0.1;
    }
  });

  return (
    <group ref={groupRef} position={position}>
      <mesh>
        <boxGeometry args={[0.9, 0.9, 0.9]} />
        <meshStandardMaterial color="#2563eb" roughness={0.2} metalness={0.6} />
      </mesh>
      {/* whale stripes */}
      <mesh position={[0, 0.15, 0.46]}>
        <planeGeometry args={[0.6, 0.12]} />
        <meshBasicMaterial color="#fff" transparent opacity={0.9} />
      </mesh>
      <mesh position={[0, -0.1, 0.46]}>
        <planeGeometry args={[0.4, 0.1]} />
        <meshBasicMaterial color="#fff" transparent opacity={0.6} />
      </mesh>
      {/* corner ribs */}
      {[-0.42, 0.42].map((x) =>
        [-0.42, 0.42].map((y) => (
          <mesh key={`${x}-${y}`} position={[x, y, 0.46]}>
            <boxGeometry args={[0.04, 0.04, 0.04]} />
            <meshBasicMaterial color="#60a5fa" />
          </mesh>
        ))
      )}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Proxy / gateway shield                                             */
/* ------------------------------------------------------------------ */
function ProxyGateway({ position }: { position: [number, number, number] }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (ref.current) {
      ref.current.rotation.y = Math.sin(clock.getElapsedTime() * 0.3) * 0.15;
      ref.current.position.y = position[1] + Math.sin(clock.getElapsedTime() * 0.5 + 1) * 0.08;
    }
  });

  return (
    <mesh ref={ref} position={position}>
      <octahedronGeometry args={[0.7, 0]} />
      <meshStandardMaterial
        color={CYAN}
        emissive={CYAN}
        emissiveIntensity={0.35}
        roughness={0.2}
        metalness={0.8}
        transparent
        opacity={0.9}
      />
    </mesh>
  );
}

/* ------------------------------------------------------------------ */
/* Cloud relay                                                        */
/* ------------------------------------------------------------------ */
function CloudRelay({ position }: { position: [number, number, number] }) {
  const groupRef = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (groupRef.current) {
      groupRef.current.rotation.y = clock.getElapsedTime() * 0.06;
      groupRef.current.position.y = position[1] + Math.sin(clock.getElapsedTime() * 0.35 + 3) * 0.07;
    }
  });

  return (
    <group ref={groupRef} position={position}>
      {[
        [0, 0, 0, 0.55],
        [-0.4, 0.1, 0, 0.38],
        [0.42, -0.05, 0.1, 0.4],
        [-0.15, 0.25, -0.15, 0.32],
        [0.18, -0.22, 0.12, 0.3],
      ].map(([x, y, z, s], i) => (
        <mesh key={i} position={[x as number, y as number, z as number]}>
          <sphereGeometry args={[s as number, 24, 24]} />
          <meshStandardMaterial color="#e2e8f0" roughness={0.6} metalness={0.1} transparent opacity={0.85} />
        </mesh>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Connection beam with flowing data                                  */
/* ------------------------------------------------------------------ */
function ConnectionBeam({
  from,
  to,
  color = ACCENT,
  particleCount = 3,
  speed = 0.4,
}: {
  from: THREE.Vector3;
  to: THREE.Vector3;
  color?: THREE.Color;
  particleCount?: number;
  speed?: number;
}) {
  const linePoints = useMemo(() => {
    const mid = from.clone().lerp(to, 0.5).add(new THREE.Vector3(0, 0.4, 0));
    const curve = new THREE.QuadraticBezierCurve3(from, mid, to);
    return curve.getPoints(40).map((p) => p.toArray()).flat();
  }, [from, to]);

  const lineGeo = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(linePoints), 3));
    return geo;
  }, [linePoints]);

  const particlesRef = useRef<THREE.Group>(null);
  const curve = useMemo(() => {
    const mid = from.clone().lerp(to, 0.5).add(new THREE.Vector3(0, 0.4, 0));
    return new THREE.QuadraticBezierCurve3(from, mid, to);
  }, [from, to]);

  useFrame(({ clock }) => {
    if (!particlesRef.current) return;
    particlesRef.current.children.forEach((child, i) => {
      const t = ((clock.getElapsedTime() * speed + i / particleCount) % 1);
      const p = curve.getPoint(t);
      (child as THREE.Mesh).position.copy(p);
      const mat = (child as THREE.Mesh).material as THREE.MeshBasicMaterial;
      mat.opacity = 0.4 + Math.sin(t * Math.PI) * 0.6;
    });
  });

  return (
    <group>
      <lineSegments geometry={lineGeo}>
        <lineBasicMaterial color={color} transparent opacity={0.12} />
      </lineSegments>
      <group ref={particlesRef}>
        {Array.from({ length: particleCount }).map((_, i) => (
          <mesh key={i}>
            <sphereGeometry args={[0.06, 12, 12]} />
            <meshBasicMaterial color={color} transparent opacity={0.8} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Orbital containers around the hub                                  */
/* ------------------------------------------------------------------ */
function OrbitalContainers() {
  const groupRef = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (groupRef.current) {
      groupRef.current.rotation.y = clock.getElapsedTime() * 0.08;
      groupRef.current.rotation.x = Math.sin(clock.getElapsedTime() * 0.15) * 0.08;
    }
  });

  const configs = useMemo(
    () => [
      { radius: 2.6, angle: 0, y: 0.4, color: "#2563eb" },
      { radius: 2.8, angle: 2.1, y: -0.3, color: "#7c3aed" },
      { radius: 2.4, angle: 4.2, y: 0.2, color: "#0891b2" },
    ],
    []
  );

  return (
    <group ref={groupRef} position={[-3.2, 0, 0]}>
      {configs.map((c, i) => (
        <group key={i} position={[Math.cos(c.angle) * c.radius, c.y, Math.sin(c.angle) * c.radius]}>
          <mesh>
            <boxGeometry args={[0.35, 0.35, 0.35]} />
            <meshStandardMaterial color={c.color} roughness={0.3} metalness={0.6} />
          </mesh>
          <mesh position={[0, 0, 0.18]}>
            <planeGeometry args={[0.2, 0.05]} />
            <meshBasicMaterial color="#fff" transparent opacity={0.7} />
          </mesh>
        </group>
      ))}
      {/* orbit ring */}
      <mesh rotation={[Math.PI / 2.2, 0, 0]}>
        <torusGeometry args={[2.6, 0.008, 12, 96]} />
        <meshBasicMaterial color={ACCENT} transparent opacity={0.1} />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Ambient starfield                                                  */
/* ------------------------------------------------------------------ */
function Starfield({ count = 180 }: { count?: number }) {
  const geometry = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const rand = mulberry32(99);
    for (let i = 0; i < count; i++) {
      const r = 8 + rand() * 30;
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
    if (ref.current) ref.current.rotation.y = clock.getElapsedTime() * 0.008;
  });

  return (
    <points ref={ref} geometry={geometry}>
      <pointsMaterial size={0.045} color={ACCENT_SECONDARY} transparent opacity={0.35} sizeAttenuation />
    </points>
  );
}

/* ------------------------------------------------------------------ */
/* Full scene                                                         */
/* ------------------------------------------------------------------ */
function Scene({ mouseRef, isMobile }: { mouseRef: React.RefObject<{ x: number; y: number } | null>; isMobile: boolean }) {
  const groupRef = useRef<THREE.Group>(null);
  const target = useRef({ x: 0, y: 0 });
  const { viewport } = useThree();

  useFrame((state) => {
    if (groupRef.current && mouseRef.current) {
      target.current.x += (mouseRef.current.x * 0.6 - target.current.x) * 0.03;
      target.current.y += (mouseRef.current.y * 0.35 - target.current.y) * 0.03;
      groupRef.current.position.x = target.current.x;
      groupRef.current.position.y = target.current.y;
      groupRef.current.rotation.y = state.clock.getElapsedTime() * 0.005;
    }
  });

  // Adjust scene density/spread based on viewport width
  const spread = viewport.width < 6 ? 0.75 : 1;

  const hub = new THREE.Vector3(-3.2 * spread, 0, 0);
  const server = new THREE.Vector3(-6.2 * spread, 2.2, -1.5);
  const db = new THREE.Vector3(-6.4 * spread, -2.2, 1.2);
  const proxy = new THREE.Vector3(-1.2 * spread, 2.8, -1.2);
  const cloud = new THREE.Vector3(-1.4 * spread, -2.6, -1);

  return (
    <group ref={groupRef}>
      <PerspectiveCamera makeDefault position={[2, 0, isMobile ? 16 : 14]} fov={isMobile ? 55 : 48} />
      <ambientLight intensity={0.22} />
      <pointLight position={[4, 4, 6]} intensity={1.3} color={ACCENT_GLOW} />
      <pointLight position={[-6, -3, -4]} intensity={0.7} color={ACCENT_SECONDARY} />
      <pointLight position={[-2, 3, -3]} intensity={0.5} color={CYAN} />

      <Starfield count={isMobile ? 80 : 160} />
      <ControlHub />
      <OrbitalContainers />

      <ServerRack position={[-6.2 * spread, 2.2, -1.5]} />
      <DatabaseStack position={[-6.4 * spread, -2.2, 1.2]} />
      <ProxyGateway position={[-1.2 * spread, 2.8, -1.2]} />
      <CloudRelay position={[-1.4 * spread, -2.6, -1]} />
      <ContainerBox position={[-4.8 * spread, 0, 2.2]} />

      <ConnectionBeam from={hub} to={server} color={ACCENT} />
      <ConnectionBeam from={hub} to={db} color={ACCENT_SECONDARY} particleCount={2} speed={0.3} />
      <ConnectionBeam from={hub} to={proxy} color={CYAN} particleCount={2} speed={0.5} />
      <ConnectionBeam from={hub} to={cloud} color={CLOUD} particleCount={2} speed={0.25} />
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Public component                                                   */
/* ------------------------------------------------------------------ */
export default function LoginScene3D() {
  const mouseRef = useRef({ x: 0, y: 0 });
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    const onMove = (e: MouseEvent) => {
      mouseRef.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouseRef.current.y = -(e.clientY / window.innerHeight) * 2 + 1;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("resize", check);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("resize", check);
    };
  }, []);

  return (
    <div className="fixed inset-0 -z-10" style={{ background: BG }}>
      <Canvas
        dpr={isMobile ? [1, 1] : [1, 1.5]}
        gl={{ antialias: !isMobile, alpha: false, powerPreference: "high-performance" }}
      >
        <color attach="background" args={[BG]} />
        <fog attach="fog" args={[BG, isMobile ? 18 : 22, isMobile ? 45 : 50]} />
        <Scene mouseRef={mouseRef} isMobile={isMobile} />
      </Canvas>
    </div>
  );
}
