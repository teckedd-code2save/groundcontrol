"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AuthInput, AuthButton, AuthError } from "@/components/AuthCard";

const C = { bg: "#202427", dark: "#141618", darker: "#0D0E10", text: "#F5F6F7", mut: "rgba(245,246,247,0.45)", dim: "rgba(245,246,247,0.22)", lin: "rgba(245,246,247,0.08)" };

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
        // Split-text headline
        gsap.fromTo(".line-mask .line-inner", { y: "100%" }, { y: "0%", duration: 1.4, stagger: 0.18, ease: "power3.inOut", delay: 0.5 });
        gsap.fromTo(".fade-up", { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.8, stagger: 0.1, delay: 1.2, ease: "power2.out" });
        gsap.to(".bg-parallax", { y: "15%", ease: "none", scrollTrigger: { trigger: ".hero-s", start: "top top", end: "bottom top", scrub: 1 } });
        gsap.fromTo(".h-card", { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.7, stagger: 0.1, ease: "power2.out", scrollTrigger: { trigger: ".feat-s", start: "top 80%" } });
        gsap.fromTo(".m-val", { opacity: 0, scale: 0.9 }, { opacity: 1, scale: 1, duration: 0.8, stagger: 0.12, ease: "power2.out", scrollTrigger: { trigger: ".met-s", start: "top 80%" } });

        // Screenshot reveals — cipherdigital expanding-on-scroll pattern
        gsap.utils.toArray<HTMLElement>(".shot-reveal").forEach((el) => {
          const img = el.querySelector("img");
          if (!img) return;
          // Start clipped from bottom
          gsap.set(img, { clipPath: "inset(30% 0% 0% 0%)", scale: 1.08 });
          gsap.to(img, {
            clipPath: "inset(0% 0% 0% 0%)",
            scale: 1,
            duration: 1.6,
            ease: "power3.inOut",
            scrollTrigger: { trigger: el, start: "top 75%", end: "top 30%", scrub: 0.8 }
          });
          // Label fade
          const label = el.querySelector(".shot-label");
          if (label) {
            gsap.fromTo(label, { y: 16, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6, ease: "power2.out",
              scrollTrigger: { trigger: el, start: "top 75%" } });
          }
        });
      });
    }
    init();
    return () => ctx?.revert();
  }, []);

  return (
    <div style={{ background: C.bg, color: C.text, fontFamily: "articulat-cf, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", minHeight: "100vh", overflowX: "hidden" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500&display=swap'); body{margin:0;}`}</style>

      {/* HERO */}
      <section className="hero-s relative min-h-screen flex items-center overflow-hidden" style={{ background: C.dark }}>
        <div className="bg-parallax absolute inset-0" style={{ background: `radial-gradient(ellipse 80% 60% at 50% 40%, ${C.dark} 0%, ${C.bg} 60%, ${C.darker} 100%)` }} />
        <div className="absolute inset-0 opacity-30" style={{ backgroundImage: `linear-gradient(${C.lin} 1px, transparent 1px), linear-gradient(90deg, ${C.lin} 1px, transparent 1px)`, backgroundSize: "80px 80px" }} />
        <div className="relative z-10 w-full max-w-7xl mx-auto px-6 md:px-12 py-24">
          <div style={{ maxWidth: 700 }}>
            <div className="mb-10">
              <h1 style={{ fontSize: "clamp(36px, 6.5vw, 72px)", fontWeight: 300, lineHeight: 1.06, letterSpacing: "-0.02em", margin: 0 }}>
                <div className="line-mask" style={{ overflow: "hidden" }}><div className="line-inner">Your VPS has an</div></div>
                <div className="line-mask" style={{ overflow: "hidden" }}><div className="line-inner" style={{ color: "#E8542A" }}>AI co-pilot</div></div>
              </h1>
            </div>
            <p className="fade-up" style={{ fontSize: 18, color: C.mut, lineHeight: 1.7, marginBottom: 36, maxWidth: 480 }}>Metrics, logs, DNS, deployments, templates — managed by an AI agent that knows your server.</p>
            <div className="fade-up flex flex-wrap items-center gap-3">
              <button onClick={() => setShowLogin(true)} style={{ padding: "14px 32px", background: "transparent", color: C.text, border: `1px solid ${C.dim}`, fontFamily: "inherit", fontSize: 14, fontWeight: 400, cursor: "pointer" }}>Open Dashboard →</button>
              <button onClick={copyCmd} style={{ padding: "14px 32px", background: "transparent", color: C.mut, border: `1px solid ${C.lin}`, fontFamily: "monospace", fontSize: 12, fontWeight: 400, cursor: "pointer", whiteSpace: "nowrap" }}>{copied ? "Copied" : "Copy command"}</button>
            </div>
          </div>
        </div>
        <div className="fade-up absolute bottom-10 left-1/2 -translate-x-1/2" style={{ color: C.dim, fontSize: 11, letterSpacing: "0.15em", textTransform: "uppercase" }}>Scroll</div>
      </section>

      {/* SCREENSHOT 1 — Dashboard */}
      <section className="shot-reveal" style={{ padding: "120px 0 60px", background: C.bg }}>
        <div className="max-w-6xl mx-auto px-6 md:px-12">
          <div className="text-center mb-12">
            <p className="shot-label" style={{ color: C.dim, fontSize: 11, letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 16 }}>01 — Dashboard</p>
            <h2 className="shot-label" style={{ fontSize: "clamp(28px, 4vw, 42px)", fontWeight: 300, lineHeight: 1.15, margin: "0 0 12px" }}>Real-time metrics.</h2>
            <p className="shot-label" style={{ color: C.mut, fontSize: 16, maxWidth: 480, margin: "0 auto" }}>CPU, memory, disk, container health. Everything you need to know about your server — in one place.</p>
          </div>
          <div style={{ overflow: "hidden", maxWidth: 900, margin: "0 auto" }}>
            <img src="/login-previews/dashboard.png" alt="Dashboard" style={{ width: "100%", display: "block" }} loading="lazy" />
          </div>
        </div>
      </section>

      {/* SCREENSHOT 2 — Services */}
      <section className="shot-reveal" style={{ padding: "60px 0", background: C.bg }}>
        <div className="max-w-6xl mx-auto px-6 md:px-12">
          <div className="text-center mb-12">
            <p className="shot-label" style={{ color: C.dim, fontSize: 11, letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 16 }}>02 — Services</p>
            <h2 className="shot-label" style={{ fontSize: "clamp(28px, 4vw, 42px)", fontWeight: 300, lineHeight: 1.15, margin: "0 0 12px" }}>Container management.</h2>
            <p className="shot-label" style={{ color: C.mut, fontSize: 16, maxWidth: 480, margin: "0 auto" }}>Start, stop, restart containers. View logs. The AI agent can manage services for you.</p>
          </div>
          <div style={{ overflow: "hidden", maxWidth: 900, margin: "0 auto" }}>
            <img src="/login-previews/containers.png" alt="Services" style={{ width: "100%", display: "block" }} loading="lazy" />
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section className="feat-s" style={{ padding: "120px 0", background: C.darker }}>
        <div className="max-w-7xl mx-auto px-6 md:px-12">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-px" style={{ background: C.lin }}>
            {[
              { icon: "◉", title: "AI Co-Pilot", desc: "Ask anything about your server. The agent reads your actual infrastructure." },
              { icon: "▦", title: "Deploy Templates", desc: "Caddy + App + DB, Traefik + microservices. One click to production." },
              { icon: "◎", title: "Cloudflare DNS", desc: "Manage records, zones, tunnels. Auto-create records on deploy." },
              { icon: "◈", title: "Live Dashboard", desc: "Real-time metrics, container health, alerts when something breaks." },
              { icon: "⌘", title: "Web Terminal", desc: "Full terminal access. The AI agent runs commands for you." },
              { icon: "◑", title: "Self-Hosted", desc: "Your VPS, your data. Open source. No vendor lock-in." },
            ].map((f, i) => (
              <div key={i} className="h-card" style={{ background: C.darker, padding: "clamp(24px, 4vw, 48px)" }}>
                <div style={{ color: C.dim, fontSize: 24, marginBottom: 20 }}>{f.icon}</div>
                <h3 style={{ fontSize: 18, fontWeight: 400, margin: "0 0 8px" }}>{f.title}</h3>
                <p style={{ fontSize: 14, color: C.mut, lineHeight: 1.6, margin: 0 }}>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SCREENSHOT 3 — Terminal */}
      <section className="shot-reveal" style={{ padding: "60px 0 120px", background: C.bg }}>
        <div className="max-w-6xl mx-auto px-6 md:px-12">
          <div className="text-center mb-12">
            <p className="shot-label" style={{ color: C.dim, fontSize: 11, letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 16 }}>03 — Terminal</p>
            <h2 className="shot-label" style={{ fontSize: "clamp(28px, 4vw, 42px)", fontWeight: 300, lineHeight: 1.15, margin: "0 0 12px" }}>Full terminal access.</h2>
            <p className="shot-label" style={{ color: C.mut, fontSize: 16, maxWidth: 480, margin: "0 auto" }}>Web-based shell for direct access. Or let the AI agent run commands — you type English, it executes.</p>
          </div>
          <div style={{ overflow: "hidden", maxWidth: 900, margin: "0 auto" }}>
            <img src="/login-previews/terminal.png" alt="Terminal" style={{ width: "100%", display: "block" }} loading="lazy" />
          </div>
        </div>
      </section>

      {/* METRICS */}
      <section className="met-s" style={{ padding: "100px 0", background: C.dark }}>
        <div className="max-w-5xl mx-auto px-6 md:px-12">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {[
              { val: "5", label: "Cloud Platforms" },
              { val: "3", label: "Deploy Templates" },
              { val: "22", label: "AI Agent Tools" },
              { val: "1", label: "Command to Install" },
            ].map((m, i) => (
              <div key={i} className="m-val text-center">
                <div style={{ fontSize: "clamp(36px, 5vw, 56px)", fontWeight: 300, lineHeight: 1, marginBottom: 8 }}>{m.val}</div>
                <div style={{ fontSize: 12, color: C.mut, textTransform: "uppercase", letterSpacing: "0.1em" }}>{m.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section style={{ padding: "120px 0", background: C.dark }}>
        <div className="max-w-2xl mx-auto px-6 text-center">
          <h2 style={{ fontSize: "clamp(28px, 4vw, 42px)", fontWeight: 300, lineHeight: 1.15, marginBottom: 24 }}>Ready to give your VPS an AI co-pilot?</h2>
          <p style={{ color: C.mut, fontSize: 16, marginBottom: 40 }}>Free. Open source. Self-hosted.</p>
          <div className="flex gap-3 justify-center flex-wrap">
            <button onClick={() => setShowLogin(true)} style={{ padding: "16px 36px", background: "transparent", color: C.text, border: `1px solid ${C.dim}`, fontFamily: "inherit", fontSize: 14, fontWeight: 400, cursor: "pointer" }}>Open Dashboard</button>
            <a href="https://github.com/teckedd-code2save/groundcontrol" target="_blank" rel="noopener" style={{ padding: "16px 36px", background: "transparent", color: C.mut, border: `1px solid ${C.lin}`, fontFamily: "inherit", fontSize: 14, fontWeight: 400, cursor: "pointer", textDecoration: "none" }}>GitHub</a>
          </div>
          <div style={{ marginTop: 32 }}>
            <code style={{ background: C.darker, padding: "12px 16px", fontSize: 11, color: C.mut, fontFamily: "monospace", wordBreak: "break-all", display: "inline-block", maxWidth: "100%" }}>{cmd}</code>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer style={{ padding: "48px 0", background: C.darker, borderTop: `1px solid ${C.lin}` }}>
        <div className="max-w-7xl mx-auto px-6 md:px-12 flex flex-col md:flex-row items-center justify-between gap-4">
          <span style={{ fontSize: 13, color: C.dim }}>GroundControl</span>
          <div style={{ display: "flex", gap: "clamp(12px, 3vw, 24px)", flexWrap: "wrap", justifyContent: "center" }}>
            <a href="https://github.com/teckedd-code2save/groundcontrol" target="_blank" rel="noopener" style={{ color: C.dim, fontSize: 12, textDecoration: "none", fontFamily: "monospace" }}>GitHub</a>
            <a href="https://github.com/teckedd-code2save/convoy" target="_blank" rel="noopener" style={{ color: C.dim, fontSize: 12, textDecoration: "none", fontFamily: "monospace" }}>Convoy</a>
            <a href="https://www.serendepify.com" target="_blank" rel="noopener" style={{ color: C.dim, fontSize: 12, textDecoration: "none", fontFamily: "monospace" }}>Serendepify</a>
          </div>
          <span style={{ color: C.dim, fontSize: 11, fontFamily: "monospace" }}>© 2026</span>
        </div>
      </footer>

      {/* LOGIN MODAL */}
      {showLogin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.85)", backdropFilter: "blur(8px)" }}>
          <div className="absolute inset-0" onClick={() => setShowLogin(false)} />
          <div className="relative w-full max-w-sm" style={{ background: C.dark, border: `1px solid ${C.lin}`, padding: "clamp(24px, 5vw, 40px)" }}>
            <h2 style={{ fontSize: 22, fontWeight: 300, marginBottom: 24 }}>Sign in</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <AuthInput label="Username" type="text" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="admin" autoFocus />
              <AuthInput label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
              <AuthError message={error} />
              <AuthButton loading={loading}>Sign In</AuthButton>
            </form>
            <button onClick={() => setShowLogin(false)} style={{ marginTop: 16, width: "100%", background: "transparent", border: "none", color: C.dim, fontSize: 12, cursor: "pointer", fontFamily: "monospace" }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
