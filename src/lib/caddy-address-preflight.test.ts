// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({v4: vi.fn(), v6: vi.fn(), exec: vi.fn()}));
vi.mock("node:dns/promises", () => ({resolve4: m.v4, resolve6: m.v6}));
vi.mock("./host-exec", () => ({execOnHost: m.exec}));
import { currentPublicIpv4, verifyCaddyDns, execReadOnlyAddressProbe } from "./caddy-address-preflight";
beforeEach(() => {
  vi.resetAllMocks(); m.v4.mockResolvedValue(["8.8.8.8"]); m.v6.mockResolvedValue([]);
  m.exec.mockResolvedValue({code: 0, stdout: "", stderr: ""});
});
it("rejects a mixed A answer", async () => {
  m.v4.mockResolvedValue(["8.8.8.8", "1.1.1.1"]);
  await expect(verifyCaddyDns("gc.example.com", "8.8.8.8")).rejects.toMatchObject({code: "DNS_REQUIRED"});
  expect(m.exec).not.toHaveBeenCalled();
});
it("accepts matching normalized IPv6 and rejects stale AAAA", async () => {
  m.v6.mockResolvedValue(["2001:0db8:0:0:0:0:0:1"]);
  m.exec.mockResolvedValue({code: 0, stdout: "2: eth0 inet6 2001:db8::1/64 scope global", stderr: ""});
  await expect(verifyCaddyDns("gc.example.com", "8.8.8.8")).resolves.toBeUndefined();
  m.v6.mockResolvedValue(["2001:db8::2"]);
  await expect(verifyCaddyDns("gc.example.com", "8.8.8.8")).rejects.toThrow("not confirmed");
});
it("does not treat resolver outage as missing records", async () => {
  m.v6.mockRejectedValue(Object.assign(new Error("outage"), {code: "ESERVFAIL"}));
  await expect(verifyCaddyDns("gc.example.com", "8.8.8.8")).rejects.toThrow("Do not change records");
});
it("does not mistake missing host tools for absent IPv6", async () => {
  m.v6.mockResolvedValue(["2001:db8::1"]);
  m.exec.mockResolvedValue({code: 127, stdout: "", stderr: ""});
  await expect(verifyCaddyDns("gc.example.com", "8.8.8.8")).rejects.toThrow("ip command");
});
it("bounds public IP discovery on the actual host", async () => {
  m.exec.mockResolvedValue({code: 0, stdout: "8.8.8.8\n", stderr: ""});
  expect(await currentPublicIpv4()).toBe("8.8.8.8");
  expect(m.exec).toHaveBeenCalledWith(expect.stringContaining("--max-time 8"), {requireHost: true, timeout: 20000});
});

it.each(["ip -6 -o address show scope global", "ss -H -ltnp"])("bounds read-only %s even if transport ignores timeout", async command => {
  vi.useFakeTimers();
  try {
    m.exec.mockReturnValue(new Promise(() => {}));
    const result = execReadOnlyAddressProbe(command, 10000);
    const check = expect(result).rejects.toMatchObject({status: 504});
    await vi.advanceTimersByTimeAsync(10000);
    await check;
    expect(m.exec).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});
it("clears the deadline when a host probe completes early", async () => {
  vi.useFakeTimers();
  try {
    await execReadOnlyAddressProbe("ss -H -ltnp", 10000);
    expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});
