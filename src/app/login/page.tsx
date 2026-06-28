"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import BrandLogo from "@/components/BrandLogo";
import { AuthInput, AuthButton, AuthError } from "@/components/AuthCard";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (res.ok) router.push("/");
      else { const d = await res.json().catch(() => ({})); setError(d.error || "Invalid credentials"); }
    } catch { setError("Network error"); }
    finally { setLoading(false); }
  }

  return (
    <div className="min-h-screen bg-background relative overflow-hidden flex">
      {/* Animated geometric grid background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: `linear-gradient(rgba(34,211,238,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(34,211,238,0.3) 1px, transparent 1px)`,
            backgroundSize: "60px 60px",
            animation: "gridMove 20s linear infinite",
          }} />
        <style>{`
          @keyframes gridMove { 0% { transform: translate(0,0); } 100% { transform: translate(60px,60px); } }
        `}</style>
        {/* Floating geometric shapes */}
        <div className="absolute top-1/4 left-1/4 w-64 h-64 rounded-full bg-accent/5 blur-3xl animate-pulse" style={{animationDuration: "8s"}} />
        <div className="absolute bottom-1/3 right-1/4 w-96 h-96 rounded-full bg-accent/3 blur-3xl animate-pulse" style={{animationDuration: "12s", animationDelay: "2s"}} />
        <div className="absolute top-1/2 left-1/2 w-48 h-48 rounded-full bg-accent/5 blur-2xl animate-pulse" style={{animationDuration: "6s", animationDelay: "4s"}} />
        {/* Animated nodes */}
        {[
          { x: "15%", y: "20%", d: "3s" },
          { x: "75%", y: "15%", d: "4s" },
          { x: "85%", y: "70%", d: "5s" },
          { x: "20%", y: "80%", d: "3.5s" },
          { x: "50%", y: "50%", d: "2.5s" },
          { x: "60%", y: "85%", d: "4.5s" },
        ].map((n, i) => (
          <div key={i} className="absolute w-1.5 h-1.5 rounded-full bg-accent/30"
            style={{
              left: n.x, top: n.y,
              animation: `nodePulse ${n.d} ease-in-out infinite`,
              animationDelay: `${i * 0.5}s`,
            }} />
        ))}
        <style>{`
          @keyframes nodePulse { 0%,100% { opacity:0.2; transform:scale(1); } 50% { opacity:0.8; transform:scale(2.5); } }
        `}</style>
        {/* Connecting lines between nodes */}
        <svg className="absolute inset-0 w-full h-full opacity-[0.06]">
          {[
            ["15%","20%","75%","15%"],
            ["75%","15%","85%","70%"],
            ["85%","70%","20%","80%"],
            ["20%","80%","15%","20%"],
            ["50%","50%","60%","85%"],
            ["60%","85%","75%","15%"],
          ].map(([x1,y1,x2,y2], i) => (
            <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="currentColor" className="text-accent" strokeWidth="1"
              style={{ animation: `lineFade ${3 + i * 0.5}s ease-in-out infinite`, animationDelay: `${i * 0.7}s` }} />
          ))}
        </svg>
        <style>{`
          @keyframes lineFade { 0%,100% { opacity:0.1; } 50% { opacity:0.5; } }
        `}</style>
      </div>

      {/* Left: Value proposition */}
      <div className="hidden lg:flex lg:w-1/2 relative items-center justify-center p-16">
        <div className="max-w-md">
          <div className="mb-8">
            <BrandLogo size={48} stroke="#1b1916" />
          </div>
          <h1 className="text-4xl font-bold tracking-tight leading-tight mb-4">
            Your VPS has an{" "}
            <span className="text-accent">AI co-pilot</span>
          </h1>
          <p className="text-lg text-muted leading-relaxed mb-10">
            Check metrics, read logs, restart services, configure DNS, deploy from templates — all from your browser. No SSH needed.
          </p>

          <div className="space-y-4">
            {[
              { icon: "◉", title: "AI Management", desc: "Ask the agent anything about your server" },
              { icon: "▦", title: "Deployment Templates", desc: "Production stacks in one click" },
              { icon: "◎", title: "Cloudflare DNS", desc: "Manage records from the same dashboard" },
              { icon: "◑", title: "Self-Hosted & Private", desc: "Your data never leaves your server" },
            ].map((f, i) => (
              <div key={i} className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center text-accent text-sm shrink-0 mt-0.5">{f.icon}</div>
                <div>
                  <h3 className="text-sm font-medium">{f.title}</h3>
                  <p className="text-xs text-muted">{f.desc}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-10 p-4 bg-card/50 border border-border rounded-xl">
            <p className="text-[10px] font-mono text-muted mb-2 uppercase tracking-wider">One command to install</p>
            <code className="block text-[11px] font-mono text-foreground/60 leading-relaxed">
              curl -fsSL https://raw.githubusercontent.com/teckedd-code2save/groundcontrol/main/scripts/bootstrap | bash
            </code>
          </div>
        </div>
      </div>

      {/* Right: Auth card */}
      <div className="flex-1 flex items-center justify-center p-6 md:p-12 relative">
        <div className="w-full max-w-sm">
          {/* Mobile brand + tagline (hidden on desktop) */}
          <div className="lg:hidden text-center mb-8">
            <BrandLogo size={40} stroke="#1b1916" />
            <h1 className="text-xl font-bold mt-4">GroundControl</h1>
            <p className="text-sm text-muted mt-1">Self-hosted VPS cockpit</p>
          </div>

          <div className="bg-card border border-border rounded-2xl p-8 shadow-2xl shadow-black/20 relative">
            <div className="absolute -top-px left-8 right-8 h-px bg-gradient-to-r from-transparent via-accent/40 to-transparent" />

            <h2 className="text-lg font-bold mb-1">Sign in</h2>
            <p className="text-xs text-muted mb-6">Access your GroundControl dashboard</p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <AuthInput
                label="Username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="admin"
                autoFocus
              />
              <AuthInput
                label="Password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
              <AuthError message={error} />
              <AuthButton loading={loading}>Sign In</AuthButton>
            </form>

            <p className="text-[10px] text-muted text-center mt-6 font-mono">
              New to GroundControl?{" "}
              <Link href="/" className="text-accent hover:underline">Learn more →</Link>
            </p>
          </div>

          {/* Bottom install hint for mobile */}
          <div className="lg:hidden mt-6 p-4 bg-card/50 border border-border rounded-xl text-center">
            <code className="text-[10px] font-mono text-foreground/50 break-all">
              curl -fsSL https://raw.githubusercontent.com/teckedd-code2save/groundcontrol/main/scripts/bootstrap | bash
            </code>
          </div>
        </div>
      </div>
    </div>
  );
}
