"use client";

import { usePathname } from "next/navigation";
import CommandPalette from "@/components/CommandPalette";
import AIChatWidget from "@/components/AIChatWidget";
import AIChatGlobalShortcuts from "@/components/AIChatGlobalShortcuts";
import AlertScheduler from "@/components/AlertScheduler";

const HIDDEN_PATHS = ["/login", "/setup", "/force-password-change"];

export function AuthenticatedWidgets() {
  const pathname = usePathname();
  if (HIDDEN_PATHS.includes(pathname)) return null;
  return (
    <>
      <CommandPalette />
      <AIChatGlobalShortcuts />
      <AIChatWidget />
      <AlertScheduler />
    </>
  );
}
