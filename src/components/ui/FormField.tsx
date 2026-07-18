import { useId, type ReactElement, type ReactNode } from "react";
import { cloneElement } from "react";
import { cn } from "@/lib/ui";

export function FormField({
  label,
  hint,
  error,
  optional = false,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string;
  optional?: boolean;
  children: ReactElement<{ id?: string; "aria-describedby"?: string; "aria-invalid"?: boolean; className?: string }>;
  className?: string;
}) {
  const generatedId = useId();
  const id = children.props.id || generatedId;
  const descriptionId = hint || error ? `${id}-description` : undefined;
  const control = cloneElement(children, {
    id,
    "aria-describedby": descriptionId,
    "aria-invalid": Boolean(error),
    className: cn("gc-field w-full", error && "gc-field--error", children.props.className),
  });

  return (
    <div className={className}>
      <label htmlFor={id} className="gc-label">
        {label}
        {optional && <span className="ml-1 normal-case tracking-normal text-text-dim">optional</span>}
      </label>
      {control}
      {(error || hint) && (
        <p id={descriptionId} className={cn("mt-1.5 text-[11px] leading-relaxed", error ? "text-error" : "text-muted")}>
          {error || hint}
        </p>
      )}
    </div>
  );
}

export function FieldGroup({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-4 border-0 p-0">
      <legend className="text-sm font-medium text-foreground">{title}</legend>
      {description && <p className="-mt-2 text-xs leading-relaxed text-muted">{description}</p>}
      {children}
    </fieldset>
  );
}

