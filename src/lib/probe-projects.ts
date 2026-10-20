// src/lib/probe-projects.ts
//
// Discover project directories on the VPS by finding docker-compose
// files and detecting tech stacks. More thorough than scanProjectsTree
// because it searches multiple root paths and tags projects with tech hints.

import { execOnTarget } from "./host-exec";
import { getActiveVps, shQuote } from "./vps";
import { isDesktopMode } from "./runtime";

export interface DiscoveredProject {
  path: string;
  composePath: string;
  hasCompose: boolean;
  hasDockerfile: boolean;
  hasPackageJson: boolean;
  hasGit: boolean;
  techHints: string[];
  composeServices: string[];
}

export async function probeProjects(): Promise<DiscoveredProject[]> {
  const desktop = isDesktopMode() && (await getActiveVps())?.isLocal;
  const roots = desktop && process.env.GC_WORKSPACE_ROOT
    ? shQuote(process.env.GC_WORKSPACE_ROOT)
    : "/opt /srv /var/www /home /data /apps";
  // Find all compose files across common project directories
  const composeFiles = await execOnTarget(
    `find ${roots} -maxdepth 4 -type f \\( -name 'docker-compose*.yml' -o -name 'docker-compose*.yaml' -o -name 'compose*.yml' -o -name 'compose*.yaml' \\) 2>/dev/null | head -40 || echo ""`
  );

  if (!composeFiles.stdout.trim()) return [];

  const projects: DiscoveredProject[] = [];
  const seen = new Set<string>();

  for (const line of composeFiles.stdout.split("\n")) {
    if (!line.trim()) continue;
    if (/\/groundcontrol\/backups\//.test(line)) continue;
    const dir = line.replace(/\/[^/]+$/, ""); // parent dir
    if (dir === "/opt/groundcontrol") continue;
    if (seen.has(dir)) continue;
    seen.add(dir);

    const [pkg, dockerfile, git, services] = await Promise.all([
      execOnTarget(`test -f ${shQuote(dir)}/package.json && echo yes || echo no`),
      execOnTarget(`test -f ${shQuote(dir)}/Dockerfile && echo yes || echo no`),
      execOnTarget(`test -d ${shQuote(dir)}/.git && echo yes || echo no`),
      parseComposeServiceNames(line),
    ]);

    const techHints = await detectTechStack(dir);

    projects.push({
      path: dir,
      composePath: line,
      hasCompose: true,
      hasDockerfile: dockerfile.stdout.trim() === "yes",
      hasPackageJson: pkg.stdout.trim() === "yes",
      hasGit: git.stdout.trim() === "yes",
      techHints,
      composeServices: services,
    });
  }

  return projects;
}

async function parseComposeServiceNames(composePath: string): Promise<string[]> {
  const result = await execOnTarget(
    `docker compose -f ${shQuote(composePath)} config --services 2>/dev/null || docker-compose -f ${shQuote(composePath)} config --services 2>/dev/null || true`
  );
  return [...new Set(result.stdout.split("\n").map((name) => name.trim()).filter((name) => /^[a-zA-Z0-9_.-]+$/.test(name)))];
}

async function detectTechStack(dir: string): Promise<string[]> {
  const hints: string[] = [];
  
  const checks = [
    { file: "package.json", hint: "Node.js" },
    { file: "requirements.txt", hint: "Python" },
    { file: "pyproject.toml", hint: "Python" },
    { file: "Cargo.toml", hint: "Rust" },
    { file: "go.mod", hint: "Go" },
    { file: "Gemfile", hint: "Ruby" },
    { file: "composer.json", hint: "PHP" },
    { file: "mix.exs", hint: "Elixir" },
    { file: "pom.xml", hint: "Java" },
    { file: "build.gradle", hint: "Java" },
    { file: "CMakeLists.txt", hint: "C/C++" },
  ];

  for (const { file, hint } of checks) {
    const result = await execOnTarget(
      `test -f ${shQuote(dir)}/${shQuote(file)} && echo yes || echo no`
    );
    if (result.stdout.trim() === "yes") hints.push(hint);
  }

  return hints;
}
