"use client";

/** Lightweight ASCII / terminal brand frame for empty states and hero moments. */
export function AsciiEmpty({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-border bg-card px-6 py-12 text-center">
      <pre
        className="mb-4 select-none font-mono text-[10px] leading-tight text-accent/70 sm:text-xs"
        aria-hidden
      >{`┌─────────────────┐
│  ·  ·  ·  ·  ·  │
│  ·  [ GC ]  ·  │
│  ·  ·  ·  ·  ·  │
└─────────────────┘`}</pre>
      <h3 className="text-sm font-medium text-foreground">{title}</h3>
      {subtitle ? <p className="mt-1 max-w-sm text-xs text-muted">{subtitle}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function AsciiMark({ className = "" }: { className?: string }) {
  return (
    <pre
      className={`select-none font-mono text-[9px] leading-none text-accent/60 ${className}`}
      aria-hidden
    >{`╔══╗
║GC║
╚══╝`}</pre>
  );
}
