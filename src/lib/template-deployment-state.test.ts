import { describe, expect, it, vi } from "vitest";
import {
  normalizeDnsRecords,
  persistTemplateDeployment,
  type PersistTemplateDeploymentInput,
  type TemplateDeploymentPrismaClient,
} from "./template-deployment-state";

function baseInput(): PersistTemplateDeploymentInput {
  return {
    slug: "demo-app",
    templateName: "next-postgres",
    deployPath: "/srv/groundcontrol/deployments/demo-app",
    composeProject: "gc_demo_app",
    source: {
      kind: "git",
      sourcePath: "/srv/groundcontrol/deployments/demo-app",
      buildContext: ".",
      repoUrl: "https://github.com/example/demo-app.git",
      requestedRef: "main",
      branch: "main",
      commitSha: "abc123",
      defaultBranch: "main",
    },
    domains: ["demo.serendepify.com"],
    composeYml: "services:\n  app:\n    build: .\n",
    proxyConfig: "demo.serendepify.com { reverse_proxy localhost:3000 }",
    proxyConfigPath: "/etc/caddy/sites/demo-app.caddy",
    proxyOutput: { output: "reloaded" },
    dnsResult: [{ recordId: "dns_123", name: "demo.serendepify.com", content: "203.0.113.10" }],
    healthResults: [{ domain: "demo.serendepify.com", result: "HTTP/2 200" }],
    upOutput: { stdout: "started", stderr: "", code: 0 },
    manifest: JSON.stringify({ deploymentRoot: "/srv/groundcontrol/deployments/demo-app" }),
    vpsConfigId: 7,
    durationMs: 1234,
  };
}

function createClient(existingTarget: { id: number } | null = null): TemplateDeploymentPrismaClient {
  return {
    project: {
      upsert: vi.fn().mockResolvedValue({ id: 11, slug: "demo-app" }),
    },
    deploymentTarget: {
      findFirst: vi.fn().mockResolvedValue(existingTarget),
      create: vi.fn().mockResolvedValue({ id: 22 }),
      update: vi.fn().mockResolvedValue({ id: existingTarget?.id ?? 22 }),
    },
    deployment: {
      create: vi.fn().mockResolvedValue({ id: 33 }),
    },
  } as unknown as TemplateDeploymentPrismaClient;
}

describe("persistTemplateDeployment", () => {
  it("persists template deployments into project, target, and deployment rows", async () => {
    const client = createClient();
    const result = await persistTemplateDeployment(baseInput(), client);

    expect(result).toEqual({ projectId: 11, targetId: 22, deploymentId: 33 });
    expect(client.project.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { slug: "demo-app" },
      create: expect.objectContaining({
        repoUrl: "https://github.com/example/demo-app.git",
        domain: "demo.serendepify.com",
        path: "/srv/groundcontrol/deployments/demo-app",
        status: "success",
      }),
    }));
    expect(client.deploymentTarget.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: "Template: demo-app",
        type: "docker-compose",
        vpsConfigId: 7,
        dnsRecordId: "dns_123",
        dnsRecordName: "demo.serendepify.com",
      }),
    });
    expect(client.deployment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: 11,
        targetId: 22,
        status: "success",
        branch: "main",
        commitSha: "abc123",
        publicUrl: "https://demo.serendepify.com",
        durationMs: 1234,
      }),
    });
  });

  it("reuses an existing template deployment target for the same slug", async () => {
    const client = createClient({ id: 44 });
    const result = await persistTemplateDeployment(baseInput(), client);

    expect(result.targetId).toBe(44);
    expect(client.deploymentTarget.create).not.toHaveBeenCalled();
    expect(client.deploymentTarget.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 44 },
    }));
  });

  it("normalizes DNS record arrays and ignores error objects", () => {
    expect(normalizeDnsRecords([{ recordId: "abc", name: "app.example.com" }, { error: "failed" }])).toEqual([
      { recordId: "abc", name: "app.example.com", content: undefined },
    ]);
    expect(normalizeDnsRecords({ error: "DNS provisioning failed" })).toEqual([]);
  });
});
