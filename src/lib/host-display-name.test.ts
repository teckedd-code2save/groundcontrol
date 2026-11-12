import { afterEach, expect, it, vi } from "vitest";
import { hostDisplayName } from "./host-display-name";
afterEach(() => vi.unstubAllEnvs());
it.each(["local", "localhost", "127.0.0.1", "This computer", "", "::1"])("names server-local %s without implying the browser computer", name => {
  expect(hostDisplayName({ name, host: "127.0.0.1", isLocal: true }, false)).toBe("GroundControl server");
});
it("preserves explicitly named hosts and remote addresses", () => {
  expect(hostDisplayName({ name: "Azure staging", host: "127.0.0.1", isLocal: true }, false)).toBe("Azure staging");
  expect(hostDisplayName({ name: "local", host: "remote.example", isLocal: false }, false)).toBe("local");
  expect(hostDisplayName({ host: "remote.example", isLocal: false }, true)).toBe("remote.example");
});
it("uses a real saved hostname without discovering a container hostname", () => {
  expect(hostDisplayName({ name: "local", host: "gc-test.example", isLocal: true }, false)).toBe("GroundControl server (gc-test.example)");
});
it("preserves desktop names and fallback", () => {
  expect(hostDisplayName({ name: "This computer", isLocal: true }, true)).toBe("This computer");
  expect(hostDisplayName({ name: "local", isLocal: true }, true)).toBe("local");
  expect(hostDisplayName({ isLocal: true }, true)).toBe("This computer");
  expect(hostDisplayName(null, true)).toBe("Connection unavailable");
});
it("reads runtime mode per call without changing connection identity", () => {
  const host = Object.freeze({ name: "local", host: "127.0.0.1", isLocal: true });
  vi.stubEnv("GC_DESKTOP_MODE", "0"); expect(hostDisplayName(host)).toBe("GroundControl server");
  vi.stubEnv("GC_DESKTOP_MODE", "1"); expect(hostDisplayName(host)).toBe("local");
});
