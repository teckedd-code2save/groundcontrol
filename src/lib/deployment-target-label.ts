export function isTemplateManagedTarget(target?: { name?: string | null; configJson?: string | null } | null): boolean {
  if (!target) return false;
  if (String(target.name || "").startsWith("Template: ")) return true;
  try {
    const config = JSON.parse(target.configJson || "{}") as { managedBy?: unknown };
    return config.managedBy === "template-deploy";
  } catch {
    return false;
  }
}

export function deploymentTargetDisplayName(target?: { name?: string | null; type?: string | null; configJson?: string | null } | null): string {
  if (!target) return "Deployment";
  if (isTemplateManagedTarget(target)) {
    return /static/i.test(target.type || "") ? "Static site" : "Docker Compose";
  }
  return target.name || target.type || "Deployment";
}
