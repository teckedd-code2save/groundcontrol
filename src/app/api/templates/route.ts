import { NextRequest, NextResponse } from "next/server";
import { listTemplates, loadTemplate, resolveTemplate, generatePreview } from "@/lib/template-engine";

export async function GET(req: Request) {
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
