import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { execOnVps, shQuote, type VpsConnection } from "./vps";
import { execOnTargetStrict } from "./host-exec";
import { isDesktopMode } from "./runtime";
import { HttpError } from "./errors";

export type SourceProject = {
  name: string;
  sourcePath: string;
  markers: string[];
  technologies: string[];
  composePath: string | null;
};

const composeNames = ["compose.yaml", "compose.yml", "docker-compose.yml", "docker-compose.yaml"];
const markers = [...composeNames, ".git", "package.json", "pyproject.toml", "requirements.txt", "Pipfile", "go.mod", "Cargo.toml", "pom.xml", "build.gradle", "build.gradle.kts", "*.csproj", "*.fsproj", "*.sln", "*.slnx", "Gemfile", "composer.json", "Dockerfile", "index.html"];
const ignored = ["node_modules", ".git", ".next", ".nuxt", ".venv", "venv", "vendor", "dist", "build", "target", "bin", "obj", ".cache", "coverage", "backups"];

export function normalizeSourcePath(input: unknown): string {
  const value = typeof input === "string" ? input.trim() : "";
  if (!value.startsWith("/") || value.length > 2048 || /[\x00-\x1f\x7f,]/.test(value)) {
    throw new HttpError("Enter the full folder path, such as /Users/you/Projects/my-app. Use the Linux path for a Linux or WSL server.", 400);
  }
  const normalized = path.posix.normalize(value).replace(/\/$/, "");
  if (!normalized || ["/Users", "/home", "/root", "/etc", "/proc", "/sys", "/dev", "/var", "/usr"].includes(normalized)) {
    throw new HttpError("Choose a project folder or a folder containing your projects, rather than a system folder.", 400);
  }
  return normalized;
}

export function describeSource(sourcePath: string, found: string[]): SourceProject {
  const names = [...new Set(found)].sort();
  const has = (...values: string[]) => values.some((value) => names.includes(value));
  const technologies = [
    has("package.json") && "JavaScript / TypeScript",
    has("pyproject.toml", "requirements.txt", "Pipfile") && "Python",
    has("go.mod") && "Go", has("Cargo.toml") && "Rust",
    has("pom.xml", "build.gradle", "build.gradle.kts") && "Java / Kotlin",
    names.some((name) => /\.(csproj|fsproj|sln|slnx)$/.test(name)) && ".NET",
    has("Gemfile") && "Ruby", has("composer.json") && "PHP",
    has("index.html") && "Static website", has("Dockerfile") && "Docker",
    has(...composeNames) && "Docker Compose", has(".git") && "Git",
  ].filter((value): value is string => Boolean(value));
  const compose = composeNames.find((name) => names.includes(name));
  return { name: path.posix.basename(sourcePath), sourcePath, markers: names, technologies, composePath: compose ? `${sourcePath}/${compose}` : null };
}

/** Names only: never reads secrets, executes project code, or follows nested symlinks. */
export function sourceScanCommand(root: string, recursive: boolean): string {
  const match = markers.map((name) => `-name ${shQuote(name)}`).join(" -o ");
  const prune = ignored.map((name) => `-name ${shQuote(name)}`).join(" -o ");
  return `cd ${shQuote(root)} && test -r . && test -x . && find . -maxdepth ${recursive ? 4 : 1} \\( -name .git -print0 -prune \\) -o \\( -type d \\( ${prune} \\) -prune \\) -o \\( -type f \\( ${match} \\) -print0 \\)`;
}

export function parseSourceScan(root: string, output: string): SourceProject[] {
  if (Buffer.byteLength(output) > 256 * 1024) throw new HttpError("This folder contains too many projects. Scan a smaller folder.", 400);
  const folders = new Map<string, string[]>();
  for (const entry of output.split("\0").filter(Boolean)) {
    if (!entry.startsWith("./") || /[\x00-\x1f\x7f]/.test(entry)) continue;
    const relative = entry.slice(2);
    const sourcePath = path.posix.join(root, path.posix.dirname(relative));
    if (sourcePath !== root && !sourcePath.startsWith(root + "/")) continue;
    const found = folders.get(sourcePath) || [];
    found.push(path.posix.basename(relative));
    folders.set(sourcePath, found);
  }
  if (folders.size > 150) throw new HttpError("More than 150 projects found. Choose a smaller folder to review.", 400);
  return [...folders].map(([folder, files]) => describeSource(folder, files)).sort((a, b) => a.sourcePath.localeCompare(b.sourcePath));
}

