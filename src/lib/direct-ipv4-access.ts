import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { HttpError } from "@/lib/errors";
import { execOnHost } from "@/lib/host-exec";
import { installClaimStatus } from "@/lib/install-claim";
import { prisma } from "@/lib/prisma";
import { DIRECT_IPV4_CADDY_VERSION, directIpv4Caddyfile, publicIpv4 } from "@/lib/direct-ipv4-policy";
import { isDesktopMode } from "@/lib/runtime";

const STAGE = "groundcontrol_direct_ipv4_stage";
const ACCESS_URL = "groundcontrol_public_url";
const MODE = "groundcontrol_publish_mode";
const VERIFIED = "groundcontrol_direct_ipv4_evidence";
const EVIDENCE = "groundcontrol_publish_evidence";
const HEX = /^[a-f0-9]{64}$/;

type Stage = {
  ip: string; instanceId: string; adminId: number; challenge: string;
  routeKey: string; signingKey: string; expiresAt: number; priorUrl: string; priorMode: string; guidedTrial?: boolean;
};
type ConfigDb = Pick<typeof prisma, "appConfig">;

async function get(db: ConfigDb, key: string) {
  return (await db.appConfig.findUnique({ where: { key } }))?.value || "";
}
async function put(db: ConfigDb, key: string, value: string) {
  await db.appConfig.upsert({ where: { key }, create: { key, value }, update: { value } });
}

export function directIpv4Enabled() {
  return !isDesktopMode() && (process.env.GC_EXPERIMENTAL_DIRECT_IPV4 === "1" || process.env.GC_INSTALLER_GUIDED_IPV4 === "1");
}

export function directIpv4GuidedEnabled() {
  return !isDesktopMode() && process.env.GC_INSTALLER_GUIDED_IPV4 === "1";
}

export async function directIpv4Active() {
  return await get(prisma, MODE) === "direct_ipv4";
}

export async function directIpv4Evidence() {
  if (!await directIpv4Active()) return null;
  const raw = await get(prisma, VERIFIED);
  return raw ? JSON.parse(raw) as { publicUrl: string; checkedAt: string; priorUrl: string } : null;
}

function stageFrom(raw: string): Stage | null {
  if (!raw) return null;
  const stage = JSON.parse(raw) as Stage;
  return stage.expiresAt > Date.now() ? stage : null;
}

