import type { ReactNode } from "react";
import { cn } from "@/lib/ui";

export type TabItem<T extends string> = {
  id: T;
  label: string;
  meta?: ReactNode;
  disabled?: boolean;
};

export function Tabs<T extends string>({
  label,
  items,
  value,
  onChange,
  orientation = "horizontal",
  className,
}: {
  label: string;
  items: Array<TabItem<T>>;
  value: T;
  onChange: (value: T) => void;
  orientation?: "horizontal" | "vertical";
  className?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      aria-orientation={orientation}
      className={cn("gc-tabs", orientation === "vertical" && "gc-tabs--vertical", className)}
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={value === item.id}
          disabled={item.disabled}
          onClick={() => onChange(item.id)}
          className="gc-tab"
        >
          <span>{item.label}</span>
          {item.meta && <span className="gc-tab__meta">{item.meta}</span>}
        </button>
      ))}
    </div>
  );
}
