import { prisma } from "./prisma";
import { decrypt, isEncrypted } from "./crypto";

export interface FirstLaunchConfigKey { service: string; key: string; required: boolean }
export interface FirstLaunchConfigBinding extends FirstLaunchConfigKey { versionId: number; version: number }
export interface FirstLaunchConfiguration { version: 1; projectId: number; profileId: number; bindings: FirstLaunchConfigBinding[] }
const safeName = /^[A-Za-z_][A-Za-z0-9_]*$/;
function validateKeys(keys: FirstLaunchConfigKey[], services: string[]) {
  if (!Array.isArray(keys) || keys.length > 200) throw new Error("Choose at most 200 service configuration keys.");
  const seen = new Set<string>();
  for (const item of keys) {
    if (!item || !services.includes(item.service) || !safeName.test(item.key) || item.key.length > 128 || typeof item.required !== "boolean") throw new Error("Invalid service configuration declaration.");
    const identity = `${item.service}:${item.key}`;
    if (seen.has(identity)) throw new Error("Duplicate service configuration declaration.");
    seen.add(identity);
  }
}
async function requireProfile(userId: number, projectId: number, profileId: number) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.role !== "admin" || user.forcePasswordChange) throw new Error("Owner administrator access is required for configuration.");
  const profile = await prisma.deploymentEnvProfile.findFirst({ where: { id: profileId, projectId } });
  if (!profile || profile.providerType !== "local") throw new Error("Choose an encrypted local configuration profile for this project.");
  return profile;
}
/** Owner-only preparation. Returns references and missing key names, never values. */
export async function captureFirstLaunchConfiguration(userId: number, projectId: number, profileId: number, keys: FirstLaunchConfigKey[], services: string[]): Promise<{ configuration: FirstLaunchConfiguration; missing: FirstLaunchConfigKey[] }> {
  validateKeys(keys, services);
  await requireProfile(userId, projectId, profileId);
  const bindings: FirstLaunchConfigBinding[] = [], missing: FirstLaunchConfigKey[] = [];
  for (const item of keys) {
    const current = await prisma.deploymentEnvValue.findUnique({ where: { profileId_component_key: { profileId, component: item.service, key: item.key } } });
    if (!current || !isEncrypted(current.value)) { if (item.required) missing.push({ service: item.service, key: item.key, required: item.required }); continue; }
    const version = await prisma.deploymentEnvValueVersion.findUnique({ where: { profileId_component_key_version: { profileId, component: item.service, key: item.key, version: current.version } } });
    if (!version || version.state !== "active" || version.value !== current.value) throw new Error("Configuration changed while preparing review. Save and review again.");
    let plaintext: string;
    try { plaintext = decrypt(version.value); } catch { throw new Error("Configuration could not be decrypted."); }
    if (item.required && !plaintext) { missing.push({ service: item.service, key: item.key, required: item.required }); continue; }
    if (plaintext.includes("\0") || Buffer.byteLength(plaintext, "utf8") > 64 * 1024) throw new Error("Configuration contains unsupported content.");
    bindings.push({ service: item.service, key: item.key, required: item.required, versionId: version.id, version: version.version });
  }
  return { configuration: { version: 1, projectId, profileId, bindings: bindings.sort((a,b) => `${a.service}:${a.key}`.localeCompare(`${b.service}:${b.key}`)) }, missing };
}
/** Internal execution only. Never send returned values through MCP, logs, evidence or review payloads. */
export async function resolveFirstLaunchConfiguration(userId: number, binding: FirstLaunchConfiguration, projectId: number, services: string[]): Promise<Record<string, Record<string, string>>> {
  if (binding.version !== 1 || binding.projectId !== projectId) throw new Error("Approved configuration project changed.");
  validateKeys(binding.bindings, services);
  await requireProfile(userId, projectId, binding.profileId);
  const values: Record<string, Record<string, string>> = Object.create(null);
  for (const item of binding.bindings) {
    const version = await prisma.deploymentEnvValueVersion.findUnique({ where: { id: item.versionId } });
    const current = await prisma.deploymentEnvValue.findUnique({ where: { profileId_component_key: { profileId: binding.profileId, component: item.service, key: item.key } } });
    if (!version || version.profileId !== binding.profileId || version.component !== item.service || version.key !== item.key || version.version !== item.version || version.state !== "active" || !isEncrypted(version.value) || !current || current.version !== item.version || current.value !== version.value) throw new Error("Approved configuration was changed or removed. Review the new version before launch.");
    let plaintext: string;
    try { plaintext = decrypt(version.value); } catch { throw new Error("Approved configuration could not be decrypted."); }
    if (plaintext.includes("\0") || Buffer.byteLength(plaintext, "utf8") > 64 * 1024 || (item.required && !plaintext)) throw new Error("Approved configuration has an empty required value or unsupported content.");
    (values[item.service] ||= Object.create(null))[item.key] = plaintext;
  }
  return values;
}
