"use client";

import { useRef, useMemo, useEffect, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { PerspectiveCamera } from "@react-three/drei";
import * as THREE from "three";

const ACCENT = new THREE.Color("#ff5500");
const ACCENT_GLOW = new THREE.Color("#ff7b29");
const ACCENT_SECONDARY = new THREE.Color("#c77dff");
const CYAN = new THREE.Color("#00d4ff");
const GOLD = new THREE.Color("#f59e0b");
const BG = "#050507";

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ */
/* Central command hub — larger, more commanding                      */
/* ------------------------------------------------------------------ */
function ControlHub() {
  const coreRef = useRef<THREE.Mesh>(null);
  const ringA = useRef<THREE.Mesh>(null);
  const ringB = useRef<THREE.Mesh>(null);
  const ringC = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (coreRef.current) {
      coreRef.current.rotation.y = t * 0.1;
      coreRef.current.rotation.x = Math.sin(t * 0.25) * 0.03;
    }
    if (ringA.current) ringA.current.rotation.z = t * 0.06;
    if (ringB.current) ringB.current.rotation.x = t * 0.04;
    if (ringC.current) ringC.current.rotation.y = -t * 0.025;
  });

  return (
    <group position={[-2.5, 0.2, 0]}>
      <mesh ref={coreRef}>
        <sphereGeometry args={[1.35, 64, 64]} />
        <meshStandardMaterial
          color={ACCENT}
          emissive={ACCENT}
          emissiveIntensity={1.6}
          roughness={0.1}
          metalness={0.95}
        />
      </mesh>
      <mesh ref={ringA} rotation={[0.2, 0.3, 0]}>
        <torusGeometry args={[2, 0.025, 16, 128]} />
        <meshBasicMaterial color={ACCENT} transparent opacity={0.3} />
      </mesh>
      <mesh ref={ringB} rotation={[Math.PI / 2.1, 0.4, 0]}>
        <torusGeometry args={[2.7, 0.018, 16, 128]} />
        <meshBasicMaterial color={ACCENT_SECONDARY} transparent opacity={0.18} />
      </mesh>
      <mesh ref={ringC} rotation={[0.15, 0, 0.35]}>
        <torusGeometry args={[3.3, 0.012, 16, 128]} />
        <meshBasicMaterial color={CYAN} transparent opacity={0.1} />
      </mesh>
      <PulseRing radius={3.6} color={ACCENT} speed={0.55} />
      <PulseRing radius={4.8} color={ACCENT_SECONDARY} speed={0.4} delay={1.2} />
    </group>
  );
}

function PulseRing({ radius, color, speed, delay = 0 }: { radius: number; color: THREE.Color; speed: number; delay?: number }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = ((clock.getElapsedTime() + delay) * speed) % 1;
    const s = 1 + t * 0.3;
    ref.current.scale.set(s, s, s);
    (ref.current.material as THREE.MeshBasicMaterial).opacity = 0.22 * (1 - t);
  });
  return (
    <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]} position={[-2.5, -0.6, 0]}>
      <ringGeometry args={[radius * 0.9, radius, 128]} />
      <meshBasicMaterial color={color} transparent opacity={0.22} />
    </mesh>
  );
}

/* ------------------------------------------------------------------ */
/* Ground station — large base platform with structural columns       */
/* ------------------------------------------------------------------ */
function GroundStation() {
  const baseRef = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (baseRef.current) baseRef.current.rotation.y = Math.sin(clock.getElapsedTime() * 0.08) * 0.03;
  });

  return (
    <group ref={baseRef} position={[-2.5, -2.2, 0]}>
      {/* main deck */}
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[3.8, 4.2, 0.25, 8]} />
        <meshStandardMaterial color="#13131a" roughness={0.4} metalness={0.8} />
      </mesh>
      {/* inner ring */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.14, 0]}>
        <ringGeometry args={[2.2, 3.6, 64]} />
        <meshBasicMaterial color={ACCENT} transparent opacity={0.08} />
      </mesh>
      {/* support columns */}
      {Array.from({ length: 8 }).map((_, i) => {
        const a = (i / 8) * Math.PI * 2;
        const r = 3.4;
        return (
          <mesh key={i} position={[Math.cos(a) * r, -0.8, Math.sin(a) * r]}>
            <cylinderGeometry args={[0.08, 0.08, 1.6, 12]} />
            <meshStandardMaterial color="#1f1f2a" metalness={0.7} roughness={0.4} />
          </mesh>
        );
      })}
      {/* runway lights */}
      {Array.from({ length: 16 }).map((_, i) => {
        const a = (i / 16) * Math.PI * 2;
        const r = 3.0;
        return (
          <mesh key={i} position={[Math.cos(a) * r, 0.16, Math.sin(a) * r]}>
            <sphereGeometry args={[0.06, 8, 8]} />
            <meshBasicMaterial color={i % 2 === 0 ? ACCENT : CYAN} transparent opacity={0.7} />
          </mesh>
        );
      })}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Satellite dish pointing at the hub                                 */
