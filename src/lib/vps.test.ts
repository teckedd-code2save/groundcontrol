import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VpsConnection } from "./vps";
import {
  computeChangedFields,
  execDetached,
  execOnVps,
  getContainerLogs,
  getDockerContainers,
  getDockerStats,
  getImageDigest,
  getKubeconfigEnv,
  getPreviousDeploymentDigest,
  getSystemStats,
  shQuote,
} from "./vps";

/**
 * The VPS execution layer (src/lib/vps.ts) is the heart of GroundControl:
 * every remote/host command flows through execOnVps(). These tests lock down
 * the shell-quoting contract and the local/SSH execution paths with mocked
 * child_process + node-ssh — deterministic, no network, no Docker, no DB.
 */

const { execMock, spawnMock, prismaMocks, sshMocks } = vi.hoisted(() => ({
  execMock: vi.fn(),
  spawnMock: vi.fn(() => ({ unref: vi.fn() })),
  prismaMocks: {
    vpsConfigFindFirst: vi.fn(),
    vpsConfigFindUnique: vi.fn(),
    projectFindUnique: vi.fn(),
    deploymentFindFirst: vi.fn(),
  },
  sshMocks: {
    connect: vi.fn(),
    execCommand: vi.fn(),
    dispose: vi.fn(),
  },
}));

vi.mock("child_process", () => ({
  default: { exec: execMock, spawn: spawnMock },
  exec: execMock,
  spawn: spawnMock,
}));

// child_process.exec's real util.promisify resolves { stdout, stderr }. A plain
// vi.fn falls back to the DEFAULT promisify (resolves an array), which would
// break `const { stdout } = await execAsync(...)`. Provide the real shape.
vi.mock("util", () => ({
  default: {
    promisify:
      (fn: (...args: unknown[]) => unknown) =>
      (...args: unknown[]) =>
        new Promise((resolve, reject) => {
          fn(...args, (err: unknown, stdout?: string, stderr?: string) => {
            if (err) reject(err);
            else resolve({ stdout: stdout ?? "", stderr: stderr ?? "" });
          });
        }),
  },
  promisify:
    (fn: (...args: unknown[]) => unknown) =>
    (...args: unknown[]) =>
      new Promise((resolve, reject) => {
        fn(...args, (err: unknown, stdout?: string, stderr?: string) => {
          if (err) reject(err);
          else resolve({ stdout: stdout ?? "", stderr: stderr ?? "" });
        });
      }),
}));

vi.mock("node-ssh", () => ({
  default: {
    NodeSSH: class {
      connect = sshMocks.connect;
      execCommand = sshMocks.execCommand;
      dispose = sshMocks.dispose;
    },
  },
  NodeSSH: class {
    connect = sshMocks.connect;
    execCommand = sshMocks.execCommand;
    dispose = sshMocks.dispose;
  },
}));

vi.mock("./prisma", () => ({
  prisma: {
    vpsConfig: {
      findFirst: prismaMocks.vpsConfigFindFirst,
      findUnique: prismaMocks.vpsConfigFindUnique,
    },
    project: { findUnique: prismaMocks.projectFindUnique },
    deployment: { findFirst: prismaMocks.deploymentFindFirst },
  },
}));

const LOCAL_CONN: VpsConnection = {
  id: 1,
  host: "local",
  port: 0,
  username: "root",
  isLocal: true,
};

const REMOTE_CONN: VpsConnection = {
  id: -1, // transient (id <= 0) → no DB round-trip
  host: "10.0.0.5",
  port: 22,
  username: "root",
  isLocal: false,
  authType: "key",
  privateKey: "-----BEGIN OPENSSH PRIVATE KEY-----",
};

type ExecCallback = (error: unknown, stdout?: string, stderr?: string) => void;

/** Stub child_process.exec to answer per-command substring → stdout. */
function stubExec(responses: Record<string, string>): void {
  execMock.mockImplementation(
    (command: string, _opts: unknown, cb: ExecCallback) => {
      const match = Object.keys(responses).find((key) => command.includes(key));
      cb(null, match ? responses[match] : "", "");
      return { stdin: { end: () => {} } };
    }
  );
}

