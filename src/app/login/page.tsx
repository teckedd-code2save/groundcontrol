"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import BrandLogo from "@/components/BrandLogo";
import { AuthInput, AuthButton, AuthError } from "@/components/AuthCard";

const PREVIEW_STAGES = [
  {
    label: "Dashboard",
    title: "Read the host",
    sub: "Metrics, health score, alerts, and capacity in one loaded cockpit.",
    image: "/login-previews/dashboard.png",
  },
  {
    label: "Services",
    title: "Run the stack",
    sub: "Containers, reverse proxy, projects, and deployments in one place.",
    image: "/login-previews/containers.png",
  },
  {
    label: "Settings",
    title: "Provision with code",
    sub: "Terraform stacks, deploy targets, and cloud accounts wired in.",
    image: "/login-previews/infrastructure.png",
  },
  {
    label: "Terminal",
    title: "Operate anywhere",
    sub: "A host-aware shell with the commands your VPS actually supports.",
    image: "/login-previews/terminal.png",
  },
];

const PREVIEW_INTERVAL = 5000;

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  useEffect(() => {
    fetch("/api/auth/setup")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.setupRequired) {
          router.push("/setup");
          return;
        }
        fetch("/api/auth/me")
          .then((res) => {
            if (res.ok) router.push("/dashboard");
          })
          .catch(() => {});
      })
      .catch(() => {});
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (res.ok) {
        if (data.forcePasswordChange) {
          router.push("/force-password-change");
        } else {
          router.push("/dashboard");
        }
      } else {
        setError(data.error || "Login failed");
      }
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="gc-home sr-theme">
      <div className="gc-home__ambient" />
      <section className="gc-home__grid">
        <GroundControlFlipPreview />

        <aside className="gc-home__auth" aria-label="Sign in to GroundControl">
          <p className="gc-home__auth-kicker">Secure your fleet from a single pane of glass.</p>

          {/* One-command install */}
          <div className="bg-card/80 border border-border rounded-xl p-4 mb-4 max-w-sm">
            <p className="text-[10px] font-mono text-muted mb-2 uppercase tracking-wider">One command to install</p>
            <code className="block text-xs font-mono bg-background border border-border rounded-lg px-3 py-2.5 text-foreground/80">
              npx groundcontrol bootstrap root@your-vps
            </code>
            <p className="text-[10px] text-muted mt-2">
              Installs Docker, deploys GroundControl. Your VPS has an AI co-pilot in 60 seconds.
            </p>
          </div>

          <div className="gc-home__auth-card">
            <div className="gc-home__auth-brand">
              <BrandLogo size={58} stroke="#1b1916" />
              <h1 className="sr-display">GroundControl</h1>
              <p>Self-hosted VPS cockpit</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
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
          </div>
        </aside>
      </section>
    </main>
  );
}

