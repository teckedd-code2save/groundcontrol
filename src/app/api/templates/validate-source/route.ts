import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { loadTemplate } from "@/lib/template-engine";
import {
  evaluateSourceRequirements,
  getTemplateSourcePlan,
  isStaticTemplateLike,
  probeFromGithubRootListing,
  type SourceMode,
  type SourceTreeProbe,
} from "@/lib/template-source-requirements";
import { getActiveVps, shQuote } from "@/lib/vps";
import { execOnTarget } from "@/lib/host-exec";

function parseGithubRepo(raw: string): { owner: string; repo: string } | null {
  const cleaned = raw.trim().replace(/\.git$/, "");
  const m = cleaned.match(/github\.com[/:]([^/]+)\/([^/#?]+)/i);
  if (!m) return null;
  return { owner: m[1], repo: m[2].replace(/\/$/, "") };
}

async function probeGithubRepo(
  repoUrl: string,
  branch?: string
): Promise<{ tree: SourceTreeProbe | null; meta?: Record<string, unknown>; error?: string }> {
  const parsed = parseGithubRepo(repoUrl);
  if (!parsed) {
    return { tree: null, error: "Not a GitHub URL — use https://github.com/owner/repo" };
  }

  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "groundcontrol-template-validate",
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  // Resolve default branch if needed
  let ref = (branch || "").trim();
  const repoRes = await fetch(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}`, {
    headers,
    signal: AbortSignal.timeout(8000),
  });
  if (!repoRes.ok) {
    return {
      tree: null,
      error:
        repoRes.status === 404
          ? "Repository not found (or private without token)"
          : `GitHub API error: ${repoRes.status}`,
    };
  }
  const repoData = (await repoRes.json()) as {
    full_name?: string;
    private?: boolean;
    default_branch?: string;
    description?: string;
  };
  if (!ref) ref = repoData.default_branch || "main";

  const contentsUrl = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/contents/?ref=${encodeURIComponent(ref)}`;
  const contentsRes = await fetch(contentsUrl, {
    headers,
    signal: AbortSignal.timeout(8000),
  });
  if (!contentsRes.ok) {
    return {
      tree: null,
      meta: {
        name: repoData.full_name,
        private: repoData.private,
        defaultBranch: repoData.default_branch,
        description: repoData.description,
        branch: ref,
      },
      error: `Could not list repository files at branch "${ref}" (${contentsRes.status})`,
    };
  }

  const listing = (await contentsRes.json()) as { name: string; path: string; type: string }[];
  if (!Array.isArray(listing)) {
    return { tree: null, error: "Unexpected GitHub contents response" };
  }

  // Also probe common nested paths for static output dirs
  const tree = probeFromGithubRootListing(listing);
  for (const extra of ["dist/index.html", "build/index.html", "out/index.html", "public/index.html"]) {
    const r = await fetch(
      `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/contents/${extra}?ref=${encodeURIComponent(ref)}`,
      { headers, signal: AbortSignal.timeout(5000) }
    );
    if (r.ok) tree.paths.add(extra);
  }

  return {
    tree,
    meta: {
      name: repoData.full_name,
      private: repoData.private,
      defaultBranch: repoData.default_branch,
      description: repoData.description,
      branch: ref,
      rootFiles: [...tree.rootFiles].filter((f) => f === f.toLowerCase() ? false : true).slice(0, 40),
    },
  };
}

async function probeLocalPath(localPath: string): Promise<{ tree: SourceTreeProbe | null; error?: string }> {
  const vps = await getActiveVps();
  if (!vps) {
    return { tree: null, error: "No active VPS — cannot inspect local path" };
  }
  const path = localPath.trim();
  const exists = await execOnTarget(`test -d ${shQuote(path)} && echo yes || echo no`, vps);
  if (exists.stdout.trim() !== "yes") {
    return { tree: null, error: `Path does not exist on VPS: ${path}` };
  }

  const list = await execOnTarget(
    `cd ${shQuote(path)} && ls -1A 2>/dev/null | head -200`,
    vps
  );
  const rootFiles = new Set<string>();
  const paths = new Set<string>();
  for (const line of list.stdout.split("\n").map((l) => l.trim()).filter(Boolean)) {
    rootFiles.add(line);
    rootFiles.add(line.toLowerCase());
    paths.add(line);
  }
  // Check common files
  for (const f of ["Dockerfile", "dockerfile", "index.html", "package.json", "dist/index.html", "build/index.html"]) {
    const r = await execOnTarget(`test -e ${shQuote(`${path}/${f}`)} && echo yes || echo no`, vps);
    if (r.stdout.trim() === "yes") {
      paths.add(f);
      const base = f.split("/").pop()!;
      rootFiles.add(base);
      rootFiles.add(base.toLowerCase());
    }
  }
  return { tree: { paths, rootFiles } };
}

export async function POST(req: NextRequest) {
  try {
    await requireAuth(req);
    const body = await req.json();
    const templateName = String(body.templateName || body.name || "").trim();
    const sourceMode = String(body.sourceType || body.sourceMode || "github") as SourceMode;
    const repoUrl = String(body.repoUrl || "").trim();
    const branch = String(body.branch || "").trim();
    const localPath = String(body.localPath || "").trim();
    const ghcrImage = String(body.ghcrImage || "").trim();
    const outputDir = String(body.outputDir || body.output_dir || ".").trim();
    const buildCommand = String(body.buildCommand || body.build_command || "").trim();

    if (!templateName) {
      return NextResponse.json({ ok: false, error: "templateName is required" }, { status: 400 });
    }

    const template = loadTemplate(`${templateName}.yml`);
    if (!template) {
      return NextResponse.json({ ok: false, error: `Template "${templateName}" not found` }, { status: 404 });
    }

    const plan = getTemplateSourcePlan(template);
    let tree: SourceTreeProbe | null = null;
    let repoMeta: Record<string, unknown> | undefined;
    let probeError: string | undefined;

    if (sourceMode === "github") {
      if (!repoUrl) {
        return NextResponse.json({
          ok: false,
          error: "Repository URL is required",
          plan,
          errors: ["Enter a GitHub repository URL."],
          checks: [],
          warnings: [],
        });
      }
      const probed = await probeGithubRepo(repoUrl, branch);
      tree = probed.tree;
      repoMeta = probed.meta;
      probeError = probed.error;
      if (probeError && !tree) {
        return NextResponse.json({
          ok: false,
          error: probeError,
          plan,
          errors: [probeError],
          checks: [],
          warnings: [],
          repo: repoMeta,
        });
      }
    } else if (sourceMode === "local") {
      if (!localPath) {
        return NextResponse.json({
          ok: false,
          error: "Local path is required",
          plan,
          errors: ["Enter a path on the VPS."],
          checks: [],
          warnings: [],
        });
      }
      const probed = await probeLocalPath(localPath);
      tree = probed.tree;
      probeError = probed.error;
      if (probeError && !tree) {
        return NextResponse.json({
          ok: false,
          error: probeError,
          plan,
          errors: [probeError],
          checks: [],
          warnings: [],
        });
      }
    } else if (sourceMode === "ghcr") {
      if (plan.requiresDockerfile || isStaticTemplateLike(template)) {
        return NextResponse.json({
          ok: false,
          error: "This template does not deploy from a container image alone.",
          plan,
          errors: [
            plan.requiresDockerfile
              ? "Source Build needs a Git repo or local path with a Dockerfile."
              : "Static Site needs a Git repo or local path with HTML files.",
          ],
          checks: [],
          warnings: [],
        });
      }
    }

    const result = evaluateSourceRequirements(template, tree, {
      sourceMode,
      hasImage: Boolean(ghcrImage),
      outputDir,
      buildCommand,
    });

    // Suggest the right template when Dockerfile missing but static content present
    let suggestion: string | undefined;
    if (
      !result.ok &&
      plan.requiresDockerfile &&
      tree &&
      ([...tree.rootFiles].some((f) => f.endsWith(".html") || f === "index.html") ||
        tree.paths.has("index.html"))
    ) {
      suggestion =
        "This looks like a static HTML site. Use the **VPS Caddy Static Site** template instead of Source Build.";
    }
    if (
      !result.ok &&
      isStaticTemplateLike(template) &&
      tree &&
      (tree.rootFiles.has("Dockerfile") || tree.paths.has("Dockerfile"))
    ) {
      suggestion =
        "This repo has a Dockerfile. Use **VPS Caddy Source Build** if you want to build and run a container.";
    }

    return NextResponse.json({
      ok: result.ok,
      error: result.ok ? undefined : result.errors[0],
      errors: result.errors,
      warnings: result.warnings,
      checks: result.checks,
      plan,
      suggestion,
      repo: repoMeta,
      template: {
        name: template.name,
        category: template.category,
        deploy_mode: template.deploy_mode,
        requiresDockerfile: plan.requiresDockerfile,
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Validation failed",
        errors: [err instanceof Error ? err.message : "Validation failed"],
      },
      { status: 500 }
    );
  }
}
