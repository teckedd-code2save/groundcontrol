import path from "node:path";
import { getSystemConfig, shQuote, type VpsConnection } from "./vps";
import { isDesktopMode } from "./runtime";
import { HttpError } from "./errors";
import { normalizeSourcePath, readProjectFolder } from "./source-discovery";

type Folder = { name: string; path: string };
export type FolderListing = {
  path: string; name: string; parentPath: string | null;
  error?: string; errorCode?: string; warning?: string; roots: Folder[]; breadcrumbs: Folder[]; folders: Folder[]; canSelect: boolean;
};

function cleanPath(input: unknown) {
  if (typeof input !== "string" || !input.startsWith("/") || input.length > 2048 || /[\x00-\x1f\x7f,]/.test(input)) throw new HttpError("Choose a folder from the browser.", 400);
  return path.posix.normalize(input).replace(/\/$/, "") || "/";
}
function within(folder: string, root: string) { return root === "/" || folder === root || folder.startsWith(root + "/"); }

export function desktopFolderRoots(workspace: string, hostHome?: string): Folder[] {
  const shared = cleanPath(workspace);
  const home = hostHome || shared.match(/^(\/(?:Users|home)\/[^/]+)(?:\/|$)/)?.[1] || (shared.startsWith("/root/") ? "/root" : null);
  const roots: Folder[] = [];
  if (home && cleanPath(home) !== "/") roots.push({ name: "Home", path: cleanPath(home) });
  if (!roots.some((root) => root.path === shared) && shared !== "/") roots.push({ name: "Workspace", path: shared });
  if (home?.startsWith("/Users/")) roots.push({ name: "Drives", path: "/Volumes" });
  return roots;
}

/** One level of directory names only; files and symlink targets are never read. */
export function folderListCommand(root: string) {
  // Checking entries individually avoids a broken macOS virtual entry (such as
  // .Trash) making an otherwise readable Home folder fail as a whole.
  return `cd ${shQuote(root)} || exit 66; listing=$(ls -A . 2>/dev/null); listing_status=$?; if [ "$listing_status" -ne 0 ] && [ -z "$listing" ]; then exit 77; fi; for entry in ./* ./.[!.]* ./..?*; do [ -L "$entry" ] && continue; [ -d "$entry" ] && printf '%s\\0' "$entry"; done; exit 0`;
}

export function parseFolderListing(root: string, output: string, showHidden = false): Folder[] {
  if (Buffer.byteLength(output) > 256 * 1024) throw new HttpError("This folder has too many entries to display. Choose a more specific location.", 400);
  const names = [...new Set(output.split("\0").filter((entry) => entry.startsWith("./")).map((entry) => entry.slice(2)))];
  return names.filter((name) => name && !name.includes("/") && !/[\x00-\x1f\x7f,]/.test(name) && name !== "." && name !== ".." && (showHidden || !name.startsWith(".")))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }))
    .map((name) => ({ name, path: path.posix.join(root, name) }));
}

export async function browseProjectFolders(input: unknown, vps: VpsConnection | null, showHidden = false): Promise<FolderListing> {
  if (!vps) throw new HttpError("Choose a connection before browsing folders.", 400);
  const desktop = isDesktopMode() && vps.isLocal;
  const roots = desktop
    ? desktopFolderRoots(process.env.GC_WORKSPACE_ROOT || "", process.env.GC_HOST_HOME)
    : [{ name: "Project folders", path: cleanPath((await getSystemConfig()).projectRoot || "/opt") }, { name: "Server", path: "/" }];
  if (!roots.length) throw new HttpError("This installation has no shared folder to browse. Rerun local setup to connect a workspace.", 400);
  const current = input == null || input === "" ? roots[0].path : cleanPath(input);
  // Desktop navigation stays on actual PC mounts, never the Docker VM root.
  const boundary = roots.find((root) => within(current, root.path));
  if (!boundary) throw new HttpError("Choose a folder under one of the available locations.", 400);
  let folders: Folder[] = [];
  let error: string | undefined; let errorCode: string | undefined; let warning: string | undefined;
  try { const result = await readProjectFolder(current, vps, folderListCommand); folders = parseFolderListing(current, result.output, showHidden); warning = result.warning; }
  catch (failure) { error = failure instanceof HttpError ? failure.message : "Could not open this location. Choose another location or try again."; errorCode = failure instanceof HttpError ? failure.code : undefined; }
  const breadcrumbs: Folder[] = [boundary];
  const relative = path.posix.relative(boundary.path, current);
  let cursor = boundary.path;
  for (const name of relative.split("/").filter(Boolean)) { cursor = path.posix.join(cursor, name); breadcrumbs.push({ name, path: cursor }); }
  let canSelect = true;
  try { normalizeSourcePath(current); } catch { canSelect = false; }
  const parent = path.posix.dirname(current);
  return { path: current, name: path.posix.basename(current) || "Server", parentPath: current !== boundary.path && within(parent, boundary.path) ? parent : null, roots, breadcrumbs, folders, canSelect: canSelect && !error, ...(error ? { error, errorCode } : {}), ...(warning ? { warning } : {}) };
}
