import { describe, expect, it } from "vitest";
import { resolveDeploymentEvidence } from "./deployment-evidence";

describe("deployment evidence resolver", () => {
  it("uses a matching Caddy route when no release URL was captured", () => {
    const evidence = resolveDeploymentEvidence(
      { slug: "rentaweekend", sourcePath: "/opt/RentAWeekend" },
      [{ name: "rentaweekend-web-1", image: "web", status: "Up", ports: "127.0.0.1:7848->3000/tcp", state: "running" }],
      [{
        name: "rentaweekend-web-1",
        project: "rentaweekend",
        service: "web",
        workingDir: "/opt/RentAWeekend",
        configFiles: "/opt/RentAWeekend/docker-compose.yml",
        projectSlug: "RentAWeekend",
        createdAt: "2026-07-01T12:00:00Z",
        startedAt: "2026-07-02T12:00:00Z",
        restartCount: 1,
      }],
      [],
      [{ file: "/etc/caddy/sites/rentaweekend.caddy", domain: "rentaweekend.example.com", root: null, proxy: "127.0.0.1:7848" }]
    );
    expect(evidence.publicUrl).toBe("https://rentaweekend.example.com");
    expect(evidence.route?.confidence).toBe("high");
    expect(evidence.runtime.containers[0]).toMatchObject({ service: "web", restartCount: 1 });
  });

  it("keeps operator-confirmed identity ahead of inferred host evidence", () => {
    const evidence = resolveDeploymentEvidence(
      {
        slug: "app",
        metadataJson: JSON.stringify({
          manualPublicUrl: "https://confirmed.example.com/app",
          manualRepoUrl: "https://github.com/example/app",
        }),
      },
      [],
      [],
      [],
      [{ file: "/etc/caddy/sites/app.caddy", domain: "inferred.example.com", root: null, proxy: "localhost:3000" }]
    );
    expect(evidence.publicUrl).toBe("https://confirmed.example.com/app");
    expect(evidence.repoUrl).toBe("https://github.com/example/app");
    expect(evidence.identitySource).toBe("operator");
  });
});
