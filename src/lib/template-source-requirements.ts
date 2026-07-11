/**
 * Template source requirements — what the chosen template needs from the
 * source before deploy. Used for early validation (UI + API), not only at
 * docker compose up time.
 *
 * IMPORTANT: keep this module free of Node-only imports (fs/path) so the
 * Templates UI can import the plan helpers in the browser.
 */

/** Minimal template shape (avoids coupling to template-engine Node loaders). */
export interface TemplateLike {
  category?: string;
  deploy_mode?: string;
  services: { build?: boolean; name?: string }[];
  inputs: { name: string }[];
  components?: { kind?: string }[];
  requires?: { docker?: boolean };
}

export type SourceMode = "github" | "ghcr" | "local" | "none";

export interface TemplateSourceRequirement {
  id: string;
  label: string;
  /** GitHub Contents API path relative to repo root, or local relative path. */
  path: string;
  /** If true, at least one of the group (same group id) must exist. */
  group?: string;
  /** Soft requirement — warn but don't block. */
  optional?: boolean;
}

export interface TemplateSourcePlan {
  deployMode: "compose" | "static";
  /** Allowed source pickers for this template. */
  allowedSources: SourceMode[];
  requiresDockerfile: boolean;
  requiresGitOrLocal: boolean;
  requiresImage: boolean;
  /** Hard file checks against the source tree. */
  requirements: TemplateSourceRequirement[];
  summary: string;
}

export function isStaticTemplateLike(template: TemplateLike): boolean {
  return template.deploy_mode === "static" || template.category === "static";
}

export function getTemplateSourcePlan(template: TemplateLike): TemplateSourcePlan {
  const usesBuild = (template.services || []).some((s) => s.build);
  const imageInputs = (template.inputs || []).filter(
    (i) => i.name.endsWith("_image") || i.name === "app_image"
  );
  const requiresImage = imageInputs.length > 0 && !usesBuild && !isStaticTemplateLike(template);

  if (isStaticTemplateLike(template)) {
    return {
      deployMode: "static",
      allowedSources: ["github", "local"],
      requiresDockerfile: false,
      requiresGitOrLocal: true,
      requiresImage: false,
      requirements: [
        {
          id: "index_html",
          label: "index.html at site root (or in output_dir after build)",
          path: "index.html",
          group: "entry",
          optional: true, // build_command may produce it
        },
        {
          id: "any_web_file",
          label: "At least one web file (html/css/js) or a package.json for a build step",
          path: "",
          group: "entry",
        },
      ],
      summary:
        "Static site: clone from Git or a VPS path. No Docker. Needs HTML (or a build that outputs it).",
    };
  }

  if (usesBuild) {
    return {
      deployMode: "compose",
      allowedSources: ["github", "local"],
      requiresDockerfile: true,
      requiresGitOrLocal: true,
      requiresImage: false,
      requirements: [
        {
          id: "dockerfile",
          label: "Dockerfile at repository root",
          path: "Dockerfile",
        },
      ],
      summary: "Source build: Git or local path with a Dockerfile at the root.",
    };
  }

  if (requiresImage) {
    return {
      deployMode: "compose",
      allowedSources: ["ghcr", "github", "local"],
      requiresDockerfile: false,
      requiresGitOrLocal: false,
      requiresImage: true,
      requirements: [],
      summary: "Image-based stack: provide a container image (GHCR) or use template defaults.",
    };
  }

  return {
    deployMode: "compose",
    allowedSources: ["ghcr", "github", "local"],
    requiresDockerfile: false,
    requiresGitOrLocal: false,
    requiresImage: false,
    requirements: [],
    summary: "Uses template defaults / configured images.",
  };
}

export interface SourceTreeProbe {
  /** Paths that exist (repo-relative). */
  paths: Set<string>;
  /** File basenames in the repo root. */
  rootFiles: Set<string>;
}

export interface SourceRequirementResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  checks: { id: string; label: string; ok: boolean; detail?: string }[];
  plan: TemplateSourcePlan;
}

/**
 * Evaluate hard requirements against a probed source tree.
 * For static sites, accepts index.html OR any .html OR package.json (buildable).
 */
