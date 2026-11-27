// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({ host: vi.fn(), container: vi.fn(), fallback: vi.fn() }));
vi.mock("../host-exec", () => ({ execOnTargetStrict: f.host }));
vi.mock("../vps", () => ({ execOnVps: f.container, getActiveVps: async () => null, shQuote: (value: string) => `'${value}'` }));
vi.mock("../bootstrap", () => ({ getServerIp: f.fallback }));
import { getVpsPublicIp } from "./utils";
const host = { id: 1, host: "203.0.113.10", isLocal: true, port: 22, username: "root" };
beforeEach(() => {
  vi.clearAllMocks();
  f.host.mockResolvedValue({ code: 0, stdout: "203.0.113.10\n", stderr: "" });
  f.container.mockResolvedValue({ code: 127, stdout: "", stderr: "curl: not found" });
  f.fallback.mockResolvedValue("172.18.0.2");
});
it("uses an explicitly configured public IPv4 without depending on tools inside the app container", async () => {
  expect(await getVpsPublicIp(host)).toBe("203.0.113.10");
  expect(f.container).not.toHaveBeenCalled();
});
it("discovers a local host address on that host and requests IPv4 for A records", async () => {
  expect(await getVpsPublicIp({ ...host, host: "127.0.0.1" })).toBe("203.0.113.10");
  expect(f.host).toHaveBeenCalledWith(expect.stringContaining("curl -4"), expect.objectContaining({ host: "127.0.0.1" }));
  expect(f.container).not.toHaveBeenCalled();
});
it("never offers a private container/interface address as public DNS fallback", async () => {
  f.host.mockResolvedValue({ code: 1, stdout: "", stderr: "network unavailable" });
  expect(await getVpsPublicIp({ ...host, host: "172.18.0.2" })).toBe("");
});