describe("shQuote — POSIX single-quote escaping", () => {
  it("wraps a plain value in single quotes", () => {
    expect(shQuote("hello")).toBe("'hello'");
  });

  it("keeps spaces inside the quotes", () => {
    expect(shQuote("hello world")).toBe("'hello world'");
  });

  it("escapes embedded single quotes with the classic '\\'' sequence", () => {
    expect(shQuote("it's")).toBe("'it'\\''s'");
    expect(shQuote("a'b'c")).toBe("'a'\\''b'\\''c'");
  });

  it("quotes an empty string as two adjacent quotes", () => {
    expect(shQuote("")).toBe("''");
  });

  it("preserves unicode characters", () => {
    expect(shQuote("héllo 世界 🚀")).toBe("'héllo 世界 🚀'");
  });

  it("treats newlines as literal characters inside quotes", () => {
    expect(shQuote("line1\nline2")).toBe("'line1\nline2'");
  });

  it("neutralizes command substitution and glob metacharacters", () => {
    expect(shQuote("$(rm -rf /)")).toBe("'$(rm -rf /)'");
    expect(shQuote("`id`")).toBe("'`id`'");
    expect(shQuote("*.log")).toBe("'*.log'");
    expect(shQuote("a;b && c")).toBe("'a;b && c'");
  });

  it("coerces non-string values to strings", () => {
    expect(shQuote(42 as unknown as string)).toBe("'42'");
  });
});

describe("execOnVps — local execution", () => {
  beforeEach(() => {
    execMock.mockReset();
  });

  it("runs the command with the host PATH export and returns stdout", async () => {
    stubExec({ "echo hello": "hello\n" });
    const result = await execOnVps("echo hello", LOCAL_CONN);

    expect(result).toEqual({ stdout: "hello\n", stderr: "", code: 0 });
    const [command, opts] = execMock.mock.calls[0] as [string, { timeout: number; cwd?: string }];
    expect(command).toMatch(/^export PATH="[^"]+:\$PATH"; echo hello$/);
    expect(opts.timeout).toBe(30000);
  });

  it("passes cwd through to the local process", async () => {
    stubExec({ "pwd": "/opt/app" });
    await execOnVps("pwd", LOCAL_CONN, "/opt/app");
    const [, opts] = execMock.mock.calls[0] as [string, { cwd?: string }];
    expect(opts.cwd).toBe("/opt/app");
  });

  it("returns the exit code and stderr when the command fails", async () => {
    execMock.mockImplementation((_cmd: string, _opts: unknown, cb: ExecCallback) => {
      const error = Object.assign(new Error("command failed"), {
        code: 2,
        stdout: "partial output",
        stderr: "boom",
      });
      cb(error, "partial output", "boom");
    });

    const result = await execOnVps("false", LOCAL_CONN);
    expect(result).toEqual({ stdout: "partial output", stderr: "boom", code: 2 });
  });

  it("writes stdin to the child process", async () => {
    const stdinEnd = vi.fn();
    execMock.mockImplementation((_cmd: string, _opts: unknown, cb: ExecCallback) => {
      cb(null, "echoed", "");
      return { stdin: { end: stdinEnd } };
    });

    const result = await execOnVps("cat", LOCAL_CONN, undefined, "payload");
    expect(result.stdout).toBe("echoed");
    expect(stdinEnd).toHaveBeenCalledWith("payload");
  });

  it("throws a descriptive error when no VPS is configured", async () => {
    prismaMocks.vpsConfigFindFirst.mockResolvedValue(null);
    await expect(execOnVps("echo hi")).rejects.toThrow("No VPS configured");
  });
});