const readableMarker = "__GC_FOLDER_READY__\0";
function checkedFolderCommand(root: string, command: (root: string) => string) {
  return `cd ${shQuote(root)} || exit 66; test -r . && test -x . || exit 77; printf '__GC_FOLDER_READY__\\0'; ${command(root)}`;
}
export function folderReadError(result: { code: number; stderr?: string }, desktop: boolean): HttpError {
  const diagnostic = result.stderr || "";
  if (result.code === 124 || result.code === 137 || /timed out|timeout/i.test(diagnostic)) return new HttpError("This folder took too long to read. Open a smaller folder and try again.", 408, { code: "folder_timeout" });
  if (desktop && /mounts denied|not shared|file sharing|bind denied/i.test(diagnostic)) return new HttpError("Docker cannot access this location. Allow it in Docker Desktop → Settings → Resources → File sharing, or choose Workspace.", 403, { code: "folder_not_shared" });
  if (result.code === 77 || /permission denied|operation not permitted/i.test(diagnostic)) return new HttpError(desktop ? "Access to this folder is blocked. Allow Docker to access it in your computer’s privacy settings, or choose another folder." : "The server account cannot read this folder. Choose another folder or update its permissions.", 403, { code: "folder_permission" });
  if (result.code === 66 || /bind source path does not exist|no such file or directory|not a directory/i.test(diagnostic)) return new HttpError("This folder is no longer available. Go back to its parent and refresh the folder list.", 404, { code: "folder_missing" });
  return new HttpError(desktop ? "Could not open this folder. Check that Docker is running, then try again or choose Workspace." : "Could not read this folder on the selected server. Check the connection and try again.", 503, { code: "folder_unavailable" });
}

/** Run only built-in metadata commands against a read-only folder. */
export async function readProjectFolder(root: string, vps: VpsConnection | null, command: (mountedRoot: string) => string): Promise<{ output: string; warning?: string }> {
  let result;
  const desktop = Boolean(isDesktopMode() && vps?.isLocal);
  if (desktop) {
    const image = await execOnVps(`docker inspect --format '{{.Image}}' ${shQuote(os.hostname())}`, vps);
    if (image.code !== 0 || !/^sha256:[a-f0-9]{64}$/.test(image.stdout.trim())) throw new HttpError("Could not open a folder reader. Check that Docker is running, then try again.", 503);
    const reader = `gc-project-scan-${randomUUID()}`;
    try {
      result = await execOnVps([
        "docker run --rm --pull=never --network none --read-only --cap-drop ALL --security-opt no-new-privileges",
        "--pids-limit 32 --memory 96m --cpus 0.5 --label io.groundcontrol.internal=project-scan",
        `--name ${shQuote(reader)} --mount ${shQuote(`type=bind,src=${root},dst=/source,readonly`)} --entrypoint sh`,
        shQuote(image.stdout.trim()), "-c", shQuote(`timeout 15 sh -c ${shQuote(checkedFolderCommand("/source", command))}`),
      ].join(" "), vps);
    } finally {
      await execOnVps(`docker rm -f ${shQuote(reader)} >/dev/null 2>&1 || true`, vps);
    }
  } else result = await execOnTargetStrict(checkedFolderCommand(root, command), vps);
  const opened = result.stdout.startsWith(readableMarker);
  const output = opened ? result.stdout.slice(readableMarker.length) : result.stdout;
  if (result.code === 1 && opened && /^find:/m.test(result.stderr || "")) {
    return { output, warning: "Some items inside this folder were unavailable and were skipped. You can choose a project below or browse to a more specific folder." };
  }
  if (result.code !== 0) throw folderReadError(result, desktop);
  return { output };
}

export async function scanSourceFolder(input: unknown, vps: VpsConnection | null, recursive = true) {
  const root = normalizeSourcePath(input);
  const result = await readProjectFolder(root, vps, (mountedRoot) => sourceScanCommand(mountedRoot, recursive));
  const projects = parseSourceScan(root, result.output);
  return { root, projects, folder: projects.find((item) => item.sourcePath === root) || describeSource(root, []), ...(result.warning ? { warning: result.warning } : {}) };
}
