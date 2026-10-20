// @vitest-environment node
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ exec: vi.fn(), strict: vi.fn() }));
vi.mock("./vps", () => ({ execOnVps: mocks.exec, shQuote: (s: string) => `'${s.replace(/'/g, "'\\''")}'` }));
vi.mock("./host-exec", () => ({ execOnTargetStrict: mocks.strict }));
import { folderReadError, describeSource, normalizeSourcePath, parseSourceScan, scanSourceFolder, sourceScanCommand } from "./source-discovery";

const vps = { id: 1, isLocal: true, host: "localhost", port: 22, username: "root" };
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });

it("discovers real source projects, spaces and apostrophes, excluding dependencies, git internals and symlink escapes", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "gc-source-"));
  try {
    const files = ["web app/package.json", "web app/.git/config", "web app/node_modules/dependency/package.json", "web app/.next/package.json", "python's api/pyproject.toml", "dotnet/App.csproj", "rust/Cargo.toml", "go/go.mod", "outside/package.json"];
    for (const file of files) { await mkdir(path.dirname(path.join(root, file)), { recursive: true }); await writeFile(path.join(root, file), "do not execute or read me"); }
    await symlink(path.join(root, "outside"), path.join(root, "web app", "linked"));
    const { stdout } = await promisify(exec)(sourceScanCommand(root, true));
    const projects = parseSourceScan(root, stdout);
    expect(projects.map((p) => p.name)).toEqual(["dotnet", "go", "outside", "python's api", "rust", "web app"]);
    expect(projects.find((p) => p.name === "web app")?.technologies).toEqual(["JavaScript / TypeScript", "Git"]);
    expect(projects.find((p) => p.name === "dotnet")?.technologies).toEqual([".NET"]);
    const exact = await promisify(exec)(sourceScanCommand(path.join(root, "web app"), false));
    expect(parseSourceScan(path.join(root, "web app"), exact.stdout)).toHaveLength(1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("normalizes equivalent paths and rejects invalid or overly broad folder requests", () => {
  expect(normalizeSourcePath(" /Users/me/projects/../projects/demo/ ")).toBe("/Users/me/projects/demo");
  for (const input of ["", "relative", "/", "/Users", "/tmp/a\nb", "/tmp/a,readonly=false"]) expect(() => normalizeSourcePath(input)).toThrow();
  expect(describeSource("/home/me/site", ["compose.yml", "package.json"]).composePath).toBe("/home/me/site/compose.yml");
});

it("uses a read-only, isolated, pinned reader for an explicitly selected desktop folder and always cleans it up", async () => {
  vi.stubEnv("GC_DESKTOP_MODE", "1");
  mocks.exec.mockResolvedValue({ stdout: "", code: 0 }).mockResolvedValueOnce({ stdout: `sha256:${"a".repeat(64)}\n`, code: 0 }).mockResolvedValueOnce({ stdout: "./package.json\0", code: 0 });
  const scan = await scanSourceFolder("/Users/test/my app", vps);
  expect(scan.folder.technologies).toEqual(["JavaScript / TypeScript"]);
  const command = mocks.exec.mock.calls[1][0];
  expect(command).toContain("--network none --read-only --cap-drop ALL");
  expect(command).toContain("src=/Users/test/my app,dst=/source,readonly");
  expect(command).toContain("--entrypoint sh");
  expect(command).not.toMatch(/--privileged|--pid=host|docker-entrypoint/);
  expect(mocks.exec.mock.calls[2][0]).toMatch(/^docker rm -f 'gc-project-scan-/);
  expect(mocks.strict).not.toHaveBeenCalled();
});

it("reports unreadable desktop folders and removes the reader after a failure", async () => {
  vi.stubEnv("GC_DESKTOP_MODE", "1");
  mocks.exec.mockResolvedValue({ stdout: "", code: 0 }).mockResolvedValueOnce({ stdout: `sha256:${"b".repeat(64)}`, code: 0 }).mockResolvedValueOnce({ stdout: "", stderr: "bind denied", code: 1 });
  await expect(scanSourceFolder("/Users/test/missing", vps)).rejects.toThrow("File sharing");
  expect(mocks.exec.mock.calls[2][0]).toContain("docker rm -f");
});

it("uses the selected remote server even when GroundControl runs on a PC", async () => {
  vi.stubEnv("GC_DESKTOP_MODE", "1");
  const remote = { ...vps, id: 2, isLocal: false };
  mocks.strict.mockResolvedValue({ stdout: "./requirements.txt\0", code: 0 });
  const scan = await scanSourceFolder("/home/me/api", remote);
  expect(scan.folder.technologies).toEqual(["Python"]);
  expect(mocks.strict).toHaveBeenCalledWith(expect.stringContaining("cd '/home/me/api'"), remote);
  expect(mocks.exec).not.toHaveBeenCalled();
});

it("keeps partial project results when an unavailable child breaks find", async () => {
  vi.stubEnv("GC_DESKTOP_MODE", "0");
  mocks.strict.mockResolvedValue({ stdout: "__GC_FOLDER_READY__\0./web/package.json\0", stderr: "find: ./.Trash: No such file or directory", code: 1 });
  const scan = await scanSourceFolder("/Users/me", { ...vps, isLocal: false });
  expect(scan.projects[0].name).toBe("web"); expect(scan.warning).toContain("skipped");
});
it("distinguishes missing, shared-folder, permission and timeout failures", () => {
  expect(folderReadError({ code: 125, stderr: "bind source path does not exist" }, true).code).toBe("folder_missing");
  expect(folderReadError({ code: 125, stderr: "Mounts denied" }, true).code).toBe("folder_not_shared");
  expect(folderReadError({ code: 77 }, false).code).toBe("folder_permission");
  expect(folderReadError({ code: 66, stderr: "cd: permission denied" }, false).code).toBe("folder_permission");
  expect(folderReadError({ code: 124 }, true).code).toBe("folder_timeout");
});
