import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { handleApiError, HttpError } from "@/lib/errors";
import { execOnTargetStrict } from "@/lib/host-exec";
import { getActiveVps, getDockerContainers, resolveComposeFile, resolveComposeProjectPath, shQuote } from "@/lib/vps";
import { MANAGED_IMAGE_OVERRIDE_FILE } from "@/lib/compose-management";
import { buildDigestImageOverride, composeImageEnvKeys } from "@/lib/github-image-release";
import { setLocalEnvValues } from "@/lib/env-management";
import { prisma } from "@/lib/prisma";

function isValidProjectSlug(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(value);
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

/**
 * Release half of the playbook: pin each service to an exact, previously-built
 * `repo@sha256:<digest>` via the managed image override. This endpoint only
 * writes the pin — the worker triggers the existing redeploy path to actually
 * switch, and records the rollback pair from the returned `previous` digests.
 */
export async function POST(req: NextRequest) {
  try {
    requireAuth(req);
    const body = await req.json();
    const projectSlug = String(body.projectSlug || "");
    if (!isValidProjectSlug(projectSlug)) {
      throw new HttpError("A valid projectSlug is required", 400);
    }
    const images: unknown[] = Array.isArray(body.images) ? body.images : [];
    if (images.length === 0) {
      throw new HttpError("At least one image digest is required to release.", 400);
    }
    const parsedImages = images.map((entry: unknown) => {
      const record = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
      return {
        service: String(record.service || ""),
        digest: String(record.digest || ""),
        ref: String(record.ref || ""),
      };
    });

    const vps = await getActiveVps();
    const resolved = await resolveComposeProjectPath(projectSlug, undefined, vps);
    const projectPath = resolved.projectPath;

    const { content, refs } = buildDigestImageOverride(
      parsedImages.map((entry) => ({ service: entry.service, digest: entry.digest }))
    );

    // Capture the prior running digests so the caller can record a rollback pair.
    const containers = await getDockerContainers(vps);
    const previous: Record<string, string> = {};
    for (const service of Object.keys(refs)) {
      const container = containers.find(
        (c) => c.name === service || c.name.startsWith(`${service}-`) || c.name.includes(`-${service}-`)
      );
      if (container) {
        const digest = await execOnTargetStrict(
          `docker inspect --format '{{index .RepoDigests 0}}' ${shQuote(container.name)} 2>/dev/null || true`,
          vps
        );
        if (digest.stdout.trim()) previous[service] = digest.stdout.trim();
      }
    }

    const write = await execOnTargetStrict(writeOverrideCommand(projectPath, content), vps);
    if (write.code !== 0) {
      throw new HttpError(write.stderr || "Could not write the release image override.", 500);
    }

    // Reconcile the canonical image references: update the deployment-wide
    // `*_IMAGE` env vars (the source Compose substitutes from `.env`) to the
    // same digests, so the `.env`, the managed override, and the running
    // container never diverge. Only services that reference `${IMAGE_KEY}`
    // in the compose file have a canonical env key to update.
    const composePath = await resolveComposeFile(projectPath, vps);
    const imageEnv: Record<string, string> = {};
    if (composePath) {
      const rawCompose = await execOnTargetStrict(`cat ${shQuote(composePath)}`, vps);
      const envKeys = composeImageEnvKeys(rawCompose.stdout);
      for (const [service, digest] of Object.entries(refs)) {
        const envKey = envKeys[service];
        // Pin the runtime env var to the SHA tag, not the digest: a digest cannot
        // be used as a build tag, so writing it into the `*_IMAGE` env would break
        // the next build_publish. The managed override still pins the exact digest.
        const tag = parsedImages.find((entry) => entry.service === service)?.ref || digest;
        if (envKey) imageEnv[envKey] = tag;
      }
      if (Object.keys(imageEnv).length > 0) {
        const project = await prisma.project.findFirst({ where: { slug: projectSlug } });
        const profile = project
          ? await prisma.deploymentEnvProfile.findFirst({
              where: { projectId: project.id },
              orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
            })
          : null;
        if (profile) {
          await setLocalEnvValues(profile.id, imageEnv, [], "");
        }
      }
    }

    return NextResponse.json({
      success: true,
      pinned: refs,
      previous,
      syncedEnv: Object.keys(imageEnv),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
