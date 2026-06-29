"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AuthInput, AuthButton, AuthError } from "@/components/AuthCard";

const INK = "#0B0B0C"; const WARM = "#16150F"; const CORAL = "#E8542A"; const CORAL_B = "#FF6A40"; const PAPER = "#F5F4F0"; const MUTED = "rgba(245,244,240,0.45)"; const FAINT = "rgba(245,244,240,0.12)";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [copied, setCopied] = useState(false);
  const router = useRouter();
  const installCmd = "curl -fsSL https://raw.githubusercontent.com/teckedd-code2save/groundcontrol/main/scripts/bootstrap | bash -s root@your-vps";
  async function copyCmd() { await navigator.clipboard.writeText(installCmd); setCopied(true); setTimeout(() => setCopied(false), 2000); }
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setLoading(true); setError("");
    try {
      const res = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
      if (res.ok) router.push("/");
      else { const d = await res.json().catch(() => ({})); setError(d.error || "Invalid credentials"); }
    } catch { setError("Network error"); } finally { setLoading(false); }
  }

  // ── Handoff animation patterns ─────────────
  useEffect(() => {
    let ctx: any;
    async function init() {
      const { gsap } = await import("gsap");
      const { ScrollTrigger } = await import("gsap/ScrollTrigger");
      gsap.registerPlugin(ScrollTrigger);
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      ctx = gsap.context(() => {
        // Hero sequence (data-sr-hero)
        gsap.fromTo(".hero-word", { y: 80, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.9, stagger: 0.07, ease: "power3.out" });
        gsap.fromTo(".hero-desc", { y: 24, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.7, delay: 0.6, ease: "power2.out" });
        gsap.fromTo(".hero-cta", { y: 20, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.5, delay: 0.9, ease: "power2.out" });
        // Stats count-up
        gsap.fromTo(".hero-stat", { opacity: 0, y: 12 },
          { opacity: 1, y: 0, duration: 0.6, stagger: 0.12, delay: 0.7 });

        // Screenshot clip reveal (data-sr-reveal="clip")
        gsap.utils.toArray<HTMLElement>(".clip-reveal").forEach((el) => {
          const img = el.querySelector("img");
          if (!img) return;
          gsap.set(img, { clipPath: "inset(0 100% 0 0)" });
          gsap.to(img, { clipPath: "inset(0 0% 0 0)", duration: 1.3, ease: "power3.inOut",
            scrollTrigger: { trigger: el, start: "top 78%", once: true } });
        });

        // Feature cards reveal
        gsap.utils.toArray<HTMLElement>(".card-reveal").forEach((el, i) => {
          gsap.fromTo(el, { y: 48, opacity: 0 },
            { y: 0, opacity: 1, duration: 0.65, delay: i * 0.08, ease: "power2.out",
              scrollTrigger: { trigger: el, start: "top 88%" } });
        });

        // SVG draw (data-sr-draw)
        gsap.fromTo(".draw-svg line, .draw-svg path",
          { strokeDashoffset: 600, strokeDasharray: 600 },
          { strokeDashoffset: 0, duration: 1.8, delay: 0.3, ease: "power2.inOut" });

        // Parallax orbs
        gsap.to(".orb-1", { y: -60, scrollTrigger: { trigger: "body", start: "top top", end: "bottom bottom", scrub: 0.8 } });
        gsap.to(".orb-2", { y: 60, scrollTrigger: { trigger: "body", start: "top top", end: "bottom bottom", scrub: 1 } });
      });
    }
    init();
    return () => ctx?.revert();
  }, []);

  return (
    <div className="min-h-screen overflow-x-hidden" style={{ background: INK, color: PAPER, fontFamily: "'Schibsted Grotesk', system-ui, sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Schibsted+Grotesk:wght@500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap');
        .bg-dots { background-image: radial-gradient(circle, rgba(232,84,42,0.07) 1px, transparent 1px); background-size: 36px 36px; }
      `}</style>

      {/* Background orbs */}
      <div className="orb-1 fixed top-1/3 -right-60 w-[700px] h-[700px] rounded-full opacity-[0.10] pointer-events-none z-0" style={{ background: `radial-gradient(circle, ${CORAL}44 0%, transparent 70%)` }} />
      <div className="orb-2 fixed -bottom-40 -left-20 w-[500px] h-[500px] rounded-full opacity-[0.08] pointer-events-none z-0" style={{ background: `radial-gradient(circle, ${CORAL_B}33 0%, transparent 70%)` }} />

      {/* ═══ HERO — handoff pattern: data-sr-hero ═══ */}
      <section className="relative min-h-screen flex items-center justify-center overflow-hidden">
        <div className="absolute inset-0 bg-dots opacity-50 z-0" style={{ maskImage: "linear-gradient(180deg, #000 0%, transparent 85%)", WebkitMaskImage: "linear-gradient(180deg, #000 0%, transparent 85%)" }} />

        <div className="relative z-10 max-w-6xl mx-auto px-6 py-24 w-full">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div>
              <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full mb-10"
                style={{ background: `${CORAL}15`, border: `1px solid ${CORAL}30`, color: CORAL, fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>
                <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: CORAL }} /> Open source · Self-hosted
              </div>

              <h1 className="text-5xl md:text-6xl lg:text-7xl font-extrabold leading-none tracking-[-0.04em] mb-6" style={{ color: PAPER }}>
                <span className="hero-word inline-block">Your </span>
                <span className="hero-word inline-block">VPS </span>
                <span className="hero-word inline-block">has </span>
                <span className="hero-word inline-block">an </span>
                <span className="hero-word inline-block" style={{ color: CORAL }}>AI </span>
                <span className="hero-word inline-block">co-pilot</span>
              </h1>

              <p className="hero-desc text-lg leading-relaxed mb-8 max-w-xl" style={{ color: MUTED, fontWeight: 500 }}>
                GroundControl gives you an AI agent that manages your server — metrics, logs, DNS, deployments. No SSH needed.
              </p>

              <div className="hero-cta flex flex-col sm:flex-row gap-3">
                <button onClick={() => setShowLogin(true)}
                  className="px-8 py-3.5 rounded-xl text-sm font-bold transition-all duration-200"
                  style={{ background: CORAL, color: "#fff", fontFamily: "'JetBrains Mono', monospace" }}>
                  Open Dashboard →
                </button>
                <div className="flex items-center gap-2">
                  <code className="hidden lg:block px-4 py-3 rounded-xl text-xs truncate max-w-sm"
                    style={{ background: `${PAPER}05`, border: `1px solid ${FAINT}`, color: MUTED, fontFamily: "'JetBrains Mono', monospace" }}>
                    {installCmd}
                  </code>
                  <button onClick={copyCmd}
                    className="px-3 py-3 rounded-xl text-xs transition-all shrink-0"
                    style={{ background: `${PAPER}03`, border: `1px solid ${FAINT}`, color: copied ? CORAL : MUTED, fontFamily: "'JetBrains Mono', monospace" }}>
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
              </div>

              {/* Stats row */}
              <div className="hero-stat flex gap-12 mt-12">
                <div>
                  <div className="text-3xl font-extrabold tracking-[-0.03em]" style={{ color: PAPER }}>5</div>
                  <div className="text-xs font-semibold mt-0.5" style={{ color: MUTED }}>cloud platforms</div>
                </div>
                <div>
                  <div className="text-3xl font-extrabold tracking-[-0.03em]" style={{ color: PAPER }}>3</div>
                  <div className="text-xs font-semibold mt-0.5" style={{ color: MUTED }}>deploy templates</div>
                </div>
                <div>
                  <div className="text-3xl font-extrabold tracking-[-0.03em]" style={{ color: PAPER }}>22</div>
                  <div className="text-xs font-semibold mt-0.5" style={{ color: MUTED }}>AI agent tools</div>
                </div>
              </div>
            </div>

            {/* Screenshot — clip reveal */}
            <div className="clip-reveal hidden lg:block rounded-2xl overflow-hidden" style={{ boxShadow: "0 26px 60px rgba(0,0,0,0.4)" }}>
              <img src="/login-previews/dashboard.png" alt="GroundControl Dashboard" className="w-full" loading="lazy" />
            </div>
          </div>
        </div>
      </section>

      {/* ═══ HOW IT WORKS — handoff two-column pattern ═══ */}
      <section className="relative py-28" style={{ borderTop: `1px solid ${FAINT}` }}>
        <div className="max-w-6xl mx-auto px-6">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div className="clip-reveal order-2 lg:order-1 rounded-2xl overflow-hidden" style={{ boxShadow: "0 26px 60px rgba(0,0,0,0.4)" }}>
              <img src="/login-previews/containers.png" alt="Services" className="w-full" loading="lazy" />
            </div>
            <div className="order-1 lg:order-2">
              <div className="flex items-baseline gap-4 mb-4">
                <span style={{ fontSize: 20, fontWeight: 700, color: MUTED, fontFamily: "'Schibsted Grotesk', sans-serif" }}>01</span>
                <h2 className="text-4xl md:text-5xl font-extrabold tracking-[-0.035em]" style={{ color: PAPER }}>Connect your server.</h2>
              </div>
              <p style={{ color: CORAL, fontWeight: 600, fontSize: 19, marginBottom: 14, fontFamily: "'Schibsted Grotesk', sans-serif" }}>
                One command. Full visibility.
              </p>
              <p className="text-base leading-relaxed max-w-lg" style={{ color: MUTED }}>
                Run one curl command on your VPS. Docker and GroundControl install automatically.
                The AI agent scans your server — OS, containers, reverse proxy, projects — and maps
                your entire stack in seconds.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ FEATURES ═══ */}
      <section className="relative py-28" style={{ borderTop: `1px solid ${FAINT}` }}>
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-16">
            <p className="uppercase tracking-[0.2em] text-xs mb-4" style={{ color: CORAL, fontFamily: "'JetBrains Mono', monospace" }}>Features</p>
            <h2 className="text-4xl md:text-5xl font-extrabold tracking-[-0.035em]" style={{ color: PAPER }}>
              Everything you need to run production.
            </h2>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {[
              { icon: "◉", title: "AI Co-Pilot", desc: "Ask anything — check CPU, read logs, restart services. It knows your server's actual state." },
              { icon: "▦", title: "Deploy Templates", desc: "Caddy + App + DB, Traefik + microservices. GitHub, GHCR, or local code." },
              { icon: "◎", title: "Cloudflare DNS", desc: "Manage records, zones, tunnels. Auto-create A records when you deploy." },
              { icon: "◈", title: "Live Dashboard", desc: "Real-time metrics, container health, disk usage. Alerts when something breaks." },
              { icon: "⌘", title: "Web Terminal", desc: "Full terminal access from your browser. The AI agent can run commands for you." },
              { icon: "◑", title: "Self-Hosted", desc: "Runs on your VPS. Your data stays yours. Open source. No credit card." },
            ].map((f, i) => (
              <div key={i} className="card-reveal rounded-2xl p-8 transition-colors duration-300"
                style={{ background: `${PAPER}03`, border: `1px solid ${FAINT}` }}>
                <div className="w-12 h-12 rounded-xl flex items-center justify-center text-xl mb-5"
                  style={{ background: `${CORAL}15`, color: CORAL }}>{f.icon}</div>
                <h3 className="font-bold text-base mb-2">{f.title}</h3>
                <p className="text-sm leading-relaxed" style={{ color: MUTED, fontWeight: 500 }}>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ SECOND SCREENSHOT ═══ */}
      <section className="relative py-28" style={{ borderTop: `1px solid ${FAINT}` }}>
        <div className="max-w-6xl mx-auto px-6">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div>
              <div className="flex items-baseline gap-4 mb-4">
                <span style={{ fontSize: 20, fontWeight: 700, color: MUTED, fontFamily: "'Schibsted Grotesk', sans-serif" }}>02</span>
                <h2 className="text-4xl md:text-5xl font-extrabold tracking-[-0.035em]" style={{ color: PAPER }}>Deploy with confidence.</h2>
              </div>
              <p style={{ color: CORAL, fontWeight: 600, fontSize: 19, marginBottom: 14, fontFamily: "'Schibsted Grotesk', sans-serif" }}>
                Pick a template. It ships.
              </p>
              <p className="text-base leading-relaxed max-w-lg" style={{ color: MUTED }}>
                Choose from pre-built production templates. Connect your GitHub repo, GHCR image,
                or local code. Configure environment variables, set up Cloudflare DNS, and deploy —
                all from one interface.
              </p>
            </div>
            <div className="clip-reveal rounded-2xl overflow-hidden" style={{ boxShadow: "0 26px 60px rgba(0,0,0,0.4)" }}>
              <img src="/login-previews/terminal.png" alt="Terminal" className="w-full" loading="lazy" />
            </div>
          </div>
        </div>
      </section>

      {/* ═══ AI AGENT SECTION (dark accent, like handoff "agents" section) ═══ */}
      <section className="relative py-28 overflow-hidden" style={{ background: WARM }}>
        <div className="absolute top-[-20%] left-1/2 -translate-x-1/2 w-[70%] aspect-[2/1] pointer-events-none"
          style={{ background: `radial-gradient(ellipse at 50% 50%, ${CORAL_B}22, transparent 65%)` }} />
        <div className="relative max-w-3xl mx-auto px-6 text-center">
          <p className="uppercase tracking-[0.2em] text-xs mb-5" style={{ color: CORAL_B, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700 }}>
            Built for agents
          </p>
          <h2 className="text-4xl md:text-6xl font-extrabold tracking-[-0.04em] leading-none mb-6" style={{ color: PAPER }}>
            The AI co-pilot that knows your server.
          </h2>
          <p className="text-lg leading-relaxed max-w-xl mx-auto" style={{ color: `${PAPER}99`, fontWeight: 500 }}>
            Ask it to check CPU usage, read error logs, restart a container, configure DNS, or deploy from a template.
            It understands your actual infrastructure — not a generic playbook.
          </p>
        </div>
      </section>

      {/* ═══ THIRD SCREENSHOT ═══ */}
      <section className="relative py-28" style={{ borderTop: `1px solid ${FAINT}` }}>
        <div className="max-w-6xl mx-auto px-6">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div className="clip-reveal order-2 lg:order-1 rounded-2xl overflow-hidden" style={{ boxShadow: "0 26px 60px rgba(0,0,0,0.4)" }}>
              <img src="/login-previews/infrastructure.png" alt="Infrastructure" className="w-full" loading="lazy" />
            </div>
            <div className="order-1 lg:order-2">
              <div className="flex items-baseline gap-4 mb-4">
                <span style={{ fontSize: 20, fontWeight: 700, color: MUTED, fontFamily: "'Schibsted Grotesk', sans-serif" }}>03</span>
                <h2 className="text-4xl md:text-5xl font-extrabold tracking-[-0.035em]" style={{ color: PAPER }}>Eyes on production.</h2>
              </div>
              <p style={{ color: CORAL, fontWeight: 600, fontSize: 19, marginBottom: 14, fontFamily: "'Schibsted Grotesk', sans-serif" }}>
                Always watching. Never sleeping.
              </p>
              <p className="text-base leading-relaxed max-w-lg" style={{ color: MUTED }}>
                Live metrics, container health, reverse proxy status, and DNS records in one place.
                The AI agent monitors your stack and alerts you when something needs attention.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ CTA ═══ */}
      <section className="relative py-28" style={{ borderTop: `1px solid ${FAINT}` }}>
        <div className="max-w-2xl mx-auto px-6 text-center">
          <div className="rounded-3xl p-12"
            style={{ background: `${PAPER}03`, border: `1px solid ${FAINT}`, boxShadow: `0 0 120px ${CORAL}15` }}>
            <h2 className="text-3xl md:text-4xl font-extrabold tracking-[-0.03em] mb-4" style={{ color: PAPER }}>
              Ready to give your VPS an AI co-pilot?
            </h2>
            <p className="mb-8" style={{ color: MUTED, fontWeight: 500 }}>Free. Open source. Self-hosted.</p>
            <div className="flex items-center gap-2 justify-center mb-6">
              <code className="px-5 py-3 rounded-xl text-xs max-w-lg truncate"
                style={{ background: "#00000055", border: `1px solid ${FAINT}`, color: MUTED, fontFamily: "'JetBrains Mono', monospace" }}>{installCmd}</code>
              <button onClick={copyCmd} className="px-4 py-3 rounded-xl text-xs transition-all shrink-0"
                style={{ background: `${PAPER}03`, border: `1px solid ${FAINT}`, color: copied ? CORAL : MUTED, fontFamily: "'JetBrains Mono', monospace" }}>
                {copied ? "✓" : "Copy"}
              </button>
            </div>
            <div className="flex gap-4 justify-center">
              <button onClick={() => setShowLogin(true)}
                className="px-6 py-3 rounded-xl text-sm font-bold transition-all shadow-lg"
                style={{ background: CORAL, color: "#fff", fontFamily: "'JetBrains Mono', monospace", boxShadow: `0 12px 32px ${CORAL}33` }}>
                Open Dashboard
              </button>
              <a href="https://github.com/teckedd-code2save/groundcontrol" target="_blank" rel="noopener"
                className="px-6 py-3 rounded-xl text-sm font-bold transition-all"
                style={{ border: `1px solid ${FAINT}`, color: MUTED, fontFamily: "'JetBrains Mono', monospace" }}>
                GitHub →
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ FOOTER ═══ */}
      <footer className="py-10" style={{ borderTop: `1px solid ${FAINT}` }}>
        <div className="max-w-6xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <span className="text-sm font-semibold" style={{ color: `${PAPER}55` }}>GroundControl</span>
          <div className="flex items-center gap-5">
            <a href="https://github.com/teckedd-code2save/groundcontrol" target="_blank" rel="noopener"
              className="text-xs transition-colors" style={{ color: `${PAPER}22`, fontFamily: "'JetBrains Mono', monospace" }}>GitHub</a>
            <a href="https://github.com/teckedd-code2save/convoy" target="_blank" rel="noopener"
              className="text-xs transition-colors" style={{ color: `${PAPER}22`, fontFamily: "'JetBrains Mono', monospace" }}>Convoy</a>
            <a href="https://www.serendepify.com" target="_blank" rel="noopener"
              className="text-xs transition-colors" style={{ color: `${PAPER}22`, fontFamily: "'JetBrains Mono', monospace" }}>Serendepify</a>
          </div>
          <span className="text-xs" style={{ color: `${PAPER}12`, fontFamily: "'JetBrains Mono', monospace" }}>Open source · Self-hosted</span>
        </div>
      </footer>

      {/* ═══ LOGIN MODAL ═══ */}
      {showLogin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setShowLogin(false)} />
          <div className="relative rounded-2xl p-8 w-full max-w-sm"
            style={{ background: INK, border: `1px solid ${FAINT}`, boxShadow: `0 0 120px ${CORAL}12` }}>
            <div className="absolute -top-px left-8 right-8 h-px"
              style={{ background: `linear-gradient(90deg, transparent, ${CORAL}44, transparent)` }} />
            <h2 className="text-xl font-bold mb-1" style={{ color: PAPER }}>Sign in</h2>
            <p className="text-xs mb-6" style={{ color: MUTED }}>Access your dashboard</p>
            <form onSubmit={handleSubmit} className="space-y-4">
              <AuthInput label="Username" type="text" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="admin" autoFocus />
              <AuthInput label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
              <AuthError message={error} />
              <AuthButton loading={loading}>Sign In</AuthButton>
            </form>
            <button onClick={() => setShowLogin(false)} className="mt-4 w-full text-center text-xs transition-colors" style={{ color: `${PAPER}18`, fontFamily: "'JetBrains Mono', monospace" }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
