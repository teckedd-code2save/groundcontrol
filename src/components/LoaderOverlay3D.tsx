"use client";

import { Boxes, Container, Layers3, Network, Rocket, ScanLine, type LucideIcon } from "lucide-react";
import BrandLogo from "@/components/BrandLogo";

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
const VARIANTS: Record<LoaderVariant, { title: string; label: string; Icon: LucideIcon }> = {
  container: { title: "Working with containers…", label: "Docker runtime", Icon: Container },
  image: { title: "Working with images…", label: "Image registry", Icon: Boxes },
  project: { title: "Working with projects…", label: "Project state", Icon: Layers3 },
  deploy: { title: "Deploying…", label: "Release operation", Icon: Rocket },
  proxy: { title: "Updating proxy…", label: "Network route", Icon: Network },
  compose: { title: "Running Compose…", label: "Compose operation", Icon: Layers3 },
  generic: { title: "Loading…", label: "GroundControl", Icon: ScanLine },
};

/**
 * Kept under the existing export name to avoid churn at call sites. The old
 * WebGL scene was intentionally replaced with a lighter operational loader so
 * routine actions do not allocate a 3D canvas or compete with mobile scrolling.
 */
export function LoaderOverlay3D({ open, variant = "generic", title, subtitle }: LoaderOverlay3DProps) {
  if (!open) return null;
  const meta = VARIANTS[variant];
  const Icon = meta.Icon;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-background/88 p-5 backdrop-blur-sm"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="w-full max-w-sm overflow-hidden border border-border bg-card shadow-2xl shadow-black/35">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center border border-border bg-background text-accent">
              <BrandLogo size={19} stroke="currentColor" accent="currentColor" />
            </span>
            <div>
              <p className="gc-eyebrow">{meta.label}</p>
              <p className="mt-0.5 text-xs font-medium text-foreground">Operation in progress</p>
            </div>
          </div>
          <Icon size={16} className="text-muted" aria-hidden="true" />
        </div>

        <div className="px-4 py-5">
          <div className="gc-loader-track" aria-hidden="true">
            <span className="gc-loader-track__signal" />
          </div>
          <h2 className="mt-5 text-sm font-medium tracking-tight text-foreground">{title || meta.title}</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            {subtitle || "GroundControl is waiting for verified host output before continuing."}
          </p>
          <div className="mt-4 flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.1em] text-text-dim">
            <span className="h-1.5 w-1.5 rounded-full bg-accent gc-loader-pulse" />
            Do not close this window
          </div>
        </div>
      </div>
    </div>
  );
}
