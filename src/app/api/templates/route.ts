import { NextResponse } from "next/server";
import { listTemplates, loadTemplate, resolveTemplate, generatePreview } from "@/lib/template-engine";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const name = url.searchParams.get("name");
  const preview = url.searchParams.get("preview");

  if (name) {
    const template = loadTemplate(`${name}.yml`);
    if (!template) return NextResponse.json({ error: "Template not found" }, { status: 404 });
    if (preview === "true") {
      const inputs: Record<string, string> = {};
      url.searchParams.forEach((v, k) => { if (k !== "name" && k !== "preview") inputs[k] = v; });
      const resolved = resolveTemplate(template, inputs);
      const previewText = generatePreview(resolved);
      return NextResponse.json({ template, preview: previewText, resolved });
    }
    return NextResponse.json(template);
  }

  const templates = listTemplates();
  return NextResponse.json({ templates });
}
