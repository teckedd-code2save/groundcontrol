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
    <div className="bg-card border border-border rounded-xl p-5 hover:border-border-hover transition-colors">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-mono uppercase tracking-wider text-muted mb-2">{title}</p>
          <p className="text-2xl font-bold tracking-tight">{value}</p>
          {subtitle && <p className={`text-xs mt-1 ${trendColor}`}>{subtitle}</p>}
        </div>
        {icon && (
          <div className="w-9 h-9 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-center text-accent text-sm">
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}
