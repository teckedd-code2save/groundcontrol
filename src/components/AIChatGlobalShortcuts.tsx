"use client";

import { useEffect } from "react";

/**
 * Registers the global AI chat shortcut (Ctrl/Cmd+Shift+G) at the layout level.
 * The actual widget listens for the resulting custom event so state stays
 * co-located in AIChatWidget.
 */
export default function AIChatGlobalShortcuts() {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "g") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("gc:ai-chat-toggle"));
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return null;
}
