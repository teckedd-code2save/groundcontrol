"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AuthInput, AuthButton, AuthError } from "@/components/AuthCard";

// Cipher Digital palette
const C = { bg: "#202427", dark: "#141618", darker: "#0D0E10", text: "#F5F6F7", mute: "rgba(245,246,247,0.45)", dim: "rgba(245,246,247,0.22)", line: "rgba(245,246,247,0.08)" };

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [copied, setCopied] = useState(false);
  const router = useRouter();
  const cmd = "curl -fsSL https://raw.githubusercontent.com/teckedd-code2save/groundcontrol/main/scripts/bootstrap | bash -s root@your-vps";
  async function copyCmd() { await navigator.clipboard.writeText(cmd); setCopied(true); setTimeout(() => setCopied(false), 2000); }
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setLoading(true); setError("");
    try {
      const res = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
      if (res.ok) router.push("/"); else { const d = await res.json().catch(() => ({})); setError(d.error || "Invalid credentials"); }
    } catch { setError("Network error"); } finally { setLoading(false); }
  }

  useEffect(() => {
    let ctx: any;
    async function init() {
      const { gsap } = await import("gsap");
      const { ScrollTrigger } = await import("gsap/ScrollTrigger");
      gsap.registerPlugin(ScrollTrigger);
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      ctx = gsap.context(() => {
        // Split-text style headline reveal
        gsap.fromTo(".line-mask .line-inner",
          { y: "100%" }, { y: "0%", duration: 1.4, stagger: 0.18, ease: "power3.inOut", delay: 0.5 });

        // Fade up elements after headline
        gsap.fromTo(".fade-up", { y: 30, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.8, stagger: 0.1, delay: 1.2, ease: "power2.out" });

        // Parallax background
        gsap.to(".bg-parallax", { y: "15%", ease: "none",
          scrollTrigger: { trigger: ".hero-section", start: "top top", end: "bottom top", scrub: 1 } });

        // Horizontal scroll cards reveal
        gsap.fromTo(".h-card", { y: 40, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.7, stagger: 0.1, ease: "power2.out",
            scrollTrigger: { trigger: ".features-section", start: "top 80%" } });

        // Metrics count
        gsap.fromTo(".metric-val", { opacity: 0, scale: 0.9 },
          { opacity: 1, scale: 1, duration: 0.8, stagger: 0.12, ease: "power2.out",
            scrollTrigger: { trigger: ".metrics-section", start: "top 80%" } });
      });
    }
    init();
    return () => ctx?.revert();
  }, []);

  return (
    <div style={{ background: C.bg, color: C.text, fontFamily: "articulat-cf, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", minHeight: "100vh" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500&display=swap');
        body { margin: 0; }
      `}</style>

      {/* ── HERO ── */}
      <section className="hero-section relative h-screen flex items-center overflow-hidden" style={{ background: C.dark }}>
        {/* Background gradient (simulating cipherdigital's video bg) */}
        <div className="bg-parallax absolute inset-0" style={{ background: `radial-gradient(ellipse 80% 60% at 50% 40%, ${C.dark} 0%, ${C.bg} 60%, ${C.darker} 100%)` }} />
        <div className="absolute inset-0 opacity-30" style={{
          backgroundImage: `linear-gradient(${C.line} 1px, transparent 1px), linear-gradient(90deg, ${C.line} 1px, transparent 1px)`,
          backgroundSize: "80px 80px",
        }} />

        <div className="relative z-10 w-full max-w-7xl mx-auto px-6 md:px-12">
          <div style={{ maxWidth: 700 }}>
            {/* Headline — split text */}
            <div className="mb-10">
              <h1 style={{ fontSize: "clamp(42px, 6.5vw, 72px)", fontWeight: 300, lineHeight: 1.06, letterSpacing: "-0.02em", margin: 0 }}>
                <div className="line-mask" style={{ overflow: "hidden" }}>
                  <div className="line-inner">Your VPS has an</div>
                </div>
                <div className="line-mask" style={{ overflow: "hidden" }}>
                  <div className="line-inner" style={{ color: "#E8542A" }}>AI co-pilot</div>
                </div>
              </h1>
            </div>

            <p className="fade-up" style={{ fontSize: 18, color: C.mute, lineHeight: 1.7, marginBottom: 36, maxWidth: 480 }}>
              Metrics, logs, DNS, deployments, templates — managed by an AI agent that knows your server. No SSH needed.
            </p>

            <div className="fade-up flex items-center gap-4 flex-wrap">
              <button onClick={() => setShowLogin(true)}
                style={{ padding: "14px 32px", background: "transparent", color: C.text, border: `1px solid ${C.dim}`, fontFamily: "inherit", fontSize: 14, fontWeight: 400, cursor: "pointer", letterSpacing: "0.01em" }}>
                Open Dashboard →
              </button>
              <button onClick={copyCmd}
                style={{ padding: "14px 32px", background: "transparent", color: C.mute, border: `1px solid ${C.line}`, fontFamily: "monospace", fontSize: 12, fontWeight: 400, cursor: "pointer" }}>
                {copied ? "Copied" : "Copy install command"}
              </button>
            </div>
          </div>
        </div>

        {/* Scroll indicator */}
        <div className="fade-up absolute bottom-10 left-1/2 -translate-x-1/2" style={{ color: C.dim, fontSize: 11, letterSpacing: "0.15em", textTransform: "uppercase" }}>
          Scroll
        </div>
      </section>

      {/* ── FEATURES (cipherdigital horiz-scroll style — cards grid) ── */}
      <section className="features-section" style={{ padding: "120px 0", background: C.darker }}>
        <div className="max-w-7xl mx-auto px-6 md:px-12">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-px" style={{ background: C.line }}>
            {[
              { icon: "◉", title: "AI Co-Pilot", desc: "Ask anything about your server. The agent reads your actual infrastructure." },
              { icon: "▦", title: "Deploy Templates", desc: "Caddy + App + DB, Traefik + microservices. One click to production." },
              { icon: "◎", title: "Cloudflare DNS", desc: "Manage records, zones, tunnels. Auto-create records on deploy." },
              { icon: "◈", title: "Live Dashboard", desc: "Real-time metrics, container health, alerts when something breaks." },
              { icon: "⌘", title: "Web Terminal", desc: "Full terminal access. The AI agent runs commands for you." },
              { icon: "◑", title: "Self-Hosted", desc: "Your VPS, your data. Open source. No vendor lock-in." },
            ].map((f, i) => (
              <div key={i} className="h-card" style={{ background: C.darker, padding: 48 }}>
                <div style={{ color: C.dim, fontSize: 24, marginBottom: 20 }}>{f.icon}</div>
                <h3 style={{ fontSize: 18, fontWeight: 400, margin: "0 0 8px" }}>{f.title}</h3>
                <p style={{ fontSize: 14, color: C.mute, lineHeight: 1.6, margin: 0 }}>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── METRICS ── */}
      <section className="metrics-section" style={{ padding: "100px 0", background: C.bg }}>
        <div className="max-w-5xl mx-auto px-6 md:px-12">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {[
              { val: "5", label: "Cloud Platforms" },
              { val: "3", label: "Deploy Templates" },
              { val: "22", label: "AI Agent Tools" },
              { val: "1", label: "Command to Install" },
            ].map((m, i) => (
              <div key={i} className="metric-val text-center">
                <div style={{ fontSize: "clamp(36px, 5vw, 56px)", fontWeight: 300, lineHeight: 1, marginBottom: 8 }}>
                  {m.val}
                </div>
                <div style={{ fontSize: 12, color: C.mute, textTransform: "uppercase", letterSpacing: "0.1em" }}>
                  {m.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section style={{ padding: "120px 0", background: C.dark }}>
        <div className="max-w-2xl mx-auto px-6 text-center">
          <h2 style={{ fontSize: "clamp(28px, 4vw, 42px)", fontWeight: 300, lineHeight: 1.15, marginBottom: 24 }}>
            Ready to give your VPS an AI co-pilot?
          </h2>
          <p style={{ color: C.mute, fontSize: 16, marginBottom: 40 }}>Free. Open source. Self-hosted.</p>
          <div className="flex gap-4 justify-center flex-wrap">
            <button onClick={() => setShowLogin(true)}
              style={{ padding: "16px 36px", background: "transparent", color: C.text, border: `1px solid ${C.dim}`, fontFamily: "inherit", fontSize: 14, fontWeight: 400, cursor: "pointer" }}>
              Open Dashboard
            </button>
            <a href="https://github.com/teckedd-code2save/groundcontrol" target="_blank" rel="noopener"
              style={{ padding: "16px 36px", background: "transparent", color: C.mute, border: `1px solid ${C.line}`, fontFamily: "inherit", fontSize: 14, fontWeight: 400, cursor: "pointer", textDecoration: "none" }}>
              GitHub
            </a>
          </div>
          <div style={{ marginTop: 32 }}>
            <code style={{ background: C.darker, padding: "12px 20px", borderRadius: 0, fontSize: 11, color: C.mute, fontFamily: "monospace" }}>
              {cmd}
            </code>
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer style={{ padding: "48px 0", background: C.dark, borderTop: `1px solid ${C.line}` }}>
        <div className="max-w-7xl mx-auto px-6 md:px-12 flex flex-col md:flex-row items-center justify-between gap-4">
          <span style={{ fontSize: 13, color: C.dim }}>GroundControl</span>
          <div style={{ display: "flex", gap: 24 }}>
            <a href="https://github.com/teckedd-code2save/groundcontrol" target="_blank" rel="noopener" style={{ color: C.dim, fontSize: 12, textDecoration: "none", fontFamily: "monospace" }}>GitHub</a>
            <a href="https://github.com/teckedd-code2save/convoy" target="_blank" rel="noopener" style={{ color: C.dim, fontSize: 12, textDecoration: "none", fontFamily: "monospace" }}>Convoy</a>
            <a href="https://www.serendepify.com" target="_blank" rel="noopener" style={{ color: C.dim, fontSize: 12, textDecoration: "none", fontFamily: "monospace" }}>Serendepify</a>
          </div>
          <span style={{ color: C.dim, fontSize: 11, fontFamily: "monospace" }}>© 2026</span>
        </div>
      </footer>

      {/* ── LOGIN MODAL ── */}
      {showLogin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.85)", backdropFilter: "blur(8px)" }}>
          <div className="absolute inset-0" onClick={() => setShowLogin(false)} />
          <div className="relative w-full max-w-sm" style={{ background: C.dark, border: `1px solid ${C.line}`, padding: 40 }}>
            <h2 style={{ fontSize: 22, fontWeight: 300, marginBottom: 24 }}>Sign in</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <AuthInput label="Username" type="text" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="admin" autoFocus />
              <AuthInput label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
              <AuthError message={error} />
              <AuthButton loading={loading}>Sign In</AuthButton>
            </form>
            <button onClick={() => setShowLogin(false)}
              style={{ marginTop: 16, width: "100%", background: "transparent", border: "none", color: C.dim, fontSize: 12, cursor: "pointer", fontFamily: "monospace" }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
