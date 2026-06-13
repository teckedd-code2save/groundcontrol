"use client";

import LoginHero3D from "@/components/LoginHero3D";

interface AuthCardProps {
  title: string;
  subtitle: string;
  badge?: string;
  badgeColor?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export default function AuthCard({
  title,
  subtitle,
  badge = "GC",
  badgeColor = "from-accent via-orange-500 to-orange-600",
  children,
  footer,
}: AuthCardProps) {
  return (
    <main className="relative min-h-screen w-full flex flex-col items-center justify-center overflow-hidden px-6">
      <LoginHero3D />

      <div className="relative z-10 w-full max-w-sm">
        <div className="relative rounded-3xl bg-gradient-to-b from-white/[0.07] to-white/[0.02] p-px shadow-2xl">
          <div className="relative rounded-3xl bg-black/20 backdrop-blur-2xl px-8 py-10 overflow-hidden">
            <div className="absolute -top-24 -right-24 w-48 h-48 rounded-full bg-accent/20 blur-[80px]" />
            <div className="absolute -bottom-24 -left-24 w-48 h-48 rounded-full bg-purple-500/15 blur-[80px]" />

            <div className="relative flex flex-col items-center text-center mb-8">
              <div className="relative mb-5">
                <div
                  className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${badgeColor} flex items-center justify-center text-white font-bold text-xl shadow-lg shadow-accent/20`}
                >
                  {badge}
                </div>
                <div className="absolute inset-0 rounded-2xl bg-accent/40 blur-xl -z-10 animate-pulse-slow" />
              </div>
              <h1 className="text-3xl font-bold tracking-tight text-white drop-shadow-sm">
                {title}
              </h1>
              <p className="mt-2 text-sm text-white/50 font-medium">{subtitle}</p>
            </div>

            <div className="relative">{children}</div>

            {footer && (
              <p className="relative mt-6 text-center text-[11px] text-white/30">{footer}</p>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

export function AuthInput({
  label,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <div className="group">
      <label className="block text-[11px] font-semibold uppercase tracking-wider text-white/40 mb-1.5 group-focus-within:text-accent transition-colors">
        {label}
      </label>
      <input
        className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/20 outline-none transition-all focus:bg-white/[0.07] focus:border-accent/50 focus:ring-2 focus:ring-accent/10"
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
      className="relative w-full mt-2 py-3 rounded-xl bg-gradient-to-r from-accent via-orange-500 to-accent bg-[length:200%_100%] text-white text-sm font-semibold shadow-lg shadow-accent/20 transition-all hover:shadow-accent/30 hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed overflow-hidden"
      {...props}
    >
      <span className="relative z-10 flex items-center justify-center gap-2">
        {loading ? (
          <>
            <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
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
    <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-200 text-sm text-center animate-shake">
      {message}
    </div>
  );
}
