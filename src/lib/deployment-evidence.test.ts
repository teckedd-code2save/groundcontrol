import { describe, expect, it } from "vitest";
import {
  readDeploymentSourceIdentity,
  resolveDeploymentEvidence,
  resolveDeploymentExecutionIdentity,
} from "./deployment-evidence";

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

  it("uses live Compose labels instead of a stale enrolled folder", () => {
    const identity = resolveDeploymentExecutionIdentity({
      slug: "rentaweekend",
      sourcePath: "/opt/github-com-teckedd-code2save-company-site-git",
      composePath: "/opt/github-com-teckedd-code2save-company-site-git/docker-compose.yml",
      legacyProjectPath: "/opt/agent-flow/RentAWeekend",
      legacyProjectSlug: "rentaweekend",
    }, [{
      name: "rentaweekend-api-1",
      project: "rentaweekend",
      service: "api",
      workingDir: "/opt/agent-flow/RentAWeekend",
      configFiles: "/opt/agent-flow/RentAWeekend/docker-compose.yml",
      projectSlug: "RentAWeekend",
    }]);

    expect(identity).toEqual({
      sourcePath: "/opt/agent-flow/RentAWeekend",
      composePath: "/opt/agent-flow/RentAWeekend/docker-compose.yml",
      composeProject: "rentaweekend",
      source: "runtime-label",
    });
  });

  it("falls back to the saved project before stale enrollment metadata", () => {
    expect(resolveDeploymentExecutionIdentity({
      slug: "app",
      sourcePath: "/opt/old-app",
      legacyProjectPath: "/opt/current-app",
    }, [])).toMatchObject({
      sourcePath: "/opt/current-app",
      source: "saved-project",
    });
  });

  it("recovers repository identity from the recorded deployment source", () => {
    const output = JSON.stringify({
      source: {
        repoUrl: "https://github.com/example/recorded-app.git",
        commitSha: "a".repeat(40),
      },
    });
    expect(readDeploymentSourceIdentity(output)).toEqual({
      repoUrl: "https://github.com/example/recorded-app.git",
      commitSha: "a".repeat(40),
    });
    const evidence = resolveDeploymentEvidence({
      slug: "recorded-app",
      savedReleaseOutput: output,
    }, [], [], [], []);
    expect(evidence.repoUrl).toBe("https://github.com/example/recorded-app.git");
    expect(evidence.sourceCommit).toBe("a".repeat(40));
    expect(evidence.identitySource).toBe("release-record");
  });

  it("recovers source identity from a deploy fingerprint marker in release output", () => {
    const output = [
      "__GC_SOURCE_FINGERPRINT__={\"repoUrl\":\"https://github.com/example/app\",\"commitSha\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\"composePath\":\"/srv/app/docker-compose.yml\"}",
      "deployment logs continue here",
    ].join("\n");
    expect(readDeploymentSourceIdentity(output)).toEqual({
      repoUrl: "https://github.com/example/app",
      commitSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    });
  });

  it("uses configured deployed commit ahead of older release output", () => {
    const evidence = resolveDeploymentEvidence({
      slug: "app",
      metadataJson: JSON.stringify({
        sourceRepair: {
          deployedCommit: "c".repeat(40),
        },
      }),
      savedReleaseOutput: JSON.stringify({
        source: {
          repoUrl: "https://github.com/example/app",
          commitSha: "d".repeat(40),
        },
      }),
    }, [], [], [], []);
    expect(evidence.repoUrl).toBe("https://github.com/example/app");
    expect(evidence.sourceCommit).toBe("c".repeat(40));
  });
});