export function evaluateSourceRequirements(
  template: TemplateLike,
  tree: SourceTreeProbe | null,
  opts: {
    sourceMode: SourceMode;
    hasImage?: boolean;
    outputDir?: string;
    buildCommand?: string;
  }
): SourceRequirementResult {
  const plan = getTemplateSourcePlan(template);
  const errors: string[] = [];
  const warnings: string[] = [];
  const checks: SourceRequirementResult["checks"] = [];

  // Source mode allowed?
  if (opts.sourceMode !== "none" && !plan.allowedSources.includes(opts.sourceMode)) {
    errors.push(
      `This template does not support "${opts.sourceMode}" source. Use: ${plan.allowedSources.join(", ")}.`
    );
  }

  if (plan.requiresImage && opts.sourceMode === "ghcr" && !opts.hasImage) {
    errors.push("This template needs a container image (e.g. ghcr.io/you/app:latest).");
  }

  if (plan.requiresGitOrLocal && (opts.sourceMode === "github" || opts.sourceMode === "local")) {
    // file checks need tree
  } else if (plan.requiresGitOrLocal && opts.sourceMode === "ghcr") {
    errors.push(
      plan.requiresDockerfile
        ? "This template builds from source and needs a Git repo or local path with a Dockerfile — not only an image."
        : "This template needs a Git repository or local path on the VPS."
    );
  }

  if (plan.requiresDockerfile) {
    const hasDocker =
      tree &&
      (tree.rootFiles.has("dockerfile") ||
        tree.rootFiles.has("Dockerfile") ||
        tree.paths.has("Dockerfile") ||
        tree.paths.has("dockerfile"));
    checks.push({
      id: "dockerfile",
      label: "Dockerfile at repository root",
      ok: Boolean(hasDocker),
      detail: hasDocker
        ? "Found"
        : "Missing — this template builds a container image from source",
    });
    if (!hasDocker) {
      errors.push(
        "No Dockerfile found at the repository root. Pick the Static Site template for plain HTML/CSS/JS repos, or add a Dockerfile."
      );
    }
  }

  if (isStaticTemplateLike(template)) {
    const outputDir = (opts.outputDir || ".").replace(/^\.\/+/, "").replace(/\/+$/, "");
    const indexCandidates = [
      "index.html",
      outputDir === "." ? "index.html" : `${outputDir}/index.html`,
    ];
    const hasIndex =
      tree &&
      indexCandidates.some(
        (p) => tree.paths.has(p) || tree.rootFiles.has(p.toLowerCase()) || tree.paths.has(p.toLowerCase())
      );
    // Also accept case-insensitive root index
    const hasIndexRoot =
      tree &&
      [...tree.rootFiles].some((f) => f.toLowerCase() === "index.html");

    const hasHtml =
      tree &&
      ([...tree.rootFiles].some((f) => f.endsWith(".html")) ||
        [...tree.paths].some((p) => p.endsWith(".html")));

    const hasPackageJson =
      tree && (tree.rootFiles.has("package.json") || tree.paths.has("package.json"));

    const hasBuild = Boolean((opts.buildCommand || "").trim()) || Boolean(hasPackageJson);
    const okStatic = Boolean(hasIndex || hasIndexRoot || hasHtml || hasBuild);

    checks.push({
      id: "static_entry",
      label: "Static site content (index.html, *.html, or buildable package.json)",
      ok: okStatic,
      detail: hasIndex || hasIndexRoot
        ? "Found index.html"
        : hasHtml
          ? "Found HTML files"
          : hasPackageJson
            ? "Found package.json (set a build command if needed)"
            : "No HTML or package.json found at repo root",
    });

    if (!okStatic && tree) {
      errors.push(
        "This repo does not look like a static site (no index.html / HTML / package.json). " +
          "For container apps with a Dockerfile, use Source Build instead."
      );
    }

    if (hasPackageJson && !(opts.buildCommand || "").trim()) {
      warnings.push(
        "package.json found but build command is empty — only existing files will be published. Set build_command (e.g. npm run build) and output_dir if needed."
      );
    }
  }

  // If tree could not be probed but we need file checks
  if (!tree && (plan.requiresDockerfile || isStaticTemplateLike(template)) && (opts.sourceMode === "github" || opts.sourceMode === "local")) {
    warnings.push("Could not inspect repository files yet — full checks will run on deploy.");
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    checks,
    plan,
  };
}

/** Parse GitHub Contents API list response into a tree probe (root only). */
export function probeFromGithubRootListing(
  entries: { name: string; path: string; type: string }[]
): SourceTreeProbe {
  const paths = new Set<string>();
  const rootFiles = new Set<string>();
  for (const e of entries) {
    if (e.type === "file") {
      paths.add(e.path);
      rootFiles.add(e.name);
      rootFiles.add(e.name.toLowerCase());
    } else if (e.type === "dir") {
      paths.add(e.path + "/");
    }
  }
  return { paths, rootFiles };
}
