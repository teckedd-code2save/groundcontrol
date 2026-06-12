"use client";

import { useEffect } from "react";

export default function AlertScheduler() {
  useEffect(() => {
    async function evaluate() {
      try {
        await fetch("/api/alert-rules/evaluate", { method: "POST" });
      } catch {
        // ignore background errors
      }
    }

    evaluate();
    const interval = setInterval(evaluate, 60000);
    return () => clearInterval(interval);
  }, []);

  return null;
}
