// @vitest-environment node
import { describe, expect, it } from "vitest";
import { hashInstallClaimToken, validInstallClaimToken } from "./install-claim";

describe("install claims", () => {
  it("accepts only GroundControl claim token shapes", () => {
    expect(validInstallClaimToken("gc_claim_abcdefghijklmnopqrstuvwxyzABCDE12345_-")).toBe(true);
    expect(validInstallClaimToken("not-a-claim")).toBe(false);
    expect(validInstallClaimToken("gc_claim_short")).toBe(false);
  });

  it("hashes claim tokens deterministically without preserving the raw token", () => {
    const token = "gc_claim_abcdefghijklmnopqrstuvwxyzABCDE12345_-";
    const digest = hashInstallClaimToken(token);
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(digest).not.toContain(token);
    expect(hashInstallClaimToken(token)).toBe(digest);
  });
});
