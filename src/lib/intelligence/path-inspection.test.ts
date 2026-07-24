import { describe, expect, it } from "vitest";
import { inspectServicePath } from "./path-inspection";
import type { HostObservation, ProbeResult, ServicePath } from "./types";

const observedAt = "2026-07-24T10:00:00.000Z";

function path(overrides: Partial<ServicePath> = {}): ServicePath {
  return {
    domain: "app.example.com",
    upstream: "127.0.0.1:14080",
    healthy: false,
    issues: ["no_container_match"],
    ...overrides,
  };
}

function observation(overrides: Partial<HostObservation> = {}): HostObservation {
  return {
    hostId: "host:22",
    observedAt,
    source: "live",
    containers: [],
    composeProjects: [],
    proxy: {
      type: "caddy",
      configContent: "app.example.com { reverse_proxy 127.0.0.1:14080 }",
      fingerprint: "proxy-revision",
      routes: [{ domain: "app.example.com", upstream: "127.0.0.1:14080" }],
      execution: { plane: "host" },
    },
    listeners: [],
    ...overrides,
  };
}

function external(statusCode: number, ok = false): ProbeResult {
  return {
    id: "probe_external",
    kind: "external",
    target: "https://app.example.com/",
    ok,
    statusCode,
    latencyMs: 104,
    observedAt,
  };
}

describe("deterministic public-path inspection", () => {
  it("treats an HTTPS 502 as proof that edge transport reached the proxy", () => {
    const result = inspectServicePath({
      path: path(),
      externalProbe: external(502),
      observation: observation(),
    });

    expect(result.failureBoundary).toBe("proxy_to_upstream");
    expect(result.evidence[0]).toMatchObject({
      id: "edge",
      status: "verified",
      value: "Reached",
    });
    expect(result.evidence.map((item) => item.status)).not.toContain("unknown");
  });

  it("isolates container-local loopback when the active proxy owns the edge ports", () => {
    const result = inspectServicePath({
      path: path(),
      externalProbe: external(502),
      observation: observation({
        proxy: {
          type: "caddy",
          configContent: "app.example.com { reverse_proxy 127.0.0.1:14080 }",
          fingerprint: "proxy-revision",
          routes: [{ domain: "app.example.com", upstream: "127.0.0.1:14080" }],
          execution: { plane: "container", containerName: "caddy", networkMode: "bridge" },
        },
      }),
    });

    expect(result.confidence).toBe(0.98);
    expect(result.cause).toContain("resolves inside caddy");
    expect(result.nextAction?.title).toBe("Correct the proxy execution-plane target");
    expect(result.deepInvestigation).toMatchObject({
      geminiEligible: true,
      daytonaEligible: false,
    });
  });

  it("uses a direct host probe to separate upstream application failure from routing failure", () => {
    const result = inspectServicePath({
      path: path({
        containerName: "payments-api-1",
        containerState: "running",
        serviceId: "api",
        linkMethod: "published_port",
      }),
      externalProbe: external(502),
      internalProbe: {
        target: "http://127.0.0.1:14080/",
        ok: false,
        statusCode: 500,
        latencyMs: 18,
      },
      observation: observation({
        listeners: [{ address: "0.0.0.0", port: 14080 }],
      }),
    });

    expect(result.failureBoundary).toBe("upstream");
    expect(result.summary).toContain("HTTP 500");
    expect(result.deepInvestigation?.daytonaEligible).toBe(true);
  });

  it("does not recommend mutation for a healthy public path", () => {
    const result = inspectServicePath({
      path: path({ healthy: true, issues: [] }),
      externalProbe: external(200, true),
      internalProbe: {
        target: "http://127.0.0.1:14080/",
        ok: true,
        statusCode: 200,
        latencyMs: 7,
      },
      observation: observation({
        listeners: [{ address: "0.0.0.0", port: 14080 }],
      }),
    });

    expect(result.outcome).toBe("healthy");
    expect(result.nextAction).toBeUndefined();
    expect(result.deepInvestigation?.geminiEligible).toBe(false);
  });
});
