export type ComposeProjectTarget = {
  projectPath: string;
  projectSlug: string;
  service?: string;
  source: "labels" | "config" | "request";
};

function normalizePath(value?: string | null): string {
  return String(value || "").trim().replace(/\/+$/, "");
}

/**
 * A browser-supplied path is only a hint. Live Compose labels and the
 * server-side project record are fresher and must be tried first.
 */
export function composeProjectCandidates(
  resolved: Omit<ComposeProjectTarget, "source"> & { source: "labels" | "config" },
  requestedPath?: string | null
): ComposeProjectTarget[] {
  const candidates: ComposeProjectTarget[] = [{
    ...resolved,
    projectPath: normalizePath(resolved.projectPath),
  }];
  const explicit = normalizePath(requestedPath);
  if (explicit && !candidates.some((candidate) => candidate.projectPath === explicit)) {
    candidates.push({
      projectPath: explicit,
      projectSlug: resolved.projectSlug,
      service: resolved.service,
      source: "request",
    });
  }
  return candidates.filter((candidate) => Boolean(candidate.projectPath));
}

export function requestedComposePathForCandidate(
  requestedComposePath: string | null | undefined,
  projectPath: string
): string | undefined {
  const requested = normalizePath(requestedComposePath);
  const root = normalizePath(projectPath);
  return requested && requested.startsWith(`${root}/`) ? requested : undefined;
}
