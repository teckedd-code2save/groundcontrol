import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import {
  assertComposeServiceName,
  composeServiceImages,
  composeServiceNames,
  MANAGED_IMAGE_OVERRIDE_FILE,
  readManagedImageOverrides,
  updateManagedImageOverride,
} from "@/lib/compose-management";
import { handleApiError, HttpError } from "@/lib/errors";
import { execOnTargetStrict } from "@/lib/host-exec";
import { validateSafePath } from "@/lib/host-safety";
import {
  buildManagedComposeInvocation,
  getActiveVps,
  getDockerComposeCommand,
  resolveComposeFile,
  resolveComposeProjectPath,
  shQuote,
} from "@/lib/vps";

function normalizedPath(value: unknown): string {
  return String(value || "").trim().replace(/\/+$/, "");
}

function validateRequestedComposePath(projectPath: string, composePath: string): string | null {
  if (!composePath) return null;
  const safePathError = validateSafePath(composePath);
  if (safePathError) return safePathError;
  if (!composePath.startsWith(`${projectPath}/`)) return "Compose file must live inside the deployment folder.";
  if (!/\.ya?ml$/i.test(composePath)) return "Compose file must be a YAML file.";
  return null;
}

function writeOverrideCommand(projectPath: string, content: string): string {
  const target = `${projectPath}/${MANAGED_IMAGE_OVERRIDE_FILE}`;
  if (!content.trim()) return `rm -f ${shQuote(target)}`;
  const encoded = Buffer.from(content, "utf8").toString("base64");
  return [
    "set -eu",
    `mkdir -p ${shQuote(`${projectPath}/.groundcontrol`)}`,
    `printf '%s' ${shQuote(encoded)} | base64 -d > ${shQuote(`${target}.new`)}`,
    `chmod 600 ${shQuote(`${target}.new`)}`,
    `mv ${shQuote(`${target}.new`)} ${shQuote(target)}`,
  ].join("\n");
}

async function resolveRequest(input: {
  projectSlug: string;
  requestedPath?: string;
  requestedComposePath?: string;
}) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(input.projectSlug)) {
    throw new HttpError("A valid projectSlug is required", 400);
  }
  const explicitPath = normalizedPath(input.requestedPath);
  const pathError = explicitPath ? validateSafePath(explicitPath) : null;
  if (pathError) throw new HttpError(pathError, 400);
  const target = explicitPath
    ? { projectPath: explicitPath }
    : await resolveComposeProjectPath(input.projectSlug);
  const requestedComposePath = normalizedPath(input.requestedComposePath);
  const composePathError = validateRequestedComposePath(target.projectPath, requestedComposePath);
  if (composePathError) throw new HttpError(composePathError, 400);
  const vps = await getActiveVps();
  const composePath = await resolveComposeFile(target.projectPath, vps, requestedComposePath || undefined);
  if (!composePath) throw new HttpError("No Compose file was found for this deployment.", 404);
  return { projectPath: target.projectPath, composePath, vps };
}

export async function GET(req: NextRequest) {
  try {
    requireAuth(req);
    const service = assertComposeServiceName(req.nextUrl.searchParams.get("service"));
    const resolved = await resolveRequest({
      projectSlug: req.nextUrl.searchParams.get("slug") || "",
      requestedPath: req.nextUrl.searchParams.get("path") || "",
      requestedComposePath: req.nextUrl.searchParams.get("composePath") || "",
    });
    const [base, override] = await Promise.all([
      execOnTargetStrict(`cat ${shQuote(resolved.composePath)}`, resolved.vps),
      execOnTargetStrict(`cat ${shQuote(`${resolved.projectPath}/${MANAGED_IMAGE_OVERRIDE_FILE}`)} 2>/dev/null || true`, resolved.vps),
    ]);
    if (base.code !== 0) throw new HttpError(base.stderr || "Could not read the Compose file.", 400);
    const services = composeServiceNames(base.stdout);
    if (!services.includes(service)) throw new HttpError(`Compose service ${service} no longer exists.`, 409);
    const configuredImages = composeServiceImages(base.stdout);
    const overrides = readManagedImageOverrides(override.stdout);
    return NextResponse.json({
      service,
      composePath: resolved.composePath,
      configuredImage: configuredImages[service] || null,
      overrideImage: overrides[service] || null,
      effectiveImage: overrides[service] || configuredImages[service] || null,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    requireAuth(req);
    const body = await req.json();
    const service = assertComposeServiceName(body.service);
    const resolved = await resolveRequest({
      projectSlug: String(body.projectSlug || ""),
      requestedPath: String(body.projectPath || ""),
      requestedComposePath: String(body.composePath || ""),
    });
    const [base, previousOverride] = await Promise.all([
      execOnTargetStrict(`cat ${shQuote(resolved.composePath)}`, resolved.vps),
      execOnTargetStrict(`cat ${shQuote(`${resolved.projectPath}/${MANAGED_IMAGE_OVERRIDE_FILE}`)} 2>/dev/null || true`, resolved.vps),
    ]);
    if (base.code !== 0) throw new HttpError(base.stderr || "Could not read the Compose file.", 400);
    if (!composeServiceNames(base.stdout).includes(service)) {
      throw new HttpError(`Compose service ${service} no longer exists. Refresh the deployment.`, 409);
    }

    const update = updateManagedImageOverride(previousOverride.stdout, service, body.image);
    const write = await execOnTargetStrict(writeOverrideCommand(resolved.projectPath, update.content), resolved.vps);
    if (write.code !== 0) throw new HttpError(write.stderr || "Could not save the image override.", 500);

    const composeCommand = await getDockerComposeCommand(resolved.vps, execOnTargetStrict);
    const validation = await execOnTargetStrict(
      `cd ${shQuote(resolved.projectPath)} && ${buildManagedComposeInvocation(
        composeCommand,
        "config --quiet",
        resolved.composePath,
        { includeEnvironment: false }
      )}`,
      resolved.vps
    );
    if (validation.code !== 0) {
      await execOnTargetStrict(writeOverrideCommand(resolved.projectPath, previousOverride.stdout), resolved.vps).catch(() => undefined);
      throw new HttpError(
        `The image override was rejected by Compose: ${(validation.stderr || validation.stdout || "invalid configuration").trim().slice(0, 400)}`,
        400
      );
    }

    const configuredImages = composeServiceImages(base.stdout);
    return NextResponse.json({
      success: true,
      service,
      composePath: resolved.composePath,
      configuredImage: configuredImages[service] || null,
      overrideImage: update.images[service] || null,
      effectiveImage: update.images[service] || configuredImages[service] || null,
      message: update.images[service]
        ? `Image source saved for ${service}.`
        : `Image override removed from ${service}.`,
    });
  } catch (error) {
    return handleApiError(error instanceof Error && !(error instanceof HttpError)
      ? new HttpError(error.message, 400, { cause: error })
      : error);
  }
}
