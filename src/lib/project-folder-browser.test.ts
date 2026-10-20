// @vitest-environment node
import { expect, it, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
vi.mock("./source-discovery", async (load) => { const original = await load<typeof import("./source-discovery")>(); return { ...original, readProjectFolder: vi.fn(async (root, _vps, command) => ({ output: execFileSync("sh", ["-c", command(root)], { encoding: "utf8" }) })) }; });
import { browseProjectFolders, desktopFolderRoots, folderListCommand, parseFolderListing } from "./project-folder-browser";
it("browses immediate directories including spaces, without files or symlink targets", async () => {
  const dir = await mkdtemp(join(tmpdir(), "folder-browser-"));
  try {
    await mkdir(join(dir, "My project")); await mkdir(join(dir, ".hidden")); await writeFile(join(dir, "secret.env"), "never read"); await symlink("My project", join(dir, "link")); await symlink("/unavailable/.Trash", join(dir, ".Trash"));
    const result = execFileSync("sh", ["-c", folderListCommand(dir)], { encoding: "utf8" });
    expect(parseFolderListing(dir, result).map((item) => item.name)).toEqual(["My project"]);
    expect(parseFolderListing(dir, result, true).map((item) => item.name)).toEqual([".hidden", "My project"]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
it("derives PC roots, navigates breadcrumbs and rejects paths outside those roots", async () => {
  const dir = await mkdtemp(join(tmpdir(), "folder-roots-")); await mkdir(join(dir, "project"));
  vi.stubEnv("GC_DESKTOP_MODE", "1"); vi.stubEnv("GC_WORKSPACE_ROOT", dir); vi.stubEnv("GC_HOST_HOME", dir);
  const vps = { id: 1, host: "localhost", port: 22, username: "me", isLocal: true };
  try {
    expect(desktopFolderRoots("/Users/me/GC/workspace").map((item) => item.path)).toEqual(["/Users/me", "/Users/me/GC/workspace", "/Volumes"]);
    const home = await browseProjectFolders(undefined, vps); expect(home.path).toBe(dir); expect(home.parentPath).toBeNull();
    const child = await browseProjectFolders(join(dir, "project"), vps); expect(child.parentPath).toBe(dir); expect(child.breadcrumbs).toHaveLength(2);
    await expect(browseProjectFolders("/etc", vps)).rejects.toThrow("available locations");
    await expect(browseProjectFolders(`${dir}/../../etc`, vps)).rejects.toThrow("available locations");
    expect((await browseProjectFolders(join(dir, "missing"), vps)).canSelect).toBe(false);
  } finally { vi.unstubAllEnvs(); await rm(dir, { recursive: true, force: true }); }
});
it("keeps usable listings when macOS reports a broken child, but rejects an unreadable root", async () => {
  const dir = await mkdtemp(join(tmpdir(), "folder-partial-"));
  try {
    await mkdir(join(dir, "Documents"));
    const partial = `ls() { printf 'Documents\\n'; printf 'ls: .Trash: No such file or directory\\n' >&2; return 1; }; `;
    expect(parseFolderListing(dir, execFileSync("sh", ["-c", partial + folderListCommand(dir)], { encoding: "utf8" })).map((f) => f.name)).toEqual(["Documents"]);
    const denied = `ls() { printf 'ls: .: Permission denied\\n' >&2; return 1; }; `;
    expect(spawnSync("sh", ["-c", denied + folderListCommand(dir)]).status).toBe(77);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
