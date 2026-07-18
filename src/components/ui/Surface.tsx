import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/ui";

export function Surface({
  children,
  raised = false,
  className,
  ...props
}: HTMLAttributes<HTMLElement> & { children: ReactNode; raised?: boolean }) {
  return (
    <section className={cn("gc-panel", raised && "gc-panel--raised", className)} {...props}>
      {children}
    </section>
  );
}

export function SurfaceHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("gc-panel-header", className)} {...props} />;
}

