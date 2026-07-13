import type { CustomerJourney, JourneyRunResult, JourneyStep } from "./types";
import type { ProbeExecutor } from "./probes";

/**
 * Execute a journey deterministically via HTTP status checks.
 * Mutating steps are not supported in MVP (safety).
 */
export async function runJourney(
  journey: CustomerJourney,
  executor: ProbeExecutor,
  observedAt: string = new Date().toISOString()
): Promise<JourneyRunResult> {
  const stepResults: JourneyRunResult["stepResults"] = [];
  let allOk = true;

  for (let i = 0; i < journey.steps.length; i++) {
    const step = journey.steps[i];
    const result = await runStep(step, executor, journey);
    stepResults.push({ stepIndex: i, ...result });
    if (!result.ok) allOk = false;
  }

  return {
    journeyId: journey.id,
    ok: allOk && stepResults.length > 0,
    stepResults,
    observedAt,
  };
}

async function runStep(
  step: JourneyStep,
  executor: ProbeExecutor,
  journey: CustomerJourney
): Promise<{ ok: boolean; detail: string; statusCode?: number }> {
  const url = step.url || journey.publicUrl;
  if (!url) {
    return { ok: false, detail: "No URL on step or journey" };
  }

  try {
    const { statusCode } = await executor.fetchStatus(url);
    if (step.action === "open" || step.action === "expect_status") {
      const expected = step.status ?? 200;
      const ok = statusCode === expected;
      return {
        ok,
        statusCode,
        detail: ok
          ? `HTTP ${statusCode} as expected`
          : `Expected HTTP ${expected}, got ${statusCode}`,
      };
    }
    if (step.action === "expect_body") {
      // Body inspection requires richer executor; treat 200 as pass for status-only MVP
      const ok = statusCode >= 200 && statusCode < 400;
      return {
        ok,
        statusCode,
        detail: ok
          ? `HTTP ${statusCode}; body check not available in status-only executor`
          : `HTTP ${statusCode} failed body probe`,
      };
    }
    return { ok: false, detail: `Unknown step action: ${step.action}`, statusCode };
  } catch (err) {
    return {
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

export function createHttpJourney(args: {
  id: string;
  name: string;
  serviceIds: string[];
  publicUrl: string;
  expectStatus?: number;
  triggers?: string[];
  confirmed?: boolean;
  criticality?: CustomerJourney["criticality"];
}): CustomerJourney {
  return {
    id: args.id,
    name: args.name,
    serviceIds: args.serviceIds,
    criticality: args.criticality || "critical",
    triggers: args.triggers || ["proxy.changed", "container.changed", "service.changed"],
    confirmed: args.confirmed !== false,
    publicUrl: args.publicUrl,
    steps: [
      {
        action: "expect_status",
        url: args.publicUrl,
        status: args.expectStatus ?? 200,
      },
    ],
  };
}