/* ------------------------------------------------------------------ */
function SatelliteDish({ position }: { position: [number, number, number] }) {
  const groupRef = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (groupRef.current) {
      groupRef.current.position.y = position[1] + Math.sin(clock.getElapsedTime() * 0.4 + position[0]) * 0.05;
    }
  });

  return (
    <group ref={groupRef} position={position}>
      {/* stand */}
      <mesh position={[0, -0.7, 0]}>
        <cylinderGeometry args={[0.1, 0.15, 1.4, 16]} />
        <meshStandardMaterial color="#1f1f2a" metalness={0.7} roughness={0.4} />
      </mesh>
      {/* dish */}
      <group rotation={[0, 0, -0.4]} position={[0, 0.2, 0]}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <sphereGeometry args={[1.2, 32, 16, 0, Math.PI * 2, 0, 0.5]} />
          <meshStandardMaterial color="#e2e8f0" roughness={0.25} metalness={0.6} side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[0, 0.05, 0]}>
          <cylinderGeometry args={[0.08, 0.08, 0.8, 12]} />
          <meshStandardMaterial color={ACCENT} emissive={ACCENT} emissiveIntensity={0.4} />
        </mesh>
      </group>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Data tower — tall vertical structure with glowing segments         */
/* ------------------------------------------------------------------ */
function DataTower({ position }: { position: [number, number, number] }) {
  const towerRef = useRef<THREE.Group>(null);
  const ringsRef = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    if (towerRef.current) {
      towerRef.current.position.y = position[1] + Math.sin(clock.getElapsedTime() * 0.3 + 2) * 0.06;
    }
    if (ringsRef.current) {
      ringsRef.current.children.forEach((child, i) => {
        const mat = (child as THREE.Mesh).material as THREE.MeshBasicMaterial;
        const t = clock.getElapsedTime() * 1.5 + i;
        mat.opacity = 0.25 + Math.max(0, Math.sin(t)) * 0.55;
      });
    }
  });

  return (
    <group ref={towerRef} position={position}>
      {/* spine */}
      <mesh>
        <cylinderGeometry args={[0.18, 0.25, 4.5, 8]} />
        <meshStandardMaterial color="#16161f" metalness={0.8} roughness={0.35} />
      </mesh>
      {/* stacked rings */}
      <group ref={ringsRef}>
        {Array.from({ length: 5 }).map((_, i) => (
          <mesh key={i} position={[0, -1.6 + i * 0.8, 0]}>
            <torusGeometry args={[0.55 - i * 0.05, 0.035, 12, 48]} />
            <meshBasicMaterial color={i % 2 === 0 ? ACCENT_SECONDARY : CYAN} transparent opacity={0.6} />
          </mesh>
        ))}
      </group>
      {/* antenna tip */}
      <mesh position={[0, 2.5, 0]}>
        <cylinderGeometry args={[0.02, 0.02, 1.2, 8]} />
        <meshBasicMaterial color={ACCENT} transparent opacity={0.8} />
      </mesh>
      <mesh position={[0, 3.2, 0]}>
        <sphereGeometry args={[0.12, 16, 16]} />
        <meshBasicMaterial color={ACCENT} transparent opacity={0.9} />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Network globe — wireframe sphere with orbiting nodes               */
/* ------------------------------------------------------------------ */
function NetworkGlobe({ position }: { position: [number, number, number] }) {
  const globeRef = useRef<THREE.Group>(null);
  const nodesRef = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    if (globeRef.current) globeRef.current.rotation.y = clock.getElapsedTime() * 0.04;
    if (nodesRef.current) nodesRef.current.rotation.y = -clock.getElapsedTime() * 0.06;
  });

  const wireGeo = useMemo(() => {
    const geo = new THREE.IcosahedronGeometry(1.6, 2);
    const edges = new THREE.EdgesGeometry(geo);
    return edges;
  }, []);

  return (
    <group position={position}>
      <group ref={globeRef}>
        <lineSegments geometry={wireGeo}>
          <lineBasicMaterial color={CYAN} transparent opacity={0.15} />
        </lineSegments>
      </group>
      <group ref={nodesRef}>
        {Array.from({ length: 8 }).map((_, i) => {
          const a = (i / 8) * Math.PI * 2;
          const r = 1.8;
          return (
            <mesh key={i} position={[Math.cos(a) * r, Math.sin(a * 1.3) * 0.8, Math.sin(a) * r]}>
              <octahedronGeometry args={[0.12, 0]} />
              <meshStandardMaterial color={i % 2 === 0 ? CYAN : ACCENT_GLOW} emissive={i % 2 === 0 ? CYAN : ACCENT_GLOW} emissiveIntensity={0.6} />
            </mesh>
          );
        })}
      </group>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Hex platform — floating landing pad                                */
/* ------------------------------------------------------------------ */
function HexPlatform({ position, scale = 1, color = ACCENT_SECONDARY }: { position: [number, number, number]; scale?: number; color?: THREE.Color }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (ref.current) {
      ref.current.position.y = position[1] + Math.sin(clock.getElapsedTime() * 0.35 + position[0]) * 0.06;
      ref.current.rotation.y = clock.getElapsedTime() * 0.03;
    }
  });

  return (
    <group ref={ref} position={position} scale={scale}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[1, 1, 0.08, 6]} />
        <meshStandardMaterial color="#16161f" metalness={0.7} roughness={0.4} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.06, 0]}>
        <ringGeometry args={[0.7, 0.95, 6]} />
        <meshBasicMaterial color={color} transparent opacity={0.25} />
      </mesh>
      <mesh position={[0, 0.2, 0]}>
        <boxGeometry args={[0.25, 0.35, 0.25]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.3} />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Data crystal — angular shard clusters                              */
