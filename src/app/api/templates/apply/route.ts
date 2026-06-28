import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { loadTemplate, resolveTemplate, generatePreview, resolveTemplateForExisting } from "@/lib/template-engine";
import { execOnTarget } from "@/lib/host-exec";
import { shQuote } from "@/lib/vps";

export async function POST(req: NextRequest) {
  try {
    await requireAuth(req);
    const body = await req.json();
    const { templateName, inputs, targetPath, existingComposePath } = body;

    if (!templateName) return NextResponse.json({ error: "templateName required" }, { status: 400 });

    const template = loadTemplate(`${templateName}.yml`);
    if (!template) return NextResponse.json({ error: "Template not found" }, { status: 404 });

    const resolvedInputs = inputs || {};

    if (existingComposePath) {
      // Migrate existing app to template
      const result = resolveTemplateForExisting(template, existingComposePath, resolvedInputs);
      return NextResponse.json({
        success: true,
        mode: "migrate",
        template: template.name,
        backupPath: result.backupPath,
        diff: result.diff,
        composeYml: result.dockerCompose,
        proxyConfig: result.proxyConfig,
        proxyConfigPath: result.proxyConfigPath,
        envSchema: result.envSchema,
        preview: generatePreview(result),
      });
    }

    // New deployment
    const resolved = resolveTemplate(template, resolvedInputs);
    const destPath = targetPath || `/opt/${resolvedInputs["app_slug"] || resolvedInputs["domain"]?.replace(/\./g, "-") || "app"}`;

    return NextResponse.json({
      success: true,
      mode: "create",
      template: template.name,
      targetPath: destPath,
      composeYml: resolved.dockerCompose,
      proxyConfig: resolved.proxyConfig,
      proxyConfigPath: resolved.proxyConfigPath,
      envSchema: resolved.envSchema,
      preview: generatePreview(resolved),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to apply template" },
      { status: 500 }
    );
  }
}