describe("execOnVps — SSH execution", () => {
  beforeEach(() => {
    sshMocks.connect.mockReset();
    sshMocks.execCommand.mockReset();
  });

  it("connects with credentials and runs the command over SSH", async () => {
    sshMocks.connect.mockResolvedValue(undefined as never);
    sshMocks.execCommand.mockResolvedValue({ stdout: "hello\n", stderr: "", code: 0 } as never);

    const result = await execOnVps("echo hello", REMOTE_CONN);

    expect(result).toEqual({ stdout: "hello\n", stderr: "", code: 0 });
    expect(sshMocks.connect).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "10.0.0.5",
        port: 22,
        username: "root",
        privateKey: "-----BEGIN OPENSSH PRIVATE KEY-----",
      })
    );
    const [command, opts] = sshMocks.execCommand.mock.calls[0] as [string, { cwd: string }];
    expect(command).toMatch(/^export PATH="[^"]+:\$PATH"; echo hello$/);
    expect(opts.cwd).toBe("/root");
  });

  it("forwards stdin to the remote command", async () => {
    sshMocks.connect.mockResolvedValue(undefined as never);
    sshMocks.execCommand.mockResolvedValue({ stdout: "", stderr: "", code: 0 } as never);

    await execOnVps("cat", REMOTE_CONN, undefined, "secret");

    const [, opts] = sshMocks.execCommand.mock.calls[0] as [string, { stdin?: string }];
    expect(opts.stdin).toBe("secret");
  });
});

describe("execDetached — self-redeploy-safe detached execution", () => {
  it("wraps the command in nohup and unrefs the child", () => {
    execDetached("docker compose up -d");
    expect(spawnMock).toHaveBeenCalledWith(
      "nohup sh -c 'docker compose up -d' > /dev/null 2>&1 &",
      [],
      expect.objectContaining({ shell: true, detached: true, stdio: "ignore" })
    );
  });

  it("redirects output to a file when requested", () => {
    execDetached("deploy.sh", "/tmp/deploy.log");
    expect(spawnMock).toHaveBeenCalledWith(
      "nohup sh -c 'deploy.sh' > '/tmp/deploy.log' 2>&1 &",
      [],
      expect.anything()
    );
  });

  it("appends when the append option is set", () => {
    execDetached("deploy.sh", "/tmp/deploy.log", { append: true });
    expect(spawnMock).toHaveBeenCalledWith(
      "nohup sh -c 'deploy.sh' >> '/tmp/deploy.log' 2>&1 &",
      [],
      expect.anything()
    );
  });
});

describe("Docker helpers — output parsing", () => {
  beforeEach(() => {
    execMock.mockReset();
  });

  it("parses docker ps lines into container records", async () => {
    stubExec({
      "docker ps -a --format":
        "web|nginx:latest|Up 2 hours|0.0.0.0:80->80/tcp|abc123|running\napi|node:20|Exited (0) 1 hour ago||def456|exited",
    });

    const containers = await getDockerContainers(LOCAL_CONN);
    expect(containers).toHaveLength(2);
    expect(containers[0]).toEqual({
      name: "web",
      image: "nginx:latest",
      status: "Up 2 hours",
      ports: "0.0.0.0:80->80/tcp",
      id: "abc123",
      state: "running",
    });
    expect(containers[1].state).toBe("exited");
  });

  it("returns an empty list when docker ps produces no output", async () => {
    stubExec({ "docker ps -a --format": "" });
    expect(await getDockerContainers(LOCAL_CONN)).toEqual([]);
  });

  it("parses docker stats lines", async () => {
    stubExec({
      "docker stats --no-stream":
        "web|0.50%|10MiB / 100MiB|1kB / 2kB|3kB / 4kB|5",
    });

    const stats = await getDockerStats(LOCAL_CONN);
    expect(stats).toEqual([
      { name: "web", cpu: "0.50%", mem: "10MiB / 100MiB", net: "1kB / 2kB", block: "3kB / 4kB", pids: "5" },
    ]);
  });

  it("resolves the image digest and trims whitespace", async () => {
    stubExec({
      "docker inspect": "myapp@sha256:deadbeef\n",
    });
    expect(await getImageDigest("myapp", LOCAL_CONN)).toBe("myapp@sha256:deadbeef");
  });

  it("returns null when no digest is available", async () => {
    stubExec({ "docker inspect": "" });
    expect(await getImageDigest("myapp", LOCAL_CONN)).toBeNull();
  });

  it("clamps the log tail to the supported range", async () => {
    stubExec({ "docker logs": "line" });

    await getContainerLogs("web", 99999, LOCAL_CONN);
    await getContainerLogs("web", -5, LOCAL_CONN);
    await getContainerLogs("web", 0, LOCAL_CONN);

    const commands = execMock.mock.calls.map((c) => c[0] as string);
    expect(commands[0]).toContain("--tail 5000");
    expect(commands[1]).toContain("--tail 1");
    expect(commands[2]).toContain("--tail 100");
  });
});

