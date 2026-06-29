"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function HomePage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [copied, setCopied] = useState(false);
  const installCmd = "curl -fsSL https://raw.githubusercontent.com/teckedd-code2save/groundcontrol/main/scripts/bootstrap | bash -s root@your-vps";
  async function copyCmd() { await navigator.clipboard.writeText(installCmd); setCopied(true); setTimeout(() => setCopied(false), 2000); }

  useEffect(() => {
    fetch("/api/auth/me").then(async (res) => {
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
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      ctx = gsap.context(() => {
        gsap.fromTo(".sr-hero-word", { y: 100, opacity: 0, rotateX: -10 }, { y: 0, opacity: 1, rotateX: 0, duration: 1, stagger: 0.08, ease: "power3.out" });
        gsap.fromTo(".sr-hero-sub", { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.8, delay: 0.5 });
        gsap.fromTo(".sr-hero-cta", { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6, delay: 0.8 });
        gsap.fromTo(".sr-draw line, .sr-draw rect, .sr-draw path", { strokeDashoffset: 1000, strokeDasharray: 1000 }, { strokeDashoffset: 0, duration: 2, delay: 0.2, ease: "power2.inOut" });
        gsap.utils.toArray<HTMLElement>(".sr-card").forEach((el, i) => {
          gsap.fromTo(el, { y: 60, opacity: 0 }, { y: 0, opacity: 1, duration: 0.7, delay: i * 0.08, ease: "power2.out", scrollTrigger: { trigger: el, start: "top 90%" } });
          el.addEventListener("mousemove", (e: Event) => {
            const r = el.getBoundingClientRect();
            gsap.to(el, { rotateY: (((e as MouseEvent).clientX - r.left) / r.width - 0.5) * 4, rotateX: -(((e as MouseEvent).clientY - r.top) / r.height - 0.5) * 4, duration: 0.4 });
          });
          el.addEventListener("mouseleave", () => { gsap.to(el, { rotateY: 0, rotateX: 0, duration: 0.4 }); });
        });
        gsap.fromTo(".sr-step", { y: 60, opacity: 0 }, { y: 0, opacity: 1, duration: 0.7, stagger: 0.15, ease: "power2.out", scrollTrigger: { trigger: ".sr-steps", start: "top 80%" } });
        gsap.to(".sr-orb-1", { y: -80, x: 40, ease: "none", scrollTrigger: { trigger: "body", start: "top top", end: "bottom bottom", scrub: 1 } });
        gsap.to(".sr-orb-2", { y: 80, x: -60, ease: "none", scrollTrigger: { trigger: "body", start: "top top", end: "bottom bottom", scrub: 1.2 } });
      });
    }
    init();
    return () => ctx?.revert();
  }, [checking]);

  if (checking) return <div className="min-h-screen flex items-center justify-center bg-[#0A0A0B]"><div className="w-8 h-8 rounded-lg bg-[#E8542A] animate-pulse" /></div>;

  return (
    <div className="bg-[#0A0A0B] text-[#F5F4F0] min-h-screen overflow-x-hidden" style={{ fontFamily: "'Schibsted Grotesk', system-ui, sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Schibsted+Grotesk:ital,wght@0,400;0,500;0,600;0,700;1,400&family=JetBrains+Mono:wght@400;500&display=swap');
        .sr-grid { background-image: linear-gradient(rgba(232,84,42,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(232,84,42,0.04) 1px, transparent 1px); background-size: 60px 60px; }
        .sr-dots { background-image: radial-gradient(circle, rgba(232,84,42,0.08) 1px, transparent 1px); background-size: 28px 28px; }
        .sr-gradient { background: linear-gradient(135deg, #E8542A 0%, #FF6A40 50%, #FF8A65 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
        .sr-glow { box-shadow: 0 0 100px rgba(232,84,42,0.12); }
      `}</style>

      <div className="sr-orb-1 fixed top-1/4 -right-40 w-[600px] h-[600px] rounded-full opacity-15 pointer-events-none z-0" style={{ background: "radial-gradient(circle, rgba(232,84,42,0.3) 0%, transparent 70%)" }} />
      <div className="sr-orb-2 fixed -bottom-40 -left-20 w-[500px] h-[500px] rounded-full opacity-12 pointer-events-none z-0" style={{ background: "radial-gradient(circle, rgba(232,84,42,0.25) 0%, transparent 70%)" }} />

      {/* HERO */}
      <section className="relative min-h-screen flex items-center justify-center overflow-hidden">
        <div className="absolute inset-0 sr-grid sr-dots opacity-50 z-0" />
        <svg className="sr-draw absolute inset-0 w-full h-full z-0 opacity-[0.05]" viewBox="0 0 1440 900" preserveAspectRatio="none">
          <line x1="0" y1="200" x2="1440" y2="200" stroke="#E8542A" strokeWidth="1" />
          <line x1="0" y1="600" x2="1440" y2="600" stroke="#E8542A" strokeWidth="1" />
          <rect x="200" y="250" width="240" height="280" fill="none" stroke="#E8542A" strokeWidth="1.5" rx="4" />
          <rect x="550" y="180" width="240" height="350" fill="none" stroke="#E8542A" strokeWidth="1.5" rx="4" />
          <rect x="900" y="300" width="240" height="230" fill="none" stroke="#E8542A" strokeWidth="1.5" rx="4" />
          <path d="M 0 700 Q 500 450 800 600 T 1440 500" fill="none" stroke="#FF6A40" strokeWidth="1.5" />
        </svg>
        <div className="relative z-10 max-w-5xl mx-auto px-6 text-center py-20">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-[#E8542A]/10 border border-[#E8542A]/20 text-[#E8542A] text-xs font-mono mb-10">
            <span className="w-2 h-2 rounded-full bg-[#E8542A] animate-pulse" /> Open source · Self-hosted
          </div>
          <h1 className="text-5xl md:text-7xl lg:text-8xl font-bold leading-none tracking-tight mb-6 max-w-4xl mx-auto">
            <span className="sr-hero-word inline-block">Your</span> <span className="sr-hero-word inline-block">VPS</span> <span className="sr-hero-word inline-block">has</span> <span className="sr-hero-word inline-block">an</span>{" "}
            <span className="sr-hero-word inline-block sr-gradient">AI</span> <span className="sr-hero-word inline-block">co-pilot</span>
          </h1>
          <p className="sr-hero-sub text-lg md:text-xl text-[#F5F4F0]/40 max-w-xl mx-auto mb-10">GroundControl gives you an AI agent that manages your server — metrics, logs, DNS, deployments, templates. No SSH needed.</p>
          <div className="sr-hero-cta flex flex-wrap items-center justify-center gap-4">
            <Link href="/login" className="px-8 py-3.5 bg-[#E8542A] text-white rounded-xl hover:bg-[#FF6A40] transition-all duration-200 text-sm font-mono font-medium shadow-lg shadow-[#E8542A]/20">Get Started →</Link>
            <div className="flex items-center gap-2">
              <code className="hidden sm:block px-4 py-3 bg-white/[0.03] border border-white/[0.06] rounded-xl text-xs font-mono text-white/20">{installCmd}</code>
              <button onClick={copyCmd} className="px-3 py-3 text-xs font-mono text-white/20 hover:text-[#E8542A] border border-white/[0.06] rounded-xl hover:border-[#E8542A]/30 transition-all shrink-0">{copied ? "Copied" : "Copy"}</button>
            </div>
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section className="relative py-32 border-t border-white/[0.05]">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-20">
            <p className="text-[#E8542A] text-xs font-mono uppercase tracking-[0.2em] mb-4">Features</p>
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">Everything you need to <span className="sr-gradient">run production</span></h2>
            <p className="text-[#F5F4F0]/30 max-w-md mx-auto">From a fresh VPS to a monitored, backed-up, reverse-proxied stack.</p>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {[
              { icon: "◉", title: "AI Management", desc: "Ask the co-pilot anything — check CPU, read logs, restart services. It knows your server's actual state." },
              { icon: "▦", title: "Templates", desc: "Production stacks in one click. Caddy + App + DB, Traefik + microservices. GitHub, GHCR, or local code." },
              { icon: "◎", title: "Cloudflare DNS", desc: "Manage records, zones, tunnels directly from GC. Auto-create A records when you deploy." },
              { icon: "◈", title: "Live Dashboard", desc: "Real-time metrics, container health, disk usage. Alerts when something breaks." },
              { icon: "⌘", title: "Terminal + AI Agent", desc: "Full terminal access + AI that can manage services, read logs, install software." },
              { icon: "◑", title: "Self-Hosted", desc: "Runs on your VPS. Your data stays yours. Open source. No credit card." },
            ].map((f, i) => (
              <div key={i} className="sr-card bg-white/[0.02] border border-white/[0.05] rounded-2xl p-8 hover:bg-white/[0.04] hover:border-[#E8542A]/20 transition-colors duration-300" style={{ perspective: "800px" }}>
                <div className="w-12 h-12 rounded-xl bg-[#E8542A]/10 flex items-center justify-center text-[#E8542A] text-xl mb-5">{f.icon}</div>
                <h3 className="font-semibold text-base mb-2">{f.title}</h3>
                <p className="text-sm text-[#F5F4F0]/30 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="sr-steps relative py-32 border-t border-white/[0.05]">
        <div className="max-w-5xl mx-auto px-6">
          <div className="text-center mb-20">
            <p className="text-[#E8542A] text-xs font-mono uppercase tracking-[0.2em] mb-4">How it works</p>
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">Three steps to <span className="sr-gradient">production</span></h2>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              { step: "01", title: "Install", desc: "One curl command. Docker + GroundControl on your VPS in 60 seconds.", color: "#E8542A" },
              { step: "02", title: "Connect", desc: "GroundControl scans your server, discovers your stack, asks a few questions.", color: "#FF6A40" },
              { step: "03", title: "Deploy", desc: "Pick a template, connect your code, configure DNS. Production-ready in minutes.", color: "#FF8A65" },
            ].map((s, i) => (
              <div key={i} className="sr-step text-center">
                <div className="text-6xl font-bold mb-4" style={{ color: s.color }}>{s.step}</div>
                <h3 className="text-xl font-semibold mb-3">{s.title}</h3>
                <p className="text-sm text-[#F5F4F0]/30 leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="relative py-32 border-t border-white/[0.05]">
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#E8542A]/[0.015] to-transparent" />
        <div className="relative max-w-2xl mx-auto px-6 text-center">
          <div className="bg-white/[0.02] border border-white/[0.05] rounded-3xl p-12 sr-glow">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Ready to give your VPS an AI co-pilot?</h2>
            <p className="text-[#F5F4F0]/30 mb-8">Free. Open source. Self-hosted. No credit card.</p>
            <div className="flex items-center gap-2 justify-center mb-6">
              <code className="px-5 py-3 bg-black/40 border border-white/[0.06] rounded-xl text-xs font-mono text-white/20 max-w-lg truncate">{installCmd}</code>
              <button onClick={copyCmd} className="px-4 py-3 text-xs font-mono text-white/20 hover:text-[#E8542A] border border-white/[0.06] rounded-xl hover:border-[#E8542A]/30 transition-all shrink-0">{copied ? "✓" : "Copy"}</button>
            </div>
            <div className="flex gap-4 justify-center">
              <Link href="/login" className="px-6 py-3 bg-[#E8542A] text-white rounded-xl hover:bg-[#FF6A40] transition-all text-sm font-mono shadow-lg shadow-[#E8542A]/20">Sign In</Link>
              <a href="https://github.com/teckedd-code2save/groundcontrol" target="_blank" rel="noopener" className="px-6 py-3 border border-white/[0.06] rounded-xl hover:border-[#E8542A]/30 hover:text-[#E8542A] transition-all text-sm font-mono">GitHub →</a>
            </div>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-white/[0.05] py-12">
        <div className="max-w-6xl mx-auto px-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-6">
              <span className="text-sm font-semibold text-[#F5F4F0]/50">GroundControl</span>
              <div className="flex items-center gap-5">
                <a href="https://github.com/teckedd-code2save/groundcontrol" target="_blank" rel="noopener" className="text-xs font-mono text-[#F5F4F0]/20 hover:text-[#E8542A] transition-colors">GitHub</a>
                <a href="https://github.com/teckedd-code2save/convoy" target="_blank" rel="noopener" className="text-xs font-mono text-[#F5F4F0]/20 hover:text-[#E8542A] transition-colors">Convoy</a>
                <a href="https://www.serendepify.com" target="_blank" rel="noopener" className="text-xs font-mono text-[#F5F4F0]/20 hover:text-[#E8542A] transition-colors">Serendepify</a>
              </div>
            </div>
            <p className="text-xs text-[#F5F4F0]/12 font-mono">Open source · Self-hosted VPS management with AI</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
