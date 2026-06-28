"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function HomePage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [copied, setCopied] = useState<"local" | "remote" | null>(null);
  const heroRef = useRef<HTMLDivElement>(null);
  const featuresRef = useRef<HTMLDivElement>(null);
  const compareRef = useRef<HTMLDivElement>(null);

  const localCmd = "curl -fsSL https://raw.githubusercontent.com/teckedd-code2save/groundcontrol/main/scripts/bootstrap | bash";
  const remoteCmd = "curl -fsSL https://raw.githubusercontent.com/teckedd-code2save/groundcontrol/main/scripts/bootstrap | bash -s root@your-vps";

  async function copyCmd(cmd: string, which: "local" | "remote") {
    await navigator.clipboard.writeText(cmd);
    setCopied(which);
    setTimeout(() => setCopied(null), 2000);
  }

  useEffect(() => {
    fetch("/api/auth/me")
      .then(async (res) => {
        if (!res.ok) { setChecking(false); return; }
        const configs = await fetch("/api/vps").then(r => r.ok ? r.json() : []);
        if (Array.isArray(configs) && configs.length === 0) router.push("/onboarding");
        else if (configs) router.push("/dashboard");
      }).catch(() => setChecking(false));
  }, [router]);

  // GSAP scroll animations
  useEffect(() => {
    if (checking) return;
    async function init() {
      const { gsap } = await import("gsap");
      const { ScrollTrigger } = await import("gsap/ScrollTrigger");
      gsap.registerPlugin(ScrollTrigger);

      // Hero parallax
      if (heroRef.current) {
        gsap.fromTo(heroRef.current.querySelectorAll(".hero-anim"), 
          { y: 60, opacity: 0 },
          { y: 0, opacity: 1, duration: 1, stagger: 0.15, ease: "power3.out" }
        );
      }

      // Features fade in on scroll
      if (featuresRef.current) {
        gsap.fromTo(featuresRef.current.querySelectorAll(".feature-card"),
          { y: 40, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.8, stagger: 0.1, ease: "power2.out",
            scrollTrigger: { trigger: featuresRef.current, start: "top 80%" } }
        );
      }

      // Compare section
      if (compareRef.current) {
        gsap.fromTo(compareRef.current.querySelectorAll(".compare-card"),
          { x: (i: number) => i === 0 ? -40 : 40, opacity: 0 },
          { x: 0, opacity: 1, duration: 0.8, stagger: 0.2, ease: "power2.out",
            scrollTrigger: { trigger: compareRef.current, start: "top 80%" } }
        );
      }
    }
    init();
  }, [checking]);

  if (checking) {
    return <div className="min-h-screen flex items-center justify-center bg-background"><div className="w-8 h-8 rounded-lg bg-accent animate-pulse" /></div>;
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Geometric animated background */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none -z-10">
        <div className="absolute inset-0 opacity-[0.02]" style={{
          backgroundImage: `linear-gradient(rgba(34,211,238,0.4) 1px, transparent 1px), linear-gradient(90deg, rgba(34,211,238,0.4) 1px, transparent 1px)`,
          backgroundSize: "80px 80px",
          animation: "gridMove 30s linear infinite",
        }} />
        <div className="absolute top-1/3 left-1/4 w-96 h-96 rounded-full bg-accent/4 blur-3xl animate-pulse" style={{animationDuration: "10s"}} />
        <div className="absolute bottom-1/4 right-1/4 w-[30rem] h-[30rem] rounded-full bg-accent/3 blur-3xl animate-pulse" style={{animationDuration: "14s", animationDelay: "3s"}} />
        <svg className="absolute inset-0 w-full h-full opacity-[0.04]">
          {["15%","10%","80%","20%","85%","60%","25%","75%","50%","45%","70%","30%"].reduce((acc: string[][], _, i, arr) => {
            if (i % 4 === 0) acc.push(arr.slice(i, i+4));
            return acc;
          }, []).map(([x1,y1,x2,y2], i) => (
            <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="currentColor" className="text-accent" strokeWidth="1"
              style={{ animation: `lineFade ${4+i}s ease-in-out infinite`, animationDelay: `${i*0.8}s` }} />
          ))}
        </svg>
        <style>{`
          @keyframes gridMove { 0% { transform: translate(0,0); } 100% { transform: translate(80px,80px); } }
          @keyframes lineFade { 0%,100% { opacity:0.08; } 50% { opacity:0.4; } }
        `}</style>
      </div>

      {/* Hero */}
      <header ref={heroRef} className="relative overflow-hidden border-b border-border">
        <div className="absolute inset-0 bg-gradient-to-br from-accent/5 via-transparent to-transparent" />
        <div className="max-w-5xl mx-auto px-6 py-28 md:py-36 relative">
          <div className="max-w-2xl">
            <div className="hero-anim inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent/10 border border-accent/20 text-accent text-xs font-mono mb-6">
              <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" /> Open source · Self-hosted
            </div>
            <h1 className="hero-anim text-4xl md:text-5xl font-bold tracking-tight leading-tight mb-4">
              Your VPS has an <span className="text-accent">AI co-pilot</span>
            </h1>
            <p className="hero-anim text-lg text-muted leading-relaxed mb-8 max-w-lg">
              GroundControl gives you an AI agent that manages your server — check metrics, read logs, restart services, configure DNS, deploy apps from templates. All from your browser.
            </p>
            <div className="hero-anim flex flex-col gap-4">
              <Link href="/login" className="px-6 py-3 bg-accent text-white rounded-xl hover:bg-accent/90 transition-colors text-sm font-mono font-medium inline-block w-fit">
                Get Started →
              </Link>
              <div className="space-y-2 max-w-2xl">
                <div className="flex items-center gap-2 group">
                  <span className="text-[10px] text-muted font-mono w-14 shrink-0">Local:</span>
                  <code className="flex-1 px-3 py-2 bg-card/80 border border-border rounded-lg text-[11px] font-mono text-foreground/60 truncate">{localCmd}</code>
                  <button onClick={() => copyCmd(localCmd, "local")}
                    className="px-2 py-2 text-[10px] font-mono text-muted hover:text-accent border border-border rounded-lg hover:border-accent transition-colors shrink-0">
                    {copied === "local" ? "✓" : "Copy"}
                  </button>
                </div>
                <div className="flex items-center gap-2 group">
                  <span className="text-[10px] text-muted font-mono w-14 shrink-0">Remote:</span>
                  <code className="flex-1 px-3 py-2 bg-card/80 border border-border rounded-lg text-[11px] font-mono text-foreground/60 truncate">{remoteCmd}</code>
                  <button onClick={() => copyCmd(remoteCmd, "remote")}
                    className="px-2 py-2 text-[10px] font-mono text-muted hover:text-accent border border-border rounded-lg hover:border-accent transition-colors shrink-0">
                    {copied === "remote" ? "✓" : "Copy"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Features */}
      <section ref={featuresRef} className="max-w-5xl mx-auto px-6 py-24">
        <div className="text-center mb-16">
          <h2 className="text-2xl font-bold tracking-tight mb-3">Everything you need to run production</h2>
          <p className="text-muted text-sm max-w-md mx-auto">From a fresh VPS to a monitored, backed-up, reverse-proxied production stack.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {[
            { icon: "◉", title: "AI-Powered Management", desc: "Ask the AI co-pilot anything — check CPU, read logs, restart containers, configure DNS. It knows your server's actual state." },
            { icon: "▦", title: "Deployment Templates", desc: "Production stacks in one click. Caddy + App + DB, Traefik + microservices, static sites. GitHub, GHCR, or local code." },
            { icon: "◎", title: "Cloudflare DNS", desc: "Manage DNS records, zones, and tunnels directly from GroundControl. Create A records, CNAMEs, toggle proxy mode." },
            { icon: "◈", title: "Live Dashboard", desc: "Real-time metrics, container health, disk usage. Alerts when something breaks. All from your browser." },
            { icon: "⌘", title: "Web Terminal + AI Agent", desc: "Full terminal access + an AI agent that can manage services, read logs, and install software for you." },
            { icon: "◑", title: "Self-Hosted & Private", desc: "Runs on your VPS. Your data never leaves your server. Open source. No vendor lock-in. No credit card." },
          ].map((f, i) => (
            <div key={i} className="feature-card bg-card border border-border rounded-xl p-6 hover:border-accent/30 transition-all duration-300 hover:-translate-y-1">
              <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center text-accent text-lg mb-4">{f.icon}</div>
              <h3 className="font-medium text-sm mb-2">{f.title}</h3>
              <p className="text-xs text-muted leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="border-t border-border bg-card/20">
        <div className="max-w-5xl mx-auto px-6 py-24">
          <div className="text-center mb-14">
            <h2 className="text-2xl font-bold tracking-tight mb-3">How it works</h2>
            <p className="text-muted text-sm max-w-md mx-auto">Three steps from fresh VPS to production.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-3xl mx-auto">
            {[
              { step: "1", title: "Install", desc: "One curl command installs Docker and GroundControl on your VPS. Under 60 seconds." },
              { step: "2", title: "Connect", desc: "Open your browser. GroundControl scans your server, discovers your stack, asks a few questions." },
              { step: "3", title: "Deploy", desc: "Pick a template, connect your code, configure DNS. Production-ready in minutes." },
            ].map((s, i) => (
              <div key={i} className="text-center">
                <div className="w-12 h-12 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center text-accent text-lg font-bold mx-auto mb-4">{s.step}</div>
                <h3 className="font-medium text-sm mb-2">{s.title}</h3>
                <p className="text-xs text-muted leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Comparison */}
      <section ref={compareRef} className="max-w-5xl mx-auto px-6 py-24">
        <div className="text-center mb-10">
          <h2 className="text-2xl font-bold tracking-tight mb-3">Why not just SSH?</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-2xl mx-auto">
          <div className="compare-card bg-card border border-border rounded-xl p-6">
            <h3 className="text-xs font-mono text-muted mb-4">With SSH</h3>
            <ul className="space-y-3 text-sm text-muted">
              {["Remember IPs and keys for every server", "Manually run docker ps, df -h, journalctl", "Parse raw log output yourself", "No alerts, no dashboard, no history", "Configure DNS on a separate website"].map((l, i) => (
                <li key={i} className="flex gap-2"><span className="text-error/70 shrink-0">✗</span> {l}</li>
              ))}
            </ul>
          </div>
          <div className="compare-card bg-card border border-accent/30 rounded-xl p-6">
            <h3 className="text-xs font-mono text-accent mb-4">With GroundControl</h3>
            <ul className="space-y-3 text-sm">
              {["One dashboard for all servers", "AI agent checks everything in one ask", "Structured output — not terminal dumps", "Alerts, metrics, deployment history", "Manage DNS from the same dashboard"].map((l, i) => (
                <li key={i} className="flex gap-2"><span className="text-success shrink-0">✓</span> {l}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-border">
        <div className="max-w-5xl mx-auto px-6 py-24 text-center">
          <div className="bg-card border border-border rounded-2xl p-10 max-w-2xl mx-auto">
            <h2 className="text-xl font-bold tracking-tight mb-3">Ready to give your VPS an AI co-pilot?</h2>
            <p className="text-sm text-muted mb-6">Free. Open source. Self-hosted. No credit card.</p>
            <div className="space-y-2 mb-6 max-w-md mx-auto text-left">
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-muted font-mono w-14 shrink-0">Local:</span>
                <code className="flex-1 px-3 py-2 bg-background border border-border rounded-lg text-[11px] font-mono text-foreground/60 truncate">{localCmd}</code>
                <button onClick={() => copyCmd(localCmd, "local")}
                  className="px-2 py-2 text-[10px] font-mono text-muted hover:text-accent border border-border rounded-lg hover:border-accent transition-colors shrink-0">
                  {copied === "local" ? "✓" : "Copy"}
                </button>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-muted font-mono w-14 shrink-0">Remote:</span>
                <code className="flex-1 px-3 py-2 bg-background border border-border rounded-lg text-[11px] font-mono text-foreground/60 truncate">{remoteCmd}</code>
                <button onClick={() => copyCmd(remoteCmd, "remote")}
                  className="px-2 py-2 text-[10px] font-mono text-muted hover:text-accent border border-border rounded-lg hover:border-accent transition-colors shrink-0">
                  {copied === "remote" ? "✓" : "Copy"}
                </button>
              </div>
            </div>
            <div className="flex gap-4 justify-center">
              <Link href="/login" className="px-5 py-2.5 bg-accent text-white rounded-xl hover:bg-accent/90 transition-colors text-sm font-mono">Sign In</Link>
              <a href="https://github.com/teckedd-code2save/groundcontrol" target="_blank" rel="noopener"
                className="px-5 py-2.5 border border-border rounded-xl hover:border-accent hover:text-accent transition-colors text-sm font-mono">GitHub →</a>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-border py-8 text-center">
        <p className="text-xs text-muted font-mono">GroundControl · Open source · Self-hosted VPS management with AI</p>
      </footer>
    </div>
  );
}
