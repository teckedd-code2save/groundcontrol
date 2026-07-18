import type { HTMLAttributes, ReactNode } from "react";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import { cn, type InterfaceTone } from "@/lib/ui";

const icons = {
  neutral: Info,
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  danger: CircleAlert,
};

export function Notice({
  tone = "neutral",
  title,
  children,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  tone?: InterfaceTone;
  title?: string;
  children: ReactNode;
}) {
  const Icon = icons[tone];
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn("gc-notice", `gc-notice--${tone}`, className)}
      {...props}
    >
      <Icon className="mt-0.5 shrink-0" size={15} aria-hidden="true" />
      <div className="min-w-0">
        {title && <p className="gc-notice__title">{title}</p>}
        <div className="gc-notice__body">{children}</div>
      </div>
    </div>
  );
}

