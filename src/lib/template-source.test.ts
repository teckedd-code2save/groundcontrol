import { describe, expect, it, vi } from "vitest";
import { resolveTemplateSource } from "./template-source";
import type { VpsConnection } from "./vps";

const vps: VpsConnection = {
  id: 1,
  host: "203.0.113.10",
  port: 22,
  username: "root",
  isLocal: false,
};

function execResult(stdout = "", stderr = "", code = 0) {
  return { stdout, stderr, code };
}

describe("resolveTemplateSource", () => {
  it("creates an empty deployment source when no source is provided", async () => {
    const exec = vi.fn().mockResolvedValue(execResult());

    const result = await resolveTemplateSource(
      { deployPath: "/srv/groundcontrol/deployments/app", vps },
      { exec }
    );

    expect(result).toEqual({
      kind: "empty",
      sourcePath: "/srv/groundcontrol/deployments/app",
      buildContext: ".",
    });
    expect(exec).toHaveBeenCalledWith("mkdir -p '/srv/groundcontrol/deployments/app'", vps);
  });

  it("validates local source paths and uses them as the build context", async () => {
    const exec = vi
      .fn()
      .mockResolvedValueOnce(execResult())
      .mockResolvedValueOnce(execResult("yes\n"));

    const result = await resolveTemplateSource(
      {
        localPath: "/opt/my-app",
        deployPath: "/srv/groundcontrol/deployments/my-app",
        vps,
      },
      { exec }
    );

    expect(result.kind).toBe("local");
    expect(result.sourcePath).toBe("/opt/my-app");
    expect(result.buildContext).toBe("/opt/my-app");
    expect(exec).toHaveBeenLastCalledWith("test -d '/opt/my-app' && echo yes || echo no", vps);
  });

  it("fails clearly when a local source path is missing", async () => {
    const exec = vi
      .fn()
      .mockResolvedValueOnce(execResult())
      .mockResolvedValueOnce(execResult("no\n"));

    await expect(
      resolveTemplateSource(
        {
          localPath: "/opt/missing",
          deployPath: "/srv/groundcontrol/deployments/missing",
          vps,
        },
        { exec }
      )
    ).rejects.toThrow("Local source path does not exist on VPS: /opt/missing");
  });

  it("installs git when missing and returns canonical git metadata", async () => {
    const exec = vi
      .fn()
      .mockResolvedValueOnce(execResult())
      .mockResolvedValueOnce(execResult("no\n"))
      .mockResolvedValueOnce(execResult("yes\n"))
      .mockResolvedValueOnce(
        execResult(
          [
            "Cloning into '/srv/groundcontrol/deployments/app'...",
            "GC_SOURCE_COMMIT=abc123",
            "GC_SOURCE_BRANCH=main",
            "GC_SOURCE_DEFAULT_BRANCH=main",
          ].join("\n")
        )
      );
    const installGit = vi.fn().mockResolvedValue({ success: true, output: "installed", error: "" });

    const result = await resolveTemplateSource(
      {
        repoUrl: "https://github.com/example/app.git",
        branch: "main",
        deployPath: "/srv/groundcontrol/deployments/app",
        vps,
      },
      { exec, installGit }
    );

    expect(installGit).toHaveBeenCalledWith(vps);
    expect(result).toMatchObject({
      kind: "git",
      sourcePath: "/srv/groundcontrol/deployments/app",
      buildContext: ".",
      repoUrl: "https://github.com/example/app.git",
      requestedRef: "main",
      branch: "main",
      commitSha: "abc123",
      defaultBranch: "main",
    });
    expect(exec.mock.calls[3][0]).toContain("git clone \"$repo\" \"$path\"");
    expect(exec.mock.calls[3][0]).toContain("git checkout -B \"$ref\" \"origin/$ref\"");
  });

  it("surfaces git source failures without hiding stderr", async () => {
    const exec = vi
      .fn()
      .mockResolvedValueOnce(execResult())
      .mockResolvedValueOnce(execResult("yes\n"))
      .mockResolvedValueOnce(execResult("", "Deployment path already contains a different git remote: old\n", 42));

    await expect(
      resolveTemplateSource(
        {
          repoUrl: "https://github.com/example/app.git",
          branch: "main",
          deployPath: "/srv/groundcontrol/deployments/app",
          vps,
        },
        { exec }
      )
    ).rejects.toThrow("Deployment path already contains a different git remote");
  });
});
