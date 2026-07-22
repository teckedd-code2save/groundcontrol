import { describe, it, expect } from "vitest";
import type { BridgeDeps } from "./docker-host-bridge";
import {
  isDockerSocketAvailable,
  canTalkToDockerDaemon,
  ensureBridgeImage,
  execDetachedViaDockerHostBridge,
  execViaDockerHostBridge,
  canUseDockerHostBridge,
} from "./docker-host-bridge";

function makeDeps(
  partial: Partial<BridgeDeps> & {
    execResponses?: Record<string, { stdout?: string; stderr?: string; code?: number }>;
    socketIsFile?: boolean;
  } = {}
): BridgeDeps {
  const execCalls: string[] = [];
  const responses = partial.execResponses ?? {};

  return {
    statSync: (() => {
      if (partial.socketIsFile) {
        return { isSocket: () => false } as ReturnType<BridgeDeps["statSync"]>;
      }
      return { isSocket: () => true } as ReturnType<BridgeDeps["statSync"]>;
    }) as BridgeDeps["statSync"],
    execAsync: (async (cmd: string) => {
      execCalls.push(cmd);
      const key = Object.keys(responses).find((k) => cmd.includes(k));
      const res = key
        ? responses[key]
        : { stdout: "", stderr: "command not found", code: 127 };
      if (res.code !== 0) {
        const err = Object.assign(new Error(res.stderr || ""), {
          code: res.code ?? 1,
          stdout: res.stdout ?? "",
          stderr: res.stderr ?? "",
        });
        throw err;
      }
      return { stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
    }) as BridgeDeps["execAsync"],
  };
}

describe("docker-host-bridge", () => {
  describe("isDockerSocketAvailable", () => {
    it("returns true when /var/run/docker.sock is a socket", () => {
      expect(isDockerSocketAvailable(makeDeps())).toBe(true);
    });

    it("returns false when the socket is not a socket", () => {
      expect(isDockerSocketAvailable(makeDeps({ socketIsFile: true }))).toBe(false);
    });

    it("returns false when statSync throws", () => {
      const deps = makeDeps();
      deps.statSync = (() => {
        throw new Error("ENOENT");
      }) as BridgeDeps["statSync"];
      expect(isDockerSocketAvailable(deps)).toBe(false);
    });
  });

  describe("canTalkToDockerDaemon", () => {
    it("returns true when docker version returns a server version", async () => {
      const deps = makeDeps({
        execResponses: { "docker version": { stdout: "24.0.7\n", code: 0 } },
      });
      expect(await canTalkToDockerDaemon(deps)).toBe(true);
    });

    it("returns false when docker version fails", async () => {
      const deps = makeDeps({
        execResponses: { "docker version": { stderr: "permission denied", code: 1 } },
      });
      expect(await canTalkToDockerDaemon(deps)).toBe(false);
    });

    it("returns false when socket is missing", async () => {
      const deps = makeDeps({ socketIsFile: true });
      expect(await canTalkToDockerDaemon(deps)).toBe(false);
    });
  });

  describe("ensureBridgeImage", () => {
    it("returns true when the bridge image already exists", async () => {
      const deps = makeDeps({
        execResponses: {
          "docker images -q groundcontrol-host-bridge": { stdout: "abc123\n", code: 0 },
        },
      });
      expect(await ensureBridgeImage(deps)).toBe(true);
    });

    it("builds the image when it is missing and returns true", async () => {
      let calls = 0;
      const deps = makeDeps();
      deps.execAsync = (async (cmd: string) => {
        calls++;
        if (cmd.includes("docker images -q")) {
          return { stdout: calls === 1 ? "" : "abc123\n", stderr: "" };
        }
        if (cmd.includes("docker build")) {
          return { stdout: "", stderr: "" };
        }
        throw new Error("unexpected command");
      }) as BridgeDeps["execAsync"];

      expect(await ensureBridgeImage(deps)).toBe(true);
    });

    it("returns false when the build fails", async () => {
      const deps = makeDeps();
      deps.execAsync = (async (cmd: string) => {
        if (cmd.includes("docker images -q")) {
          return { stdout: "", stderr: "" };
        }
        const err = Object.assign(new Error("build failed"), {
          code: 1,
          stdout: "",
          stderr: "build failed",
        });
        throw err;
      }) as BridgeDeps["execAsync"];

      expect(await ensureBridgeImage(deps)).toBe(false);
    });
  });

  describe("canUseDockerHostBridge", () => {
    it("returns true when docker daemon responds and image exists", async () => {
      const deps = makeDeps({
        execResponses: {
          "docker version": { stdout: "24.0.7\n", code: 0 },
          "docker images -q groundcontrol-host-bridge": { stdout: "abc123\n", code: 0 },
        },
      });
      expect(await canUseDockerHostBridge(deps)).toBe(true);
    });
  });

  describe("execViaDockerHostBridge", () => {
    it("runs the expected nsenter command via docker run", async () => {
      let capturedCmd = "";
      const deps = makeDeps();
      deps.execAsync = (async (cmd: string) => {
        capturedCmd = cmd;
        if (cmd.includes("docker images -q")) {
          return { stdout: "abc123\n", stderr: "" };
        }
        return { stdout: "host output", stderr: "" };
      }) as BridgeDeps["execAsync"];

      const result = await execViaDockerHostBridge("cat /etc/os-release", { cwd: "/opt" }, deps);
      expect(result.code).toBe(0);
      expect(result.stdout).toBe("host output");
      expect(capturedCmd).toContain("docker run --rm");
      expect(capturedCmd).toContain("--privileged");
      expect(capturedCmd).toContain("--pid=host");
      expect(capturedCmd).toContain("groundcontrol-host-bridge:latest");
      expect(capturedCmd).toContain("-t 1 -m -u -i -n -p --");
      expect(capturedCmd).toContain("cat /etc/os-release");
      expect(capturedCmd).toContain("cd");
      expect(capturedCmd).toContain("/opt");
    });

    it("returns the command exit code on failure", async () => {
      const deps = makeDeps();
      deps.execAsync = (async (cmd: string) => {
        if (cmd.includes("docker images -q")) {
          return { stdout: "abc123\n", stderr: "" };
        }
        throw Object.assign(new Error("fail"), { code: 5, stdout: "", stderr: "err" });
      }) as BridgeDeps["execAsync"];

      const result = await execViaDockerHostBridge("false", undefined, deps);
      expect(result.code).toBe(5);
      expect(result.stderr).toBe("err");
    });

    it("passes stdin without exposing it in the docker command", async () => {
      let capturedCmd = "";
      let capturedInput = "";
      const deps = makeDeps();
      deps.execAsync = (async (cmd: string) => {
        if (cmd.includes("docker images -q")) {
          return { stdout: "abc123\n", stderr: "" };
        }
        throw new Error("unexpected execAsync call");
      }) as BridgeDeps["execAsync"];
      deps.execWithInput = async (cmd: string, input: string) => {
        capturedCmd = cmd;
        capturedInput = input;
        return { stdout: "Login Succeeded", stderr: "" };
      };

      const result = await execViaDockerHostBridge(
        "docker login ghcr.io --password-stdin",
        { stdin: "registry-token\n" },
        deps
      );

      expect(result.code).toBe(0);
      expect(capturedCmd).toContain("docker run --rm -i");
      expect(capturedCmd).not.toContain("registry-token");
      expect(capturedInput).toBe("registry-token\n");
    });

    it("fails fast when the bridge image cannot be ensured", async () => {
      const deps = makeDeps();
      deps.execAsync = (async (_cmd: string) => {
        throw Object.assign(new Error("build failed"), { code: 1, stdout: "", stderr: "build failed" });
      }) as BridgeDeps["execAsync"];

      const result = await execViaDockerHostBridge("true", undefined, deps);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("bridge image is not available");
    });
  });

  describe("execDetachedViaDockerHostBridge", () => {
    it("starts an ephemeral host-side runner owned by Docker", async () => {
      let capturedCmd = "";
      const deps = makeDeps();
      deps.execAsync = (async (cmd: string) => {
        if (cmd.includes("docker images -q")) {
          return { stdout: "abc123\n", stderr: "" };
        }
        capturedCmd = cmd;
        return { stdout: "runner123\n", stderr: "" };
      }) as BridgeDeps["execAsync"];

      const result = await execDetachedViaDockerHostBridge(
        "cd /opt/app && docker compose up -d",
        "/tmp/redeploy.log",
        deps
      );

      expect(result).toEqual({ stdout: "runner123", stderr: "", code: 0 });
      expect(capturedCmd).toContain("docker run -d --rm");
      expect(capturedCmd).toContain("--pid=host");
      expect(capturedCmd).toContain("docker compose up -d");
      expect(capturedCmd).toContain("/tmp/redeploy.log");
    });
  });
});
