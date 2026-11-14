import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "./auth";
import { requestOrigin } from "./oauth";
/** Cookie mutations require the browser's exact origin, never wildcard or absent Origin. */
export function ownerProposalRequest(req: NextRequest, mutation = false) {
  const user = requireAuth(req);
  if (mutation) {
    const origin = req.headers.get("origin");
    if (!origin || origin !== requestOrigin(req) || (req.headers.get("sec-fetch-site") && !["same-origin", "none"].includes(req.headers.get("sec-fetch-site")!))) throw new Error("Same-origin browser request required");
  }
  return user.id;
}
export async function boundedReviewBody(req: NextRequest) {
  if (Number(req.headers.get("content-length") || 0) > 8192) throw new Error("Review request too large");
  if (!req.body) throw new Error("Expected review body");
  const reader = req.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 8192) throw new Error("Review request too large");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => undefined); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}
export function ownerProposalError(error: unknown) {
  // Errors originate from bounded validation; avoid reflecting provider responses or stack traces.
  const message = error instanceof Error ? error.message : "Cannot process deployment review";
  const safe = /^(Unauthorized|Same-origin|Expected|Unknown review|Invalid|Choose|Use |Initial launches|Explicit|The health|Deployment proposals|A current|Proposal |Review |This proposal|Server configuration|Deployment path|Cannot fetch|Compose file|Review request)/.test(message) ? message : "Cannot process deployment review. Check the proposal and try again.";
  return NextResponse.json({ error: safe }, { status: message === "Unauthorized" ? 401 : message.startsWith("Same-origin") ? 403 : 400, headers: { "Cache-Control": "no-store" } });
}
