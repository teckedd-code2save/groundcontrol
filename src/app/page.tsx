"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function HomePage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [copied, setCopied] = useState(false);
  const heroRef = useRef<HTMLDivElement>(null);
  const featuresRef = useRef<HTMLDivElement>(null);
  const stepsRef = useRef<HTMLDivElement>(null);

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
    async function init() {
      const { gsap } = await import("gsap");
      const { ScrollTrigger } = await import("gsap/ScrollTrigger");
      gsap.registerPlugin(ScrollTrigger);

      if (heroRef.current) {
        gsap.fromTo(heroRef.current.querySelectorAll(".hero-anim"),
          { y: 80, opacity: 0 }, { y: 0, opacity: 1, duration: 1, stagger: 0.12, ease: "power3.out" });
        gsap.fromTo(heroRef.current.querySelectorAll(".draw-line"),
          { strokeDashoffset: 800, strokeDasharray: 800 },
          { strokeDashoffset: 0, duration: 2, ease: "power2.inOut", delay: 0.6 });
      }

      if (featuresRef.current) {
        featuresRef.current.querySelectorAll(".feat-card").forEach((el, i) => {
          gsap.fromTo(el, { y: 60, opacity: 0 },
            { y: 0, opacity: 1, duration: 0.7, delay: i * 0.08, ease: "power2.out",
              scrollTrigger: { trigger: el, start: "top 85%" } });
        });
      }

      if (stepsRef.current) {
        gsap.fromTo(stepsRef.current.querySelectorAll(".step-item"),
          { y: 40, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.7, stagger: 0.2, ease: "power2.out",
            scrollTrigger: { trigger: stepsRef.current, start: "top 80%" } });
      }
    }
    init();
  }, [checking]);

  if (checking) {
    return <div className="min-h-screen flex items-center justify-center bg-[#0A0A0B]"><div className="w-8 h-8 rounded-lg bg-[#E8542A] animate-pulse" /></div>;
  }

  return (
    <div className="min-h-screen bg-[#0A0A0B] text-[#F5F4F0] font-sans">
      <style>{`
        @keyframes blueprintGrid { 0% { background-position: 0 0; } 100% { background-position: 60px 60px; } }
        @keyframes lineDraw { to { stroke-dashoffset: 0; } }
        .grid-pattern {
          background-image: linear-gradient(rgba(232,84,42,0.04) 1px, transparent 1px),
                            linear-gradient(90deg, rgba(232,84,42,0.04) 1px, transparent 1px);
          background-size: 60px 60px;
          animation: blueprintGrid 30s linear infinite;
        }
        .dot-pattern {
          background-image: radial-gradient(circle, rgba(232,84,42,0.08) 1px, transparent 1px);
          background-size: 24px 24px;
        }
    `}</style>

      {/* ── HERO ── */}
      <header ref={heroRef} className="relative min-h-screen flex items-center overflow-hidden border-b border-white/5">
        <div className="absolute inset-0 grid-pattern dot-pattern opacity-60" />
        <div className="absolute top-20 right-20 w-96 h-96 rounded-full bg-[#E8542A]/5 blur-3xl" />
        <div className="absolute bottom-20 left-10 w-80 h-80 rounded-full bg-[#E8542A]/3 blur-3xl" />

        <svg className="absolute inset-0 w-full h-full opacity-[0.04]" viewBox="0 0 1200 800" preserveAspectRatio="none">
          {[150,250,350,450,550,650].map((y,i) => (
            <line key={y} x1="0" y1={y} x2="1200" y2={y} stroke="#E8542A" strokeWidth="1" className="draw-line" />
          ))}
          <line x1="0" y1="600" x2="500" y2="300" stroke="#E8542A" strokeWidth="1.5" className="draw-line" />
          <line x1="700" y1="200" x2="1200" y2="450" stroke="#E8542A" strokeWidth="1.5" className="draw-line" />
        </svg>

        <div className="relative max-w-6xl mx-auto px-6 py-20 w-full">
          <div className="max-w-2xl">
            <div className="hero-anim inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#E8542A]/10 border border-[#E8542A]/20 text-[#E8542A] text-xs font-mono mb-8">
              <span className="w-1.5 h-1.5 rounded-full bg-[#E8542A] animate-pulse" /> Open source · Self-hosted
            </div>
            <h1 className="hero-anim text-5xl md:text-7xl font-bold leading-none tracking-tight mb-6" style={{fontFamily:"'Schibsted Grotesk',system-ui,sans-serif"}}>
              Your VPS has an{" "}
              <span className="text-[#E8542A]">AI co-pilot</span>
            </h1>
            <p className="hero-anim text-lg text-white/50 leading-relaxed mb-8 max-w-lg">
              GroundControl gives you an AI agent that manages your server — metrics, logs, DNS, deployments, templates. No SSH needed.
            </p>
            <div className="hero-anim flex flex-wrap items-center gap-3">
              <Link href="/login"
                className="px-6 py-3 bg-[#E8542A] text-white rounded-xl hover:bg-[#FF6A40] transition-colors text-sm font-mono font-medium">
                Get Started →
              </Link>
              <div className="flex items-center gap-2">
                <code className="px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-xs font-mono text-white/40 max-w-md truncate hidden sm:block">
                  {installCmd}
                </code>
                <button onClick={copyCmd}
                  className="px-2.5 py-2 text-xs font-mono text-white/30 hover:text-[#E8542A] border border-white/10 rounded-lg hover:border-[#E8542A]/30 transition-colors shrink-0">
                  {copied ? "✓" : "Copy"}
                </button>
              </div>
            </div>
            <p className="hero-anim text-[10px] text-white/20 mt-3 font-mono">One command. Installs Docker + GroundControl in 60 seconds.</p>
          </div>
        </div>
      </header>

      {/* ── FEATURES ── */}
      <section ref={featuresRef} className="relative py-28 border-b border-white/5">
        <div className="absolute inset-0 dot-pattern opacity-30" />
        <div className="relative max-w-6xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4" style={{fontFamily:"'Schibsted Grotesk',system-ui,sans-serif"}}>
              Everything you need to <span className="text-[#E8542A]">run production</span>
            </h2>
            <p className="text-white/40 max-w-md mx-auto">From a fresh VPS to a monitored, backed-up, reverse-proxied stack.</p>
          </div>
          <div className="grid md:grid-cols-3 gap-5">
            {[
              { icon: "◉", title: "AI Management", desc: "Ask the co-pilot anything — check CPU, read logs, restart services. It knows your server." },
              { icon: "▦", title: "Templates", desc: "Production stacks in one click. Caddy + App + DB, Traefik + microservices, static sites." },
              { icon: "◎", title: "Cloudflare DNS", desc: "Manage records, zones, and tunnels. Auto-create A records when you deploy." },
              { icon: "◈", title: "Live Dashboard", desc: "Real-time metrics, container health, disk usage. Alerts when something breaks." },
              { icon: "⌘", title: "Terminal + AI Agent", desc: "Full terminal access + an AI that can manage services, read logs, install software." },
              { icon: "◑", title: "Self-Hosted & Private", desc: "Runs on your VPS. Your data never leaves your server. Open source." },
            ].map((f, i) => (
              <div key={i} className="feat-card bg-white/[0.03] border border-white/5 rounded-xl p-6 hover:border-[#E8542A]/20 hover:bg-white/[0.05] transition-all duration-300 hover:-translate-y-1">
                <div className="w-10 h-10 rounded-lg bg-[#E8542A]/10 flex items-center justify-center text-[#E8542A] text-lg mb-4">{f.icon}</div>
                <h3 className="font-medium text-sm mb-2">{f.title}</h3>
                <p className="text-xs text-white/35 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section ref={stepsRef} className="relative py-28 border-b border-white/5">
        <div className="relative max-w-4xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4" style={{fontFamily:"'Schibsted Grotesk',system-ui,sans-serif"}}>
              Three steps to <span className="text-[#E8542A]">production</span>
            </h2>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              { step: "1", title: "Install", desc: "One curl command. Docker + GroundControl on your VPS in 60 seconds." },
              { step: "2", title: "Connect", desc: "GroundControl scans your server, discovers your stack, asks a few questions." },
              { step: "3", title: "Deploy", desc: "Pick a template, connect your code, configure DNS. Production in minutes." },
            ].map((s, i) => (
              <div key={i} className="step-item text-center">
                <div className="w-14 h-14 rounded-2xl bg-[#E8542A]/10 border border-[#E8542A]/20 flex items-center justify-center text-[#E8542A] text-xl font-bold mx-auto mb-4">{s.step}</div>
                <h3 className="font-medium mb-2">{s.title}</h3>
                <p className="text-xs text-white/35 leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="relative py-28">
        <div className="relative max-w-2xl mx-auto px-6 text-center">
          <div className="bg-white/[0.03] border border-white/5 rounded-2xl p-10">
            <h2 className="text-2xl font-bold mb-3" style={{fontFamily:"'Schibsted Grotesk',system-ui,sans-serif"}}>
              Ready to give your VPS an AI co-pilot?
            </h2>
            <p className="text-white/40 mb-6 text-sm">Free. Open source. Self-hosted. No credit card.</p>
            <div className="flex items-center gap-2 justify-center mb-4">
              <code className="px-4 py-3 bg-black/40 border border-white/10 rounded-xl text-xs font-mono text-white/30 max-w-lg truncate">{installCmd}</code>
              <button onClick={copyCmd}
                className="px-3 py-3 text-xs font-mono text-white/30 hover:text-[#E8542A] border border-white/10 rounded-xl hover:border-[#E8542A]/30 transition-colors shrink-0">
                {copied ? "✓" : "Copy"}
              </button>
            </div>
            <div className="flex gap-4 justify-center">
              <Link href="/login" className="px-5 py-2.5 bg-[#E8542A] text-white rounded-xl hover:bg-[#FF6A40] transition-colors text-sm font-mono">Sign In</Link>
              <a href="https://github.com/teckedd-code2save/groundcontrol" target="_blank" rel="noopener"
                className="px-5 py-2.5 border border-white/10 rounded-xl hover:border-[#E8542A]/30 hover:text-[#E8542A] transition-colors text-sm font-mono">GitHub →</a>
            </div>
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="border-t border-white/5 py-10">
        <div className="max-w-6xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-white/20 text-xs font-mono">
            <span>GroundControl</span>
            <span>·</span>
            <span>Open source</span>
          </div>
          <div className="flex items-center gap-4">
            <a href="https://github.com/teckedd-code2save" target="_blank" rel="noopener"
              className="text-xs font-mono text-white/20 hover:text-[#E8542A] transition-colors">GitHub</a>
            <a href="https://github.com/teckedd-code2save/groundcontrol" target="_blank" rel="noopener"
              className="text-xs font-mono text-white/20 hover:text-[#E8542A] transition-colors">groundcontrol</a>
            <a href="https://github.com/teckedd-code2save/convoy" target="_blank" rel="noopener"
              className="text-xs font-mono text-white/20 hover:text-[#E8542A] transition-colors">convoy</a>
            <a href="https://www.serendepify.com" target="_blank" rel="noopener"
              className="text-xs font-mono text-white/20 hover:text-[#E8542A] transition-colors">serendepify</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
