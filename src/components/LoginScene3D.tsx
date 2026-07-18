"use client";

import { useRef, useMemo, useEffect, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { PerspectiveCamera, Html, ContactShadows, RoundedBox } from "@react-three/drei";
import * as THREE from "three";

const ACCENT = new THREE.Color("#7c9cff");
const ACCENT_GLOW = new THREE.Color("#ff7b29");
const ACCENT_SECONDARY = new THREE.Color("#c77dff");
const CYAN = new THREE.Color("#00d4ff");
const BLUE = new THREE.Color("#2563eb");
const GOLD = new THREE.Color("#f59e0b");
const GREEN = new THREE.Color("#10b981");
const CLOUD = new THREE.Color("#e2e8f0");
const BG = "#050507";

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function ObjectLabel({ children, offset = [0, -1.2, 0] }: { children: React.ReactNode; offset?: [number, number, number] }) {
  return (
    <Html position={offset} center distanceFactor={12}>
      <div className="px-2.5 py-1 rounded-md bg-black/60 backdrop-blur-sm text-[11px] font-bold uppercase tracking-wider text-white/90 whitespace-nowrap shadow-lg pointer-events-none">
        {children}
      </div>
    </Html>
  );
}

/* ------------------------------------------------------------------ */
/* Ship control wheel — smaller, thicker, truly 3D                    */
/* ------------------------------------------------------------------ */
function ShipWheel({ position, scale = 1 }: { position: [number, number, number]; scale?: number }) {
  const spokeCount = 8;

  return (
    <group position={position} scale={scale}>
      {/* outer rim — thick torus */}
      <mesh castShadow receiveShadow>
        <torusGeometry args={[1.6, 0.18, 20, 100]} />
        <meshStandardMaterial color={ACCENT} emissive={ACCENT} emissiveIntensity={0.25} roughness={0.15} metalness={0.9} />
      </mesh>
      {/* inner rim */}
      <mesh castShadow receiveShadow>
        <torusGeometry args={[0.95, 0.09, 16, 80]} />
        <meshStandardMaterial color={ACCENT_GLOW} emissive={ACCENT_GLOW} emissiveIntensity={0.2} roughness={0.2} metalness={0.85} />
      </mesh>
      {/* spokes — cylinders for real depth */}
      {Array.from({ length: spokeCount }).map((_, i) => {
        const a = (i / spokeCount) * Math.PI * 2;
        return (
          <mesh key={i} rotation={[0, 0, a]} position={[Math.cos(a) * 1.28, Math.sin(a) * 1.28, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.07, 0.07, 1.3, 12]} />
            <meshStandardMaterial color="#c2410c" roughness={0.3} metalness={0.75} />
          </mesh>
        );
      })}
      {/* handle knobs */}
      {Array.from({ length: spokeCount }).map((_, i) => {
        const a = (i / spokeCount) * Math.PI * 2;
        return (
          <mesh key={i} position={[Math.cos(a) * 1.6, Math.sin(a) * 1.6, 0.12]} castShadow>
            <sphereGeometry args={[0.14, 24, 24]} />
            <meshStandardMaterial color={GOLD} emissive={GOLD} emissiveIntensity={0.2} roughness={0.15} metalness={0.85} />
          </mesh>
        );
      })}
      {/* central hub */}
      <mesh castShadow receiveShadow>
        <cylinderGeometry args={[0.4, 0.4, 0.45, 32]} />
        <meshStandardMaterial color={ACCENT} emissive={ACCENT} emissiveIntensity={0.8} roughness={0.1} metalness={0.95} />
      </mesh>
      <mesh position={[0, 0, 0.25]} castShadow>
        <sphereGeometry args={[0.2, 32, 32]} />
        <meshStandardMaterial color={GOLD} emissive={GOLD} emissiveIntensity={0.4} roughness={0.1} metalness={0.9} />
      </mesh>
      {/* pedestal */}
      <mesh position={[0, 0, -0.7]} castShadow receiveShadow>
        <cylinderGeometry args={[0.25, 0.4, 1, 24]} />
        <meshStandardMaterial color="#1f1f2a" metalness={0.7} roughness={0.35} />
      </mesh>
      <ObjectLabel offset={[0, -2.4, 0]}>Control</ObjectLabel>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Server rack — rounded, inset face, LEDs                            */
/* ------------------------------------------------------------------ */
function ServerRack({ position, scale = 1 }: { position: [number, number, number]; scale?: number }) {
  return (
    <group position={position} scale={scale}>
      <RoundedBox args={[1.3, 2.2, 1]} radius={0.06} smoothness={4} castShadow receiveShadow>
        <meshStandardMaterial color="#16161f" roughness={0.35} metalness={0.75} />
      </RoundedBox>
      <mesh position={[0, 0, 0.51]} castShadow receiveShadow>
        <boxGeometry args={[1.1, 2.0, 0.05]} />
        <meshStandardMaterial color="#0a0a0e" roughness={0.5} metalness={0.5} />
      </mesh>
      {Array.from({ length: 6 }).map((_, i) => (
        <group key={i} position={[0, -0.65 + i * 0.26, 0.56]}>
          <mesh position={[-0.32, 0, 0]}>
            <boxGeometry args={[0.4, 0.04, 0.02]} />
            <meshBasicMaterial color="#22222a" />
          </mesh>
          <mesh position={[0.32, 0, 0]}>
            <circleGeometry args={[0.05, 16]} />
            <meshBasicMaterial color={i % 3 === 0 ? GREEN : i % 3 === 1 ? CYAN : ACCENT} transparent opacity={0.9} />
          </mesh>
        </group>
      ))}
      <ObjectLabel offset={[0, -1.5, 0]}>Servers</ObjectLabel>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Computer — rounded monitor with depth                              */
/* ------------------------------------------------------------------ */
function Computer({ position, scale = 1 }: { position: [number, number, number]; scale?: number }) {
  return (
    <group position={position} scale={scale}>
      <RoundedBox args={[2, 1.3, 0.22]} radius={0.08} smoothness={4} castShadow receiveShadow>
        <meshStandardMaterial color="#111" roughness={0.25} metalness={0.55} />
      </RoundedBox>
      <mesh position={[0, 0, 0.12]} castShadow>
        <boxGeometry args={[1.8, 1.1, 0.02]} />
        <meshStandardMaterial color="#050507" roughness={0.2} metalness={0.3} />
      </mesh>
      <mesh position={[0, 0, 0.13]}>
        <planeGeometry args={[1.7, 1.0]} />
        <meshBasicMaterial color={CYAN} transparent opacity={0.1} />
      </mesh>
      {[
        { h: 0.32, x: -0.5 },
        { h: 0.55, x: -0.17 },
        { h: 0.4, x: 0.17 },
        { h: 0.68, x: 0.5 },
      ].map((bar, i) => (
        <mesh key={i} position={[bar.x, -0.15 + bar.h / 2, 0.14]}>
          <boxGeometry args={[0.18, bar.h, 0.02]} />
          <meshBasicMaterial color={ACCENT} transparent opacity={0.75} />
        </mesh>
      ))}
      <mesh position={[0, -0.9, -0.05]} castShadow receiveShadow>
        <boxGeometry args={[0.35, 0.5, 0.25]} />
        <meshStandardMaterial color="#222" metalness={0.6} roughness={0.35} />
      </mesh>
      <mesh position={[0, -1.15, -0.05]} castShadow receiveShadow>
        <boxGeometry args={[0.9, 0.12, 0.5]} />
        <meshStandardMaterial color="#222" metalness={0.6} roughness={0.35} />
      </mesh>
      <ObjectLabel offset={[0, -1.8, 0]}>Monitor</ObjectLabel>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Docker container — rounded, ribbed sides                           */
/* ------------------------------------------------------------------ */
function ContainerBox({ position, scale = 1 }: { position: [number, number, number]; scale?: number }) {
  return (
    <group position={position} scale={scale}>
      <RoundedBox args={[1.2, 1.2, 1.2]} radius={0.06} smoothness={4} castShadow receiveShadow>
        <meshStandardMaterial color={BLUE} roughness={0.2} metalness={0.6} />
      </RoundedBox>
      {/* side ribs */}
      {Array.from({ length: 5 }).map((_, i) => (
        <mesh key={i} position={[-0.5 + i * 0.25, 0, 0.61]} castShadow>
          <boxGeometry args={[0.04, 1.05, 0.04]} />
          <meshStandardMaterial color="#1d4ed8" roughness={0.3} metalness={0.6} />
        </mesh>
      ))}
      <mesh position={[0, 0.15, 0.62]}>
        <planeGeometry args={[0.65, 0.14]} />
        <meshBasicMaterial color="#fff" transparent opacity={0.95} />
      </mesh>
      <mesh position={[0, -0.1, 0.62]}>
        <planeGeometry args={[0.4, 0.1]} />
        <meshBasicMaterial color="#fff" transparent opacity={0.65} />
      </mesh>
      <ObjectLabel offset={[0, -1, 0]}>Containers</ObjectLabel>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Database — grooved cylinders                                       */
/* ------------------------------------------------------------------ */
function Database({ position, scale = 1 }: { position: [number, number, number]; scale?: number }) {
  return (
    <group position={position} scale={scale}>
      {Array.from({ length: 3 }).map((_, i) => (
        <group key={i} position={[0, -0.42 + i * 0.42, 0]}>
          <mesh castShadow receiveShadow>
            <cylinderGeometry args={[0.55, 0.55, 0.32, 36]} />
            <meshStandardMaterial
              color={i === 1 ? ACCENT_SECONDARY : "#252530"}
              emissive={i === 1 ? ACCENT_SECONDARY : "#000"}
              emissiveIntensity={i === 1 ? 0.25 : 0}
              roughness={0.25}
              metalness={0.8}
            />
          </mesh>
          <mesh position={[0, 0.16, 0]}>
            <cylinderGeometry args={[0.56, 0.56, 0.015, 36]} />
            <meshBasicMaterial color="#3a3a4a" transparent opacity={0.6} />
          </mesh>
          <mesh position={[0, -0.16, 0]}>
            <cylinderGeometry args={[0.56, 0.56, 0.015, 36]} />
            <meshBasicMaterial color="#3a3a4a" transparent opacity={0.6} />
          </mesh>
        </group>
      ))}
      <ObjectLabel offset={[0, -1.1, 0]}>Databases</ObjectLabel>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Cloud relay — volumetric spheres                                   */
/* ------------------------------------------------------------------ */
function CloudNode({ position, scale = 1 }: { position: [number, number, number]; scale?: number }) {
  return (
    <group position={position} scale={scale}>
      {[
        [0, 0, 0, 0.7],
        [-0.48, 0.08, 0.1, 0.45],
        [0.5, -0.04, 0.05, 0.48],
        [0.15, 0.25, -0.12, 0.35],
      ].map(([x, y, z, s], i) => (
        <mesh key={i} position={[x as number, y as number, z as number]} castShadow receiveShadow>
          <sphereGeometry args={[s as number, 32, 32]} />
          <meshStandardMaterial color="#e2e8f0" roughness={0.5} metalness={0.1} transparent opacity={0.9} />
        </mesh>
      ))}
      <ObjectLabel offset={[0, -1.1, 0]}>Cloud</ObjectLabel>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Proxy gateway — 3D shield with frame                               */
/* ------------------------------------------------------------------ */
function ProxyGateway({ position, scale = 1 }: { position: [number, number, number]; scale?: number }) {
  return (
    <group position={position} scale={scale}>
      <mesh castShadow receiveShadow>
        <octahedronGeometry args={[0.75, 0]} />
        <meshStandardMaterial color={CYAN} emissive={CYAN} emissiveIntensity={0.2} roughness={0.15} metalness={0.85} transparent opacity={0.9} />
      </mesh>
      <mesh position={[0, 0, 0.12]} castShadow>
        <octahedronGeometry args={[0.38, 0]} />
        <meshStandardMaterial color="#050507" roughness={0.3} metalness={0.6} />
      </mesh>
      <mesh position={[0, 0, 0.3]} castShadow>
        <boxGeometry args={[0.18, 0.18, 0.05]} />
        <meshStandardMaterial color={CYAN} emissive={CYAN} emissiveIntensity={0.6} />
      </mesh>
      <ObjectLabel offset={[0, -1.2, 0]}>Proxy</ObjectLabel>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Connection beams                                                   */
/* ------------------------------------------------------------------ */
function ConnectionBeam({ from, to, color = ACCENT }: { from: THREE.Vector3; to: THREE.Vector3; color?: THREE.Color }) {
  const linePoints = useMemo(() => {
    const mid = from.clone().lerp(to, 0.5).add(new THREE.Vector3(0, 0.4, 0));
    const curve = new THREE.QuadraticBezierCurve3(from, mid, to);
    return curve.getPoints(48).map((p) => p.toArray()).flat();
  }, [from, to]);

  const lineGeo = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(linePoints), 3));
    return geo;
  }, [linePoints]);

  return (
    <lineSegments geometry={lineGeo}>
      <lineBasicMaterial color={color} transparent opacity={0.1} />
    </lineSegments>
  );
}

/* ------------------------------------------------------------------ */
/* Starfield                                                          */
/* ------------------------------------------------------------------ */
function Starfield({ count = 160 }: { count?: number }) {
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
    if (ref.current) ref.current.rotation.y = clock.getElapsedTime() * 0.004;
  });

  return (
    <points ref={ref} geometry={geometry}>
      <pointsMaterial size={0.045} color={ACCENT_SECONDARY} transparent opacity={0.25} sizeAttenuation />
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
      target.current.x += (mouseRef.current.x * 0.35 - target.current.x) * 0.02;
      target.current.y += (mouseRef.current.y * 0.2 - target.current.y) * 0.02;
      groupRef.current.position.x = target.current.x;
      groupRef.current.position.y = target.current.y;
    }
  });

  const wheel = new THREE.Vector3(-2.8, 0, 0);
  const server = new THREE.Vector3(-6.8, 3.2, -1.5);
  const computer = new THREE.Vector3(-6.2, -3.2, 1.5);
  const container = new THREE.Vector3(-0.6, 3.6, 1.5);
  const database = new THREE.Vector3(3.6, -2.8, 1.5);
  const cloud = new THREE.Vector3(0.4, -4, -1.5);
  const proxy = new THREE.Vector3(5.4, 0.4, -1.5);

  return (
    <group ref={groupRef}>
      <PerspectiveCamera makeDefault position={[1.2, 0.4, isMobile ? 17 : 15]} fov={isMobile ? 56 : 52} />
      <ambientLight intensity={0.2} />
      <directionalLight position={[6, 8, 6]} intensity={1.2} color="#fff" castShadow shadow-mapSize={[1024, 1024]} shadow-bias={-0.0001} />
      <pointLight position={[-5, 4, 4]} intensity={0.8} color={ACCENT_GLOW} />
      <pointLight position={[4, -4, 4]} intensity={0.5} color={CYAN} />
      <pointLight position={[-4, -4, -4]} intensity={0.4} color={ACCENT_SECONDARY} />

      <Starfield count={isMobile ? 80 : 160} />

      <ShipWheel position={[-2.8, 0, 0]} scale={0.9} />
      <ServerRack position={[-6.8, 3.2, -1.5]} scale={1.1} />
      <Computer position={[-6.2, -3.2, 1.5]} scale={1.1} />
      <ContainerBox position={[-0.6, 3.6, 1.5]} scale={1.15} />
      <Database position={[3.6, -2.8, 1.5]} scale={1.1} />
      <CloudNode position={[0.4, -4, -1.5]} scale={1.15} />
      <ProxyGateway position={[5.4, 0.4, -1.5]} scale={1.1} />

      <ConnectionBeam from={wheel} to={server} color={GREEN} />
      <ConnectionBeam from={wheel} to={computer} color={CYAN} />
      <ConnectionBeam from={wheel} to={container} color={BLUE} />
      <ConnectionBeam from={wheel} to={database} color={ACCENT_SECONDARY} />
      <ConnectionBeam from={wheel} to={cloud} color={CLOUD} />
      <ConnectionBeam from={wheel} to={proxy} color={CYAN} />

      <ContactShadows position={[0, -5, 0]} opacity={0.35} scale={25} blur={2.5} far={10} />
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
        shadows
        gl={{ antialias: !isMobile, alpha: false, powerPreference: "high-performance" }}
      >
        <color attach="background" args={[BG]} />
        <fog attach="fog" args={[BG, isMobile ? 20 : 26, isMobile ? 52 : 62]} />
        <Scene mouseRef={mouseRef} isMobile={isMobile} />
      </Canvas>
    </div>
  );
}
