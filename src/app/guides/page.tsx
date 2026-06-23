"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { LoaderOverlay3D } from "@/components/LoaderOverlay3D";

interface GuideProgress {
  status: "not_started" | "in_progress" | "completed";
  currentStepId: string;
  completedStepIds: string[];
}

interface Guide {
  id: number;
  slug: string;
  title: string;
  description: string;
  category: string;
  sourceRef: string;
  stepsJson: string;
  isPublished: boolean;
  progress: GuideProgress;
}

const categoryColors: Record<string, string> = {
  integration: "bg-accent/10 text-accent border-accent/30",
  incident: "bg-error/10 text-error border-error/30",
  concept: "bg-warning/10 text-warning border-warning/30",
  checklist: "bg-success/10 text-success border-success/30",
};

const categoryLabels: Record<string, string> = {
  integration: "Integration",
  incident: "Incident",
  concept: "Concept",
  checklist: "Checklist",
};

function getProgressPercent(guide: Guide) {
  try {
    const steps = JSON.parse(guide.stepsJson) as { id: string }[];
    if (steps.length === 0) return 0;
    return Math.round((guide.progress.completedStepIds.length / steps.length) * 100);
  } catch {
    return 0;
  }
}

function statusIcon(status: string) {
  if (status === "completed") return "✓";
  if (status === "in_progress") return "▶";
  return "○";
}

export default function GuidesPage() {
  const [guides, setGuides] = useState<Guide[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/guides")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("Failed to load guides"))))
      .then((data: Guide[]) => {
        setGuides(data);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
  }, []);

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Interactive Guides</h1>
        <p className="text-muted mt-1">
          Step-by-step walkthroughs for integrations, incidents, and concepts. The AI assistant knows where you are and can help with each step.
        </p>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-error/10 border border-error/30 rounded-lg text-error text-sm">
          {error}
        </div>
      )}

      <LoaderOverlay3D open={loading} variant="generic" title="Loading guides..." />

      {!loading && guides.length === 0 && (
        <div className="text-center py-16 text-muted">
          <p>No guides available yet.</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {guides.map((guide) => {
          const pct = getProgressPercent(guide);
          return (
            <Link
              key={guide.slug}
              href={`/guides/${guide.slug}`}
              className="group block bg-card border border-border rounded-xl p-5 hover:border-accent/50 transition-colors"
            >
              <div className="flex items-start justify-between mb-3">
                <span
                  className={`text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded border ${
                    categoryColors[guide.category] || "bg-border/50 text-foreground border-border"
                  }`}
                >
                  {categoryLabels[guide.category] || guide.category}
                </span>
                <span
                  className={`text-lg ${
                    guide.progress.status === "completed"
                      ? "text-success"
                      : guide.progress.status === "in_progress"
                      ? "text-accent"
                      : "text-muted"
                  }`}
                  title={guide.progress.status}
                >
                  {statusIcon(guide.progress.status)}
                </span>
              </div>

              <h2 className="text-lg font-semibold mb-1 group-hover:text-accent transition-colors">
                {guide.title}
              </h2>
              <p className="text-sm text-muted mb-4 line-clamp-2">{guide.description}</p>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs font-mono text-muted">
                  <span>{guide.progress.status === "completed" ? "Completed" : `${pct}% complete`}</span>
                  <span>{guide.progress.completedStepIds.length} / {JSON.parse(guide.stepsJson || "[]").length} steps</span>
                </div>
                <div className="h-1.5 bg-border rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      guide.progress.status === "completed" ? "bg-success" : "bg-accent"
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
