import type {
  HostObservation,
  PathEvidenceStep,
  PathInspection,
  ProbeResult,
  ServicePath,
} from "./types";

interface InternalProbe {
  target: string;
  ok: boolean;
  statusCode?: number;
  latencyMs?: number;
  error?: string;
}

export interface InspectPathInput {
  path: ServicePath;
  externalProbe?: ProbeResult;
  internalProbe?: InternalProbe;
  observation: HostObservation;
}

function upstreamParts(upstream?: string): { host?: string; port?: number } {
  if (!upstream) return {};
  try {
    const raw = upstream.trim();
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `http://${raw}`);
    const port = url.port ? Number(url.port) : undefined;
    return {
      host: url.hostname.toLowerCase(),
      port: Number.isInteger(port) ? port : undefined,
    };
  } catch {
    return {};
  }
}

function isLoopback(host?: string) {
  return Boolean(host && ["127.0.0.1", "localhost", "::1", "0.0.0.0"].includes(host));
}

function externalDetail(probe?: ProbeResult) {
  if (!probe) return "No external check has run.";
  if (probe.statusCode != null) {
    return `HTTP ${probe.statusCode}${probe.latencyMs != null ? ` in ${probe.latencyMs}ms` : ""}.`;
  }
  return probe.error || "The endpoint did not return an HTTP response.";
}

function internalDetail(probe?: InternalProbe) {
  if (!probe) return "No direct upstream response was collected.";
  if (probe.statusCode != null) {
    return `Direct host check returned HTTP ${probe.statusCode}${probe.latencyMs != null ? ` in ${probe.latencyMs}ms` : ""}.`;
  }
  return probe.error || "The upstream did not return an HTTP response.";
}

