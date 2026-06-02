"use client";

import { useEffect, useState } from "react";

interface HealthData {
  score: number;
  max: number;
  breakdown: {
    containers: { score: number; max: number };
    system: { score: number; max: number };
    proxy: { score: number; max: number };
    security: { score: number; max: number };
  };
  metrics: {
    memPercent: number;
    diskPercent: number;
    loadRatio: number;
    runningContainers: number;
    totalContainers: number;
    unhealthyContainers: number;
  };
  fixes: { label: string; action: string; target?: string; href?: string }[];
}

export default function HealthScore() {
  const [data, setData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);

  async function fetchData() {
    try {
      const res = await fetch("/api/health-score");
      if (res.ok) setData(await res.json());
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, []);

  async function applyFix(fix: HealthData["fixes"][0]) {
    if (fix.action === "prune") {
      await fetch("/api/terminal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: "docker system prune -f" }),
      });
    } else if (fix.target) {
      await fetch("/api/containers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: fix.action, name: fix.target }),
      });
    }
    fetchData();
  }

  if (loading) {
    return (
      <div className="bg-card border border-border rounded-xl p-5 animate-pulse">
        <div className="h-6 bg-border rounded w-32 mb-4" />
        <div className="h-24 bg-border rounded" />
      </div>
    );
  }

  if (!data) return null;

  const pct = (data.score / data.max) * 100;
  const color =
    pct >= 90 ? "text-success" : pct >= 70 ? "text-warning" : "text-error";
  const strokeColor =
    pct >= 90 ? "#22c55e" : pct >= 70 ? "#f59e0b" : "#ef4444";
  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (pct / 100) * circumference;

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <h3 className="text-sm font-mono uppercase tracking-wider text-muted mb-4">
        Health Score
      </h3>

      <div className="flex items-center gap-6">
        {/* Circular gauge */}
        <div className="relative w-24 h-24 shrink-0">
          <svg className="w-full h-full -rotate-90" viewBox="0 0 80 80">
            <circle
              cx="40"
              cy="40"
              r={radius}
              fill="none"
              stroke="currentColor"
              strokeWidth="6"
              className="text-border"
            />
            <circle
              cx="40"
              cy="40"
              r={radius}
              fill="none"
              stroke={strokeColor}
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              className="transition-all duration-1000"
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className={`text-xl font-bold ${color}`}>{data.score}</span>
          </div>
        </div>

        {/* Breakdown */}
        <div className="flex-1 space-y-2">
          {Object.entries(data.breakdown).map(([key, val]) => (
            <div key={key} className="flex items-center gap-2">
              <span className="text-[10px] font-mono uppercase text-muted w-20">{key}</span>
              <div className="flex-1 h-1.5 bg-border rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${(val.score / val.max) * 100}%`,
                    backgroundColor:
                      val.score / val.max >= 0.9
                        ? "#22c55e"
                        : val.score / val.max >= 0.7
                        ? "#f59e0b"
                        : "#ef4444",
                  }}
                />
              </div>
              <span className="text-[10px] font-mono text-muted w-8 text-right">
                {val.score}/{val.max}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Auto-fix suggestions */}
      {data.fixes.length > 0 && (
        <div className="mt-4 pt-4 border-t border-border/50">
          <p className="text-[10px] font-mono uppercase text-muted mb-2">Suggested Fixes</p>
          <div className="flex flex-wrap gap-2">
            {data.fixes.map((fix, i) => (
              <button
                key={i}
                onClick={() => applyFix(fix)}
                className="px-3 py-1.5 text-xs font-mono border border-accent/30 text-accent rounded hover:bg-accent/10 transition-colors"
              >
                {fix.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
