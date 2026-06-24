"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { LoaderOverlay3D } from "@/components/LoaderOverlay3D";
import { renderMarkdown } from "@/lib/markdown";

interface GuideStep {
  id: string;
  title: string;
  content: string;
  checkCommand?: string;
  expectedOutput?: string;
  aiHint?: string;
  action?: {
    tool: string;
    action: string;
    confirm?: boolean;
    label?: string;
  };
}

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
  steps: GuideStep[];
  progress: GuideProgress;
}

interface CheckResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number;
  skipped?: boolean;
  message?: string;
  expectedOutput: string | null;
  matchesExpected: boolean;
  progress?: GuideProgress;
}

const categoryLabels: Record<string, string> = {
  integration: "Integration",
  incident: "Incident",
  concept: "Concept",
  checklist: "Checklist",
};

export default function GuidePlayerPage() {
  const params = useParams();
  const slug = params.slug as string;

  const [guide, setGuide] = useState<Guide | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [currentStepId, setCurrentStepId] = useState<string>("");
  const [completedStepIds, setCompletedStepIds] = useState<Set<string>>(new Set());
  const [checkLoading, setCheckLoading] = useState(false);
  const [checkResult, setCheckResult] = useState<CheckResult | null>(null);
  const [markLoading, setMarkLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionResult, setActionResult] = useState<{ ok: boolean; output: string; error: string; action: string } | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ open: boolean; label: string } | null>(null);

  useEffect(() => {
    if (!slug) return;
    fetch(`/api/guides/${slug}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("Guide not found"))))
      .then((data: Guide) => {
        setGuide(data);
        setCurrentStepId(data.progress.currentStepId || data.steps[0]?.id || "");
        setCompletedStepIds(new Set(data.progress.completedStepIds));
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
  }, [slug]);

  const steps = useMemo(() => guide?.steps || [], [guide]);
  const currentStep = useMemo(
    () => steps.find((s) => s.id === currentStepId) || steps[0],
    [steps, currentStepId]
  );

  async function runCheck() {
    if (!guide || !currentStep) return;
    setCheckLoading(true);
    setCheckResult(null);
    try {
      const res = await fetch(`/api/guides/${guide.slug}/steps/${currentStep.id}/check`, {
        method: "POST",
      });
      const data = (await res.json()) as CheckResult;
      setCheckResult(data);
      if (data.progress) {
        setCompletedStepIds(new Set(data.progress.completedStepIds));
      }
    } catch (err: unknown) {
      setCheckResult({
        ok: false,
        stdout: "",
        stderr: err instanceof Error ? err.message : String(err),
        code: 1,
        expectedOutput: null,
        matchesExpected: false,
      });
    } finally {
      setCheckLoading(false);
    }
  }

  async function runStepAction(tool: string, action: string) {
    if (!guide || !currentStep) return;
    setActionLoading(true);
    setActionResult(null);
    try {
      const res = await fetch("/api/bootstrap/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool, action }),
      });
      const data = (await res.json()) as { success: boolean; output: string; error: string };
      setActionResult({ ok: data.success, output: data.output, error: data.error, action: `${action} ${tool}` });
      if (data.success) {
        const progress = await fetch(`/api/guides/${guide.slug}/progress`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stepId: currentStep.id, markComplete: true }),
        }).then((r) => r.json() as Promise<GuideProgress>);
        setCompletedStepIds(new Set(progress.completedStepIds));
      }
    } catch (err: unknown) {
      setActionResult({
        ok: false,
        output: "",
        error: err instanceof Error ? err.message : String(err),
        action: `${action} ${tool}`,
      });
    } finally {
      setActionLoading(false);
    }
  }

  async function markComplete(advance = true) {
    if (!guide || !currentStep) return;
    setMarkLoading(true);
    try {
      const res = await fetch(`/api/guides/${guide.slug}/progress`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stepId: currentStep.id, markComplete: true }),
      });
      const data = (await res.json()) as GuideProgress;
      setCompletedStepIds(new Set(data.completedStepIds));
      if (advance) {
        const nextStep = steps.find((s) => !data.completedStepIds.includes(s.id));
        if (nextStep) setCurrentStepId(nextStep.id);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setMarkLoading(false);
    }
  }

  async function resetGuide() {
    if (!guide) return;
    if (!confirm("Reset progress for this guide?")) return;
    try {
      await fetch(`/api/guides/${guide.slug}/reset`, { method: "POST" });
      setCompletedStepIds(new Set());
      setCurrentStepId(steps[0]?.id || "");
      setCheckResult(null);
      setActionResult(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function askAi() {
    if (!guide || !currentStep) return;
    const detail = {
      message: `I'm on step "${currentStep.title}" of the "${guide.title}" guide. Help me understand and complete this step.`,
      guideContext: { guideSlug: guide.slug, stepId: currentStep.id },
    };
    window.dispatchEvent(new CustomEvent("gc:ai-chat-query", { detail }));
  }

  if (loading) {
    return (
      <div className="p-8 max-w-7xl mx-auto min-h-[60vh]">
        <LoaderOverlay3D open variant="generic" title="Loading guide..." />
      </div>
    );
  }

  if (error || !guide) {
    return (
      <div className="p-8 max-w-7xl mx-auto">
        <div className="mb-6 p-4 bg-error/10 border border-error/30 rounded-lg text-error text-sm">
          {error || "Guide not found"}
        </div>
        <Link href="/guides" className="text-accent hover:underline text-sm">
          ← Back to guides
        </Link>
      </div>
    );
  }

  const progressPercent = steps.length > 0 ? Math.round((completedStepIds.size / steps.length) * 100) : 0;
  const isCompleted = completedStepIds.size === steps.length && steps.length > 0;

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="mb-6">
        <Link href="/guides" className="text-sm text-muted hover:text-accent transition-colors">
          ← Back to guides
        </Link>
      </div>

      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded border bg-border/30 text-foreground border-border">
            {categoryLabels[guide.category] || guide.category}
          </span>
          {isCompleted && <span className="text-xs text-success font-mono">✓ Completed</span>}
        </div>
        <h1 className="text-3xl font-bold tracking-tight">{guide.title}</h1>
        <p className="text-muted mt-1">{guide.description}</p>
      </div>

      {/* Progress bar */}
      <div className="mb-8 bg-card border border-border rounded-xl p-4">
        <div className="flex items-center justify-between text-xs font-mono text-muted mb-2">
          <span>{progressPercent}% complete</span>
          <span>
            {completedStepIds.size} / {steps.length} steps
          </span>
        </div>
        <div className="h-2 bg-border rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${isCompleted ? "bg-success" : "bg-accent"}`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Step list */}
        <div className="lg:col-span-1 space-y-2">
          {steps.map((step, idx) => {
            const isCurrent = step.id === currentStep?.id;
            const isDone = completedStepIds.has(step.id);
            return (
              <button
                key={step.id}
                onClick={() => {
                  setCurrentStepId(step.id);
                  setCheckResult(null);
                  setActionResult(null);
                }}
                className={`w-full text-left px-4 py-3 rounded-lg border text-sm transition-colors ${
                  isCurrent
                    ? "bg-accent/10 border-accent/30 text-accent"
                    : "bg-card border-border text-foreground hover:border-accent/30"
                }`}
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-mono shrink-0 ${
                      isDone
                        ? "bg-success/20 text-success"
                        : isCurrent
                        ? "bg-accent/20 text-accent"
                        : "bg-border/50 text-muted"
                    }`}
                  >
                    {isDone ? "✓" : idx + 1}
                  </span>
                  <span className="line-clamp-2">{step.title}</span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Step content */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-card border border-border rounded-xl p-6">
            <h2 className="text-xl font-semibold mb-4">{currentStep?.title}</h2>
            {currentStep && (
              <div
                className="prose-sm leading-relaxed text-foreground/90 [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-black/40 [&_pre]:border [&_pre]:border-border [&_pre]:p-3 [&_pre]:text-xs [&_pre]:font-mono [&_code]:rounded [&_code]:bg-border/50 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_code]:font-mono"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(currentStep.content) }}
              />
            )}
          </div>

          {/* Confirmation modal for guide step actions */}
          {confirmAction?.open && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
              <div className="bg-card border border-error/30 rounded-xl p-5 max-w-md w-full shadow-xl">
                <h3 className="text-sm font-semibold text-error mb-2">Confirm {confirmAction.label}</h3>
                <p className="text-xs text-muted mb-4">
                  This action will make changes on the active VPS. Continue only if you understand the impact.
                </p>
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => setConfirmAction(null)}
                    className="px-3 py-1.5 text-xs font-mono rounded border border-border hover:bg-border/50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      const action = currentStep?.action;
                      if (action) runStepAction(action.tool, action.action);
                      setConfirmAction(null);
                    }}
                    className="px-3 py-1.5 text-xs font-mono rounded bg-error/10 border border-error/30 text-error hover:bg-error/20 transition-colors"
                  >
                    Confirm
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-3">
            {currentStep?.checkCommand && (
              <button
                onClick={runCheck}
                disabled={checkLoading}
                className="px-4 py-2 text-xs font-mono bg-accent/10 border border-accent/30 text-accent rounded-lg hover:bg-accent/20 transition-colors disabled:opacity-50"
              >
                {checkLoading ? "Running check…" : "Run check"}
              </button>
            )}
            {currentStep?.action && (
              <button
                onClick={() => {
                  const action = currentStep.action!;
                  if (action.confirm) {
                    setConfirmAction({ open: true, label: action.label || `${action.action} ${action.tool}` });
                  } else {
                    runStepAction(action.tool, action.action);
                  }
                }}
                disabled={actionLoading}
                className="px-4 py-2 text-xs font-mono bg-accent/10 border border-accent/30 text-accent rounded-lg hover:bg-accent/20 transition-colors disabled:opacity-50"
              >
                {actionLoading ? "Running…" : currentStep.action.label || `${currentStep.action.action} ${currentStep.action.tool}`}
              </button>
            )}
            <button
              onClick={() => markComplete(true)}
              disabled={markLoading || (currentStep ? completedStepIds.has(currentStep.id) : false)}
              className="px-4 py-2 text-xs font-mono bg-success/10 border border-success/30 text-success rounded-lg hover:bg-success/20 transition-colors disabled:opacity-50"
            >
              {markLoading ? "Saving…" : completedStepIds.has(currentStep?.id || "") ? "Step done" : "Mark done & continue"}
            </button>
            <button
              onClick={askAi}
              className="px-4 py-2 text-xs font-mono bg-border/50 border border-border text-foreground rounded-lg hover:bg-border transition-colors"
            >
              Ask AI about this step
            </button>
            <button
              onClick={resetGuide}
              className="ml-auto px-4 py-2 text-xs font-mono text-muted hover:text-error transition-colors"
            >
              Reset progress
            </button>
          </div>

          {/* Action result */}
          {actionResult && (
            <div className={`rounded-xl border p-4 ${actionResult.ok ? "bg-success/5 border-success/30" : "bg-error/5 border-error/30"}`}>
              <div className="flex items-center gap-2 mb-2">
                <span className={actionResult.ok ? "text-success" : "text-error"}>{actionResult.ok ? "✓" : "✗"}</span>
                <span className="text-sm font-medium">{actionResult.ok ? `${actionResult.action} succeeded` : `${actionResult.action} failed`}</span>
              </div>
              <pre className="text-xs font-mono bg-black/40 border border-border rounded-lg p-3 overflow-x-auto whitespace-pre-wrap">
                <strong>stdout:</strong>\n{actionResult.output || "(empty)"}\n\n<strong>stderr:</strong>\n{actionResult.error || "(empty)"}
              </pre>
            </div>
          )}

          {/* Check result */}
          {checkResult && (
            <div
              className={`rounded-xl border p-4 ${
                checkResult.ok
                  ? "bg-success/5 border-success/30"
                  : checkResult.skipped
                  ? "bg-warning/5 border-warning/30"
                  : "bg-error/5 border-error/30"
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                <span className={checkResult.ok ? "text-success" : checkResult.skipped ? "text-warning" : "text-error"}>
                  {checkResult.ok ? "✓" : checkResult.skipped ? "⊘" : "✗"}
                </span>
                <span className="text-sm font-medium">
                  {checkResult.ok
                    ? "Check passed"
                    : checkResult.skipped
                    ? checkResult.message || "No automatic check"
                    : "Check failed"}
                </span>
              </div>
              {checkResult.skipped ? null : (
                <>
                  {(checkResult.code === 127 ||
                    /not found|command not found|No such file or directory/i.test(
                      `${checkResult.stdout} ${checkResult.stderr}`
                    )) && (
                    <div className="mb-3 p-3 bg-warning/10 border border-warning/30 rounded-lg text-warning text-xs font-mono">
                      <strong>This component is not installed or is not in PATH.</strong>
                      {currentStep?.action ? (
                        <span>
                          {" "}
                          Click <strong>{currentStep.action.label || `${currentStep.action.action} ${currentStep.action.tool}`}</strong> above to install it, then run the check again.
                        </span>
                      ) : (
                        <span>
                          {" "}
                          Follow the step instructions to install it, then run the check again.
                        </span>
                      )}
                    </div>
                  )}
                  <pre className="text-xs font-mono bg-black/40 border border-border rounded-lg p-3 overflow-x-auto whitespace-pre-wrap">
                    <strong>stdout:</strong>\n{checkResult.stdout || "(empty)"}\n\n<strong>stderr:</strong>\n{checkResult.stderr || "(empty)"}\n\n<strong>exit code:</strong> {checkResult.code}
                </pre>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