export function inspectServicePath({
  path,
  externalProbe,
  internalProbe,
  observation,
}: InspectPathInput): PathInspection {
  const at = externalProbe?.observedAt || observation.observedAt;
  const externalStatus = externalProbe?.statusCode;
  const externalFailed =
    Boolean(externalProbe) &&
    (!externalProbe?.ok && (externalStatus == null || externalStatus >= 500));
  const externalResponded = externalStatus != null;
  const upstream = upstreamParts(path.upstream);
  const listener = upstream.port != null
    ? observation.listeners?.find((candidate) => candidate.port === upstream.port)
    : undefined;
  const proxyExecution = observation.proxy?.execution;
  const containerLoopback =
    proxyExecution?.plane === "container" &&
    proxyExecution.networkMode !== "host" &&
    isLoopback(upstream.host);

  const evidence: PathEvidenceStep[] = [];
  if (externalResponded) {
    evidence.push({
      id: "edge",
      label: "Edge transport",
      value: "Reached",
      detail: `DNS and TLS completed far enough to receive ${externalDetail(externalProbe)}`,
      status: "verified",
    });
  } else if (externalProbe) {
    evidence.push({
      id: "edge",
      label: "Public request",
      value: "No HTTP response",
      detail: externalDetail(externalProbe),
      status: "failed",
    });
  }

  evidence.push({
    id: "proxy",
    label: "Proxy route",
    value: path.upstream || "No target",
    detail: externalStatus === 502
      ? `${observation.proxy?.type || "Reverse proxy"} returned the gateway failure.`
      : "Read from the active reverse-proxy configuration.",
    status: externalStatus === 502 || !path.upstream ? "failed" : "observed",
  });

  if (internalProbe) {
    evidence.push({
      id: "upstream",
      label: "Upstream check",
      value: internalProbe.ok
        ? `HTTP ${internalProbe.statusCode}`
        : internalProbe.statusCode != null
          ? `HTTP ${internalProbe.statusCode}`
          : "Unreachable",
      detail: internalDetail(internalProbe),
      status: internalProbe.ok ? "verified" : "failed",
    });
  } else if (listener) {
    evidence.push({
      id: "upstream",
      label: "Host listener",
      value: `${listener.address}:${listener.port}`,
      detail: "A listening socket exists on the configured upstream port.",
      status: "observed",
    });
  } else if (upstream.port != null && isLoopback(upstream.host)) {
    evidence.push({
      id: "upstream",
      label: "Host listener",
      value: `Port ${upstream.port} closed`,
      detail: "No listening socket was found for the configured host upstream.",
      status: "failed",
    });
  }

  if (path.containerName) {
    const running = path.containerState?.toLowerCase() === "running";
    evidence.push({
      id: "runtime",
      label: "Runtime",
      value: path.containerName,
      detail: `${path.serviceId || "Service"} is ${path.containerState || "observed"}${path.linkMethod ? `; linked by ${path.linkMethod.replaceAll("_", " ")}` : ""}.`,
      status: running ? "verified" : "failed",
    });
  }

  if (!externalProbe) {
    return {
      domain: path.domain,
      observedAt: at,
      outcome: "degraded",
      summary: "The route is observed; run a scan to verify the customer path.",
      confidence: 0.6,
      evidence,
    };
  }

  if (externalProbe.ok) {
    return {
      domain: path.domain,
      observedAt: at,
      outcome: "healthy",
      summary: "The public path is responding and no recovery is justified.",
      confidence: 1,
      evidence,
      deepInvestigation: {
        geminiEligible: false,
        daytonaEligible: false,
        reason: "Deterministic checks found no customer-facing failure.",
      },
    };
  }

  if (externalStatus != null && externalStatus < 500) {
    return {
      domain: path.domain,
      observedAt: at,
      outcome: "degraded",
      failureBoundary: "application",
      summary: `The application responded with HTTP ${externalStatus}; the root-path expectation needs a product-specific journey.`,
      confidence: 0.95,
      evidence,
      nextAction: {
        title: "Configure the real customer journey",
        detail: "Use the deployment's health path or feature journey before treating this response as downtime.",
        mode: "guided",
      },
      deepInvestigation: {
        geminiEligible: false,
        daytonaEligible: false,
        reason: "The application responded; deeper automation needs an explicit product journey.",
      },
    };
  }

  if (containerLoopback) {
    return {
      domain: path.domain,
      observedAt: at,
      outcome: "failed",
      failureBoundary: "proxy_to_upstream",
      summary: "The proxy is running in a container but its route targets container-local loopback.",
      cause: `${path.upstream} resolves inside ${proxyExecution?.containerName || "the proxy container"}, not to the host service.`,
      confidence: 0.98,
      evidence,
      nextAction: {
        title: "Correct the proxy execution-plane target",
        detail: "Point the route to the Compose service on a shared Docker network or to a verified host gateway, validate the proxy configuration, reload it, then repeat the public check.",
        mode: "approval",
      },
      deepInvestigation: {
        geminiEligible: true,
        daytonaEligible: false,
        reason: "Gemini can correlate the safest route correction; Daytona is unnecessary for a live proxy topology defect.",
      },
    };
  }

  if (internalProbe && !internalProbe.ok) {
    const upstreamApplicationFailure = internalProbe.statusCode != null && internalProbe.statusCode >= 500;
    return {
      domain: path.domain,
      observedAt: at,
      outcome: "failed",
      failureBoundary: upstreamApplicationFailure ? "upstream" : "proxy_to_upstream",
      summary: upstreamApplicationFailure
        ? `The upstream itself returns HTTP ${internalProbe.statusCode}.`
        : "The configured upstream cannot be reached from the deployment host.",
      cause: upstreamApplicationFailure
        ? "The reverse proxy is forwarding to a failing application."
        : path.containerName
          ? `The route and ${path.containerName} do not meet on a reachable port.`
          : "No running deployment runtime is linked to the configured upstream.",
      confidence: upstreamApplicationFailure ? 0.96 : 0.94,
      evidence,
      nextAction: {
        title: upstreamApplicationFailure ? "Inspect the failing service" : "Restore the upstream link",
        detail: upstreamApplicationFailure
          ? "Correlate the service logs, health, environment and latest release before preparing a reversible application fix."
          : "Identify the intended Compose service and published port, then either restore that runtime or correct the proxy route and verify externally.",
        mode: "guided",
      },
      deepInvestigation: {
        geminiEligible: true,
        daytonaEligible: upstreamApplicationFailure,
        reason: upstreamApplicationFailure
          ? "Gemini can correlate live evidence; Daytona becomes eligible only if the evidence points to a repository or configuration regression."
          : "Gemini can rank runtime and routing evidence; no isolated code reproduction is justified yet.",
      },
    };
  }

  if (upstream.port != null && isLoopback(upstream.host) && !listener) {
    return {
      domain: path.domain,
      observedAt: at,
      outcome: "failed",
      failureBoundary: "proxy_to_upstream",
      summary: `The proxy targets port ${upstream.port}, but the host has no listener there.`,
      cause: path.containerName
        ? `${path.containerName} is not publishing the port expected by the proxy.`
        : "The configured runtime is stopped, moved, or no longer linked to this route.",
      confidence: 0.96,
      evidence,
      nextAction: {
        title: "Restore the route-to-runtime contract",
        detail: "Find the deployment that owns this domain, compare its actual published port with the proxy target, then start the service or apply the smallest validated route correction.",
        mode: "guided",
      },
      deepInvestigation: {
        geminiEligible: true,
        daytonaEligible: false,
        reason: "Live host evidence is sufficient to isolate the boundary; no code sandbox is justified yet.",
      },
    };
  }

  return {
    domain: path.domain,
    observedAt: at,
    outcome: externalFailed ? "failed" : "degraded",
    failureBoundary: externalResponded ? "proxy_to_upstream" : "edge",
    summary: externalResponded
      ? "The public request reached the proxy, but the upstream identity is not yet proven."
      : "The endpoint failed before returning an HTTP response.",
    confidence: externalResponded ? 0.82 : 0.68,
    evidence,
    nextAction: {
      title: externalResponded ? "Resolve the runtime identity" : "Verify edge transport",
      detail: externalResponded
        ? "Link the route to its deployment or container, then test the configured upstream directly."
        : "Check DNS resolution, certificate validity and connectivity before investigating the application runtime.",
      mode: "guided",
    },
    deepInvestigation: {
      geminiEligible: externalResponded,
      daytonaEligible: false,
      reason: externalResponded
        ? "Gemini can correlate ambiguous live topology; Daytona must wait for a code-level failure boundary."
        : "The failure boundary is still outside the application runtime.",
    },
  };
}
