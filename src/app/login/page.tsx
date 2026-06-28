"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import BrandLogo from "@/components/BrandLogo";
import { AuthInput, AuthButton, AuthError } from "@/components/AuthCard";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const router = useRouter();
  const heroRef = useRef<HTMLDivElement>(null);
  const featuresRef = useRef<HTMLDivElement>(null);
  const stepsRef = useRef<HTMLDivElement>(null);
  const ctaRef = useRef<HTMLDivElement>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setLoading(true); setError("");
    try {
      const res = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
      if (res.ok) router.push("/");
      else { const d = await res.json().catch(() => ({})); setError(d.error || "Invalid credentials"); }
    } catch { setError("Network error"); } finally { setLoading(false); }
  }

  useEffect(() => {
    async function init() {
      const { gsap } = await import("gsap");
      const { ScrollTrigger } = await import("gsap/ScrollTrigger");
      gsap.registerPlugin(ScrollTrigger);

      // Hero stagger
      if (heroRef.current) {
        gsap.fromTo(heroRef.current.querySelectorAll(".hero-anim"),
          { y: 80, opacity: 0 }, { y: 0, opacity: 1, duration: 1, stagger: 0.12, ease: "power3.out" });
        // Animated SVG paths
        gsap.fromTo(heroRef.current.querySelectorAll(".draw-path"),
          { strokeDashoffset: 1000, strokeDasharray: 1000 },
          { strokeDashoffset: 0, duration: 2, ease: "power2.inOut", delay: 0.8 });
      }

      // Features scroll reveal
      if (featuresRef.current) {
        featuresRef.current.querySelectorAll(".feat-card").forEach((el, i) => {
          gsap.fromTo(el, { y: 60, opacity: 0 },
            { y: 0, opacity: 1, duration: 0.8, ease: "power2.out",
              scrollTrigger: { trigger: el, start: "top 85%", end: "top 50%", toggleActions: "play none none reverse" } });
        });
      }

      // Steps with connecting line draw
      if (stepsRef.current) {
        gsap.fromTo(stepsRef.current.querySelectorAll(".step-card"),
          { y: 40, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.7, stagger: 0.2, ease: "power2.out",
            scrollTrigger: { trigger: stepsRef.current, start: "top 80%" } });
        gsap.fromTo(stepsRef.current.querySelector(".connect-line"),
          { scaleX: 0, transformOrigin: "left center" },
          { scaleX: 1, duration: 1.5, ease: "power2.inOut",
            scrollTrigger: { trigger: stepsRef.current, start: "top 70%" } });
      }

      // CTA pulse
      if (ctaRef.current) {
        gsap.fromTo(ctaRef.current, { scale: 0.95, opacity: 0 },
          { scale: 1, opacity: 1, duration: 0.8, ease: "back.out(1.5)",
            scrollTrigger: { trigger: ctaRef.current, start: "top 85%" } });
      }
    }
    init();
  }, []);

  return (
    <div className="bg-[#080b12] text-slate-200 min-h-screen">
      <style>{`
        @keyframes blueprintPulse { 0%,100% { opacity:0.3; } 50% { opacity:0.6; } }
        @keyframes drawLine { to { stroke-dashoffset: 0; } }
        .blueprint-grid {
          background-image: linear-gradient(rgba(34,211,238,0.06) 1px, transparent 1px),
                            linear-gradient(90deg, rgba(34,211,238,0.06) 1px, transparent 1px);
          background-size: 40px 40px;
        }
        .blueprint-dots {
          background-image: radial-gradient(circle, rgba(34,211,238,0.15) 1px, transparent 1px);
          background-size: 20px 20px;
        }
        .gradient-text {
          background: linear-gradient(135deg, #22d3ee 0%, #a78bfa 50%, #f472b6 100%);
          -webkit-background-clip: text; -webkit-text-fill-color: transparent;
        }
      `}</style>

      {/* ── SECTION 1: HERO ── */}
      <section ref={heroRef} className="relative min-h-screen flex items-center overflow-hidden">
        {/* Blueprint grid */}
        <div className="absolute inset-0 blueprint-grid blueprint-dots opacity-60" />
        {/* Floating gradient orbs */}
        <div className="absolute top-20 left-10 w-72 h-72 rounded-full bg-cyan-500/10 blur-3xl animate-pulse" style={{animationDuration:"8s"}} />
        <div className="absolute bottom-20 right-10 w-96 h-96 rounded-full bg-violet-500/8 blur-3xl animate-pulse" style={{animationDuration:"12s",animationDelay:"3s"}} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full bg-fuchsia-500/5 blur-3xl animate-pulse" style={{animationDuration:"10s",animationDelay:"5s"}} />

        {/* Animated SVG blueprint lines */}
        <svg className="absolute inset-0 w-full h-full opacity-[0.08]" viewBox="0 0 1200 800" preserveAspectRatio="none">
          {/* Horizontal graph lines */}
          {[100,200,300,400,500,600,700].map((y,i) => (
            <line key={y} x1="0" y1={y} x2="1200" y2={y} stroke="#22d3ee" strokeWidth="1"
              className="draw-path" strokeDasharray="1000" strokeDashoffset="1000" />
          ))}
          {/* Vertical graph bars */}
          {[200,350,500,650,800,950,1100].map((x,i) => (
            <rect key={x} x={x} y="200" width="60" height={100 + i * 60} fill="none" stroke="#a78bfa" strokeWidth="1"
              className="draw-path" strokeDasharray="1000" strokeDashoffset="1000" />
          ))}
          {/* Diagonal accent */}
          <line x1="0" y1="700" x2="400" y2="400" stroke="#f472b6" strokeWidth="1.5"
            className="draw-path" strokeDasharray="600" strokeDashoffset="600" />
          <line x1="800" y1="300" x2="1200" y2="500" stroke="#22d3ee" strokeWidth="1.5"
            className="draw-path" strokeDasharray="600" strokeDashoffset="600" />
        </svg>

        <div className="relative max-w-6xl mx-auto px-6 py-20 w-full">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            {/* Left: Copy */}
            <div>
              <div className="hero-anim inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-xs font-mono mb-8">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" /> Open source · Self-hosted
              </div>
              <h1 className="hero-anim text-5xl md:text-6xl font-bold leading-tight mb-6">
                Your VPS has an{" "}
                <span className="gradient-text">AI co-pilot</span>
              </h1>
              <p className="hero-anim text-lg text-slate-400 leading-relaxed mb-8 max-w-lg">
                GroundControl gives you an AI agent that manages your server — metrics, logs, DNS, deployments. No SSH needed.
              </p>
              <div className="hero-anim flex flex-wrap gap-4">
                <button onClick={() => setShowLogin(true)}
                  className="px-6 py-3 bg-gradient-to-r from-cyan-500 to-violet-500 text-white rounded-xl hover:opacity-90 transition-opacity text-sm font-mono font-medium">
                  Sign In →
                </button>
                <code className="px-4 py-3 bg-slate-900/80 border border-slate-800 rounded-xl text-xs font-mono text-slate-400 hidden sm:block">
                  curl -fsSL https://raw.../bootstrap | bash
                </code>
              </div>
            </div>

            {/* Right: Animated dashboard preview / SVG art */}
            <div className="hero-anim hidden lg:block relative">
              <div className="relative w-full aspect-[4/3] bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl shadow-cyan-500/5">
                {/* Fake dashboard */}
                <div className="absolute top-0 left-0 right-0 h-10 bg-slate-900/80 border-b border-slate-800 flex items-center px-4 gap-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
                  <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
                  <div className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
                  <span className="text-[10px] text-slate-600 font-mono ml-2">dashboard.groundcontrol</span>
                </div>
                <div className="p-5 pt-14 space-y-3">
                  <div className="flex gap-3">
                    <div className="flex-1 h-16 bg-slate-800/50 rounded-lg border border-slate-800 flex items-center px-4">
                      <div><div className="text-[10px] text-slate-600 font-mono">CPU</div><div className="text-lg font-mono text-cyan-400">23%</div></div>
                    </div>
                    <div className="flex-1 h-16 bg-slate-800/50 rounded-lg border border-slate-800 flex items-center px-4">
                      <div><div className="text-[10px] text-slate-600 font-mono">MEM</div><div className="text-lg font-mono text-violet-400">1.2GB</div></div>
                    </div>
                    <div className="flex-1 h-16 bg-slate-800/50 rounded-lg border border-slate-800 flex items-center px-4">
                      <div><div className="text-[10px] text-slate-600 font-mono">DISK</div><div className="text-lg font-mono text-fuchsia-400">45%</div></div>
                    </div>
                  </div>
                  <div className="h-32 bg-slate-800/30 rounded-lg border border-slate-800 flex items-center justify-center">
                    <span className="text-slate-700 font-mono text-xs">◉ AI Co-Pilot ready</span>
                  </div>
                  <div className="flex gap-2">
                    <div className="h-2 flex-1 rounded-full bg-cyan-500/30" />
                    <div className="h-2 flex-[2] rounded-full bg-violet-500/30" />
                    <div className="h-2 flex-[0.5] rounded-full bg-fuchsia-500/30" />
                  </div>
                </div>
              </div>
              {/* Floating element */}
              <div className="absolute -bottom-3 -right-3 bg-slate-900 border border-cyan-500/30 rounded-xl p-3 shadow-xl animate-pulse" style={{animationDuration:"3s"}}>
                <div className="flex items-center gap-2 text-xs font-mono text-cyan-400">
                  <span className="w-2 h-2 rounded-full bg-cyan-400" /> 22 containers running
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── SECTION 2: FEATURES ── */}
      <section ref={featuresRef} className="relative py-24 border-t border-slate-800/50">
        <div className="absolute inset-0 blueprint-grid opacity-30" />
        <div className="relative max-w-6xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold mb-4">Everything you need to <span className="gradient-text">run production</span></h2>
            <p className="text-slate-500 max-w-md mx-auto">From a fresh VPS to a monitored, backed-up, reverse-proxied stack.</p>
          </div>
          <div className="grid md:grid-cols-3 gap-5">
            {[
              { icon: "◉", title: "AI Management", desc: "Ask the co-pilot anything — check CPU, read logs, restart services. It knows your server." },
              { icon: "▦", title: "Templates", desc: "Production stacks in one click — Caddy + App + DB, Traefik + microservices, static sites." },
              { icon: "◎", title: "Cloudflare DNS", desc: "Manage records, zones, and tunnels from the same dashboard. Auto-create A records on deploy." },
              { icon: "◈", title: "Live Dashboard", desc: "Real-time metrics, container health, disk usage. Alerts when something breaks." },
              { icon: "⌘", title: "Terminal + AI Agent", desc: "Full terminal access plus an AI that can manage services, read logs, install software." },
              { icon: "◑", title: "Self-Hosted", desc: "Runs on your VPS. Your data stays yours. Open source. No vendor lock-in." },
            ].map((f, i) => (
              <div key={i} className="feat-card bg-slate-900/60 border border-slate-800 rounded-xl p-6 hover:border-cyan-500/30 transition-all duration-300 hover:-translate-y-1">
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-cyan-500/10 to-violet-500/10 flex items-center justify-center text-cyan-400 text-lg mb-4">{f.icon}</div>
                <h3 className="font-medium text-sm mb-2">{f.title}</h3>
                <p className="text-xs text-slate-500 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── SECTION 3: HOW IT WORKS ── */}
      <section ref={stepsRef} className="relative py-24 border-t border-slate-800/50">
        <div className="absolute inset-0 blueprint-dots opacity-40" />
        <div className="relative max-w-4xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold mb-4">Three steps to <span className="gradient-text">production</span></h2>
          </div>
          <div className="relative grid md:grid-cols-3 gap-8">
            {/* Connecting line */}
            <div className="hidden md:block absolute top-12 left-[20%] right-[20%] h-0.5 bg-gradient-to-r from-cyan-500/40 via-violet-500/40 to-fuchsia-500/40 connect-line origin-left scale-x-0" />
            {[
              { step: "1", title: "Install", desc: "One curl command. Docker + GroundControl on your VPS in 60 seconds.", color: "cyan" },
              { step: "2", title: "Connect", desc: "GroundControl scans your server, discovers your stack, asks a few questions.", color: "violet" },
              { step: "3", title: "Deploy", desc: "Pick a template, connect your code, configure DNS. Production in minutes.", color: "fuchsia" },
            ].map((s, i) => (
              <div key={i} className="step-card text-center relative">
                <div className={`w-14 h-14 rounded-2xl bg-${s.color}-500/10 border border-${s.color}-500/20 flex items-center justify-center text-${s.color}-400 text-xl font-bold mx-auto mb-4`}>{s.step}</div>
                <h3 className="font-medium mb-2">{s.title}</h3>
                <p className="text-xs text-slate-500 leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── SECTION 4: CTA ── */}
      <section ref={ctaRef} className="relative py-24 border-t border-slate-800/50">
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-cyan-500/3 to-transparent" />
        <div className="relative max-w-2xl mx-auto px-6 text-center">
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-10">
            <h2 className="text-2xl font-bold mb-3">Ready to give your VPS an AI co-pilot?</h2>
            <p className="text-slate-500 mb-6 text-sm">Free. Open source. Self-hosted.</p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <button onClick={() => setShowLogin(true)}
                className="px-6 py-3 bg-gradient-to-r from-cyan-500 to-violet-500 text-white rounded-xl hover:opacity-90 transition-opacity text-sm font-mono">
                Sign In
              </button>
              <Link href="/"
                className="px-6 py-3 border border-slate-800 rounded-xl hover:border-cyan-500/50 hover:text-cyan-400 transition-colors text-sm font-mono">
                Learn More →
              </Link>
            </div>
            <code className="block mt-6 text-[10px] font-mono text-slate-600 break-all">
              curl -fsSL https://raw.githubusercontent.com/teckedd-code2save/groundcontrol/main/scripts/bootstrap | bash
            </code>
          </div>
        </div>
      </section>

      {/* ── LOGIN MODAL ── */}
      {showLogin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setShowLogin(false)} />
          <div className="relative bg-slate-900 border border-slate-800 rounded-2xl p-8 w-full max-w-sm shadow-2xl shadow-cyan-500/10">
            <div className="absolute -top-px left-8 right-8 h-px bg-gradient-to-r from-transparent via-cyan-400/40 to-transparent" />
            <div className="text-center mb-6">
              <BrandLogo size={40} stroke="#1b1916" />
              <h2 className="text-lg font-bold mt-3">Sign in</h2>
              <p className="text-xs text-slate-500 mt-1">Access your dashboard</p>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <AuthInput label="Username" type="text" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="admin" autoFocus />
              <AuthInput label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
              <AuthError message={error} />
              <AuthButton loading={loading}>Sign In</AuthButton>
            </form>
            <button onClick={() => setShowLogin(false)}
              className="mt-4 w-full text-center text-xs text-slate-600 hover:text-slate-400 transition-colors font-mono">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
