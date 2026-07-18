import { Check } from "lucide-react";
import { cn } from "@/lib/ui";

export type ProgressStep<T extends string> = { id: T; label: string };

export function ProgressSteps<T extends string>({
  label,
  steps,
  current,
  onSelect,
  className,
}: {
  label: string;
  steps: Array<ProgressStep<T>>;
  current: T;
  onSelect?: (step: T) => void;
  className?: string;
}) {
  const currentIndex = Math.max(0, steps.findIndex((step) => step.id === current));
  return (
    <ol aria-label={label} className={cn("gc-progress", className)}>
      {steps.map((step, index) => {
        const complete = index < currentIndex;
        const active = index === currentIndex;
        return (
          <li key={step.id} className="gc-progress__item">
            <button
              type="button"
              aria-current={active ? "step" : undefined}
              disabled={index > currentIndex || !onSelect}
              onClick={() => onSelect?.(step.id)}
              className="gc-progress__button"
            >
              <span className="gc-progress__index" aria-hidden="true">
                {complete ? <Check size={11} /> : String(index + 1).padStart(2, "0")}
              </span>
              <span>{step.label}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

