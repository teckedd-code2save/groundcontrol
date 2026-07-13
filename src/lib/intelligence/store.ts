/**
 * Process-local Loop engine store.
 * Persists across requests in the same Node process (dev/server).
 * Fixture-friendly and avoids requiring a Prisma migration for the core loop path.
 */

import {
  createEngineState,
  type LoopEngineState,
} from "./orchestrator";
import type { LoopRun } from "./types";

const g = globalThis as unknown as {
  __gcLoopEngine?: LoopEngineState;
};

export function getLoopEngine(): LoopEngineState {
  if (!g.__gcLoopEngine) {
    g.__gcLoopEngine = createEngineState();
  }
  return g.__gcLoopEngine;
}

export function setLoopEngine(state: LoopEngineState): void {
  g.__gcLoopEngine = state;
}

export function resetLoopEngine(): void {
  g.__gcLoopEngine = createEngineState();
}

export function listRuns(): LoopRun[] {
  return Array.from(getLoopEngine().runs.values()).sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

export function getRun(id: string): LoopRun | undefined {
  return getLoopEngine().runs.get(id);
}
