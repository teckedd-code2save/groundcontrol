/**
 * Gemini investigation provider — structured investigation only.
 * Never executes host commands; never returns freeform shell for execOnVps.
 */

import type {
  Investigation,
  JourneyRunResult,
  LastKnownHealthy,
  OperationalEvent,
  ServiceGraph,
} from "../types";
import { investigateDeterministic } from "../investigation";
import { listServicePaths } from "../service-graph";

export interface GeminiInvestigateArgs {
  graph: ServiceGraph;
  events: OperationalEvent[];
  journeyResults: JourneyRunResult[];
  lastHealthy?: LastKnownHealthy | null;
  proxyRevisionId?: string;
  previousArtifactRef?: string;
  domain?: string;
  apiKey?: string;
  model?: string;
}

/**
 * Structured JSON schema we ask Gemini to fill. Application validates before use.
 */
export const INVESTIGATION_JSON_SCHEMA_HINT = `{
  "symptom": string,
  "customerImpact": string,
  "confirmedConcept": string | null,
  "confirmedCause": string | null,
  "uncertainty": string[],
  "hypotheses": Array<{
    "id": string,
    "statement": string,
    "supportingEvidenceIds": string[],
    "contradictingEvidenceIds": string[],
    "confidence": number,
    "status": "open" | "confirmed" | "rejected",
    "concept"?: string
  }>
}`;

function getGeminiKey(explicit?: string): string | undefined {
  return (
    explicit ||
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_AI_API_KEY ||
    process.env.GOOGLE_API_KEY
  );
}

/**
 * Call Gemini generateContent with a strict instruction to return JSON only.
 * Falls back to deterministic investigation on any failure or missing key.
 */
export async function investigateWithGemini(
  args: GeminiInvestigateArgs
): Promise<Investigation> {
  const fallback = investigateDeterministic(args);
  const apiKey = getGeminiKey(args.apiKey);
  if (!apiKey) {
    return { ...fallback, provider: "deterministic" };
  }

  const model = args.model || process.env.GEMINI_MODEL || "gemini-2.0-flash";
  const paths = listServicePaths(args.graph);
  const prompt = [
    "You are GroundControl Loop. Produce a structured infrastructure investigation.",
    "Return ONLY valid JSON matching this shape:",
    INVESTIGATION_JSON_SCHEMA_HINT,
    "Rules:",
    "- Cite only evidence ids provided below.",
    "- Never invent secrets, credentials, or shell commands.",
    "- Prefer reverse-proxy / container topology causes for 502/503.",
    "- Set confirmedConcept to one of: wrong_upstream_port, container_not_running, no_container_match, ambiguous_external_failure, no_fault_detected when applicable.",
    "",
    "Evidence context (sanitized):",
    JSON.stringify(
      {
        domain: args.domain,
        paths,
        events: args.events.map((e) => ({
          id: e.id,
          kind: e.kind,
          serviceIds: e.serviceIds,
          beforeRef: e.beforeRef,
          afterRef: e.afterRef,
          meta: e.meta,
        })),
        journeyResults: args.journeyResults,
        lastHealthy: args.lastHealthy
          ? {
              serviceId: args.lastHealthy.serviceId,
              snapshot: args.lastHealthy.snapshot,
              proxyRevisionId: args.lastHealthy.proxyRevisionId,
            }
          : null,
        deterministicHint: {
          confirmedConcept: fallback.confirmedConcept,
          hypotheses: fallback.hypotheses.map((h) => ({
            concept: h.concept,
            status: h.status,
            statement: h.statement,
          })),
          evidenceIds: fallback.evidence.map((e) => e.id),
        },
      },
      null,
      2
    ),
  ].join("\n");

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json",
        },
      }),
    });
    if (!res.ok) {
      return {
        ...fallback,
        provider: "hybrid",
        uncertainty: [
          ...fallback.uncertainty,
          `Gemini HTTP ${res.status}; used deterministic investigation`,
        ],
      };
    }
    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text =
      data.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") ||
      "";
    const parsed = JSON.parse(extractJson(text)) as {
      symptom?: string;
      customerImpact?: string;
      confirmedConcept?: string | null;
      confirmedCause?: string | null;
      uncertainty?: string[];
      hypotheses?: Investigation["hypotheses"];
    };

    // Merge: keep deterministic evidence + recommended action (policy-safe).
    // Gemini may refine narrative and hypotheses, but cannot invent shell actions.
    const evidenceIds = new Set(fallback.evidence.map((e) => e.id));
    const hypotheses = (parsed.hypotheses || fallback.hypotheses).map((h) => ({
      ...h,
      supportingEvidenceIds: (h.supportingEvidenceIds || []).filter((id) =>
        evidenceIds.has(id)
      ),
      contradictingEvidenceIds: (h.contradictingEvidenceIds || []).filter((id) =>
        evidenceIds.has(id)
      ),
      confidence: Math.min(1, Math.max(0, Number(h.confidence) || 0)),
    }));

    return {
      symptom: parsed.symptom || fallback.symptom,
      customerImpact: parsed.customerImpact || fallback.customerImpact,
      hypotheses: hypotheses.length ? hypotheses : fallback.hypotheses,
      confirmedCause: parsed.confirmedCause || fallback.confirmedCause,
      confirmedConcept:
        parsed.confirmedConcept || fallback.confirmedConcept || undefined,
      uncertainty: [
        ...(parsed.uncertainty || []),
        ...fallback.uncertainty.filter(
          (u) => !(parsed.uncertainty || []).includes(u)
        ),
      ],
      // Always keep deterministic allowlisted action plan
      recommendedAction: fallback.recommendedAction,
      evidence: fallback.evidence,
      provider: "hybrid",
    };
  } catch (err) {
    return {
      ...fallback,
      provider: "hybrid",
      uncertainty: [
        ...fallback.uncertainty,
        `Gemini error: ${err instanceof Error ? err.message : String(err)}; deterministic used`,
      ],
    };
  }
}

function extractJson(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) return trimmed;
  const m = trimmed.match(/\{[\s\S]*\}/);
  return m ? m[0] : trimmed;
}

/** Pure helper for tests — merge gemini-shaped payload with deterministic base. */
export function mergeGeminiInvestigation(
  base: Investigation,
  parsed: Partial<Investigation>
): Investigation {
  return {
    ...base,
    symptom: parsed.symptom || base.symptom,
    customerImpact: parsed.customerImpact || base.customerImpact,
    hypotheses: parsed.hypotheses?.length ? parsed.hypotheses : base.hypotheses,
    confirmedCause: parsed.confirmedCause ?? base.confirmedCause,
    confirmedConcept: parsed.confirmedConcept ?? base.confirmedConcept,
    uncertainty: parsed.uncertainty || base.uncertainty,
    recommendedAction: base.recommendedAction,
    evidence: base.evidence,
    provider: "hybrid",
  };
}
