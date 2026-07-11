"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { AuthInput, AuthButton, AuthError } from "@/components/AuthCard";
import { AmbientShader } from "@/components/AmbientShader";
import { InstallSetupSection, scrollToInstall } from "@/components/InstallSetupSection";

const C = { bg: "#202427", dark: "#141618", darker: "#0D0E10", text: "#F5F6F7", mut: "rgba(245,246,247,0.45)", dim: "rgba(245,246,247,0.22)", lin: "rgba(245,246,247,0.08)", accent: "#E8542A" };
const PAGE2_X_LINES = [1.5, 17, 55, 84, 98.5];
const PAGE2_Y_LINES = [13, 33.5, 38, 78, 84.5, 100];
const PAGE2_DOTS = PAGE2_X_LINES.flatMap((x) => PAGE2_Y_LINES.map((y) => ({ x, y })));
const PAGE2_CELLS = {
  compactImage: { left: "17%", top: "38%", width: "38%", height: "46.5%" },
  rightImage: { left: "55%", top: "33.5%", width: "29%", height: "51%" },
  expandedImage: { left: "1.5%", top: "13%", width: "97%", height: "71.5%" },
};
const PAGE2_IMAGE_FRAME = {
  compact: { left: "17%", right: "55%", top: "38%", bottom: "84.5%" },
  right: { left: "55%", right: "84%", top: "33.5%", bottom: "84.5%" },
  expanded: { left: "1.5%", right: "98.5%", top: "13%", bottom: "84.5%" },
};

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (typeof window !== "undefined" && window.location.hash === "#install") {
      window.setTimeout(() => scrollToInstall(), 150);
    }
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setLoading(true); setError("");
    try {
      const res = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
      if (res.ok) router.push("/"); else { const d = await res.json().catch(() => ({})); setError(d.error || "Invalid credentials"); }
    } catch { setError("Network error"); } finally { setLoading(false); }
  }

  useEffect(() => {
    let ctx: { revert: () => void } | undefined;
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
        gsap.fromTo(".h-card h3", { y: 12, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, stagger: 0.1, delay: 0.25, ease: "power2.out", scrollTrigger: { trigger: ".feat-s", start: "top 80%" } });

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

  // ── Grid-to-fullscreen transition (cipherdigital page 2) ──
  useEffect(() => {
    let ctx: { revert: () => void } | undefined;
    async function init() {
      const { gsap } = await import("gsap");
      const { ScrollTrigger } = await import("gsap/ScrollTrigger");
      gsap.registerPlugin(ScrollTrigger);
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || window.matchMedia("(max-width: 767px)").matches) return;
      ctx = gsap.context(() => {
        const frameTo = (frame: typeof PAGE2_IMAGE_FRAME.compact) => ({
          xLeft: { left: frame.left },
          xRight: { left: frame.right },
          yTop: { top: frame.top },
          yBottom: { top: frame.bottom },
          dotTopLeft: { left: frame.left, top: frame.top },
          dotTopRight: { left: frame.right, top: frame.top },
          dotBottomLeft: { left: frame.left, top: frame.bottom },
          dotBottomRight: { left: frame.right, top: frame.bottom },
        });
        const compactFrame = frameTo(PAGE2_IMAGE_FRAME.compact);
        const rightFrame = frameTo(PAGE2_IMAGE_FRAME.right);
        const expandedFrame = frameTo(PAGE2_IMAGE_FRAME.expanded);

        gsap.set(".page2-copy-cell", { opacity: 0, y: 20 });
        gsap.set(".page2-image-shell", { ...PAGE2_CELLS.compactImage, borderColor: "rgba(245,246,247,0.16)" });
        gsap.set(".page2-image", { scale: 1.04 });
        gsap.set(".page2-full-copy, .page2-metric", { opacity: 0, y: 22 });
        gsap.set(".page2-image-vignette", { opacity: 0 });
        gsap.set(".page2-base-line", { opacity: 0.55 });
        gsap.set(".page2-frame-x-left", compactFrame.xLeft);
        gsap.set(".page2-frame-x-right", compactFrame.xRight);
        gsap.set(".page2-frame-y-top", compactFrame.yTop);
        gsap.set(".page2-frame-y-bottom", compactFrame.yBottom);
        gsap.set(".page2-frame-dot-tl", compactFrame.dotTopLeft);
        gsap.set(".page2-frame-dot-tr", compactFrame.dotTopRight);
        gsap.set(".page2-frame-dot-bl", compactFrame.dotBottomLeft);
        gsap.set(".page2-frame-dot-br", compactFrame.dotBottomRight);

        const tl = gsap.timeline({
          scrollTrigger: {
            trigger: ".page2-transition",
            start: "top top",
            end: "+=250%",
            pin: ".page2-pin",
            scrub: 1.5,
          }
        });

        tl.to(".page2-copy-cell", { opacity: 1, y: 0, duration: 0.35, ease: "power3.out" }, 0.22)
          .to(".page2-copy-line", { opacity: 1, y: 0, duration: 0.5, stagger: 0.12, ease: "power3.out" }, 0.24)
          .to(".page2-image-shell", {
            ...PAGE2_CELLS.rightImage,
            duration: 0.28,
            ease: "power3.inOut",
          }, 0.16)
          .to(".page2-frame-x-left", { ...rightFrame.xLeft, duration: 0.28, ease: "power3.inOut" }, 0.16)
          .to(".page2-frame-x-right", { ...rightFrame.xRight, duration: 0.28, ease: "power3.inOut" }, 0.16)
          .to(".page2-frame-y-top", { ...rightFrame.yTop, duration: 0.28, ease: "power3.inOut" }, 0.16)
          .to(".page2-frame-y-bottom", { ...rightFrame.yBottom, duration: 0.28, ease: "power3.inOut" }, 0.16)
          .to(".page2-frame-dot-tl", { ...rightFrame.dotTopLeft, duration: 0.28, ease: "power3.inOut" }, 0.16)
          .to(".page2-frame-dot-tr", { ...rightFrame.dotTopRight, duration: 0.28, ease: "power3.inOut" }, 0.16)
          .to(".page2-frame-dot-bl", { ...rightFrame.dotBottomLeft, duration: 0.28, ease: "power3.inOut" }, 0.16)
          .to(".page2-frame-dot-br", { ...rightFrame.dotBottomRight, duration: 0.28, ease: "power3.inOut" }, 0.16)
          .to(".page2-image", { scale: 1, duration: 0.28, ease: "power2.out" }, 0.16);

        tl.to(".page2-copy-cell", { opacity: 0, y: -16, duration: 0.16, ease: "power2.in" }, 0.48)
          .to(".page2-base-line", { opacity: 0.22, duration: 0.2 }, 0.48)
          .to(".page2-dot", { opacity: 0.16, scale: 0.78, duration: 0.18 }, 0.5)
          .to(".page2-image-shell", {
            ...PAGE2_CELLS.expandedImage,
            borderColor: "rgba(245,246,247,0.34)",
            duration: 0.34,
            ease: "power3.inOut",
          }, 0.52)
          .to(".page2-frame-x-left", { ...expandedFrame.xLeft, duration: 0.34, ease: "power3.inOut" }, 0.52)
          .to(".page2-frame-x-right", { ...expandedFrame.xRight, duration: 0.34, ease: "power3.inOut" }, 0.52)
          .to(".page2-frame-y-top", { ...expandedFrame.yTop, duration: 0.34, ease: "power3.inOut" }, 0.52)
          .to(".page2-frame-y-bottom", { ...expandedFrame.yBottom, duration: 0.34, ease: "power3.inOut" }, 0.52)
          .to(".page2-frame-dot-tl", { ...expandedFrame.dotTopLeft, duration: 0.34, ease: "power3.inOut" }, 0.52)
          .to(".page2-frame-dot-tr", { ...expandedFrame.dotTopRight, duration: 0.34, ease: "power3.inOut" }, 0.52)
          .to(".page2-frame-dot-bl", { ...expandedFrame.dotBottomLeft, duration: 0.34, ease: "power3.inOut" }, 0.52)
          .to(".page2-frame-dot-br", { ...expandedFrame.dotBottomRight, duration: 0.34, ease: "power3.inOut" }, 0.52)
          .to(".page2-image", {
            scale: 1.06,
            duration: 0.34,
            ease: "power2.out",
          }, 0.52);

        tl.to(".page2-image-vignette", { opacity: 0.55, duration: 0.16, ease: "power2.out" }, 0.64);
        tl.to(".page2-full-copy", { opacity: 1, y: 0, duration: 0.22, ease: "power2.out" }, 0.72)
          .to(".page2-metric", { opacity: 1, y: 0, duration: 0.22, stagger: 0.04, ease: "power2.out" }, 0.78);
      });
    }
    init();
    return () => ctx?.revert();
  }, []);

  return (
    <div style={{ background: C.bg, color: C.text, fontFamily: "articulat-cf, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", minHeight: "100vh", overflowX: "hidden" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500&display=swap');
        body{margin:0;}
        @media (max-width: 767px){
          .page2-transition{height:auto!important;}
          .page2-pin{position:relative!important;height:auto!important;min-height:720px;padding:72px 0 0;}
          .page2-copy-cell{left:7%!important;top:12%!important;width:86%!important;height:auto!important;padding:0!important;opacity:1!important;transform:none!important;}
          .page2-image-shell{left:7%!important;top:36%!important;width:86%!important;height:38%!important;}
          .page2-full-copy{left:7%!important;right:7%!important;top:78%!important;width:auto!important;transform:none!important;text-align:left!important;opacity:1!important;}
          .page2-metric-shell{left:7%!important;right:7%!important;grid-template-columns:1fr!important;bottom:auto!important;top:88%!important;border-top:0!important;}
        }
      `}</style>

      {/* HERO */}
      <section className="hero-s relative min-h-screen flex items-center overflow-hidden" style={{ background: C.dark }}>
        <AmbientShader className="bg-parallax" />
        <div className="absolute inset-0 opacity-25 z-[1]" style={{ backgroundImage: `linear-gradient(${C.lin} 1px, transparent 1px), linear-gradient(90deg, ${C.lin} 1px, transparent 1px)`, backgroundSize: "80px 80px" }} />
        <div className="relative z-10 w-full max-w-7xl mx-auto px-6 md:px-12 py-24">
          <div style={{ maxWidth: 700 }}>
            <pre className="fade-up mb-6 select-none font-mono text-[10px] leading-tight" style={{ color: "rgba(232,84,42,0.55)" }} aria-hidden>{`┌─ groundcontrol ─┐
│  host · stack · ai  │
└─────────────────────┘`}</pre>
            <div className="mb-10">
              <h1 style={{ fontSize: "clamp(36px, 6.5vw, 72px)", fontWeight: 300, lineHeight: 1.06, letterSpacing: "-0.02em", margin: 0 }}>
                <div className="line-mask" style={{ overflow: "hidden" }}><div className="line-inner">Your VPS has an</div></div>
                <div className="line-mask" style={{ overflow: "hidden" }}><div className="line-inner" style={{ color: "#E8542A" }}>AI co-pilot</div></div>
              </h1>
            </div>
            <p className="fade-up" style={{ fontSize: 18, color: C.mut, lineHeight: 1.7, marginBottom: 36, maxWidth: 480 }}>Metrics, logs, DNS, deployments, templates — managed by an AI agent that knows your server.</p>
            <div className="fade-up flex flex-wrap items-center gap-3">
              <button onClick={() => setShowLogin(true)} style={{ padding: "14px 32px", background: "transparent", color: C.text, border: `1px solid ${C.dim}`, fontFamily: "inherit", fontSize: 14, fontWeight: 400, cursor: "pointer" }}>Open Dashboard →</button>
              <button
                type="button"
                onClick={scrollToInstall}
                style={{ padding: "14px 32px", background: "transparent", color: C.accent, border: `1px solid ${C.accent}`, fontFamily: "inherit", fontSize: 14, fontWeight: 400, cursor: "pointer", whiteSpace: "nowrap" }}
              >
                Install on your VPS
              </button>
            </div>
            <p className="fade-up mt-3 text-[12px]" style={{ color: C.dim, maxWidth: 480, lineHeight: 1.55 }}>
              One-command setup with SSH key or interactive prompts — jump to install below.
            </p>
          </div>
        </div>
        <div className="fade-up absolute bottom-10 left-1/2 -translate-x-1/2" style={{ color: C.dim, fontSize: 11, letterSpacing: "0.15em", textTransform: "uppercase" }}>Scroll</div>
      </section>

      {/* SCREENSHOT 1 — Dashboard */}
      <section className="shot-reveal" style={{ padding: "120px 0 60px", background: C.darker }}>
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
      <section className="shot-reveal" style={{ padding: "60px 0", background: C.dark }}>
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
          <div className="text-center mb-14">
            <p className="uppercase tracking-[0.2em] text-xs mb-3" style={{ color: C.dim, fontFamily: "'JetBrains Mono', monospace" }}>Included</p>
            <h2 style={{ fontSize: "clamp(28px, 4vw, 42px)", fontWeight: 300, lineHeight: 1.15 }}>Everything your VPS needs.</h2>
          </div>
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

      {/* GRID-TO-BAND — cipherdigital page 2 transition */}
      <section className="page2-transition" style={{ position: "relative", background: C.dark }}>
        <div className="page2-pin" style={{ position: "sticky", top: 0, height: "100vh", overflow: "hidden", background: "#0f1112" }}>
          <div className="page2-grid" style={{ position: "absolute", inset: 0, background: "#0f1112" }} />
          {PAGE2_X_LINES.map((x) => (
            <span
              key={`x-${x}`}
              className="page2-base-line"
              style={{ position: "absolute", left: `${x}%`, top: 0, bottom: 0, width: 1, background: "rgba(245,246,247,0.1)", pointerEvents: "none" }}
            />
          ))}
          {PAGE2_Y_LINES.map((y) => (
            <span
              key={`y-${y}`}
              className="page2-base-line"
              style={{ position: "absolute", left: 0, right: 0, top: `${y}%`, height: 1, background: "rgba(245,246,247,0.1)", pointerEvents: "none" }}
            />
          ))}
          {PAGE2_DOTS.map((dot) => (
            <span
              key={`${dot.x}-${dot.y}`}
              className="page2-dot"
              style={{
                position: "absolute",
                left: `${dot.x}%`,
                top: `${dot.y}%`,
                width: 9,
                height: 9,
                background: "rgba(126,138,145,0.56)",
                transform: "translate(-50%, -50%)",
                pointerEvents: "none",
              }}
            />
          ))}
          <span className="page2-frame-x-left" style={{ position: "absolute", left: PAGE2_IMAGE_FRAME.compact.left, top: 0, bottom: 0, width: 1, zIndex: 5, background: "rgba(245,246,247,0.34)", pointerEvents: "none" }} />
          <span className="page2-frame-x-right" style={{ position: "absolute", left: PAGE2_IMAGE_FRAME.compact.right, top: 0, bottom: 0, width: 1, zIndex: 5, background: "rgba(245,246,247,0.34)", pointerEvents: "none" }} />
          <span className="page2-frame-y-top" style={{ position: "absolute", left: 0, right: 0, top: PAGE2_IMAGE_FRAME.compact.top, height: 1, zIndex: 5, background: "rgba(245,246,247,0.34)", pointerEvents: "none" }} />
          <span className="page2-frame-y-bottom" style={{ position: "absolute", left: 0, right: 0, top: PAGE2_IMAGE_FRAME.compact.bottom, height: 1, zIndex: 5, background: "rgba(245,246,247,0.34)", pointerEvents: "none" }} />
          {[
            ["tl", PAGE2_IMAGE_FRAME.compact.left, PAGE2_IMAGE_FRAME.compact.top],
            ["tr", PAGE2_IMAGE_FRAME.compact.right, PAGE2_IMAGE_FRAME.compact.top],
            ["bl", PAGE2_IMAGE_FRAME.compact.left, PAGE2_IMAGE_FRAME.compact.bottom],
            ["br", PAGE2_IMAGE_FRAME.compact.right, PAGE2_IMAGE_FRAME.compact.bottom],
          ].map(([corner, left, top]) => (
            <span
              key={corner}
              className={`page2-frame-dot page2-frame-dot-${corner}`}
              style={{
                position: "absolute",
                left,
                top,
                width: 10,
                height: 10,
                zIndex: 6,
                background: "rgba(164,173,178,0.95)",
                transform: "translate(-50%, -50%)",
                pointerEvents: "none",
              }}
            />
          ))}

          <div
            className="page2-copy-cell"
            style={{
              position: "absolute",
              left: "1.5%",
              top: "38%",
              width: "53.5%",
              height: "46.5%",
              zIndex: 3,
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              padding: "0 7.5vw 0 8vw",
            }}
          >
            <p style={{ color: C.dim, fontSize: 11, letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 14 }}>
              Command Center
            </p>
            <h2 style={{ fontSize: "clamp(28px, 4.6vw, 58px)", fontWeight: 300, lineHeight: 1.03, margin: 0 }}>
              <span className="page2-copy-line" style={{ display: "block", opacity: 0, transform: "translateY(12px)" }}>Every command.</span>
              <span className="page2-copy-line" style={{ display: "block", opacity: 0, transform: "translateY(12px)" }}>Every log.</span>
              <span className="page2-copy-line" style={{ display: "block", opacity: 0, transform: "translateY(12px)" }}>One interface.</span>
            </h2>
          </div>

          <div
            className="page2-image-shell"
            style={{
              position: "absolute",
              ...PAGE2_CELLS.compactImage,
              zIndex: 2,
              overflow: "hidden",
              border: `1px solid ${C.lin}`,
              background: C.dark,
              boxShadow: "0 36px 90px rgba(0,0,0,0.38)",
            }}
          >
            <img
              src="/login-previews/terminal.png"
              alt="GroundControl terminal"
              className="page2-image"
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", transformOrigin: "center center" }}
              loading="lazy"
            />
            <div
              className="page2-image-vignette"
              style={{
                position: "absolute",
                inset: 0,
                background: "linear-gradient(180deg, rgba(15,17,18,0.58) 0%, rgba(15,17,18,0.26) 42%, rgba(15,17,18,0.72) 100%)",
                pointerEvents: "none",
              }}
            />
          </div>

          <div
            className="page2-full-copy"
            style={{
              position: "absolute",
              zIndex: 4,
              left: "17%",
              top: "33.5%",
              width: "67%",
              height: "51%",
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              padding: "0 min(8vw, 92px)",
              textAlign: "center",
              pointerEvents: "none",
            }}
          />

          <div
            className="page2-metric-shell"
            style={{
              position: "absolute",
              zIndex: 4,
              left: "1.5%",
              right: "1.5%",
              bottom: 0,
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
              borderTop: `1px solid rgba(245,246,247,0.24)`,
              pointerEvents: "none",
            }}
          >
            {[
              ["Live", "logs"],
              ["AI", "commands"],
              ["One", "pane"],
            ].map(([value, label], index) => (
              <div
                key={label}
                className="page2-metric"
                style={{
                  minHeight: 118,
                  padding: "clamp(18px, 3vw, 36px)",
                  borderRight: index === 2 ? "none" : `1px solid rgba(245,246,247,0.16)`,
                }}
              >
                <strong style={{ display: "block", fontSize: "clamp(34px, 6vw, 82px)", fontWeight: 300, lineHeight: 0.9 }}>{value}</strong>
                <span style={{ display: "block", marginTop: 10, color: C.mut, fontSize: 12, letterSpacing: "0.1em", textTransform: "uppercase" }}>{label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <InstallSetupSection colors={C} />

      {/* CTA */}
      <section style={{ padding: "120px 0", background: C.dark }}>
        <div className="max-w-2xl mx-auto px-6 text-center">
          <h2 style={{ fontSize: "clamp(28px, 4vw, 42px)", fontWeight: 300, lineHeight: 1.15, marginBottom: 24 }}>Ready to give your VPS an AI co-pilot?</h2>
          <p style={{ color: C.mut, fontSize: 16, marginBottom: 40 }}>Free. Open source. Self-hosted.</p>
          <div className="flex gap-3 justify-center flex-wrap">
            <button
              type="button"
              onClick={scrollToInstall}
              style={{ padding: "16px 36px", background: "transparent", color: C.accent, border: `1px solid ${C.accent}`, fontFamily: "inherit", fontSize: 14, fontWeight: 400, cursor: "pointer" }}
            >
              Install on your VPS
            </button>
            <button onClick={() => setShowLogin(true)} style={{ padding: "16px 36px", background: "transparent", color: C.text, border: `1px solid ${C.dim}`, fontFamily: "inherit", fontSize: 14, fontWeight: 400, cursor: "pointer" }}>Open Dashboard</button>
            <a href="https://github.com/teckedd-code2save/groundcontrol" target="_blank" rel="noopener" style={{ padding: "16px 36px", background: "transparent", color: C.mut, border: `1px solid ${C.lin}`, fontFamily: "inherit", fontSize: 14, fontWeight: 400, cursor: "pointer", textDecoration: "none" }}>GitHub</a>
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
