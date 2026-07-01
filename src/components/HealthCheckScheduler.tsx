"use client";

import { useEffect, useRef } from "react";

/**
 * Runs container health checks on a configurable interval.
 *
 * The scheduler fetches the HealthCheckConfig on mount, then polls
 * /api/health-checks/run at the configured interval. When the config
 * is disabled or no VPS is configured, the scheduler is a no-op.
 */
export default function HealthCheckScheduler() {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function setup() {
      try {
        const res = await fetch("/api/health-checks");
        if (!res.ok) return;
        const { config } = await res.json();
        if (cancelled || !config?.enabled) return;

        const intervalMs = Math.max(30, config.intervalSec || 60) * 1000;

        async function tick() {
          try {
            await fetch("/api/health-checks/run", { method: "POST" });
          } catch {
            // ignore background errors
          }
        }

        // Run an initial check on setup.
        tick();
        intervalRef.current = setInterval(tick, intervalMs);
      } catch {
        // Config or DB may not be ready — silently skip.
      }
    }

    setup();

    return () => {
      cancelled = true;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, []);

  return null;
}