/* ------------------------------------------------------------------ */
function DataCrystal({ position, scale = 1 }: { position: [number, number, number]; scale?: number }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (ref.current) {
      ref.current.rotation.y = clock.getElapsedTime() * 0.12;
      ref.current.rotation.z = Math.sin(clock.getElapsedTime() * 0.4) * 0.05;
    }
  });

  return (
    <group ref={ref} position={position} scale={scale}>
      {[
        { pos: [0, 0, 0], rot: [0, 0, 0], size: [0.35, 1.1, 0.35] },
        { pos: [0.25, 0.1, 0.15], rot: [0.2, 0.4, 0.1], size: [0.28, 0.85, 0.28] },
        { pos: [-0.2, -0.05, 0.2], rot: [-0.15, -0.3, 0.2], size: [0.22, 0.65, 0.22] },
      ].map((s, i) => (
        <mesh key={i} position={s.pos as [number, number, number]} rotation={s.rot as [number, number, number]}>
          <cylinderGeometry args={[(s.size[0] as number) / 2, (s.size[0] as number) / 4, s.size[1] as number, 6]} />
          <meshStandardMaterial
            color={i === 0 ? ACCENT : i === 1 ? ACCENT_SECONDARY : CYAN}
            emissive={i === 0 ? ACCENT : i === 1 ? ACCENT_SECONDARY : CYAN}
            emissiveIntensity={0.35}
            roughness={0.15}
            metalness={0.6}
            transparent
            opacity={0.9}
          />
        </mesh>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Energy ring — large orbital structure                              */
/* ------------------------------------------------------------------ */
function EnergyRing({ radius, color, speed, tilt = 0 }: { radius: number; color: THREE.Color; speed: number; tilt?: number }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (ref.current) ref.current.rotation.z = clock.getElapsedTime() * speed;
  });

  return (
    <mesh ref={ref} rotation={[Math.PI / 2, tilt, 0]} position={[-2.5, 0, 0]}>
      <torusGeometry args={[radius, 0.015, 12, 160]} />
      <meshBasicMaterial color={color} transparent opacity={0.08} />
    </mesh>
  );
}

/* ------------------------------------------------------------------ */
/* Connection beam with flowing particles                             */
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
    const mid = from.clone().lerp(to, 0.5).add(new THREE.Vector3(0, 0.5, 0));
    const curve = new THREE.QuadraticBezierCurve3(from, mid, to);
    return curve.getPoints(48).map((p) => p.toArray()).flat();
  }, [from, to]);

  const lineGeo = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(linePoints), 3));
    return geo;
  }, [linePoints]);

  const particlesRef = useRef<THREE.Group>(null);
  const curve = useMemo(() => {
    const mid = from.clone().lerp(to, 0.5).add(new THREE.Vector3(0, 0.5, 0));
    return new THREE.QuadraticBezierCurve3(from, mid, to);
  }, [from, to]);

  useFrame(({ clock }) => {
    if (!particlesRef.current) return;
    particlesRef.current.children.forEach((child, i) => {
      const t = (clock.getElapsedTime() * speed + i / particleCount) % 1;
      (child as THREE.Mesh).position.copy(curve.getPoint(t));
      ((child as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.3 + Math.sin(t * Math.PI) * 0.7;
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
            <sphereGeometry args={[0.07, 12, 12]} />
            <meshBasicMaterial color={color} transparent opacity={0.85} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Starfield                                                          */
/* ------------------------------------------------------------------ */
function Starfield({ count = 220 }: { count?: number }) {
  const geometry = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const rand = mulberry32(99);
    for (let i = 0; i < count; i++) {
      const r = 10 + rand() * 36;
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
    if (ref.current) ref.current.rotation.y = clock.getElapsedTime() * 0.006;
  });

  return (
    <points ref={ref} geometry={geometry}>
      <pointsMaterial size={0.05} color={ACCENT_SECONDARY} transparent opacity={0.3} sizeAttenuation />
    </points>
  );
}

/* ------------------------------------------------------------------ */
/* Scene composition                                                  */
/* ------------------------------------------------------------------ */
function Scene({ mouseRef, isMobile }: { mouseRef: React.RefObject<{ x: number; y: number } | null>; isMobile: boolean }) {
  const groupRef = useRef<THREE.Group>(null);
  const target = useRef({ x: 0, y: 0 });

  useFrame(() => {
    if (groupRef.current && mouseRef.current) {
      target.current.x += (mouseRef.current.x * 0.5 - target.current.x) * 0.025;
      target.current.y += (mouseRef.current.y * 0.28 - target.current.y) * 0.025;
      groupRef.current.position.x = target.current.x;
      groupRef.current.position.y = target.current.y;
    }
  });

  const hub = new THREE.Vector3(-2.5, 0.2, 0);
  const dish = new THREE.Vector3(-7.2, 3.2, -2.5);
  const tower = new THREE.Vector3(-7.5, -1.5, 1.5);
  const globe = new THREE.Vector3(1.5, 2.5, -2.8);
  const crystal = new THREE.Vector3(2.5, -1.8, 1.2);

  return (
    <group ref={groupRef}>
      <PerspectiveCamera makeDefault position={[1.5, 0.5, isMobile ? 17 : 15]} fov={isMobile ? 58 : 52} />
      <ambientLight intensity={0.18} />
      <pointLight position={[5, 5, 6]} intensity={1.4} color={ACCENT_GLOW} />
      <pointLight position={[-6, -2, -4]} intensity={0.7} color={ACCENT_SECONDARY} />
      <pointLight position={[3, -3, 4]} intensity={0.5} color={CYAN} />

      <Starfield count={isMobile ? 100 : 220} />

      {/* Massive background orbital rings */}
      <EnergyRing radius={9} color={ACCENT} speed={0.012} tilt={0.15} />
      <EnergyRing radius={11} color={ACCENT_SECONDARY} speed={-0.008} tilt={-0.25} />
      <EnergyRing radius={7.5} color={CYAN} speed={0.015} tilt={0.4} />

      <GroundStation />
      <ControlHub />

      <SatelliteDish position={[-7.2, 3.2, -2.5]} />
      <DataTower position={[-7.5, -1.5, 1.5]} />
      <NetworkGlobe position={[1.5, 2.5, -2.8]} />
      <DataCrystal position={[2.5, -1.8, 1.2]} scale={1.2} />

      <HexPlatform position={[-6.2, -3.5, -1]} scale={0.9} color={ACCENT} />
      <HexPlatform position={[-0.5, 4.2, -1.5]} scale={0.7} color={CYAN} />
      <HexPlatform position={[3.8, 1.5, -1]} scale={0.6} color={ACCENT_SECONDARY} />
      <HexPlatform position={[-5.5, 0.5, 3]} scale={0.5} color={GOLD} />

      <ConnectionBeam from={hub} to={dish} color={ACCENT} particleCount={3} speed={0.35} />
      <ConnectionBeam from={hub} to={tower} color={ACCENT_SECONDARY} particleCount={2} speed={0.28} />
      <ConnectionBeam from={hub} to={globe} color={CYAN} particleCount={3} speed={0.4} />
      <ConnectionBeam from={hub} to={crystal} color={ACCENT_GLOW} particleCount={2} speed={0.32} />
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
        <fog attach="fog" args={[BG, isMobile ? 20 : 26, isMobile ? 52 : 62]} />
        <Scene mouseRef={mouseRef} isMobile={isMobile} />
      </Canvas>
    </div>
  );
}
