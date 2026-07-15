export interface PublicEndpointVerification {
  domain: string;
  httpStatus: number | null;
  reachable: boolean;
  result: string;
}

export function parsePublicEndpointCheck(domain: string, output: string): PublicEndpointVerification {
  const trimmed = output.trim();
  const match = trimmed.match(/(?:^|\n)(\d{3})\|([^\n]*)$/);
  const httpStatus = match ? Number(match[1]) : null;
  const reachable = httpStatus !== null && httpStatus >= 200 && httpStatus < 500;
  return {
    domain,
    httpStatus,
    reachable,
    result: reachable
      ? `HTTP ${httpStatus}${match?.[2] ? ` via ${match[2]}` : ""}`
      : trimmed || "DNS or public endpoint did not resolve",
  };
}

export function deploymentVerificationStatus(
  domains: string[],
  dnsResult: unknown,
  checks: PublicEndpointVerification[]
): { status: "success" | "degraded"; publicVerified: boolean; error: string | null } {
  if (domains.length === 0) return { status: "success", publicVerified: true, error: null };
  const dnsError = dnsResult && typeof dnsResult === "object" && !Array.isArray(dnsResult)
    && "error" in dnsResult ? String((dnsResult as { error: unknown }).error) : null;
  const failed = checks.filter((check) => !check.reachable);
  if (!dnsError && failed.length === 0 && checks.length === domains.length) {
    return { status: "success", publicVerified: true, error: null };
  }
  const detail = dnsError || failed.map((check) => `${check.domain}: ${check.result}`).join("; ")
    || "The public endpoint could not be verified";
  return { status: "degraded", publicVerified: false, error: detail };
}
