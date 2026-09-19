// @vitest-environment node
import { describe, expect, it } from "vitest";
import { normalizePublicHostname } from "./instance-publish";

describe("GroundControl instance publishing", () => {
  it("normalizes a public hostname", () => {
    expect(normalizePublicHostname(" GC.Example.COM. ")).toBe("gc.example.com");
  });

  it.each([
    "localhost",
    "127.0.0.1",
    "192.168.1.20",
    "example",
    "-bad.example.com",
    "bad_.example.com",
  ])("rejects a non-public or invalid hostname: %s", (hostname) => {
    expect(() => normalizePublicHostname(hostname)).toThrow();
  });
});