function safeMatch(a: string | null, b: string) {
  return Boolean(a && HEX.test(a) && timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex")));
}

function proofFor(stage: Stage, phase: "trial" | "probe" = "probe") {
  const inputs = [stage.ip, stage.instanceId, stage.adminId, stage.challenge, stage.expiresAt];
  // Preserve the existing manual/probe protocol and bind guided adoption to the full trial route.
  if (phase === "trial") inputs.push("trial");
  return createHmac("sha256", Buffer.from(stage.signingKey, "hex")).update(JSON.stringify(inputs)).digest("hex");
}

export async function prepareDirectIpv4(ipInput: unknown, confirmed: unknown, adminId: number, guided: unknown = false) {
  if (!directIpv4Enabled()) throw new HttpError("Direct IPv4 rehearsal is not enabled.", 404);
  const guidedTrial = guided === true && directIpv4GuidedEnabled();
  if (guided === true && !guidedTrial) throw new HttpError("Guided IPv4 access is unavailable.", 409);
  const ip = publicIpv4(ipInput);
  if (!ip || confirmed !== true) throw new HttpError("Enter the reserved public IPv4 from your VPS provider and confirm inbound HTTPS.", 400);
  const claim = await installClaimStatus();
  if (!claim.claimed || claim.activeClaim) throw new HttpError("Finish claiming this instance first.", 409);

  // Host inspection only. Refuse ambiguous, non-loopback or multi-address
  // port mappings, and never install or update Caddy from this workflow.
  const check = await execOnHost(
    "set -eu; caddy version; docker port groundcontrol-web 3000/tcp",
    { requireHost: true }
  );
  const lines = check.stdout.trim().split(/\r?\n/);
  const port = Number(lines[1]?.match(/^127\.0\.0\.1:([1-9]\d{0,4})$/)?.[1]);
  if (check.code !== 0 || lines.length !== 2 ||
      lines[0]?.split(/\s+/)[0] !== `v${DIRECT_IPV4_CADDY_VERSION}` ||
      !Number.isInteger(port) || port > 65535 || port === 443) {
    throw new HttpError(`This rehearsal needs host Caddy ${DIRECT_IPV4_CADDY_VERSION} and a single loopback GroundControl port. No services were changed.`, 409);
  }

  return prisma.$transaction(async (tx) => {
    const priorUrl = await get(tx, ACCESS_URL);
    const priorMode = await get(tx, MODE);
    if ((priorMode && !["private", "quick_tunnel"].includes(priorMode)) ||
        (priorUrl && !/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/i.test(priorUrl))) {
      throw new HttpError("This rehearsal will not replace an existing durable address.", 409);
    }
    const keys = Array.from({ length: 3 }, () => randomBytes(32).toString("hex"));
    const stage: Stage = {
      ip, instanceId: claim.instanceId, adminId, challenge: keys[0], routeKey: keys[1],
      signingKey: keys[2], expiresAt: Date.now() + 30 * 60_000, priorUrl, priorMode, guidedTrial,
    };
    await put(tx, STAGE, JSON.stringify(stage));
    return {
      url: `https://${ip}`,
      instanceId: stage.instanceId,
      challenge: stage.challenge,
      guidedTrial,
      expiresAt: new Date(stage.expiresAt).toISOString(),
      caddyfile: directIpv4Caddyfile(ip, port, stage.routeKey),
    };
  });
}

// Public route; all invalid, expired, incorrect-origin and unconfigured
// attempts look identical. No request body, redirects, cookies or host fetch.
export async function issueDirectIpv4Proof(requestOrigin: string, challenge: string | null, routeKey: string | null, phase: string | null = null) {
  if (!directIpv4Enabled() || !challenge || !HEX.test(challenge) || !routeKey || !HEX.test(routeKey)) return null;
  const stage = stageFrom(await get(prisma, STAGE));
  if (!stage || requestOrigin !== `https://${stage.ip}` ||
      !safeMatch(challenge, stage.challenge) || !safeMatch(routeKey, stage.routeKey)) return null;
  if (phase === "trial" && !stage.guidedTrial) return null;
  if (phase !== null && phase !== "trial") return null;
  return proofFor(stage, phase === "trial" ? "trial" : "probe");
}

export async function adoptDirectIpv4(proof: unknown, confirmedExternal: unknown, adminId: number) {
  if (!directIpv4Enabled()) throw new HttpError("Direct IPv4 rehearsal is not enabled.", 404);
  if (typeof proof !== "string" || !HEX.test(proof) || confirmedExternal !== true) {
    throw new HttpError("Run verification from another machine and enter its proof.", 400);
  }
  const claim = await installClaimStatus();
  return prisma.$transaction(async (tx) => {
    const stage = stageFrom(await get(tx, STAGE));
    if (!stage || stage.adminId !== adminId || !claim.claimed || claim.activeClaim ||
        claim.instanceId !== stage.instanceId || !safeMatch(proof, proofFor(stage, stage.guidedTrial ? "trial" : "probe"))) {
      throw new HttpError("That proof is invalid or expired. Prepare a fresh check.", 409);
    }
    if (stage.guidedTrial && stage.expiresAt - Date.now() < 60_000) {
      throw new HttpError("The sign-in trial is about to expire. Keep recovery and prepare a fresh check.", 409);
    }
    if (await get(tx, ACCESS_URL) !== stage.priorUrl || await get(tx, MODE) !== stage.priorMode) {
      throw new HttpError("Access changed during verification. The saved address was not replaced.", 409);
    }
    const publicUrl = `https://${stage.ip}`;
    const checkedAt = new Date().toISOString();
    await put(tx, ACCESS_URL, publicUrl);
    await put(tx, MODE, "direct_ipv4");
    await put(tx, EVIDENCE, ""); // Prior route health is not evidence about the new IP.
    await put(tx, VERIFIED, JSON.stringify({ publicUrl, checkedAt, priorUrl: stage.priorUrl, priorMode: stage.priorMode }));
    await put(tx, STAGE, "");
    return { publicUrl, mode: "direct_ipv4" as const, priorUrl: stage.priorUrl, checkedAt };
  });
}

// This only restores saved app state after an explicit operator statement.
// GroundControl cannot independently prove the operator-owned route is gone.
export async function forgetDirectIpv4(routeRemoved: unknown) {
  if (routeRemoved !== true) throw new HttpError("Confirm you removed the operator-managed Caddy route first.", 400);
  return prisma.$transaction(async (tx) => {
    const raw = await get(tx, VERIFIED);
    const previous = raw && JSON.parse(raw) as { publicUrl: string; priorUrl: string; priorMode: string };
    if (await get(tx, MODE) !== "direct_ipv4" || !previous ||
        await get(tx, ACCESS_URL) !== previous.publicUrl) {
      throw new HttpError("No matching saved direct IPv4 address to forget.", 409);
    }
    const priorUrl = previous.priorUrl || "";
    const priorMode = previous.priorMode || (priorUrl ? "quick_tunnel" : "private");
    await put(tx, ACCESS_URL, priorUrl);
    await put(tx, MODE, priorMode);
    await put(tx, VERIFIED, "");
    await put(tx, EVIDENCE, "");
    return { publicUrl: priorUrl || null, mode: priorMode, operatorAttestedRemoval: true };
  });
}
