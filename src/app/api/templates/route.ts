import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { generatePreview, isRepositoryComposeTemplate, listTemplates, loadTemplate, resolveTemplate } from "@/lib/template-engine";
import { normalizeRepositoryComposePath } from "@/lib/repository-compose";

async function readGithubPreviewFile(repoUrl: string, ref: string, path: string): Promise<string> {
  const match = repoUrl.trim().replace(/\.git$/, "").match(/github\.com[/:]([^/]+)\/([^/#?]+)/i);
  if (!match) throw new Error("Existing Compose preview requires a GitHub repository URL.");
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "GroundControl",
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const response = await fetch(
    `https://api.github.com/repos/${match[1]}/${match[2]}/contents/${encodedPath}?ref=${encodeURIComponent(ref || "main")}`,
    { headers, cache: "no-store", signal: AbortSignal.timeout(8000) }
  );
  if (!response.ok) throw new Error(`Could not load ${path} from the selected repository and ref.`);
  const file = await response.json() as { content?: string; encoding?: string };
  if (file.encoding !== "base64" || !file.content) throw new Error(`${path} is not a readable text file.`);
  return Buffer.from(file.content.replace(/\n/g, ""), "base64").toString("utf8");
}

export async function GET(req: NextRequest) {
  await requireAuth(req);
  const url = new URL(req.url);
  const name = url.searchParams.get("name");

  if (name) {
    const template = loadTemplate(`${name}.yml`);
    if (!template) return NextResponse.json({ error: "Template not found" }, { status: 404 });
    return NextResponse.json(template);
  }

  const templates = listTemplates();
  return NextResponse.json({ templates });
}

export async function POST(req: NextRequest) {
  try {
    await requireAuth(req);
    const body = await req.json();
    const { name, preview, inputs = {}, repoUrl, branch, ghcrImage, localPath } = body;

    if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

    const template = loadTemplate(`${name}.yml`);
    if (!template) return NextResponse.json({ error: "Template not found" }, { status: 404 });

    if (preview) {
      const allInputs: Record<string, string> = { ...inputs };
      if (repoUrl) allInputs.repo_url = repoUrl;
      if (ghcrImage) allInputs.ghcr_image = ghcrImage;
      if (localPath) allInputs.repo_dir = localPath;

      // Resolve static_dir for static-site templates so the Caddy
      // config preview shows the real path instead of {{static_dir}}.
      // The deploy route computes this from staticRoot + slug, but
      // the preview runs before deploy so we use the template name
      // as a reasonable stand-in for the slug.
      if (template.deploy_mode === "static" && !allInputs.static_dir) {
        const { getSystemConfig } = await import("@/lib/vps");
        try {
          const config = await getSystemConfig();
          const staticRoot = config.staticRoot || "/var/www";
          const previewSlug = inputs.app_slug || name;
          allInputs.static_dir = `${staticRoot.replace(/\/+$/, "")}/${previewSlug}`;
        } catch {
          allInputs.static_dir = `/var/www/${inputs.app_slug || name}`;
        }
      }

      const resolved = resolveTemplate(template, allInputs);
      const previewText = generatePreview(resolved);
      const dockerCompose = isRepositoryComposeTemplate(template) && repoUrl
        ? await readGithubPreviewFile(
            String(repoUrl),
            String(branch || allInputs.repo_branch || "main"),
            normalizeRepositoryComposePath(allInputs.compose_file || "docker-compose.yml")
          )
        : resolved.dockerCompose;
      return NextResponse.json({
        preview: previewText,
        dockerCompose,
        proxyConfig: resolved.proxyConfig,
      });
    }

    return NextResponse.json(template);
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Invalid request",
    }, { status: 400 });
  }
}
