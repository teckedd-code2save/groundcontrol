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

describe("Assigned HTTPS origin policy", () => {
  it.each(["https://my-name.ngrok-free.dev", "https://my-name.ngrok-free.app/"])("accepts an assigned origin %s", async (value) => {
    const { normalizeAssignedHttpsUrl } = await import("./instance-publish");
    expect(normalizeAssignedHttpsUrl(value)).toBe(new URL(value).origin);
  });
  it.each(["http://my-name.ngrok-free.dev", "https://ngrok-free.dev", "https://x.y.ngrok-free.dev", "https://x.ngrok-free.dev.evil.test", "https://x.ngrok-free.dev:443", "https://x.ngrok-free.dev/path", "https://x.ngrok-free.dev?x=1", "https://x.ngrok-free.dev#x", "https://user@x.ngrok-free.dev", "https://127.0.0.1", "https://x.ngrok-free.dev\\\\@evil.test"])("rejects %s before network activity", async (value) => {
    const { normalizeAssignedHttpsUrl } = await import("./instance-publish");
    expect(() => normalizeAssignedHttpsUrl(value)).toThrow();
  });
});
