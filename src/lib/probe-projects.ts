// src/lib/probe-projects.ts
//
// Discover project directories on the VPS by finding docker-compose
// files and detecting tech stacks. More thorough than scanProjectsTree
// because it searches multiple root paths and tags projects with tech hints.

import { execOnTarget } from "./host-exec";
import { shQuote } from "./vps";

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
  // Find all compose files across common project directories
  const composeFiles = await execOnTarget(
    `find /opt /srv /var/www /home /data /apps -maxdepth 4 -name 'docker-compose*.yml' -o -name 'docker-compose*.yaml' -o -name 'compose*.yml' -o -name 'compose*.yaml' 2>/dev/null | head -40 || echo ""`
  );

  if (!composeFiles.stdout.trim()) return [];

  const projects: DiscoveredProject[] = [];
  const seen = new Set<string>();

  for (const line of composeFiles.stdout.split("\n")) {
    if (!line.trim()) continue;
    const dir = line.replace(/\/[^/]+$/, ""); // parent dir
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
    `grep -E '^  [a-zA-Z0-9_.-]+:' ${shQuote(composePath)} 2>/dev/null | head -20 || echo ""`
  );
  // Filter out property keys (image:, ports:, etc.) to keep only service names
  const propertyKeys = new Set(["image", "build", "ports", "volumes", "environment", "env_file", 
    "depends_on", "restart", "networks", "labels", "container_name", "command", "entrypoint",
    "healthcheck", "deploy", "logging", "dns", "extra_hosts", "cap_add", "security_opt"]);
  
  const services: string[] = [];
  for (const line of result.stdout.split("\n")) {
    const match = line.match(/^  ([a-zA-Z0-9_.-]+):/);
    if (match && !propertyKeys.has(match[1])) {
      services.push(match[1]);
    }
  }
  return services;
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
