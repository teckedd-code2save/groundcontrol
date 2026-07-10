import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getActiveVps, getSystemConfig, shQuote } from "@/lib/vps";
import { execOnTarget } from "@/lib/host-exec";
import { handleApiError } from "@/lib/errors";
import {
  deleteManagedDeployment,
  getManagedRootFromConfig,
  normalizeDeploymentSlug,
  resolveManagedDeployment,
} from "@/lib/managed-deployments";

function normalizeRoot(value: string): string {
  return value.replace(/\/+$/, "") || "/";
}

export async function POST(req: NextRequest) {
  try {
    requireAuth(req);
    const body = await req.json();
    const deploymentPath = String(body.path || "").replace(/\/+$/, "");
    const slugInput = String(body.slug || "").trim();
    const deleteVolumes = body.deleteVolumes === true;
    const force = body.force === true;

    if (!deploymentPath && !slugInput) {
      return NextResponse.json(
        { error: "path or slug is required" },
        { status: 400 }
      );
    }

    const config = await getSystemConfig();
    const managedRoot = normalizeRoot(
      config.templateDeploymentRoot || getManagedRootFromConfig(null)
    );

    // Prefer shared managed pipeline when path is under managed root or slug given
    const underManaged =
      deploymentPath &&
      deploymentPath !== managedRoot &&
      deploymentPath.startsWith(`${managedRoot}/`);
    const identifier = underManaged
      ? deploymentPath
      : slugInput || deploymentPath;

    if (underManaged || slugInput) {
      const result = await deleteManagedDeployment(identifier, {
        deleteVolumes,
        cleanupDb: true,
      });
      if (!result.ok) {
        return NextResponse.json(
          {
            error: result.error,
            existing: result.existing,
            root: result.root,
            lookedFor: result.lookedFor,
          },
          { status: 400 }
        );
      }
      return NextResponse.json({
        success: true,
        output: result.composeOutput,
        path: result.path,
        slug: result.slug,
        dbCleanup: result.dbCleanup,
      });
    }

    // Non-managed absolute path: only with force, and only if compose file exists
    if (!deploymentPath.startsWith("/")) {
      return NextResponse.json(
        { error: "path must be an absolute VPS path" },
        { status: 400 }
      );
    }

    if (!force) {
      return NextResponse.json(
        {
          error: `Path is outside managed root ${managedRoot}. Pass force:true to delete a non-managed compose project.`,
        },
        { status: 400 }
      );
    }

    // Fail closed: never invent a sibling path if the given one is missing
    const vps = await getActiveVps();
    const dirCheck = await execOnTarget(
      `test -d ${shQuote(deploymentPath)} && echo yes || echo no`,
      vps
    );
    if (dirCheck.stdout.trim() !== "yes") {
      return NextResponse.json(
        {
          error: `Deployment path does not exist: ${deploymentPath}. Refusing to guess another directory.`,
        },
        { status: 400 }
      );
    }

    const composeCheck = await execOnTarget(
      `if [ -f ${shQuote(`${deploymentPath}/docker-compose.yml`)} ] || [ -f ${shQuote(`${deploymentPath}/docker-compose.yaml`)} ] || [ -f ${shQuote(`${deploymentPath}/compose.yml`)} ] || [ -f ${shQuote(`${deploymentPath}/compose.yaml`)} ]; then echo yes; else echo no; fi`,
      vps
    );
    if (composeCheck.stdout.trim() !== "yes") {
      return NextResponse.json(
        {
          error: `No docker-compose.yml found at ${deploymentPath}. Not a deployment directory.`,
        },
        { status: 400 }
      );
    }

    // Reuse resolve by slug basename when possible, else manual teardown
    const slug = normalizeDeploymentSlug(deploymentPath);
    if (slug) {
      const resolved = await resolveManagedDeployment(deploymentPath, vps);
      if (resolved.ok) {
        const result = await deleteManagedDeployment(deploymentPath, {
          deleteVolumes,
          cleanupDb: true,
        }, vps);
        if (result.ok) {
          return NextResponse.json({
            success: true,
            output: result.composeOutput,
            path: result.path,
            slug: result.slug,
          });
        }
      }
    }

    const result = await execOnTarget(
      [
        `set -u`,
        `dir=${shQuote(deploymentPath)}`,
        `if [ ! -d "$dir" ]; then echo "Deployment path does not exist: $dir" >&2; exit 2; fi`,
        `compose_cmd=""`,
        `if docker compose version >/dev/null 2>&1; then compose_cmd="docker compose"; elif command -v docker-compose >/dev/null 2>&1; then compose_cmd="docker-compose"; fi`,
        `if [ -n "$compose_cmd" ]; then cd "$dir" && $compose_cmd down ${deleteVolumes ? "-v" : ""} 2>&1 || true; fi`,
        `rm -rf "$dir"`,
        `printf 'Deleted %s' "$dir"`,
      ].join("\n"),
      vps
    );

    if (result.code !== 0) {
      return NextResponse.json(
        { error: result.stderr || result.stdout || "Delete failed" },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      output: result.stdout,
      path: deploymentPath,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