function GroundControlFlipPreview() {
  const sectionRef = useRef<HTMLElement>(null);
  const stackRef = useRef<HTMLDivElement>(null);
  const copyRef = useRef<HTMLDivElement>(null);
  const kickerRef = useRef<HTMLParagraphElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const subRef = useRef<HTMLParagraphElement>(null);
  const gotoRef = useRef<(index: number, direction: number) => void>(() => {});
  const [active, setActive] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | undefined;

    async function init() {
      const stack = stackRef.current;
      const section = sectionRef.current;
      if (!stack || !section) return;

      const stages = Array.from(stack.querySelectorAll<HTMLElement>(".gc-stage"));
      const bgs = stages.map((s) => s.querySelector<HTMLElement>(".gc-stage__img")!);

      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      const [{ gsap }, observerMod] = await Promise.all([
        import("gsap"),
        import("gsap/Observer").catch(() => null),
      ]);
      if (cancelled) return;

      const Observer = observerMod?.Observer;
      if (Observer) gsap.registerPlugin(Observer);

      const wrap = gsap.utils.wrap(0, stages.length);
      let current = -1;
      let animating = false;

      const setText = (index: number, animate: boolean) => {
        const s = PREVIEW_STAGES[index];
        if (kickerRef.current) kickerRef.current.textContent = s.label;
        if (titleRef.current) titleRef.current.textContent = s.title;
        if (subRef.current) subRef.current.textContent = s.sub;
        if (copyRef.current && animate && !reduce) {
          gsap.fromTo(
            copyRef.current.children,
            { autoAlpha: 0, y: 18 },
            { autoAlpha: 1, y: 0, duration: 0.6, ease: "power2.out", stagger: 0.07, overwrite: true },
          );
        }
      };

      const goto = (index: number, direction: number) => {
        index = wrap(index);
        if (animating || index === current) return;
        animating = true;
        const dFactor = direction === -1 ? -1 : 1;
        const prev = current;
        const fromClip = dFactor === 1 ? "inset(100% 0% 0% 0%)" : "inset(0% 0% 100% 0%)";

        const tl = gsap.timeline({
          defaults: { duration: reduce ? 0.01 : 1, ease: "power3.inOut" },
          onComplete: () => {
            animating = false;
          },
        });

        gsap.set(stages[index], { autoAlpha: 1, zIndex: 1, clipPath: fromClip });
        if (prev >= 0) gsap.set(stages[prev], { zIndex: 0 });

        tl.to(stages[index], { clipPath: "inset(0% 0% 0% 0%)" }, 0).fromTo(
          bgs[index],
          { yPercent: 6 * dFactor, scale: 1.06 },
          { yPercent: 0, scale: 1, duration: reduce ? 0.01 : 1.15, ease: "power2.out" },
          0,
        );

        if (prev >= 0) {
          tl.to(bgs[prev], { yPercent: -5 * dFactor, duration: 1 }, 0).set(stages[prev], {
            autoAlpha: 0,
            clipPath: "inset(0% 0% 0% 0%)",
          });
        }

        setText(index, prev >= 0);
        current = index;
        setActive(index);
      };

      gotoRef.current = goto;

      gsap.set(stages, { autoAlpha: 0, clipPath: "inset(0% 0% 0% 0%)" });
      goto(0, 1);

      // Auto-advance, paused on hover/focus
      let paused = false;
      const timer = window.setInterval(() => {
        if (!paused) goto(current + 1, 1);
      }, PREVIEW_INTERVAL);
      const onEnter = () => (paused = true);
      const onLeave = () => (paused = false);
      section.addEventListener("mouseenter", onEnter);
      section.addEventListener("mouseleave", onLeave);
      section.addEventListener("focusin", onEnter);
      section.addEventListener("focusout", onLeave);

      // Wheel / drag over the preview cycles screens (does not hijack the page)
      let observer: { kill: () => void } | undefined;
      if (Observer && !reduce) {
        observer = Observer.create({
          target: stack,
          type: "wheel,touch",
          tolerance: 60,
          preventDefault: false,
          onUp: () => goto(current + 1, 1),
          onDown: () => goto(current - 1, -1),
        }) as unknown as { kill: () => void };
      }

      cleanup = () => {
        window.clearInterval(timer);
        section.removeEventListener("mouseenter", onEnter);
        section.removeEventListener("mouseleave", onLeave);
        section.removeEventListener("focusin", onEnter);
        section.removeEventListener("focusout", onLeave);
        observer?.kill();
        gsap.killTweensOf("*");
      };
    }

    init();
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  return (
    <section ref={sectionRef} className="gc-preview" aria-label="GroundControl product preview">
      <header className="gc-preview__header">
        <div className="gc-preview__brand">
          <BrandLogo size={34} stroke="#1b1916" />
          <span className="sr-display">GroundControl<span>.</span></span>
        </div>
        <div ref={copyRef} className="gc-preview__copy">
          <p ref={kickerRef} className="gc-preview__kicker">{PREVIEW_STAGES[0].label}</p>
          <h2 ref={titleRef} className="sr-display">{PREVIEW_STAGES[0].title}</h2>
          <p ref={subRef} className="gc-preview__sub">{PREVIEW_STAGES[0].sub}</p>
        </div>
      </header>

      <div ref={stackRef} className="gc-preview__stack">
        {PREVIEW_STAGES.map((item) => (
          <div key={item.label} className="gc-stage" aria-hidden="true">
            <img className="gc-stage__img" src={item.image} alt="" draggable={false} />
          </div>
        ))}
      </div>

      <nav className="gc-preview__nav" aria-label="Preview screens">
        {PREVIEW_STAGES.map((item, index) => (
          <button
            key={item.label}
            type="button"
            aria-current={active === index}
            className={`gc-preview__nav-item ${active === index ? "is-active" : ""}`}
            onClick={() => gotoRef.current(index, index >= active ? 1 : -1)}
          >
            {item.label}
          </button>
        ))}
      </nav>
    </section>
  );
}
