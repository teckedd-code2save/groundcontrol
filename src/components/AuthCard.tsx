"use client";

import BrandLogo from "@/components/BrandLogo";

interface AuthCardProps {
  title: string;
  subtitle: string;
  badge?: string;
  badgeColor?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  layout?: "center" | "split";
  leftPanel?: React.ReactNode;
}

export default function AuthCard({
  title,
  subtitle,
  footer,
  layout = "center",
  leftPanel,
  children,
}: AuthCardProps) {
  return (
    <main className="sr-theme relative min-h-screen w-full overflow-hidden">
      {/* Warm ambient background */}
      <div className="absolute inset-0 bg-[var(--sr-bg)]" />
      <div
        className="pointer-events-none absolute -top-[20%] -right-[8%] w-[46%] aspect-square rounded-full opacity-60"
        style={{
          background:
            "radial-gradient(circle at 50% 50%, rgba(255, 106, 64, 0.16), transparent 68%)",
        }}
      />
      <div
        className="pointer-events-none absolute bottom-0 left-0 w-full h-1/2 opacity-40"
        style={{
          background:
            "linear-gradient(to top, rgba(236, 234, 227, 1) 0%, transparent 100%)",
        }}
      />

      {layout === "split" ? (
        <div className="relative z-10 min-h-screen flex flex-col md:flex-row">
          {/* Left panel: brand story */}
          <div className="hidden md:flex md:w-1/2 lg:w-[55%] flex-col justify-between px-10 lg:px-16 xl:px-24 py-12">
            <div className="flex items-center gap-3">
              <BrandLogo size={32} stroke="#1b1916" />
              <span
                className="sr-display text-lg font-medium tracking-tight"
                style={{ color: "var(--sr-text-90)" }}
              >
                GroundControl
                <span style={{ color: "var(--sr-coral)" }}>.</span>
              </span>
            </div>
            <div className="max-w-md">{leftPanel}</div>
            <p
              className="sr-mono text-[11px] uppercase tracking-widest"
              style={{ color: "var(--sr-text-35)" }}
            >
              Self-hosted VPS management
            </p>
          </div>

          {/* Right panel: form */}
          <div className="flex-1 flex items-center justify-center px-6 py-12 md:px-12 lg:px-20">
            <div className="w-full max-w-[420px]">
              {footer && (
                <p
                  className="mb-6 text-center text-xs leading-relaxed"
                  style={{ color: "var(--sr-text-35)" }}
                >
                  {footer}
                </p>
              )}

              <div
                className="rounded-[var(--radius-xl)] p-8 md:p-10 shadow-lg"
                style={{
                  background: "var(--sr-paper)",
                  boxShadow: "0 26px 60px rgba(27, 25, 22, 0.12)",
                }}
              >
                <div className="flex flex-col items-center text-center mb-8">
                  <div className="relative mb-5">
                    <BrandLogo size={56} stroke="#1b1916" />
                  </div>
                  <h1
                    className="sr-display text-2xl md:text-3xl font-medium tracking-tight"
                    style={{ color: "var(--sr-text-90)" }}
                  >
                    {title}
                  </h1>
                  <p
                    className="mt-2 text-sm font-medium"
                    style={{ color: "var(--sr-text-55)" }}
                  >
                    {subtitle}
                  </p>
                </div>

                <div>{children}</div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="relative z-10 min-h-screen flex flex-col items-center justify-center px-6 py-12">
          <div className="w-full max-w-[420px]">
            {footer && (
              <p
                className="mb-6 text-center text-xs leading-relaxed"
                style={{ color: "var(--sr-text-35)" }}
              >
                {footer}
              </p>
            )}

            <div
              className="rounded-[var(--radius-xl)] p-8 md:p-10"
              style={{
                background: "var(--sr-paper)",
                boxShadow: "0 26px 60px rgba(27, 25, 22, 0.12)",
              }}
            >
              <div className="flex flex-col items-center text-center mb-8">
                <div className="relative mb-5">
                  <BrandLogo size={56} stroke="#1b1916" />
                </div>
                <h1
                  className="sr-display text-2xl md:text-3xl font-medium tracking-tight"
                  style={{ color: "var(--sr-text-90)" }}
                >
                  {title}
                </h1>
                <p
                  className="mt-2 text-sm font-medium"
                  style={{ color: "var(--sr-text-55)" }}
                >
                  {subtitle}
                </p>
              </div>

              <div>{children}</div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export function AuthInput({
  label,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <div className="group">
      <label
        className="block text-[11px] font-semibold uppercase tracking-wider mb-1.5 transition-colors"
        style={{ color: "var(--sr-text-35)" }}
      >
        {label}
      </label>
      <input
        className="w-full rounded-xl px-4 py-3 text-sm outline-none transition-all"
        style={{
          background: "var(--sr-bg)",
          color: "var(--sr-text-90)",
          border: "1px solid var(--sr-stone)",
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = "var(--sr-coral)";
          e.currentTarget.style.boxShadow = "0 0 0 3px rgba(232, 84, 42, 0.10)";
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = "var(--sr-stone)";
          e.currentTarget.style.boxShadow = "none";
        }}
        {...props}
      />
    </div>
  );
}

export function AuthButton({
  loading,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }) {
  return (
    <button
      disabled={loading}
      className="sr-btn sr-btn-coral relative w-full mt-2 disabled:opacity-50 disabled:cursor-not-allowed overflow-hidden"
      {...props}
    >
      <span className="relative z-10 flex items-center justify-center gap-2">
        {loading ? (
          <>
            <span className="w-4 h-4 border-2 border-black/20 border-t-black rounded-full animate-spin" />
            {children}...
          </>
        ) : (
          children
        )}
      </span>
    </button>
  );
}

export function AuthError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <div
      className="p-3 rounded-xl text-sm text-center animate-shake"
      style={{
        background: "rgba(239, 68, 68, 0.08)",
        border: "1px solid rgba(239, 68, 68, 0.18)",
        color: "#c0392b",
      }}
    >
      {message}
    </div>
  );
}
