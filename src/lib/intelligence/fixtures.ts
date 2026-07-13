import type {
  CustomerJourney,
  HostObservation,
  OperationalEvent,
  ProxyRevision,
} from "./types";
import { fingerprintContent } from "./recovery";
import { createHttpJourney } from "./journeys";

const HEALTHY_CADDY = `app.example.com {
  reverse_proxy web:3000
}
`;

const BROKEN_CADDY = `app.example.com {
  reverse_proxy web:8080
}
`;

/**
 * Canonical 502 / wrong-upstream fixture.
 * Container listens on 3000; proxy points at 8080.
 */
export function fixtureWrongUpstreamPort(): {
  id: string;
  label: string;
  healthyObservation: HostObservation;
  brokenObservation: HostObservation;
  events: OperationalEvent[];
  journey: CustomerJourney;
  healthyRevision: ProxyRevision;
  brokenRevision: ProxyRevision;
  requiredConcepts: string[];
  forbiddenConcepts: string[];
  publicUrl: string;
} {
  const hostId = "fixture-host-1";
  const atHealthy = "2026-07-13T10:00:00.000Z";
  const atBroken = "2026-07-13T10:05:00.000Z";
  const publicUrl = "https://app.example.com/";

  const containers = [
    {
      name: "web",
      image: "ghcr.io/example/web:1.2.0",
      state: "running",
      status: "Up 2 hours",
      composeProject: "shop",
      composeService: "web",
      ports: [{ host: 3000, container: 3000 }],
      networks: ["shop_default"],
    },
  ];

  const composeProjects = [
    {
      name: "shop",
      path: "/opt/shop",
      services: ["web"],
      fingerprint: "compose-fp-1",
    },
  ];

  const healthyObservation: HostObservation = {
    hostId,
    observedAt: atHealthy,
    source: "fixture",
    containers,
    composeProjects,
    proxy: {
      type: "caddy",
      configContent: HEALTHY_CADDY,
      fingerprint: fingerprintContent(HEALTHY_CADDY),
      routes: [
        {
          domain: "app.example.com",
          path: "/",
          upstream: "web:3000",
          listenPort: 443,
        },
      ],
    },
    domains: [{ domain: "app.example.com", resolvesTo: "1.2.3.4", tlsValid: true }],
  };

  const brokenObservation: HostObservation = {
    ...healthyObservation,
    observedAt: atBroken,
    proxy: {
      type: "caddy",
      configContent: BROKEN_CADDY,
      fingerprint: fingerprintContent(BROKEN_CADDY),
      routes: [
        {
          domain: "app.example.com",
          path: "/",
          upstream: "web:8080",
          listenPort: 443,
        },
      ],
    },
  };

  const healthyRevision: ProxyRevision = {
    id: "rev_healthy_caddy_1",
    hostId,
    proxyType: "caddy",
    content: HEALTHY_CADDY,
    fingerprint: fingerprintContent(HEALTHY_CADDY),
    capturedAt: atHealthy,
    serviceIds: ["web"],
    validated: true,
    label: "last-known-healthy",
  };

  const brokenRevision: ProxyRevision = {
    id: "rev_broken_caddy_1",
    hostId,
    proxyType: "caddy",
    content: BROKEN_CADDY,
    fingerprint: fingerprintContent(BROKEN_CADDY),
    capturedAt: atBroken,
    serviceIds: ["web"],
    validated: true,
    label: "broken-upstream",
  };

  const events: OperationalEvent[] = [
    {
      id: "ev_fixture_proxy_1",
      hostId,
      serviceIds: ["web"],
      kind: "proxy_changed",
      observedAt: atBroken,
      source: "fixture",
      beforeRef: healthyRevision.fingerprint,
      afterRef: brokenRevision.fingerprint,
      evidenceArtifactIds: ["evd_proxy_diff"],
      meta: { domain: "app.example.com", beforeUpstream: "web:3000", afterUpstream: "web:8080" },
    },
  ];

  const journey = createHttpJourney({
    id: "journey_app_home",
    name: "App home returns 200",
    serviceIds: ["web"],
    publicUrl,
    expectStatus: 200,
    triggers: ["proxy.changed", "web.changed", "container.changed"],
    confirmed: true,
  });

  return {
    id: "fixture_wrong_upstream_port",
    label: "Wrong proxy upstream port (502 class)",
    healthyObservation,
    brokenObservation,
    events,
    journey,
    healthyRevision,
    brokenRevision,
    requiredConcepts: ["wrong_upstream_port"],
    forbiddenConcepts: ["dns_tls_failure"],
    publicUrl,
  };
}

/**
 * Crash-loop / container down fixture.
 */
export function fixtureContainerDown(): {
  id: string;
  label: string;
  observation: HostObservation;
  events: OperationalEvent[];
  journey: CustomerJourney;
  requiredConcepts: string[];
  publicUrl: string;
} {
  const hostId = "fixture-host-2";
  const at = "2026-07-13T11:00:00.000Z";
  const publicUrl = "https://api.example.com/health";
  const caddy = `api.example.com {
  reverse_proxy api:8080
}
`;

  const observation: HostObservation = {
    hostId,
    observedAt: at,
    source: "fixture",
    containers: [
      {
        name: "api",
        image: "ghcr.io/example/api:2.0.0",
        state: "restarting",
        status: "Restarting (1) 10 seconds ago",
        composeProject: "api",
        composeService: "api",
        ports: [{ host: 8080, container: 8080 }],
      },
    ],
    composeProjects: [
      { name: "api", path: "/opt/api", services: ["api"], fingerprint: "c2" },
    ],
    proxy: {
      type: "caddy",
      configContent: caddy,
      fingerprint: fingerprintContent(caddy),
      routes: [{ domain: "api.example.com", upstream: "api:8080", listenPort: 443 }],
    },
  };

  const events: OperationalEvent[] = [
    {
      id: "ev_fixture_ctr_1",
      hostId,
      serviceIds: ["api"],
      kind: "container_replaced",
      observedAt: at,
      source: "fixture",
      beforeRef: "running",
      afterRef: "restarting",
      evidenceArtifactIds: [],
      meta: { containerName: "api" },
    },
  ];

  const journey = createHttpJourney({
    id: "journey_api_health",
    name: "API health",
    serviceIds: ["api"],
    publicUrl,
    expectStatus: 200,
    confirmed: true,
  });

  return {
    id: "fixture_container_down",
    label: "Container crash-loop",
    observation,
    events,
    journey,
    requiredConcepts: ["container_not_running"],
    publicUrl,
  };
}

export function allFixtures() {
  return {
    wrongUpstream: fixtureWrongUpstreamPort(),
    containerDown: fixtureContainerDown(),
  };
}
