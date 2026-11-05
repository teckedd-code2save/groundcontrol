import { captureStandaloneRecipe, type ContainerSnapshot } from "./standalone-recipe";
import { randomInt, randomUUID } from "node:crypto";
import { prisma } from "./prisma";
import { HttpError } from "./errors";
import { isDesktopMode } from "./runtime";
import { execOnVps, shQuote, type VpsConnection } from "./vps";
import { deploymentEnvironment } from "./project-deployments";

/** Launch one explicitly configured Docker image, privately on this PC. */
export async function launchLocalProject(body: Record<string, unknown>, vps: VpsConnection | null) {
  if (!vps?.isLocal || !isDesktopMode()) throw new HttpError("Choose the local Docker connection to launch on this computer.", 400);
  const project = await prisma.projectGroup.findUnique({ where: { id: Number(body.projectId) } });
  if (!project) throw new HttpError("Project not found.", 404);
  const environmentName = deploymentEnvironment(body.environmentName);
  const name = String(body.name || "").trim().slice(0, 120);
  const image = String(body.image || "").trim();
  const port = Number(body.containerPort);
  if (!name || !/^[a-zA-Z0-9][a-zA-Z0-9._/:@-]{0,255}$/.test(image) || !Number.isInteger(port) || port < 1 || port > 65535) throw new HttpError("Enter a deployment name, Docker image, and the port your app listens on.", 400);
  const slug = `${project.slug.slice(0, 35)}-${randomUUID().slice(0, 8)}`;
  const containerName = `gc-app-${slug}`;
  // Pin the requested port in HostConfig so stop/start and rollback retain it.
  // Docker owns allocation; a collision fails startup without changing another app.
  const hostPort = randomInt(49152, 65536);
  const deployment = await prisma.enrolledDeployment.create({ data: { name, slug, kind: "container", environmentName, managementMode: "track", containerName, vpsConfigId: vps.id, projectGroupId: project.id, status: "starting", metadataJson: JSON.stringify({ source: "local-image", image, containerPort: port }) } });
  try {
    const pull = await execOnVps(`docker image inspect ${shQuote(image)} >/dev/null 2>&1 || docker pull ${shQuote(image)}`, vps);
    if (pull.code) throw new HttpError("The image could not be downloaded in time. Check its name and Docker connectivity, then try again.", 400);
    const run = await execOnVps(`docker run -d --name ${shQuote(containerName)} --label ${shQuote(`io.groundcontrol.project=${project.id}`)} --label ${shQuote(`io.groundcontrol.deployment=${deployment.id}`)} -p ${shQuote(`127.0.0.1:${hostPort}:${port}`)} ${shQuote(image)}`, vps);
    if (run.code) throw new HttpError("Docker could not start this image. Check the image and app port, then try again.", 400);
    const inspected = await execOnVps(`docker inspect --type container --format '{{json .}}' ${shQuote(containerName)}`, vps);
    let snapshot: ContainerSnapshot;
    try { snapshot = JSON.parse(inspected.stdout); } catch { throw new HttpError("Docker did not return complete startup evidence.", 400); }
    if (inspected.code || snapshot.State?.Running !== true) throw new HttpError("The container exited during startup. This image may need environment variables or a different command. Use a configured template on a Linux server for that setup.", 400);
    const binding = snapshot.NetworkSettings?.Ports?.[`${port}/tcp`]?.find((item: { HostIp: string }) => item.HostIp === "127.0.0.1");
    if (!binding || binding.HostPort !== String(hostPort)) throw new Error("The requested private local port was not assigned.");
    const publicUrl = `http://127.0.0.1:${binding.HostPort}`;
    const recreateRecipe = captureStandaloneRecipe(snapshot, { deploymentId: deployment.id, projectId: project.id, containerName, containerPort: port, hostPort: Number(binding.HostPort) });
    return await prisma.enrolledDeployment.update({ where: { id: deployment.id }, data: { status: "active", lastSeenAt: new Date(), metadataJson: JSON.stringify({ source: "local-image", image, containerPort: port, manualPublicUrl: publicUrl, recreateRecipe }) } });
  } catch (error) {
    // Only the uniquely named container created by this attempt is removed.
    await execOnVps(`docker rm -f ${shQuote(containerName)} >/dev/null 2>&1 || true`, vps);
    await prisma.enrolledDeployment.delete({ where: { id: deployment.id } });
    throw error;
  }
}
