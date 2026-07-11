"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { InstallSetupSection, scrollToInstall } from "@/components/InstallSetupSection";
import { AmbientShader } from "@/components/AmbientShader";

const C = {
  bg: "#202427",
  dark: "#141618",
  darker: "#0D0E10",
  text: "#F5F6F7",
  mut: "rgba(245,246,247,0.45)",
  dim: "rgba(245,246,247,0.22)",
  lin: "rgba(245,246,247,0.08)",
  accent: "#E8542A",
};

function BtnPrimary({
  children,
  onClick,
  href,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  href?: string;
}) {
  const className =
    "inline-flex items-center justify-center rounded-lg bg-[#E8542A] px-6 py-3 text-[14px] font-medium text-white transition-colors hover:bg-[#FF6A40]";
  if (href) {
    return (
      <Link href={href} className={className}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={className}>
      {children}
    </button>
  );
}

function BtnGhost({
  children,
  onClick,
  href,
  external,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  href?: string;
  external?: boolean;
}) {
  const className =
    "inline-flex items-center justify-center rounded-lg border border-white/10 bg-transparent px-6 py-3 text-[14px] font-medium text-white/80 transition-colors hover:border-white/20 hover:bg-white/[0.04] hover:text-white";
  if (href) {
    return (
      <a
        href={href}
        className={className}
        {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      >
        {children}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} className={className}>
      {children}
    </button>
  );
}

export default function HomePage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (typeof window !== "undefined" && window.location.hash === "#install") {
      window.setTimeout(() => scrollToInstall(), 100);
    }
  }, [checking]);

  useEffect(() => {
    fetch("/api/auth/me")
      .then(async (res) => {
        if (!res.ok) {
          setChecking(false);
          return;
        }
        const configs = await fetch("/api/vps").then((r) => (r.ok ? r.json() : []));
        if (Array.isArray(configs) && configs.length === 0) router.push("/onboarding");
        else if (configs) router.push("/dashboard");
      })
      .catch(() => setChecking(false));
  }, [router]);

  useEffect(() => {
    if (checking) return;
    let ctx: { revert: () => void } | undefined;
    async function init() {
      const { gsap } = await import("gsap");
      const { ScrollTrigger } = await import("gsap/ScrollTrigger");
      gsap.registerPlugin(ScrollTrigger);
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      ctx = gsap.context(() => {
        gsap.fromTo(
          ".line-mask .line-inner",
          { y: "100%" },
          { y: "0%", duration: 1.2, stagger: 0.14, ease: "power3.out", delay: 0.2 }
        );
        gsap.fromTo(
          ".fade-up",
          { y: 20, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.7, stagger: 0.08, delay: 0.7, ease: "power2.out" }
        );
        gsap.fromTo(
          ".h-card",
          { y: 28, opacity: 0 },
          {
            y: 0,
            opacity: 1,
            duration: 0.6,
            stagger: 0.08,
            ease: "power2.out",
            scrollTrigger: { trigger: ".feat-s", start: "top 80%" },
          }
        );
        gsap.fromTo(
          ".m-val",
          { opacity: 0, y: 12 },
          {
            opacity: 1,
            y: 0,
            duration: 0.55,
            stagger: 0.08,
            ease: "power2.out",
            scrollTrigger: { trigger: ".met-s", start: "top 80%" },
          }
        );
      });
    }
    init();
    return () => ctx?.revert();
  }, [checking]);

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#202427]">
        <div className="h-1.5 w-16 overflow-hidden rounded-full bg-white/10">
          <div className="h-full w-1/2 animate-pulse rounded-full bg-[#E8542A]" />
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen overflow-x-hidden bg-[#202427] text-[#F5F6F7]"
      style={{ fontFamily: "Inter, articulat-cf, system-ui, sans-serif" }}
    >
      {/* HERO — shader stays behind copy; no ASCII / looping ornaments on the text */}
      <section className="hero-s relative flex min-h-screen items-center overflow-hidden bg-[#141618]">
        <AmbientShader className="z-0 opacity-90" />
        {/* Soft left scrim so the headline stays readable over the mesh */}
        <div
          className="pointer-events-none absolute inset-0 z-[1]"
          style={{
            background:
              "linear-gradient(90deg, rgba(13,14,16,0.88) 0%, rgba(13,14,16,0.55) 42%, rgba(13,14,16,0.2) 70%, transparent 100%)",
          }}
        />
        <div className="relative z-10 mx-auto w-full max-w-7xl px-6 py-24 md:px-12">
          <div className="max-w-xl">
            <div className="mb-8">
              <h1 className="m-0 text-[clamp(2.25rem,6vw,4.25rem)] font-medium leading-[1.05] tracking-tight">
                <div className="line-mask overflow-hidden">
                  <div className="line-inner">Your VPS has an</div>
                </div>
                <div className="line-mask overflow-hidden">
                  <div className="line-inner text-[#E8542A]">AI co-pilot</div>
                </div>
              </h1>
            </div>
            <p className="fade-up mb-9 max-w-md text-[17px] leading-relaxed text-white/45">
              Metrics, logs, DNS, deployments, templates — managed by an AI agent that knows your server.
            </p>
            <div className="fade-up flex flex-wrap items-center gap-3">
              <BtnPrimary onClick={scrollToInstall}>Install on your VPS</BtnPrimary>
              <BtnGhost href="/login">Open Dashboard</BtnGhost>
            </div>
            <p className="fade-up mt-4 text-[13px] text-white/30">
              One-command setup · SSH key or interactive prompts
            </p>
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section className="feat-s border-t border-white/[0.05] bg-[#0D0E10] py-20 md:py-28">
        <div className="mx-auto max-w-7xl px-6 md:px-12">
          <div className="grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.04] md:grid-cols-3">
            {[
              { title: "AI Co-Pilot", desc: "Ask anything about your server. The agent reads your actual infrastructure." },
              { title: "Deploy Templates", desc: "Caddy + App + DB, Traefik + microservices. One click to production." },
              { title: "Cloudflare DNS", desc: "Manage records, zones, tunnels. Auto-create records on deploy." },
              { title: "Live Dashboard", desc: "Real-time metrics, container health, alerts when something breaks." },
              { title: "Web Terminal", desc: "Full terminal access. The AI agent runs commands for you." },
              { title: "Self-Hosted", desc: "Your VPS, your data. Open source. No vendor lock-in." },
            ].map((f) => (
              <div key={f.title} className="h-card bg-[#141618] p-8 md:p-10">
                <h3 className="mb-2 text-[16px] font-medium text-white">{f.title}</h3>
                <p className="m-0 text-[14px] leading-relaxed text-white/40">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* METRICS */}
      <section className="met-s border-t border-white/[0.05] bg-[#141618] py-16 md:py-20">
        <div className="mx-auto max-w-5xl px-6 text-center md:px-12">
          <div className="grid grid-cols-2 gap-10 md:grid-cols-4">
            {[
              { val: "5", label: "Cloud platforms" },
              { val: "6", label: "Deploy templates" },
              { val: "40+", label: "AI agent tools" },
              { val: "1", label: "Command to install" },
            ].map((m) => (
              <div key={m.label} className="m-val">
                <div className="mb-2 text-[clamp(2rem,4vw,2.75rem)] font-medium tracking-tight text-white">
                  {m.val}
                </div>
                <div className="text-[12px] tracking-wide text-white/35">{m.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <InstallSetupSection />

      {/* CTA */}
      <section className="border-t border-white/[0.05] bg-[#141618] py-20 md:py-28">
        <div className="mx-auto max-w-xl px-6 text-center">
          <h2 className="mb-3 text-[clamp(1.5rem,3.5vw,2.25rem)] font-medium tracking-tight text-white">
            Ready to give your VPS an AI co-pilot?
          </h2>
          <p className="mb-8 text-[15px] text-white/40">Free. Open source. Self-hosted.</p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <BtnPrimary onClick={scrollToInstall}>Install on your VPS</BtnPrimary>
            <BtnGhost href="/login">Open Dashboard</BtnGhost>
            <BtnGhost href="https://github.com/teckedd-code2save/groundcontrol" external>
              GitHub
            </BtnGhost>
          </div>
        </div>
      </section>

      <footer className="border-t border-white/[0.05] bg-[#0D0E10] py-10">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-6 md:flex-row md:px-12">
          <span className="text-[13px] text-white/30">GroundControl</span>
          <div className="flex flex-wrap justify-center gap-5">
            <a
              href="https://github.com/teckedd-code2save/groundcontrol"
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-[12px] text-white/30 no-underline hover:text-white/50"
            >
              GitHub
            </a>
            <a
              href="https://www.serendepify.com"
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-[12px] text-white/30 no-underline hover:text-white/50"
            >
              Serendepify
            </a>
          </div>
          <span className="font-mono text-[11px] text-white/25">© 2026</span>
        </div>
      </footer>
    </div>
  );
}
