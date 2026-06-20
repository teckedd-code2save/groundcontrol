/**
 * Synchronize Terraform outputs into GroundControl's VpsConfig records.
 *
 * When a Terraform stack provisions a VPS, this module creates or updates a
 * VpsConfig so the new host is immediately manageable through GroundControl.
 */

import { prisma } from "@/lib/prisma";
import { encryptIfNeeded } from "@/lib/crypto";
import type { TerraformStack } from "./types";

export interface TerraformOutputs {
  server_ip?: { value: string };
  ssh_port?: { value: number };
  ssh_user?: { value: string };
  ssh_key?: { value: string };
  cloudrun_url?: { value: string };
  dns_record?: { value: string };
  [key: string]: unknown;
}

function getOutputValue(
  outputs: Record<string, unknown>,
  key: string
): unknown {
  const raw = outputs[key];
  if (raw && typeof raw === "object" && "value" in (raw as Record<string, unknown>)) {
    return (raw as Record<string, unknown>).value;
  }
  return raw;
}

/**
 * Find an existing VpsConfig linked to a Terraform stack, or one whose host
 * matches the provisioned server IP.
 */
export async function findExistingTerraformVps(
  stackId: number,
  serverIp?: string
) {
  if (serverIp) {
    const byIp = await prisma.vpsConfig.findFirst({
      where: { host: serverIp },
    });
    if (byIp) return byIp;
  }

  // Match by name pattern for now. Future: add terraformStackId to VpsConfig.
  const byName = await prisma.vpsConfig.findFirst({
    where: { name: `terraform-${stackId}` },
  });
  return byName;
}

/**
 * Create or update a VpsConfig from Terraform outputs.
 */
export async function syncTerraformVpsConfig(
  stack: TerraformStack,
  outputs: Record<string, unknown>
): Promise<{ vpsConfigId: number; created: boolean } | null> {
  const serverIp = String(getOutputValue(outputs, "server_ip") || "").trim();
  const sshPort = Number(getOutputValue(outputs, "ssh_port") || 22);
  const sshUser = String(getOutputValue(outputs, "ssh_user") || "root");
  const sshKey = String(getOutputValue(outputs, "ssh_key") || "");

  if (!serverIp) {
    // Not a VPS-provisioning stack (e.g. Cloud Run only).
    return null;
  }

  const existing = await findExistingTerraformVps(stack.id, serverIp);
  const data = {
    name: existing?.name || `terraform-${stack.id}`,
    host: serverIp,
    port: sshPort || 22,
    username: sshUser || "root",
    privateKey: sshKey ? (encryptIfNeeded(sshKey) as string) : existing?.privateKey,
    authType: sshKey ? "key" : (existing?.authType ?? "key"),
    isLocal: false,
  };

  if (existing) {
    const updated = await prisma.vpsConfig.update({
      where: { id: existing.id },
      data,
    });
    return { vpsConfigId: updated.id, created: false };
  }

  const created = await prisma.vpsConfig.create({ data });
  return { vpsConfigId: created.id, created: true };
}
