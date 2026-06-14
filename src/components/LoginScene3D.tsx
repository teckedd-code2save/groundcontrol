"use client";

import { useRef, useMemo, useEffect, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { PerspectiveCamera } from "@react-three/drei";
import * as THREE from "three";

const ACCENT = new THREE.Color("#ff5500");
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

/* ------------------------------------------------------------------ */
/* Ship control wheel — the GroundControl metaphor                    */
/* ------------------------------------------------------------------ */
function ShipWheel({ position }: { position: [number, number, number] }) {
  const wheelRef = useRef<THREE.Group>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const hubRef = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (wheelRef.current) {
      wheelRef.current.rotation.z = Math.sin(t * 0.08) * 0.06;
      wheelRef.current.rotation.y = t * 0.03;
    }
    if (ringRef.current) {
      ringRef.current.rotation.z = t * 0.02;
    }
    if (hubRef.current) {
      hubRef.current.rotation.z = -t * 0.05;
    }
  });

  const spokeCount = 8;

  return (
    <group ref={wheelRef} position={position}>
      {/* outer rim */}
      <mesh ref={ringRef}>
        <torusGeometry args={[2.4, 0.12, 16, 96]} />
        <meshStandardMaterial color={ACCENT} emissive={ACCENT} emissiveIntensity={0.4} roughness={0.2} metalness={0.8} />
      </mesh>
      {/* inner rim */}
      <mesh>
        <torusGeometry args={[1.6, 0.07, 12, 80]} />
        <meshStandardMaterial color={ACCENT_GLOW} emissive={ACCENT_GLOW} emissiveIntensity={0.3} roughness={0.25} metalness={0.75} />
      </mesh>
      {/* spokes */}
      {Array.from({ length: spokeCount }).map((_, i) => {
        const a = (i / spokeCount) * Math.PI * 2;
        return (
          <mesh key={i} rotation={[0, 0, a]} position={[Math.cos(a) * 2, Math.sin(a) * 2, 0]}>
            <boxGeometry args={[2.0, 0.12, 0.08]} />
            <meshStandardMaterial color="#c2410c" roughness={0.3} metalness={0.7} />
          </mesh>
        );
      })}
      {/* handle knobs */}
      {Array.from({ length: spokeCount }).map((_, i) => {
        const a = (i / spokeCount) * Math.PI * 2;
        return (
          <mesh key={i} position={[Math.cos(a) * 2.4, Math.sin(a) * 2.4, 0.12]}>
            <sphereGeometry args={[0.14, 16, 16]} />
            <meshStandardMaterial color={GOLD} emissive={GOLD} emissiveIntensity={0.3} roughness={0.2} metalness={0.8} />
          </mesh>
        );
      })}
      {/* central hub */}
      <mesh ref={hubRef}>
        <cylinderGeometry args={[0.5, 0.5, 0.35, 32]} />
        <meshStandardMaterial color={ACCENT} emissive={ACCENT} emissiveIntensity={1.2} roughness={0.15} metalness={0.95} />
      </mesh>
      {/* hub cap */}
      <mesh position={[0, 0, 0.2]}>
        <sphereGeometry args={[0.25, 24, 24]} />
        <meshStandardMaterial color={GOLD} emissive={GOLD} emissiveIntensity={0.6} />
      </mesh>
      {/* pedestal */}
      <mesh position={[0, 0, -0.8]}>
        <cylinderGeometry args={[0.35, 0.5, 1.2, 16]} />
        <meshStandardMaterial color="#1f1f2a" metalness={0.7} roughness={0.4} />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Server rack                                                        */
/* ------------------------------------------------------------------ */
function ServerRack({ position }: { position: [number, number, number] }) {
  const groupRef = useRef<THREE.Group>(null);
  const lightsRef = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    if (groupRef.current) {
      groupRef.current.position.y = position[1] + Math.sin(clock.getElapsedTime() * 0.35 + position[0]) * 0.06;
      groupRef.current.rotation.y = Math.sin(clock.getElapsedTime() * 0.12) * 0.08;
    }
    if (lightsRef.current) {
      lightsRef.current.children.forEach((child, i) => {
        const mat = (child as THREE.Mesh).material as THREE.MeshBasicMaterial;
        const t = clock.getElapsedTime() * 2.5 + i * 1.2;
        mat.opacity = 0.35 + Math.max(0, Math.sin(t)) * 0.65;
      });
    }
  });

  return (
    <group ref={groupRef} position={position}>
      <mesh>
        <boxGeometry args={[1.4, 2.4, 1.2]} />
        <meshStandardMaterial color="#16161f" roughness={0.4} metalness={0.75} />
      </mesh>
      <mesh position={[0, 0, 0.62]}>
        <boxGeometry args={[1.3, 2.3, 0.06]} />
        <meshStandardMaterial color="#0c0c10" roughness={0.5} metalness={0.6} />
      </mesh>
      <group ref={lightsRef}>
        {Array.from({ length: 7 }).map((_, i) => (
          <group key={i} position={[0, -0.8 + i * 0.28, 0.68]}>
            <mesh position={[-0.4, 0, 0]}>
              <boxGeometry args={[0.45, 0.04, 0.02]} />
              <meshBasicMaterial color="#2a2a35" />
            </mesh>
            <mesh position={[0.42, 0, 0]}>
              <circleGeometry args={[0.05, 12]} />
              <meshBasicMaterial color={i % 3 === 0 ? GREEN : i % 3 === 1 ? CYAN : ACCENT} transparent opacity={0.9} />
            </mesh>
          </group>
        ))}
      </group>
      {/* rack ears */}
      <mesh position={[-0.72, 0, 0]}>
        <boxGeometry args={[0.04, 2.4, 0.1]} />
        <meshStandardMaterial color="#333" metalness={0.8} />
      </mesh>
      <mesh position={[0.72, 0, 0]}>
        <boxGeometry args={[0.04, 2.4, 0.1]} />
        <meshStandardMaterial color="#333" metalness={0.8} />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Computer / monitor                                                 */
/* ------------------------------------------------------------------ */
function Computer({ position }: { position: [number, number, number] }) {
  const groupRef = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (groupRef.current) {
      groupRef.current.position.y = position[1] + Math.sin(clock.getElapsedTime() * 0.4 + 1) * 0.05;
      groupRef.current.rotation.y = Math.sin(clock.getElapsedTime() * 0.15) * 0.1;
    }
  });

  return (
    <group ref={groupRef} position={position}>
      {/* screen */}
      <mesh>
        <boxGeometry args={[2.2, 1.4, 0.12]} />
        <meshStandardMaterial color="#111" roughness={0.3} metalness={0.5} />
      </mesh>
      {/* display glow */}
      <mesh position={[0, 0, 0.07]}>
        <planeGeometry args={[2.05, 1.25]} />
        <meshBasicMaterial color={CYAN} transparent opacity={0.15} />
      </mesh>
      {/* chart bars on screen */}
      {[
        { h: 0.4, x: -0.6 },
        { h: 0.7, x: -0.2 },
        { h: 0.5, x: 0.2 },
        { h: 0.85, x: 0.6 },
      ].map((bar, i) => (
        <mesh key={i} position={[bar.x, -0.2 + bar.h / 2, 0.08]}>
          <boxGeometry args={[0.22, bar.h, 0.02]} />
          <meshBasicMaterial color={ACCENT} transparent opacity={0.8} />
        </mesh>
      ))}
      {/* stand */}
      <mesh position={[0, -0.95, -0.1]}>
        <boxGeometry args={[0.4, 0.5, 0.25]} />
        <meshStandardMaterial color="#222" metalness={0.6} roughness={0.4} />
      </mesh>
      <mesh position={[0, -1.25, -0.1]}>
        <boxGeometry args={[1, 0.12, 0.5]} />
        <meshStandardMaterial color="#222" metalness={0.6} roughness={0.4} />
      </mesh>
      {/* keyboard */}
      <mesh position={[0, -1.5, 0.35]} rotation={[0.2, 0, 0]}>
        <boxGeometry args={[1.4, 0.08, 0.5]} />
        <meshStandardMaterial color="#1a1a20" metalness={0.5} roughness={0.5} />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Docker container                                                   */
/* ------------------------------------------------------------------ */
function ContainerBox({ position }: { position: [number, number, number] }) {
  const groupRef = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (groupRef.current) {
      groupRef.current.rotation.y = clock.getElapsedTime() * 0.2;
      groupRef.current.position.y = position[1] + Math.sin(clock.getElapsedTime() * 0.6 + 2) * 0.08;
    }
  });

  return (
    <group ref={groupRef} position={position}>
      <mesh>
        <boxGeometry args={[1.2, 1.2, 1.2]} />
        <meshStandardMaterial color={BLUE} roughness={0.25} metalness={0.55} />
      </mesh>
      {/* whale logo stripes */}
      <mesh position={[0, 0.2, 0.61]}>
        <planeGeometry args={[0.9, 0.18]} />
        <meshBasicMaterial color="#fff" transparent opacity={0.95} />
      </mesh>
      <mesh position={[0, -0.08, 0.61]}>
        <planeGeometry args={[0.55, 0.12]} />
        <meshBasicMaterial color="#fff" transparent opacity={0.7} />
      </mesh>
      {/* corner castings */}
      {[-0.52, 0.52].map((x) =>
        [-0.52, 0.52].map((y) =>
          [-0.52, 0.52].map((z, zi) => (
            <mesh key={`${x}-${y}-${zi}`} position={[x, y, z]}>
              <boxGeometry args={[0.12, 0.12, 0.12]} />
              <meshStandardMaterial color="#60a5fa" />
            </mesh>
          ))
        )
      )}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Docker image — golden disc / framed icon                           */
/* ------------------------------------------------------------------ */
function DockerImage({ position }: { position: [number, number, number] }) {
  const groupRef = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (groupRef.current) {
      groupRef.current.rotation.y = clock.getElapsedTime() * 0.18;
      groupRef.current.position.y = position[1] + Math.sin(clock.getElapsedTime() * 0.5 + 3) * 0.07;
    }
  });

  return (
    <group ref={groupRef} position={position}>
      {/* frame */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.85, 0.85, 0.1, 32]} />
        <meshStandardMaterial color={GOLD} emissive={GOLD} emissiveIntensity={0.25} roughness={0.2} metalness={0.8} />
      </mesh>
      {/* face */}
      <mesh position={[0, 0.06, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.72, 0.72, 0.05, 32]} />
        <meshStandardMaterial color="#1a1508" roughness={0.4} metalness={0.4} />
      </mesh>
      {/* image icon */}
      <mesh position={[0, 0.1, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.7, 0.7]} />
        <meshBasicMaterial color={GOLD} transparent opacity={0.3} />
      </mesh>
      <mesh position={[-0.15, 0.11, 0.1]} rotation={[Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.12, 16]} />
        <meshBasicMaterial color="#fbbf24" />
      </mesh>
      <mesh position={[0.2, 0.11, -0.1]} rotation={[Math.PI / 2, 0, 0]}>
        <boxGeometry args={[0.25, 0.2, 0.02]} />
        <meshBasicMaterial color="#f59e0b" />
      </mesh>
      {/* label tab */}
      <mesh position={[0, -0.7, 0]}>
        <boxGeometry args={[0.6, 0.18, 0.05]} />
        <meshBasicMaterial color={GOLD} transparent opacity={0.8} />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Database                                                           */
