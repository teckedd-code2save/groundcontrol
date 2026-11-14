// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("./auth", () => ({ requireAuth: vi.fn(() => ({ id: 7 })) }));
import { ownerProposalRequest, boundedReviewBody } from "./agent-enrollment-http";
import { fetchPinnedCompose, normalizeOwnerReview } from "./agent-enrollment-review";
const input = { repositoryUrl: "https://github.com/example/service", revision: "a".repeat(40), runtime: "compose" as const, composePath: "deploy/compose.yml", workloadName: "test", serverId: null };
afterEach(() => vi.unstubAllGlobals());
it("requires exact origin for cookie mutations", () => {
  const url = "https://gc.example.test/api/agent-proposals/p/review";
  expect(() => ownerProposalRequest(new NextRequest(url), true)).toThrow("Same-origin");
  expect(() => ownerProposalRequest(new NextRequest(url, { headers: { origin: "https://evil.test" } }), true)).toThrow("Same-origin");
  expect(ownerProposalRequest(new NextRequest(url, { headers: { origin: "https://gc.example.test" } }), true)).toBe(7);
});
it("caps request bytes even without a declared content length", async () => {
  const req = new NextRequest("https://gc.test", { method: "POST", body: "a".repeat(8193) });
  await expect(boundedReviewBody(req)).rejects.toThrow("too large");
});
it("caps streamed source bytes and refuses non-GitHub URLs before fetch", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("a".repeat(256*1024+1))));
  await expect(fetchPinnedCompose(input)).rejects.toThrow("256 KiB");
  vi.mocked(fetch).mockClear();
  await expect(fetchPinnedCompose({ ...input, repositoryUrl: "http://127.0.0.1/secret" })).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
});
it("rejects unsolicited environment values in owner review", () => {
  expect(() => normalizeOwnerReview({ secrets: { password: "hidden" } })).toThrow("Unknown review field");
});
