"use client";

import { usePathname } from "next/navigation";
import CommandPalette from "@/components/CommandPalette";
import AIChatWidget from "@/components/AIChatWidget";
import AIChatGlobalShortcuts from "@/components/AIChatGlobalShortcuts";
import AlertScheduler from "@/components/AlertScheduler";
import HealthCheckScheduler from "@/components/HealthCheckScheduler";

const HIDDEN_PATHS = ["/login", "/setup", "/force-password-change"];
const HIDDEN_PREFIXES = ["/shared/chat/"];

export function AuthenticatedWidgets() {
  const pathname = usePathname();
  if (HIDDEN_PATHS.includes(pathname) || HIDDEN_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return null;
  return (
    <>
      <CommandPalette />
      <AIChatGlobalShortcuts />
      <AIChatWidget />
      <AlertScheduler />
      <HealthCheckScheduler />
    </>
  );
}