/* ------------------------------------------------------------------ */
function Database({ position }: { position: [number, number, number] }) {
  const groupRef = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (groupRef.current) {
      groupRef.current.rotation.y = clock.getElapsedTime() * 0.12;
      groupRef.current.position.y = position[1] + Math.sin(clock.getElapsedTime() * 0.45 + 4) * 0.06;
    }
  });

  return (
    <group ref={groupRef} position={position}>
      {Array.from({ length: 4 }).map((_, i) => (
        <mesh key={i} position={[0, -0.55 + i * 0.37, 0]}>
          <cylinderGeometry args={[0.55, 0.55, 0.3, 32]} />
          <meshStandardMaterial
            color={i === 2 ? ACCENT_SECONDARY : "#252530"}
            emissive={i === 2 ? ACCENT_SECONDARY : "#000"}
            emissiveIntensity={i === 2 ? 0.35 : 0}
            roughness={0.3}
            metalness={0.75}
          />
        </mesh>
      ))}
      <mesh position={[0, 0.55, 0]}>
        <cylinderGeometry args={[0.56, 0.56, 0.02, 32]} />
        <meshBasicMaterial color={ACCENT_SECONDARY} transparent opacity={0.4} />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Cloud relay                                                        */
/* ------------------------------------------------------------------ */
function CloudNode({ position }: { position: [number, number, number] }) {
  const groupRef = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (groupRef.current) {
      groupRef.current.rotation.y = clock.getElapsedTime() * 0.05;
      groupRef.current.position.y = position[1] + Math.sin(clock.getElapsedTime() * 0.3 + 5) * 0.08;
    }
  });

  return (
    <group ref={groupRef} position={position}>
      {[
        [0, 0, 0, 0.7],
        [-0.5, 0.1, 0.1, 0.48],
        [0.55, -0.05, 0.05, 0.5],
        [-0.15, 0.3, -0.15, 0.4],
        [0.2, -0.25, 0.15, 0.38],
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
/* Proxy gateway — archway / shield                                   */
/* ------------------------------------------------------------------ */
function ProxyGateway({ position }: { position: [number, number, number] }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (ref.current) {
      ref.current.rotation.y = Math.sin(clock.getElapsedTime() * 0.25) * 0.12;
      ref.current.position.y = position[1] + Math.sin(clock.getElapsedTime() * 0.4 + 6) * 0.06;
    }
  });

  return (
    <mesh ref={ref} position={position}>
      <torusKnotGeometry args={[0.55, 0.18, 64, 16, 2, 3]} />
      <meshStandardMaterial
        color={CYAN}
        emissive={CYAN}
        emissiveIntensity={0.3}
        roughness={0.2}
        metalness={0.8}
        transparent
        opacity={0.9}
      />
    </mesh>
  );
}

/* ------------------------------------------------------------------ */
/* Connection beams                                                   */
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

  const wheel = new THREE.Vector3(-2.5, 0, 0);
  const server = new THREE.Vector3(-6.5, 3, -2);
  const computer = new THREE.Vector3(-6.2, -2.8, 1.5);
  const container = new THREE.Vector3(-0.5, 3.2, 1.2);
  const image = new THREE.Vector3(2.5, 3.5, -2.5);
  const database = new THREE.Vector3(3, -2.2, 1);
  const cloud = new THREE.Vector3(0.5, -3.6, -1.5);
  const proxy = new THREE.Vector3(4.2, 0.5, -1.5);

  return (
    <group ref={groupRef}>
      <PerspectiveCamera makeDefault position={[1.5, 0.5, isMobile ? 17 : 15]} fov={isMobile ? 58 : 52} />
      <ambientLight intensity={0.2} />
      <pointLight position={[5, 5, 6]} intensity={1.4} color={ACCENT_GLOW} />
      <pointLight position={[-6, -2, -4]} intensity={0.7} color={ACCENT_SECONDARY} />
      <pointLight position={[3, -3, 4]} intensity={0.5} color={CYAN} />

      <Starfield count={isMobile ? 100 : 220} />

      <ShipWheel position={[-2.5, 0, 0]} />
      <ServerRack position={[-6.5, 3, -2]} />
      <Computer position={[-6.2, -2.8, 1.5]} />
      <ContainerBox position={[-0.5, 3.2, 1.2]} />
      <DockerImage position={[2.5, 3.5, -2.5]} />
      <Database position={[3, -2.2, 1]} />
      <CloudNode position={[0.5, -3.6, -1.5]} />
      <ProxyGateway position={[4.2, 0.5, -1.5]} />

      <ConnectionBeam from={wheel} to={server} color={GREEN} particleCount={3} speed={0.35} />
      <ConnectionBeam from={wheel} to={computer} color={CYAN} particleCount={2} speed={0.3} />
      <ConnectionBeam from={wheel} to={container} color={BLUE} particleCount={3} speed={0.45} />
      <ConnectionBeam from={wheel} to={image} color={GOLD} particleCount={2} speed={0.32} />
      <ConnectionBeam from={wheel} to={database} color={ACCENT_SECONDARY} particleCount={2} speed={0.28} />
      <ConnectionBeam from={wheel} to={cloud} color={CLOUD} particleCount={2} speed={0.22} />
      <ConnectionBeam from={wheel} to={proxy} color={CYAN} particleCount={2} speed={0.38} />
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
