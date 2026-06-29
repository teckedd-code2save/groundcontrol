"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function HomePage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [copied, setCopied] = useState(false);
  const installCmd = "curl -fsSL https://raw.githubusercontent.com/teckedd-code2save/groundcontrol/main/scripts/bootstrap | bash -s root@your-vps";
  async function copyCmd() { await navigator.clipboard.writeText(installCmd); setCopied(true); setTimeout(() => setCopied(false), 2000); }

  useEffect(() => {
    fetch("/api/auth/me")
      .then(async (res) => {
        if (!res.ok) { setChecking(false); return; }
        const configs = await fetch("/api/vps").then(r => r.ok ? r.json() : []);
        if (Array.isArray(configs) && configs.length === 0) router.push("/onboarding");
        else if (configs) router.push("/dashboard");
      }).catch(() => setChecking(false));
  }, [router]);

  useEffect(() => {
    if (checking) return;
    let ctx: any;
    async function init() {
      const { gsap } = await import("gsap");
      const { ScrollTrigger } = await import("gsap/ScrollTrigger");
      gsap.registerPlugin(ScrollTrigger);
      ctx = gsap.context(() => {
        gsap.fromTo(".hero-word", { y: 120, opacity: 0, rotateX: -15 },
          { y: 0, opacity: 1, rotateX: 0, duration: 1.2, stagger: 0.1, ease: "power3.out" });
        gsap.fromTo(".hero-sub", { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.8, delay: 0.6 });
        gsap.fromTo(".hero-cta", { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6, delay: 0.9 });
        gsap.fromTo(".hero-svg line, .hero-svg rect, .hero-svg path",
          { strokeDashoffset: 1000, strokeDasharray: 1000 },
          { strokeDashoffset: 0, duration: 2.5, delay: 0.3, ease: "power2.inOut" });

        gsap.utils.toArray<HTMLElement>(".feat-card").forEach((el, i) => {
          gsap.fromTo(el, { y: 80, opacity: 0 },
            { y: 0, opacity: 1, duration: 0.8, delay: i * 0.1, ease: "power2.out",
              scrollTrigger: { trigger: el, start: "top 90%" } });
        });

        gsap.fromTo(".step-card", { y: 60, opacity: 0, scale: 0.95 },
          { y: 0, opacity: 1, scale: 1, duration: 0.8, stagger: 0.2, ease: "back.out(1.4)",
            scrollTrigger: { trigger: ".steps-grid", start: "top 80%" } });

        gsap.to(".orb-1", { y: -100, x: 50, scrollTrigger: { trigger: "body", start: "top top", end: "bottom bottom", scrub: 1 } });
        gsap.to(".orb-2", { y: 100, x: -80, scrollTrigger: { trigger: "body", start: "top top", end: "bottom bottom", scrub: 1 } });
      });
    }
    init();
    return () => ctx?.revert();
  }, [checking]);

  if (checking) return <div className="min-h-screen flex items-center justify-center bg-black"><div className="w-8 h-8 rounded-lg bg-[#E8542A] animate-pulse" /></div>;

  return (
    <div className="bg-black text-white min-h-screen overflow-x-hidden" style={{ fontFamily: "'Schibsted Grotesk', system-ui, sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Schibsted+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
        .grid-bg { background-image: linear-gradient(rgba(232,84,42,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(232,84,42,0.05) 1px, transparent 1px); background-size: 80px 80px; }
        .dot-bg { background-image: radial-gradient(circle, rgba(232,84,42,0.1) 1px, transparent 1px); background-size: 32px 32px; }
        .gradient-text { background: linear-gradient(135deg, #E8542A 0%, #FF6A40 50%, #FF8A65 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
      `}</style>

      <div className="orb-1 fixed top-1/4 -right-40 w-[600px] h-[600px] rounded-full opacity-20 pointer-events-none z-0" style={{ background: "radial-gradient(circle, rgba(232,84,42,0.3) 0%, transparent 70%)" }} />
      <div className="orb-2 fixed -bottom-40 -left-20 w-[500px] h-[500px] rounded-full opacity-15 pointer-events-none z-0" style={{ background: "radial-gradient(circle, rgba(232,84,42,0.25) 0%, transparent 70%)" }} />

      {/* HERO */}
      <section className="relative min-h-screen flex items-center justify-center overflow-hidden">
        <div className="absolute inset-0 grid-bg dot-bg opacity-40 z-0" />
        <svg className="hero-svg absolute inset-0 w-full h-full z-0 opacity-[0.06]" viewBox="0 0 1440 900" preserveAspectRatio="none">
          {[120,240,360,480,600,720].map((y,i) => <line key={`h${y}`} x1="0" y1={y} x2="1440" y2={y} stroke="#E8542A" strokeWidth="1" />)}
          <rect x="300" y="300" width="200" height="300" fill="none" stroke="#E8542A" strokeWidth="1.5" rx="4" />
          <rect x="600" y="200" width="200" height="400" fill="none" stroke="#E8542A" strokeWidth="1.5" rx="4" />
          <rect x="900" y="350" width="200" height="250" fill="none" stroke="#E8542A" strokeWidth="1.5" rx="4" />
          <path d="M 0 700 Q 400 400 700 600 T 1440 500" fill="none" stroke="#FF6A40" strokeWidth="1.5" />
          <circle cx="300" cy="300" r="4" fill="#E8542A" /><circle cx="600" cy="200" r="4" fill="#E8542A" /><circle cx="900" cy="350" r="4" fill="#E8542A" />
        </svg>

        <div className="relative z-10 max-w-5xl mx-auto px-6 text-center py-20">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/5 border border-white/10 text-white/40 text-xs font-mono mb-10 backdrop-blur">
            <span className="w-2 h-2 rounded-full bg-[#E8542A] animate-pulse" /> Open source · Self-hosted
          </div>
          <h1 className="text-5xl md:text-7xl lg:text-8xl font-bold leading-none tracking-tight mb-6 max-w-4xl mx-auto">
            <span className="hero-word inline-block">Your</span> <span className="hero-word inline-block">VPS</span> <span className="hero-word inline-block">has</span> <span className="hero-word inline-block">an</span>{" "}
            <span className="hero-word inline-block gradient-text">AI</span> <span className="hero-word inline-block">co-pilot</span>
          </h1>
          <p className="hero-sub text-xl text-white/40 max-w-xl mx-auto mb-10 leading-relaxed">
            GroundControl gives you an AI agent that manages your server — metrics, logs, DNS, deployments, templates. No SSH needed.
          </p>
          <div className="hero-cta flex flex-wrap items-center justify-center gap-4">
            <Link href="/login"
              className="px-8 py-3.5 bg-[#E8542A] text-white rounded-xl hover:bg-[#FF6A40] transition-all duration-200 text-sm font-mono font-medium shadow-lg shadow-[#E8542A]/20">
              Get Started →
            </Link>
            <div className="flex items-center gap-2">
              <code className="hidden sm:block px-4 py-3 bg-white/[0.04] border border-white/[0.08] rounded-xl text-xs font-mono text-white/25">{installCmd}</code>
              <button onClick={copyCmd} className="px-3 py-3 text-xs font-mono text-white/20 hover:text-[#E8542A] border border-white/[0.08] rounded-xl hover:border-[#E8542A]/30 transition-all shrink-0">{copied ? "Copied" : "Copy"}</button>
            </div>
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section className="relative py-32 border-t border-white/[0.06]">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-20">
            <p className="text-[#E8542A] text-xs font-mono uppercase tracking-[0.2em] mb-4">Features</p>
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">Everything you need to <span className="gradient-text">run production</span></h2>
            <p className="text-white/30 max-w-md mx-auto">From a fresh VPS to a monitored, backed-up, reverse-proxied stack.</p>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {[
              { icon: "◉", title: "AI Management", desc: "Ask the co-pilot anything — check CPU, read logs, restart services. It knows your server." },
              { icon: "▦", title: "Templates", desc: "Production stacks in one click. Caddy + App + DB, Traefik + microservices, static sites." },
              { icon: "◎", title: "Cloudflare DNS", desc: "Manage records, zones, and tunnels. Auto-create A records when you deploy." },
              { icon: "◈", title: "Live Dashboard", desc: "Real-time metrics, container health, disk usage. Alerts when something breaks." },
              { icon: "⌘", title: "Terminal + AI Agent", desc: "Full terminal access + AI that can manage services, read logs, install software." },
              { icon: "◑", title: "Self-Hosted", desc: "Runs on your VPS. Data never leaves your server. Open source. No credit card." },
            ].map((f, i) => (
              <div key={i} className="feat-card group bg-white/[0.02] border border-white/[0.06] rounded-2xl p-8 hover:bg-white/[0.04] hover:border-[#E8542A]/20 transition-all duration-300">
                <div className="w-12 h-12 rounded-xl bg-[#E8542A]/10 flex items-center justify-center text-[#E8542A] text-xl mb-5 group-hover:scale-110 transition-transform duration-300">{f.icon}</div>
                <h3 className="font-semibold text-base mb-2">{f.title}</h3>
                <p className="text-sm text-white/30 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* STEPS */}
      <section className="relative py-32 border-t border-white/[0.06]">
        <div className="max-w-5xl mx-auto px-6">
          <div className="text-center mb-20">
            <p className="text-[#E8542A] text-xs font-mono uppercase tracking-[0.2em] mb-4">How it works</p>
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">Three steps to <span className="gradient-text">production</span></h2>
          </div>
          <div className="steps-grid grid md:grid-cols-3 gap-8">
            {[
              { step: "01", title: "Install", desc: "One curl command. Docker + GroundControl on your VPS in 60 seconds.", color: "#E8542A" },
              { step: "02", title: "Connect", desc: "GroundControl scans your server, discovers your stack, asks a few questions.", color: "#FF6A40" },
              { step: "03", title: "Deploy", desc: "Pick a template, connect your code, configure DNS. Production-ready in minutes.", color: "#FF8A65" },
            ].map((s, i) => (
              <div key={i} className="step-card text-center">
                <div className="text-5xl font-bold mb-4" style={{ color: s.color }}>{s.step}</div>
                <h3 className="text-xl font-semibold mb-3">{s.title}</h3>
                <p className="text-sm text-white/30 leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="relative py-32 border-t border-white/[0.06]">
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#E8542A]/[0.02] to-transparent" />
        <div className="relative max-w-2xl mx-auto px-6 text-center">
          <div className="bg-white/[0.02] border border-white/[0.06] rounded-3xl p-12" style={{ boxShadow: "0 0 80px rgba(232,84,42,0.1)" }}>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Ready to give your VPS an AI co-pilot?</h2>
            <p className="text-white/30 mb-8">Free. Open source. Self-hosted. No credit card.</p>
            <div className="flex items-center gap-2 justify-center mb-6">
              <code className="px-5 py-3 bg-black/50 border border-white/[0.08] rounded-xl text-xs font-mono text-white/25 max-w-lg truncate">{installCmd}</code>
              <button onClick={copyCmd} className="px-4 py-3 text-xs font-mono text-white/20 hover:text-[#E8542A] border border-white/[0.08] rounded-xl hover:border-[#E8542A]/30 transition-all shrink-0">{copied ? "✓" : "Copy"}</button>
            </div>
            <div className="flex gap-4 justify-center">
              <Link href="/login" className="px-6 py-3 bg-[#E8542A] text-white rounded-xl hover:bg-[#FF6A40] transition-all text-sm font-mono shadow-lg shadow-[#E8542A]/20">Sign In</Link>
              <a href="https://github.com/teckedd-code2save/groundcontrol" target="_blank" rel="noopener" className="px-6 py-3 border border-white/[0.08] rounded-xl hover:border-[#E8542A]/30 hover:text-[#E8542A] transition-all text-sm font-mono">GitHub →</a>
            </div>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-white/[0.06] py-12">
        <div className="max-w-6xl mx-auto px-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-6">
              <span className="text-sm font-semibold text-white/60">GroundControl</span>
              <div className="flex items-center gap-5">
                <a href="https://github.com/teckedd-code2save/groundcontrol" target="_blank" rel="noopener" className="text-xs font-mono text-white/25 hover:text-[#E8542A] transition-colors">GitHub</a>
                <a href="https://github.com/teckedd-code2save/convoy" target="_blank" rel="noopener" className="text-xs font-mono text-white/25 hover:text-[#E8542A] transition-colors">Convoy</a>
                <a href="https://www.serendepify.com" target="_blank" rel="noopener" className="text-xs font-mono text-white/25 hover:text-[#E8542A] transition-colors">Serendepify</a>
              </div>
            </div>
            <p className="text-xs text-white/15 font-mono">Open source · Self-hosted VPS management with AI</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
