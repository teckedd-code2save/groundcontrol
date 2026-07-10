"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

/**
 * Ambient Paper-style gradient backdrop for login / hero / idle states.
 * Falls back to a CSS mesh when shaders are unavailable or reduced-motion is on.
 */
function CssMeshFallback({ className = "" }: { className?: string }) {
  return (
    <div
      className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}
      aria-hidden
    >
      <div
        className="absolute inset-0 opacity-80"
        style={{
          background: `
            radial-gradient(ellipse 80% 60% at 20% 30%, rgba(232,84,42,0.22), transparent 55%),
            radial-gradient(ellipse 70% 50% at 80% 70%, rgba(232,84,42,0.12), transparent 50%),
            radial-gradient(ellipse 50% 40% at 50% 100%, rgba(245,246,247,0.04), transparent 45%),
            linear-gradient(165deg, #0D0E10 0%, #141618 45%, #202427 100%)
          `,
        }}
      />
      <div
        className="absolute inset-0 opacity-[0.07] mix-blend-overlay"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
        }}
      />
    </div>
  );
}

type ShaderProps = {
  className?: string;
  style?: React.CSSProperties;
  colors?: string[];
  speed?: number;
};

function PaperMeshInner({ className = "" }: { className?: string }) {
  // Dynamic import keeps SSR clean; falls back to CSS mesh if package fails.
  const [Shader, setShader] = useState<React.ComponentType<ShaderProps> | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mod = await import("@paper-design/shaders-react");
        const m = mod as unknown as {
          MeshGradient?: React.ComponentType<ShaderProps>;
          GrainGradient?: React.ComponentType<ShaderProps>;
        };
        const Comp = m.MeshGradient || m.GrainGradient || null;
        if (!cancelled && Comp) setShader(() => Comp);
      } catch {
        // package missing — CSS fallback remains
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!Shader) return <CssMeshFallback className={className} />;

  return (
    <div className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`} aria-hidden>
      <Shader
        className="absolute inset-0 h-full w-full"
        colors={["#0D0E10", "#202427", "#E8542A", "#141618"]}
        speed={0.12}
        style={{ width: "100%", height: "100%" }}
      />
      <div className="absolute inset-0 bg-gradient-to-t from-[#0D0E10]/80 via-transparent to-[#0D0E10]/40" />
    </div>
  );
}

const PaperMeshLazy = dynamic(() => Promise.resolve(PaperMeshInner), { ssr: false });

export function AmbientShader({
  className = "",
  forceCss = false,
}: {
  className?: string;
  forceCss?: boolean;
}) {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  if (forceCss || reduced) {
    return <CssMeshFallback className={className} />;
  }

  return <PaperMeshLazy className={className} />;
}
