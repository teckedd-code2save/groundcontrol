import { afterEach, beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => {
  const data = new Map<string, string>();
  const exec = vi.fn();
  const claim = vi.fn();
  const appConfig = {
    findUnique: async ({ where }: { where: { key: string } }) => ({ value: data.get(where.key) }),
    upsert: async ({ where, update }: { where: { key: string }; update: { value: string } }) => {
      data.set(where.key, update.value);
    },
  };
  return { data, exec, claim, appConfig };
});
vi.mock("@/lib/prisma", () => ({ prisma: { appConfig: m.appConfig, $transaction: (fn: (tx: unknown) => unknown) => fn({ appConfig: m.appConfig }) } }));
vi.mock("@/lib/host-exec", () => ({ execOnHost: m.exec }));
vi.mock("@/lib/install-claim", () => ({ installClaimStatus: m.claim }));
vi.mock("@/lib/runtime", () => ({ isDesktopMode: () => false }));

import { adoptDirectIpv4, forgetDirectIpv4, issueDirectIpv4Proof, prepareDirectIpv4 } from "./direct-ipv4-access";

const urlKey = "groundcontrol_public_url";
const modeKey = "groundcontrol_publish_mode";
const oldUrl = "https://prior.trycloudflare.com";
const ip = "8.8.8.8";

