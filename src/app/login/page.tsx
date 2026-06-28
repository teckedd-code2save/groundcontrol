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
  const installCmd = "curl -fsSL https://raw.githubusercontent.com/teckedd-code2save/groundcontrol/main/scripts/bootstrap | bash -s root@your-vps";

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
          { scale: 0.9, opacity: 0 },
          { scale: 1, opacity: 1, duration: 0.7, stagger: 0.2, ease: "back.out(1.5)",
            scrollTrigger: { trigger: stepsRef.current, start: "top 80%" } });
      }
    }
    init();
  }, []);

  return (
    <div className="bg-[#0A0A0B] text-[#F5F4F0] min-h-screen font-sans">
      <style>{`
        @keyframes blueprintGrid { 0% { background-position: 0 0; } 100% { background-position: 60px 60px; } }
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
      <section ref={heroRef} className="relative min-h-screen flex items-center overflow-hidden border-b border-white/5">
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
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <div className="hero-anim inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#E8542A]/10 border border-[#E8542A]/20 text-[#E8542A] text-xs font-mono mb-8">
                <span className="w-1.5 h-1.5 rounded-full bg-[#E8542A] animate-pulse" /> Open source · Self-hosted
              </div>
              <h1 className="hero-anim text-5xl md:text-7xl font-bold leading-none tracking-tight mb-6" style={{fontFamily:"'Schibsted Grotesk',system-ui,sans-serif"}}>
                Your VPS has an{" "}
                <span className="text-[#E8542A]">AI co-pilot</span>
              </h1>
              <p className="hero-anim text-lg text-white/50 leading-relaxed mb-8 max-w-lg">
                GroundControl gives you an AI agent that manages your server — metrics, logs, DNS, deployments. No SSH needed.
              </p>
              <div className="hero-anim flex flex-wrap gap-4">
                <button onClick={() => setShowLogin(true)}
                  className="px-6 py-3 bg-[#E8542A] text-white rounded-xl hover:bg-[#FF6A40] transition-colors text-sm font-mono font-medium">
                  Sign In →
                </button>
                <code className="px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-xs font-mono text-white/30 hidden sm:block">
                  {installCmd}
                </code>
              </div>
            </div>

            <div className="hero-anim hidden lg:block relative">
              <div className="relative w-full aspect-[4/3] bg-white/[0.03] border border-white/5 rounded-2xl overflow-hidden shadow-2xl">
                <div className="absolute top-0 left-0 right-0 h-10 bg-white/[0.05] border-b border-white/5 flex items-center px-4 gap-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-white/20" /><div className="w-2.5 h-2.5 rounded-full bg-white/20" /><div className="w-2.5 h-2.5 rounded-full bg-white/20" />
                  <span className="text-[10px] text-white/20 font-mono ml-2">groundcontrol</span>
                </div>
                <div className="p-5 pt-14 space-y-3">
                  <div className="flex gap-3">
                    <div className="flex-1 h-16 bg-white/[0.03] rounded-lg border border-white/5 flex items-center px-4">
                      <div><div className="text-[10px] text-white/20 font-mono">CPU</div><div className="text-lg font-mono text-[#E8542A]">23%</div></div>
                    </div>
                    <div className="flex-1 h-16 bg-white/[0.03] rounded-lg border border-white/5 flex items-center px-4">
                      <div><div className="text-[10px] text-white/20 font-mono">MEM</div><div className="text-lg font-mono text-white/60">1.2GB</div></div>
                    </div>
                    <div className="flex-1 h-16 bg-white/[0.03] rounded-lg border border-white/5 flex items-center px-4">
                      <div><div className="text-[10px] text-white/20 font-mono">DISK</div><div className="text-lg font-mono text-white/60">45%</div></div>
                    </div>
                  </div>
                  <div className="h-32 bg-white/[0.02] rounded-lg border border-white/5 flex items-center justify-center">
                    <span className="text-white/10 font-mono text-xs">◉ AI Co-Pilot ready</span>
                  </div>
                </div>
              </div>
              <div className="absolute -bottom-3 -right-3 bg-[#0A0A0B] border border-[#E8542A]/20 rounded-xl p-3 shadow-xl">
                <div className="flex items-center gap-2 text-xs font-mono text-[#E8542A]">
                  <span className="w-2 h-2 rounded-full bg-[#E8542A] animate-pulse" /> 22 containers running
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── LOGIN MODAL ── */}
      {showLogin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setShowLogin(false)} />
          <div className="relative bg-[#0A0A0B] border border-white/10 rounded-2xl p-8 w-full max-w-sm shadow-2xl">
            <div className="absolute -top-px left-8 right-8 h-px bg-gradient-to-r from-transparent via-[#E8542A]/40 to-transparent" />
            <div className="text-center mb-6">
              <BrandLogo size={40} stroke="#F5F4F0" />
              <h2 className="text-lg font-bold mt-3">Sign in</h2>
              <p className="text-xs text-white/30 mt-1">Access your dashboard</p>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <AuthInput label="Username" type="text" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="admin" autoFocus />
              <AuthInput label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
              <AuthError message={error} />
              <AuthButton loading={loading}>Sign In</AuthButton>
            </form>
            <button onClick={() => setShowLogin(false)} className="mt-4 w-full text-center text-xs text-white/20 hover:text-white/40 transition-colors font-mono">Cancel</button>
          </div>
        </div>
      )}

      {/* ── FOOTER ── */}
      <footer className="border-t border-white/5 py-8">
        <div className="max-w-6xl mx-auto px-6 flex items-center justify-center gap-4">
          <a href="https://github.com/teckedd-code2save" target="_blank" rel="noopener" className="text-xs font-mono text-white/15 hover:text-[#E8542A] transition-colors">GitHub</a>
          <span className="text-white/10">·</span>
          <a href="https://github.com/teckedd-code2save/groundcontrol" target="_blank" rel="noopener" className="text-xs font-mono text-white/15 hover:text-[#E8542A] transition-colors">groundcontrol</a>
          <span className="text-white/10">·</span>
          <a href="https://github.com/teckedd-code2save/convoy" target="_blank" rel="noopener" className="text-xs font-mono text-white/15 hover:text-[#E8542A] transition-colors">convoy</a>
          <span className="text-white/10">·</span>
          <a href="https://www.serendepify.com" target="_blank" rel="noopener" className="text-xs font-mono text-white/15 hover:text-[#E8542A] transition-colors">serendepify</a>
        </div>
      </footer>
    </div>
  );
}
