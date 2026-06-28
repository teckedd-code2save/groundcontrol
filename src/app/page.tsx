"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function HomePage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    fetch("/api/auth/me")
      .then(async (res) => {
        if (!res.ok) { setChecking(false); return; }
        const configs = await fetch("/api/vps").then(r => r.ok ? r.json() : []);
        if (Array.isArray(configs) && configs.length === 0) router.push("/onboarding");
        else if (configs) router.push("/dashboard");
      })
      .catch(() => setChecking(false));
  }, [router]);

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 rounded-lg bg-accent animate-pulse" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Hero */}
      <header className="relative overflow-hidden border-b border-border">
        <div className="absolute inset-0 bg-gradient-to-br from-accent/5 via-transparent to-transparent" />
        <div className="max-w-5xl mx-auto px-6 py-24 md:py-32 relative">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent/10 border border-accent/20 text-accent text-xs font-mono mb-6">
              <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
              Open source · Self-hosted
            </div>
            <h1 className="text-4xl md:text-5xl font-bold tracking-tight leading-tight mb-4">
              Your VPS has an{" "}
              <span className="text-accent">AI co-pilot</span>
            </h1>
            <p className="text-lg text-muted leading-relaxed mb-8 max-w-lg">
              GroundControl gives you an AI agent that manages your server — check metrics, read logs, restart services, configure DNS, deploy apps from templates. All from your browser. No SSH needed.
            </p>
            <div className="flex flex-col gap-3">
              <Link href="/login"
                className="px-6 py-3 bg-accent text-white rounded-xl hover:bg-accent/90 transition-colors text-sm font-mono font-medium inline-block w-fit">
                Get Started →
              </Link>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-muted font-mono w-16 shrink-0">Local:</span>
                  <code className="px-3 py-2 bg-card border border-border rounded-lg text-[11px] font-mono text-foreground/70">
                    curl -fsSL https://raw.githubusercontent.com/teckedd-code2save/groundcontrol/main/scripts/bootstrap | bash
                  </code>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-muted font-mono w-16 shrink-0">Remote:</span>
                  <code className="px-3 py-2 bg-card border border-border rounded-lg text-[11px] font-mono text-foreground/70">
                    curl -fsSL https://.../bootstrap | bash -s root@your-vps
                  </code>
                </div>
              </div>
            </div>
            <p className="text-[10px] text-muted mt-3 font-mono">
              One command. Installs Docker + GroundControl in under 60 seconds. Pipe to bash on your VPS, or run locally.
            </p>
          </div>
        </div>
      </header>

      {/* Features grid */}
      <section className="max-w-5xl mx-auto px-6 py-20">
        <div className="text-center mb-14">
          <h2 className="text-2xl font-bold tracking-tight mb-3">Everything you need to run production</h2>
          <p className="text-muted text-sm max-w-md mx-auto">
            From a fresh VPS to a monitored, backed-up, reverse-proxied production stack — with an AI agent that knows your server.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {[
            { icon: "◉", title: "AI-Powered Management", desc: "Ask the AI co-pilot anything — check CPU, read logs, restart containers, configure DNS. It knows your server's actual state." },
            { icon: "▦", title: "Deployment Templates", desc: "Production stacks in one click. Caddy + App + DB, Traefik + microservices, static sites. Healthchecks, backups, security headers included." },
            { icon: "◈", title: "Live Dashboard", desc: "Real-time metrics, container health, disk usage, topology view. Alerts when something breaks. All from your browser." },
            { icon: "⌘", title: "Web Terminal", desc: "Full terminal access from the browser. No SSH keys to manage. The AI agent can run commands for you." },
            { icon: "◎", title: "Cloudflare DNS", desc: "Manage DNS records, zones, and tunnels directly from GroundControl. Create A records, CNAMEs, toggle proxy mode." },
            { icon: "◑", title: "Self-Hosted & Private", desc: "Runs on your VPS. Your data never leaves your server. Open source. No vendor lock-in." },
          ].map((f, i) => (
            <div key={i} className="bg-card border border-border rounded-xl p-6 hover:border-accent/30 transition-colors">
              <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center text-accent text-lg mb-4">{f.icon}</div>
              <h3 className="font-medium text-sm mb-2">{f.title}</h3>
              <p className="text-xs text-muted leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Comparison */}
      <section className="border-t border-border bg-card/30">
        <div className="max-w-5xl mx-auto px-6 py-20">
          <div className="text-center mb-10">
            <h2 className="text-2xl font-bold tracking-tight mb-3">Why not just SSH?</h2>
            <p className="text-muted text-sm max-w-md mx-auto">GroundControl replaces the terminal for routine ops — but keeps the terminal when you need it.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-2xl mx-auto">
            <div className="bg-card border border-border rounded-xl p-6">
              <h3 className="text-xs font-mono uppercase tracking-wider text-muted mb-4">With SSH</h3>
              <ul className="space-y-3 text-sm text-muted">
                <li className="flex gap-2"><span className="text-error shrink-0">✗</span> Remember IPs, keys, ports for every server</li>
                <li className="flex gap-2"><span className="text-error shrink-0">✗</span> Manually run docker ps, df -h, journalctl</li>
                <li className="flex gap-2"><span className="text-error shrink-0">✗</span> Parse log output yourself</li>
                <li className="flex gap-2"><span className="text-error shrink-0">✗</span> No alerts, no dashboard, no history</li>
                <li className="flex gap-2"><span className="text-error shrink-0">✗</span> Configure DNS on Cloudflare's website</li>
              </ul>
            </div>
            <div className="bg-card border border-accent/30 rounded-xl p-6">
              <h3 className="text-xs font-mono uppercase tracking-wider text-accent mb-4">With GroundControl</h3>
              <ul className="space-y-3 text-sm">
                <li className="flex gap-2"><span className="text-success shrink-0">✓</span> One dashboard for all your servers</li>
                <li className="flex gap-2"><span className="text-success shrink-0">✓</span> AI agent checks everything in one ask</li>
                <li className="flex gap-2"><span className="text-success shrink-0">✓</span> Structured output — not raw terminal dumps</li>
                <li className="flex gap-2"><span className="text-success shrink-0">✓</span> Alerts, metrics, deployment history</li>
                <li className="flex gap-2"><span className="text-success shrink-0">✓</span> Manage DNS from the same dashboard</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-5xl mx-auto px-6 py-20 text-center">
        <div className="bg-card border border-border rounded-2xl p-10 max-w-2xl mx-auto">
          <h2 className="text-xl font-bold tracking-tight mb-3">One command to get started</h2>
          <p className="text-sm text-muted mb-6">Free. Open source. Self-hosted. No credit card.</p>
          <code className="block bg-background border border-border rounded-xl px-5 py-4 text-sm font-mono text-foreground/80 mb-2 max-w-md mx-auto text-left">
            <div><span className="text-muted"># Local install</span></div>
            <div>curl -fsSL https://raw.githubusercontent.com/teckedd-code2save/groundcontrol/main/scripts/bootstrap | bash</div>
            <div className="mt-2"><span className="text-muted"># Remote VPS</span></div>
            <div>curl -fsSL https://raw.githubusercontent.com/teckedd-code2save/groundcontrol/main/scripts/bootstrap | bash -s root@your-vps</div>
          </code>
          <div className="flex gap-4 justify-center">
            <Link href="/login" className="px-5 py-2.5 bg-accent text-white rounded-xl hover:bg-accent/90 transition-colors text-sm font-mono">
              Sign In
            </Link>
            <a href="https://github.com/teckedd-code2save/groundcontrol" target="_blank" rel="noopener"
              className="px-5 py-2.5 border border-border rounded-xl hover:border-accent hover:text-accent transition-colors text-sm font-mono">
              GitHub →
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-8 text-center">
        <p className="text-xs text-muted font-mono">
          GroundControl · Open source · Self-hosted VPS management with AI
        </p>
      </footer>
    </div>
  );
}
