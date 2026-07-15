"use client";

import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Ellipsis } from "lucide-react";

type MenuPosition = { left: number; top: number };

export function ContextActionMenu({
  label,
  children,
  align = "end",
}: {
  label: string;
  children: (close: () => void) => ReactNode;
  align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<MenuPosition>({ left: 0, top: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const close = () => setOpen(false);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const trigger = triggerRef.current.getBoundingClientRect();
    const menuWidth = 240;
    const menuHeight = menuRef.current?.offsetHeight || 240;
    const gutter = 12;
    const preferredLeft = align === "end" ? trigger.right - menuWidth : trigger.left;
    const left = Math.min(
      Math.max(gutter, preferredLeft),
      window.innerWidth - menuWidth - gutter
    );
    const opensUp = trigger.bottom + menuHeight + gutter > window.innerHeight;
    const top = opensUp
      ? Math.max(gutter, trigger.top - menuHeight - 6)
      : trigger.bottom + 6;
    setPosition({ left, top });
  }, [align, open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) close();
    };
    const onEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
        triggerRef.current?.focus();
      }
    };
    const onViewportChange = () => close();
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onEscape);
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onEscape);
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
    };
  }, [open]);

  function onTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      requestAnimationFrame(() => {
        menuRef.current?.querySelector<HTMLElement>("button:not(:disabled), a[href]")?.focus();
      });
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={onTriggerKeyDown}
        className="gc-icon-button"
      >
        <Ellipsis size={16} aria-hidden="true" />
      </button>
      {open && typeof document !== "undefined" && createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label={label}
          style={{ left: position.left, top: position.top }}
          className="fixed z-[90] w-60 border border-border bg-background p-1.5 shadow-2xl shadow-black/25"
        >
          {children(close)}
        </div>,
        document.body
      )}
    </>
  );
}

export function ContextMenuAction({
  children,
  onClick,
  href,
  tone = "default",
  disabled = false,
}: {
  children: ReactNode;
  onClick?: () => void;
  href?: string;
  tone?: "default" | "danger";
  disabled?: boolean;
}) {
  const className = `flex min-h-9 w-full items-center gap-2 px-2.5 py-2 text-left text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
    tone === "danger"
      ? "text-error hover:bg-error/10"
      : "text-foreground/85 hover:bg-card hover:text-foreground"
  }`;
  if (href) {
    const external = /^https?:\/\//i.test(href);
    return <a role="menuitem" href={href} target={external ? "_blank" : undefined} rel={external ? "noreferrer" : undefined} className={className}>{children}</a>;
  }
  return (
    <button role="menuitem" type="button" onClick={onClick} disabled={disabled} className={className}>
      {children}
    </button>
  );
}

export function ContextMenuLabel({ children }: { children: ReactNode }) {
  return <div className="px-2.5 pb-1 pt-2 font-mono text-[9px] uppercase tracking-[0.16em] text-muted">{children}</div>;
}

export function ContextMenuDivider() {
  return <div className="my-1 border-t border-border" />;
}