describe("getSystemStats — /proc and free/df parsing", () => {
  beforeEach(() => {
    execMock.mockReset();
  });

  it("parses uptime, load, memory, disk, and CPU count", async () => {
    stubExec({
      "cat /proc/uptime": "1234.56",
      "cat /proc/loadavg": "0.05 0.10 0.15",
      "free -m": "1024.00 2048.00 900.00",
      "df -h /": "12G 40G 28G 30%",
      "nproc": "4",
    });

    const stats = await getSystemStats(LOCAL_CONN);
    expect(stats.uptime).toBeCloseTo(1234.56);
    expect(stats.load).toEqual([0.05, 0.1, 0.15]);
    expect(stats.memory).toEqual({ used: 1024, total: 2048, free: 900, percent: "50.0" });
    expect(stats.disk).toEqual({ used: "12G", total: "40G", available: "28G", percent: "30" });
    expect(stats.cpuCount).toBe(4);
  });
});

describe("deployment change tracking", () => {
  it("treats the first deployment as an initial change", () => {
    expect(computeChangedFields(null, { imageDigest: "a", envHash: "h" })).toEqual(["initial"]);
  });

  it("detects an image change", () => {
    expect(
      computeChangedFields(
        { imageDigest: "img@sha256:old", envHash: "h" },
        { imageDigest: "img@sha256:new", envHash: "h" }
      )
    ).toEqual(["image"]);
  });

  it("detects an env change", () => {
    expect(
      computeChangedFields(
        { imageDigest: "img@sha256:old", envHash: "h1" },
        { imageDigest: "img@sha256:old", envHash: "h2" }
      )
    ).toEqual(["env"]);
  });

  it("detects both changes at once", () => {
    expect(
      computeChangedFields(
        { imageDigest: "old", envHash: "h1" },
        { imageDigest: "new", envHash: "h2" }
      )
    ).toEqual(["image", "env"]);
  });

  it("reports no changes when nothing differs", () => {
    expect(
      computeChangedFields(
        { imageDigest: "img@sha256:x", envHash: "h" },
        { imageDigest: "img@sha256:x", envHash: "h" }
      )
    ).toEqual([]);
  });
});

describe("rollback digest lookup", () => {
  it("returns the pinned digest of the latest successful deployment", async () => {
    prismaMocks.projectFindUnique.mockResolvedValue({ id: 1, slug: "myapp" });
    prismaMocks.deploymentFindFirst.mockResolvedValue({ imageDigest: "myapp@sha256:abc123" });

    expect(await getPreviousDeploymentDigest("myapp")).toBe("myapp@sha256:abc123");
    expect(prismaMocks.deploymentFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          projectId: 1,
          status: "success",
          imageDigest: { not: null },
        }),
      })
    );
  });

  it("returns null when the project does not exist", async () => {
    prismaMocks.projectFindUnique.mockResolvedValue(null);
    expect(await getPreviousDeploymentDigest("ghost")).toBeNull();
  });

  it("returns null when no previous successful deployment exists", async () => {
    prismaMocks.projectFindUnique.mockResolvedValue({ id: 1, slug: "myapp" });
    prismaMocks.deploymentFindFirst.mockResolvedValue(null);
    expect(await getPreviousDeploymentDigest("myapp")).toBeNull();
  });
});

describe("getKubeconfigEnv", () => {
  it("exports the default kubeconfig path via a quoted env var", () => {
    expect(getKubeconfigEnv()).toBe("KUBECONFIG='/etc/rancher/k3s/k3s.yaml'");
  });
});

afterEach(() => {
  vi.clearAllMocks();
});
