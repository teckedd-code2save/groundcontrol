import { describe, expect, it } from "vitest";
import { detectIntentDrift, parseGroundControlIntent } from "./intent-contract";

describe("groundcontrol intent contract", () => {
  it("parses a minimal v1 manifest", () => {
    const intent = parseGroundControlIntent(`
version: v1
project: api
domains:
  - api.example.com
services:
  - name: web
    image: ghcr.io/acme/api
    port: 4000
    health:
      path: /health
`);
    expect(intent.project).toBe("api");
    expect(intent.services[0]?.port).toBe(4000);
  });

  it("rejects duplicate services", () => {
    expect(() => parseGroundControlIntent(`
version: v1
project: api
services:
  - name: web
  - name: web
`)).toThrow(/duplicate service web/);
  });

  it("returns deterministic service, port and domain drift with evidence", () => {
    const intent = parseGroundControlIntent(`
version: v1
project: api
domains: [api.example.com]
services:
  - name: web
    port: 4000
  - name: worker
`);

    const findings = detectIntentDrift(intent, {
      projects: [{
        slug: "api",
        name: "api",
        path: "/opt/api",
        parent: null,
        hasGit: true,
        services: [{
          service: "web",
          image: "ghcr.io/acme/api",
          build: false,
          ports: ["3000:3000"],
        }],
        extraContainers: [],
        sites: [],
      }],
      unclaimedContainers: [],
    });

    expect(findings.map(f => f.code)).toEqual([
      "port_mismatch",
      "service_missing",
      "domain_missing",
    ]);
    expect(findings.every(f => f.evidence.length > 0)).toBe(true);
    expect(findings.every(f => f.reversible)).toBe(true);
  });
});
