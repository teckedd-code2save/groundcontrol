import { describe, expect, it } from "vitest";
import { findProjectSite, matchedServiceForSite, normalizeRouteToken } from "./deployment-route-match";

const caddySites = [
  {
    file: "/etc/caddy/sites/10-auridux.caddy",
    domain: "auridux.com",
    root: "/opt/optimi/app/dist",
    proxy: "localhost:8000",
    content: `auridux.com {
    @backend path /api/* /health /scrape /scrape-batch
    reverse_proxy @backend localhost:8000
    root * /opt/optimi/app/dist
}`,
  },
  {
    file: "/etc/caddy/sites/30-rentmyweekend.caddy",
    domain: "http://rentmyweekend.serendepify.com",
    root: null,
    proxy: null,
    content: `http://rentmyweekend.serendepify.com {
      redir https://rentmyweekend.serendepify.com{uri}
    }`,
  },
  {
    file: "/etc/caddy/sites/30-rentmyweekend.caddy",
    domain: "rentmyweekend.serendepify.com",
    root: null,
    proxy: "127.0.0.1:14080",
    content: `rentmyweekend.serendepify.com {
      reverse_proxy 127.0.0.1:14080
    }`,
  },
  {
    file: "/etc/caddy/sites/40-infisical.caddy",
    domain: "secrets.serendepify.com",
    root: null,
    proxy: "127.0.0.1:8080",
    content: `secrets.serendepify.com {
      reverse_proxy 127.0.0.1:8080
    }`,
  },
];

describe("deployment route matching", () => {
  it("normalizes camel case deployment names into route tokens", () => {
    expect(normalizeRouteToken("RentAWeekend")).toBe("rent-a-weekend");
  });

  it("matches RentAWeekend to its Caddy file instead of auridux", () => {
    const site = findProjectSite(
      {
        slug: "agent-flow/RentAWeekend",
        dirName: "RentAWeekend",
        path: "/opt/agent-flow/RentAWeekend",
        services: [{ name: "web", ports: ["127.0.0.1:14080:3000"] }],
      },
      caddySites,
      [{ name: "rentmyweekend-web-1", ports: "127.0.0.1:14080->3000/tcp", composeService: "web" }]
    );

    expect(site?.file).toBe("/etc/caddy/sites/30-rentmyweekend.caddy");
    expect(site?.domain).toBe("rentmyweekend.serendepify.com");
    expect(site?.proxy).toBe("127.0.0.1:14080");
  });

  it("prefers proxy/root blocks over redirect-only blocks for the same deployment", () => {
    const site = findProjectSite(
      {
        slug: "rentmyweekend",
        dirName: "rentmyweekend",
        path: "/opt/rentmyweekend",
        services: [{ name: "web", ports: ["14080:3000"] }],
      },
      caddySites
    );

    expect(site?.domain).toBe("rentmyweekend.serendepify.com");
    expect(matchedServiceForSite(site!, { slug: "rentmyweekend", dirName: "rentmyweekend", path: "/opt/rentmyweekend", services: [{ name: "web", ports: ["14080:3000"] }] })).toBe("web");
  });

  it("keeps auridux on the optimi app root and does not assign it to RentAWeekend", () => {
    const site = findProjectSite(
      {
        slug: "optimi",
        dirName: "optimi",
        path: "/opt/optimi",
        services: [{ name: "web", ports: ["8000:3000"] }],
      },
      caddySites
    );

    expect(site?.domain).toBe("auridux.com");
  });

  it("does not assign auridux to unrelated generic app deployments", () => {
    const site = findProjectSite(
      {
        slug: "groundcontrol/app",
        dirName: "app",
        path: "/opt/groundcontrol/app",
        services: [{ name: "app", ports: ["3000:3000"] }],
      },
      caddySites
    );

    expect(site).toBeUndefined();
  });

  it("matches Infisical by its Caddy file and proxy port instead of auridux", () => {
    const site = findProjectSite(
      {
        slug: "infisical",
        dirName: "infisical",
        path: "/opt/infisical",
        services: [{ name: "infisical", ports: ["127.0.0.1:8080:8080"] }],
      },
      caddySites
    );

    expect(site?.file).toBe("/etc/caddy/sites/40-infisical.caddy");
    expect(site?.domain).toBe("secrets.serendepify.com");
  });

  it("does not assign auridux to HealthWallet when there is no route evidence", () => {
    const site = findProjectSite(
      {
        slug: "agent-flow/HealthWallet-TON-MiniApp",
        dirName: "HealthWallet-TON-MiniApp",
        path: "/opt/agent-flow/HealthWallet-TON-MiniApp",
        services: [
          { name: "web", ports: ["3001:3000"] },
          { name: "api", ports: ["5001:5000"] },
        ],
      },
      caddySites
    );

    expect(site).toBeUndefined();
  });

  it("does not assign a route from shared host port alone", () => {
    const site = findProjectSite(
      {
        slug: "agent-flow/HealthWallet-TON-MiniApp",
        dirName: "HealthWallet-TON-MiniApp",
        path: "/opt/agent-flow/HealthWallet-TON-MiniApp",
        services: [
          { name: "api", ports: ["127.0.0.1:8000:5000"] },
        ],
      },
      caddySites
    );

    expect(site).toBeUndefined();
  });

  it("does not assign auridux to agent-ops deploy when no Caddy file matches", () => {
    const site = findProjectSite(
      {
        slug: "agent-ops/deploy",
        dirName: "deploy",
        path: "/opt/agent-ops/deploy",
        services: [
          { name: "web", ports: ["3011:3000"] },
          { name: "worker", ports: [] },
        ],
      },
      caddySites
    );

    expect(site).toBeUndefined();
  });
});
