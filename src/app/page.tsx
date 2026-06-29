"use client";

const CORAL = "#E8542A";
const CORAL_B = "#FF6A40";
const PAPER = "#F5F4F0";
const MUTED = "rgba(245,244,240,0.45)";
const FAINT = "rgba(245,244,240,0.12)";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";


export default function HomePage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [copied, setCopied] = useState(false);
  const cmd = "curl -fsSL https://raw.githubusercontent.com/teckedd-code2save/groundcontrol/main/scripts/bootstrap | bash -s root@your-vps";
  async function copyCmd() { await navigator.clipboard.writeText(cmd); setCopied(true); setTimeout(() => setCopied(false), 2000); }

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
        gsap.fromTo(".hw", { y: 80, opacity: 0 }, { y: 0, opacity: 1, duration: 0.9, stagger: 0.07, ease: "power3.out" });
        gsap.fromTo(".hd", { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: 0.7, delay: 0.6 });
        gsap.fromTo(".hc", { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, delay: 0.9 });
        gsap.fromTo(".hs", { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.6, stagger: 0.12, delay: 0.7 });
        gsap.utils.toArray<HTMLElement>(".cr").forEach((el, i) => {
          gsap.fromTo(el, { y: 48, opacity: 0 }, { y: 0, opacity: 1, duration: 0.65, delay: i * 0.08, ease: "power2.out", scrollTrigger: { trigger: el, start: "top 88%" } });
        });
        gsap.to(".o1", { y: -60, scrollTrigger: { trigger: "body", start: "top top", end: "bottom bottom", scrub: 0.8 } });
        gsap.to(".o2", { y: 60, scrollTrigger: { trigger: "body", start: "top top", end: "bottom bottom", scrub: 1 } });
      });
    }
    init();
    return () => ctx?.revert();
  }, [checking]);

  if (checking) return <div className="min-h-screen flex items-center justify-center" style={{ background: "#0B0B0C" }}><div className="w-8 h-8 rounded-lg animate-pulse" style={{ background: CORAL }} /></div>;

  return (
    <div className="min-h-screen overflow-x-hidden" style={{ background: "#0B0B0C", color: PAPER, fontFamily: "'Schibsted Grotesk', system-ui, sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Schibsted+Grotesk:wght@500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap');
        .dots { background-image: radial-gradient(circle, rgba(232,84,42,0.07) 1px, transparent 1px); background-size: 36px 36px; }
      `}</style>
      <div className="o1 fixed top-1/3 -right-60 w-[700px] h-[700px] rounded-full opacity-[0.10] pointer-events-none z-0" style={{ background: `radial-gradient(circle, ${CORAL}44 0%, transparent 70%)` }} />
      <div className="o2 fixed -bottom-40 -left-20 w-[500px] h-[500px] rounded-full opacity-[0.08] pointer-events-none z-0" style={{ background: `radial-gradient(circle, ${CORAL_B}33 0%, transparent 70%)` }} />

      {/* HERO */}
      <section className="relative min-h-screen flex items-center justify-center overflow-hidden">
        <div className="absolute inset-0 dots opacity-50 z-0" style={{ maskImage: "linear-gradient(180deg, #000 0%, transparent 85%)", WebkitMaskImage: "linear-gradient(180deg, #000 0%, transparent 85%)" }} />
        <div className="relative z-10 max-w-6xl mx-auto px-6 text-center py-24">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full mb-10" style={{ background: `${CORAL}15`, border: `1px solid ${CORAL}30`, color: CORAL, fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>
            <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: CORAL }} /> Open source · Self-hosted
          </div>
          <h1 className="text-5xl md:text-7xl lg:text-8xl font-extrabold leading-none tracking-[-0.04em] mb-6 max-w-4xl mx-auto">
            <span className="hw inline-block">Your </span><span className="hw inline-block">VPS </span><span className="hw inline-block">has </span><span className="hw inline-block">an </span>
            <span className="hw inline-block" style={{ color: CORAL }}>AI </span><span className="hw inline-block">co-pilot</span>
          </h1>
          <p className="hd text-lg md:text-xl leading-relaxed mb-10 max-w-lg mx-auto" style={{ color: MUTED, fontWeight: 500 }}>
            GroundControl gives you an AI agent that manages your server — metrics, logs, DNS, deployments. No SSH needed.
          </p>
          <div className="hc flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link href="/login" className="px-8 py-3.5 rounded-xl text-sm font-bold transition-all duration-200" style={{ background: CORAL, color: "#fff", fontFamily: "'JetBrains Mono', monospace" }}>Get Started →</Link>
            <div className="flex items-center gap-2">
              <code className="hidden lg:block px-4 py-3 rounded-xl text-xs truncate max-w-sm" style={{ background: `${PAPER}05`, border: `1px solid ${FAINT}`, color: MUTED, fontFamily: "'JetBrains Mono', monospace" }}>{cmd}</code>
              <button onClick={copyCmd} className="px-3 py-3 rounded-xl text-xs transition-all shrink-0" style={{ background: `${PAPER}03`, border: `1px solid ${FAINT}`, color: copied ? CORAL : MUTED, fontFamily: "'JetBrains Mono', monospace" }}>{copied ? "Copied" : "Copy"}</button>
            </div>
          </div>
          <div className="hs flex gap-12 justify-center mt-14">
            <div><div className="text-3xl font-extrabold tracking-[-0.03em]">5</div><div className="text-xs font-semibold mt-0.5" style={{ color: MUTED }}>cloud platforms</div></div>
            <div><div className="text-3xl font-extrabold tracking-[-0.03em]">3</div><div className="text-xs font-semibold mt-0.5" style={{ color: MUTED }}>deploy templates</div></div>
            <div><div className="text-3xl font-extrabold tracking-[-0.03em]">22</div><div className="text-xs font-semibold mt-0.5" style={{ color: MUTED }}>AI agent tools</div></div>
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section className="relative py-28" style={{ borderTop: `1px solid ${FAINT}` }}>
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-16">
            <p className="uppercase tracking-[0.2em] text-xs mb-4" style={{ color: CORAL, fontFamily: "'JetBrains Mono', monospace" }}>Features</p>
            <h2 className="text-4xl md:text-5xl font-extrabold tracking-[-0.035em]">Everything you need to run production.</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {[
              { icon: "◉", title: "AI Co-Pilot", desc: "Ask anything — check CPU, read logs, restart services. It knows your server." },
              { icon: "▦", title: "Deploy Templates", desc: "Caddy + App + DB, Traefik + microservices. GitHub, GHCR, or local code." },
              { icon: "◎", title: "Cloudflare DNS", desc: "Manage records, zones, tunnels. Auto-create A records when you deploy." },
              { icon: "◈", title: "Live Dashboard", desc: "Real-time metrics, container health, disk usage. Alerts when something breaks." },
              { icon: "⌘", title: "Web Terminal", desc: "Full terminal access from your browser. The AI agent runs commands for you." },
              { icon: "◑", title: "Self-Hosted", desc: "Runs on your VPS. Your data stays yours. Open source. No credit card." },
            ].map((f, i) => (
              <div key={i} className="cr rounded-2xl p-8 transition-colors duration-300" style={{ background: `${PAPER}03`, border: `1px solid ${FAINT}` }}>
                <div className="w-12 h-12 rounded-xl flex items-center justify-center text-xl mb-5" style={{ background: `${CORAL}15`, color: CORAL }}>{f.icon}</div>
                <h3 className="font-bold text-base mb-2">{f.title}</h3>
                <p className="text-sm leading-relaxed" style={{ color: MUTED, fontWeight: 500 }}>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="relative py-28" style={{ borderTop: `1px solid ${FAINT}` }}>
        <div className="max-w-2xl mx-auto px-6 text-center">
          <div className="rounded-3xl p-12" style={{ background: `${PAPER}03`, border: `1px solid ${FAINT}`, boxShadow: `0 0 120px ${CORAL}15` }}>
            <h2 className="text-3xl md:text-4xl font-extrabold tracking-[-0.03em] mb-4">Ready to give your VPS an AI co-pilot?</h2>
            <p className="mb-8" style={{ color: MUTED, fontWeight: 500 }}>Free. Open source. Self-hosted.</p>
            <div className="flex items-center gap-2 justify-center mb-6">
              <code className="px-5 py-3 rounded-xl text-xs max-w-lg truncate" style={{ background: "#00000055", border: `1px solid ${FAINT}`, color: MUTED, fontFamily: "'JetBrains Mono', monospace" }}>{cmd}</code>
              <button onClick={copyCmd} className="px-4 py-3 rounded-xl text-xs transition-all shrink-0" style={{ background: `${PAPER}03`, border: `1px solid ${FAINT}`, color: copied ? CORAL : MUTED, fontFamily: "'JetBrains Mono', monospace" }}>{copied ? "✓" : "Copy"}</button>
            </div>
            <div className="flex gap-4 justify-center">
              <Link href="/login" className="px-6 py-3 rounded-xl text-sm font-bold transition-all shadow-lg" style={{ background: CORAL, color: "#fff", fontFamily: "'JetBrains Mono', monospace", boxShadow: `0 12px 32px ${CORAL}33` }}>Open Dashboard</Link>
              <a href="https://github.com/teckedd-code2save/groundcontrol" target="_blank" rel="noopener" className="px-6 py-3 rounded-xl text-sm font-bold transition-all" style={{ border: `1px solid ${FAINT}`, color: MUTED, fontFamily: "'JetBrains Mono', monospace" }}>GitHub →</a>
            </div>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="py-10" style={{ borderTop: `1px solid ${FAINT}` }}>
        <div className="max-w-6xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <span className="text-sm font-semibold" style={{ color: `${PAPER}55` }}>GroundControl</span>
          <div className="flex items-center gap-5">
            <a href="https://github.com/teckedd-code2save/groundcontrol" target="_blank" rel="noopener" className="text-xs transition-colors" style={{ color: `${PAPER}22`, fontFamily: "'JetBrains Mono', monospace" }}>GitHub</a>
            <a href="https://github.com/teckedd-code2save/convoy" target="_blank" rel="noopener" className="text-xs transition-colors" style={{ color: `${PAPER}22`, fontFamily: "'JetBrains Mono', monospace" }}>Convoy</a>
            <a href="https://www.serendepify.com" target="_blank" rel="noopener" className="text-xs transition-colors" style={{ color: `${PAPER}22`, fontFamily: "'JetBrains Mono', monospace" }}>Serendepify</a>
          </div>
          <span className="text-xs" style={{ color: `${PAPER}12`, fontFamily: "'JetBrains Mono', monospace" }}>Open source · Self-hosted</span>
        </div>
      </footer>
    </div>
  );
}
