"use client";

export interface ToolConfirmCardProps {
  name: string;
  args?: Record<string, unknown>;
  description?: string;
  impact?: string[];
  resolved?: "approved" | "cancelled";
  loading?: boolean;
  onApprove?: () => void;
  onCancel?: () => void;
}

/** Shared mutating-tool confirmation card for Co-Pilot and floating chat. */
export function ToolConfirmCard({
  name,
  args = {},
  description,
  impact,
  resolved,
  loading,
  onApprove,
  onCancel,
}: ToolConfirmCardProps) {
  const argLines = Object.entries(args).map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);

  return (
    <div className="rounded-lg border border-accent/40 bg-accent/5 p-3 text-sm">
      <div className="mb-2 flex items-center gap-2">
        <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-accent" />
        <span className="font-mono text-[10px] uppercase tracking-wider text-accent">
          Approval required
        </span>
      </div>

      <p className="font-medium text-foreground">{name}</p>
      {description ? (
        <p className="mt-1 text-xs text-muted">{description}</p>
      ) : null}

      {argLines.length > 0 && (
        <div className="mt-2 rounded-md bg-background/60 p-2 font-mono text-[10px] text-muted">
          {argLines.map((line) => (
            <div key={line} className="truncate">
              {line}
            </div>
          ))}
        </div>
      )}

      {impact && impact.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs text-muted">
          {impact.map((item) => (
            <li key={item} className="flex gap-1.5">
              <span className="text-accent">·</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-2 text-[11px] text-muted">
        This changes server state and will not run until you approve.
      </p>

      {resolved ? (
        <p className="mt-2 font-mono text-xs italic text-muted">
          {resolved === "approved" ? "Approved." : "Cancelled."}
        </p>
      ) : (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={onApprove}
            disabled={loading}
            className="rounded-md bg-accent px-3 py-1.5 text-xs font-mono font-medium text-white transition-colors hover:bg-accent-bright disabled:opacity-50"
          >
            Approve
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-mono text-muted transition-colors hover:border-error hover:text-error disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