beforeEach(() => {
  vi.stubEnv("GC_EXPERIMENTAL_DIRECT_IPV4", "1");
  m.data.clear();
  m.exec.mockReset();
  m.claim.mockReset();
  m.exec.mockResolvedValue({ code: 0, stdout: "v2.11.9 checksum\n127.0.0.1:3003\n" });
  m.claim.mockResolvedValue({ claimed: true, activeClaim: null, instanceId: "instance-a" });
  m.data.set(urlKey, oldUrl);
  m.data.set(modeKey, "quick_tunnel");
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

async function staged() {
  const candidate = await prepareDirectIpv4(ip, true, 1);
  const routeKey = candidate.caddyfile.match(/X-GroundControl-IP-Route ([a-f0-9]{64})/)?.[1] || "";
  const proof = await issueDirectIpv4Proof(candidate.url, candidate.challenge, routeKey);
  return { candidate, routeKey, proof };
}

it("does not inspect host or change access on unconfirmed/invalid input", async () => {
  await expect(prepareDirectIpv4(ip, false, 1)).rejects.toMatchObject({ status: 400 });
  await expect(prepareDirectIpv4("127.0.0.1", true, 1)).rejects.toMatchObject({ status: 400 });
  expect(m.exec).not.toHaveBeenCalled();
  expect(m.data.get(urlKey)).toBe(oldUrl);
});
it.each(["v2.11.8 sha\n127.0.0.1:3003", "v2.11.9 sha\n0.0.0.0:3003",
  "v2.11.9 sha\n127.0.0.1:3003\n[::]:3003", "v2.11.9 sha\n127.0.0.1:443"])(
  "refuses incompatible Caddy or unsafe port mapping %s", async (stdout) => {
    m.exec.mockResolvedValue({ code: 0, stdout });
    await expect(prepareDirectIpv4(ip, true, 1)).rejects.toMatchObject({ status: 409 });
    expect(m.data.get(urlKey)).toBe(oldUrl);
  }
);
it("requires a claimed instance and preserves an existing durable identity", async () => {
  m.claim.mockResolvedValueOnce({ claimed: false });
  await expect(prepareDirectIpv4(ip, true, 1)).rejects.toMatchObject({ status: 409 });
  m.data.set(modeKey, "caddy");
  m.data.set(urlKey, "https://existing.example.com");
  await expect(prepareDirectIpv4(ip, true, 1)).rejects.toMatchObject({ status: 409 });
  expect(m.data.get(urlKey)).toBe("https://existing.example.com");
});
it("ties candidate proof to exact HTTPS origin, challenge and staged route", async () => {
  const { candidate, routeKey, proof } = await staged();
  expect(proof).toMatch(/^[a-f0-9]{64}$/);
  expect(await issueDirectIpv4Proof(oldUrl, candidate.challenge, routeKey)).toBe(null);
  expect(await issueDirectIpv4Proof(`http://${ip}`, candidate.challenge, routeKey)).toBe(null);
  expect(await issueDirectIpv4Proof(candidate.url, candidate.challenge, null)).toBe(null);
  expect(await issueDirectIpv4Proof(candidate.url, "a".repeat(64), routeKey)).toBe(null);
  expect(m.data.get(urlKey)).toBe(oldUrl);
});
it("requires same admin, external confirmation and a one-time verified receipt", async () => {
  m.data.set("groundcontrol_publish_evidence", "old route's evidence");
  const { proof } = await staged();
  await expect(adoptDirectIpv4(proof, true, 2)).rejects.toMatchObject({ status: 409 });
  await expect(adoptDirectIpv4(proof, false, 1)).rejects.toMatchObject({ status: 400 });
  expect(await adoptDirectIpv4(proof, true, 1)).toMatchObject({ mode: "direct_ipv4", publicUrl: `https://${ip}`, priorUrl: oldUrl });
  await expect(adoptDirectIpv4(proof, true, 1)).rejects.toMatchObject({ status: 409 });
  expect(m.data.get("groundcontrol_publish_evidence")).toBe("");
  expect(m.exec).toHaveBeenCalledExactlyOnceWith(
    "set -eu; caddy version; docker port groundcontrol-web 3000/tcp",
    { requireHost: true }
  );
});
it("leaves saved identity untouched if it changes before adoption", async () => {
  const { proof } = await staged();
  m.data.set(urlKey, "https://changed.trycloudflare.com");
  await expect(adoptDirectIpv4(proof, true, 1)).rejects.toMatchObject({ status: 409 });
  expect(m.data.get(urlKey)).toBe("https://changed.trycloudflare.com");
});
it("rejects expired staged proofs", async () => {
  vi.useFakeTimers();
  const { candidate, routeKey, proof } = await staged();
  vi.advanceTimersByTime(30 * 60_000);
  expect(await issueDirectIpv4Proof(candidate.url, candidate.challenge, routeKey)).toBe(null);
  await expect(adoptDirectIpv4(proof, true, 1)).rejects.toMatchObject({ status: 409 });
});

it("lets an operator restore prior state without implying the Caddy site was removed", async () => {
  const { proof } = await staged();
  await adoptDirectIpv4(proof, true, 1);
  await expect(forgetDirectIpv4(false)).rejects.toMatchObject({ status: 400 });
  expect(m.data.get(modeKey)).toBe("direct_ipv4");
  await expect(forgetDirectIpv4(true)).resolves.toMatchObject({
    publicUrl: oldUrl, mode: "quick_tunnel", operatorAttestedRemoval: true,
  });
  expect(m.data.get(urlKey)).toBe(oldUrl);
  expect(m.exec).toHaveBeenCalledTimes(1);
});


it("requires phase-specific proof from the short full-route trial before guided adoption", async () => {
  vi.stubEnv("GC_INSTALLER_GUIDED_IPV4", "1");
  const candidate = await prepareDirectIpv4(ip, true, 1, true);
  const routeKey = candidate.caddyfile.match(/X-GroundControl-IP-Route ([a-f0-9]{64})/)?.[1] || "";
  const probe = await issueDirectIpv4Proof(candidate.url, candidate.challenge, routeKey);
  expect(candidate.guidedTrial).toBe(true);
  expect(probe).toMatch(/^[a-f0-9]{64}$/);
  await expect(adoptDirectIpv4(probe, true, 1)).rejects.toMatchObject({ status: 409 });
  expect(m.data.get(urlKey)).toBe(oldUrl);
  const full = await issueDirectIpv4Proof(candidate.url, candidate.challenge, routeKey, "trial");
  expect(full).toMatch(/^[a-f0-9]{64}$/);
  expect(full).not.toBe(probe);
  expect(await issueDirectIpv4Proof(candidate.url, candidate.challenge, routeKey, "guess")).toBeNull();
  await expect(adoptDirectIpv4(full, true, 1)).resolves.toMatchObject({ publicUrl: candidate.url, priorUrl: oldUrl });
});
