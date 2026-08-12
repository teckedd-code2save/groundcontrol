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

  it("describes missing proxy links without claiming the whole deployment is stopped", () => {
    const result = inspectServicePath({
      path: path(),
      externalProbe: external(502),
      internalProbe: {
        target: "http://127.0.0.1:14080/",
        ok: false,
        error: "connection refused",
      },
      observation: observation(),
    });

    expect(result.failureBoundary).toBe("proxy_to_upstream");
    expect(result.cause).toContain("No service is linked to, or publishing");
    expect(result.cause).not.toContain("No running deployment runtime");
    expect(result.nextAction?.detail).toContain("published port");
  });

  it("detects proxy-to-runtime port drift when a related service is published on another port", () => {
    const result = inspectServicePath({
      path: path({
        domain: "rentmyweekend.serendepify.com",
        upstream: "127.0.0.1:14080",
      }),
      externalProbe: external(502),
      internalProbe: {
        target: "http://127.0.0.1:14080/",
        ok: false,
        error: "connection refused",
      },
      observation: observation({
        proxy: {
          type: "caddy",
          configContent: "rentmyweekend.serendepify.com { reverse_proxy 127.0.0.1:14080 }",
          fingerprint: "proxy-revision",
          routes: [{ domain: "rentmyweekend.serendepify.com", upstream: "127.0.0.1:14080" }],
          execution: { plane: "host" },
        },
        containers: [{
          name: "rentaweekend-web-1",
          image: "ghcr.io/teckedd-code2save/rentaweekend-web:sha",
          state: "running",
          status: "Up 10 minutes",
          composeProject: "rentaweekend",
          composeService: "web",
          ports: [{ host: 3000, container: 80, protocol: "tcp" }],
        }],
      }),
    });

    expect(result.failureBoundary).toBe("proxy_to_upstream");
    expect(result.summary).toContain("14080");
    expect(result.summary).toContain("3000");
    expect(result.cause).toContain("route-to-runtime port contract drifted");
    expect(result.nextAction?.title).toBe("Reconcile the route port");
    expect(result.deepInvestigation?.daytonaEligible).toBe(false);
  });

  it("does not borrow an unrelated generic web container for port drift", () => {
    const result = inspectServicePath({
      path: path({
        domain: "perfumeemporium.serendepify.com",
        upstream: "127.0.0.1:13000",
      }),
      externalProbe: external(502),
      internalProbe: {
        target: "http://127.0.0.1:13000/",
        ok: false,
        error: "connection refused",
      },
      observation: observation({
        proxy: {
          type: "caddy",
          configContent: "perfumeemporium.serendepify.com { reverse_proxy 127.0.0.1:13000 }",
          fingerprint: "proxy-revision",
          routes: [{ domain: "perfumeemporium.serendepify.com", upstream: "127.0.0.1:13000" }],
          execution: { plane: "host" },
        },
        containers: [{
          name: "groundcontrol-web",
          image: "ghcr.io/acme/groundcontrol-web:sha",
          state: "running",
          status: "Up 10 minutes",
          composeProject: "groundcontrol",
          composeService: "web",
          ports: [{ host: 3003, container: 3000, protocol: "tcp" }],
        }],
      }),
    });

    expect(result.failureBoundary).toBe("proxy_to_upstream");
    expect(result.summary).toBe("The configured upstream cannot be reached from the deployment host.");
    expect(result.cause).not.toContain("groundcontrol-web");
    expect(result.nextAction?.title).toBe("Restore the upstream link");
  });

  it("prefers the public web service over api when both are related to a route", () => {
    const result = inspectServicePath({
      path: path({
        domain: "rentmyweekend.serendepify.com",
        upstream: "127.0.0.1:14080",
      }),
      externalProbe: external(502),
      internalProbe: {
        target: "http://127.0.0.1:14080/",
        ok: false,
        error: "connection refused",
      },
      observation: observation({
        proxy: {
          type: "caddy",
          configContent: "rentmyweekend.serendepify.com { reverse_proxy 127.0.0.1:14080 }",
          fingerprint: "proxy-revision",
          routes: [{ domain: "rentmyweekend.serendepify.com", upstream: "127.0.0.1:14080" }],
          execution: { plane: "host" },
        },
        containers: [
          {
            name: "rentaweekend-api-1",
            image: "ghcr.io/teckedd-code2save/rentaweekend-api:sha",
            state: "running",
            status: "Up 10 minutes",
            composeProject: "rentaweekend",
            composeService: "api",
            ports: [{ host: 4000, container: 3000, protocol: "tcp" }],
          },
          {
            name: "rentaweekend-web-1",
            image: "ghcr.io/teckedd-code2save/rentaweekend-web:sha",
            state: "running",
            status: "Up 10 minutes",
            composeProject: "rentaweekend",
            composeService: "web",
            ports: [{ host: 3000, container: 80, protocol: "tcp" }],
          },
        ],
      }),
    });

    expect(result.summary).toContain("3000");
    expect(result.cause).toContain("rentaweekend-web-1");
    expect(result.cause).not.toContain("rentaweekend-api-1");
  });

  it("classifies an absent public web service behind an unhealthy internal api as an app contract failure", () => {
    const result = inspectServicePath({
      path: path({
        domain: "rentmyweekend.serendepify.com",
        upstream: "127.0.0.1:14080",
      }),
      externalProbe: external(502),
      internalProbe: {
        target: "http://127.0.0.1:14080/",
        ok: false,
        error: "connection refused",
      },
      observation: observation({
        proxy: {
          type: "caddy",
          configContent: "rentmyweekend.serendepify.com { reverse_proxy 127.0.0.1:14080 }",
          fingerprint: "proxy-revision",
          routes: [{ domain: "rentmyweekend.serendepify.com", upstream: "127.0.0.1:14080" }],
          execution: { plane: "host" },
        },
        containers: [{
          name: "rentaweekend-api-1",
          image: "ghcr.io/teckedd-code2save/rentaweekend-api:sha",
          state: "running",
          status: "Up 10 minutes (unhealthy)",
          composeProject: "rentaweekend",
          composeService: "api",
          ports: [{ host: 4000, container: 4000, protocol: "tcp" }],
        }],
        composeProjects: [{
          name: "rentaweekend",
          services: ["web", "api", "migrate", "postgres", "redis"],
          serviceDetails: [
            { name: "web", dependsOn: ["api"] },
            { name: "api" },
            { name: "migrate", dependsOn: ["postgres"] },
            { name: "postgres" },
            { name: "redis" },
          ],
        }],
      }),
    });

    expect(result.failureBoundary).toBe("application");
    expect(result.summary).toContain("web");
    expect(result.cause).toContain("web depends on api: service_healthy");
    expect(result.cause).toContain("rentaweekend-api-1");
    expect(result.nextAction?.title).toBe("Repair the service port contract");
    expect(result.nextAction?.title).not.toBe("Reconcile the route port");
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
