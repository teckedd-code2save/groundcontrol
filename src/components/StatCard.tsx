"use client";

interface StatCardProps {
  title: string;
  value: string;
  subtitle?: string;
  trend?: "up" | "down" | "neutral";
  icon?: string;
}

export function StatCard({ title, value, subtitle, trend = "neutral", icon }: StatCardProps) {
  const trendColor =
    trend === "up" ? "text-success" : trend === "down" ? "text-error" : "text-muted";

  return (
    <div
      className="rounded-[var(--radius-lg)] p-5 transition-all duration-300 hover:-translate-y-1 group"
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = "var(--border-hover)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "var(--border)";
      }}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="mb-2 font-mono text-[11px] uppercase tracking-widest text-muted">{title}</p>
          <p className="text-2xl font-bold tracking-tight">{value}</p>
          {subtitle && <p className={`text-xs mt-1 ${trendColor}`}>{subtitle}</p>}
        </div>
        {icon && (
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center text-sm transition-transform duration-300 group-hover:scale-110"
            style={{
              background: "rgba(124, 156, 255, 0.10)",
              border: "1px solid rgba(124, 156, 255, 0.20)",
              color: "var(--accent)",
            }}
          >
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}
