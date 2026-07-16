import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { listTemplates, loadTemplate, resolveTemplate, generatePreview } from "@/lib/template-engine";

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
    const { name, preview, inputs = {}, repoUrl, ghcrImage, localPath } = body;

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
      return NextResponse.json({
        preview: previewText,
        dockerCompose: resolved.dockerCompose,
        proxyConfig: resolved.proxyConfig,
      });
    }

    return NextResponse.json(template);
  } catch (err) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
