/** Bounded acceptance of the real remote builder. Does not replace production containers. */
import { buildDaytonaRelease } from "../src/lib/daytona-release";
import { parseReleaseBuildPolicy } from "../src/lib/daytona-release-plan";
import { prisma } from "../src/lib/prisma";

async function main() {
  const slug = process.env.GC_ACCEPTANCE_DEPLOYMENT;
  const revision = process.env.GC_ACCEPTANCE_COMMIT;
  const prefix = process.env.GC_ACCEPTANCE_IMAGE_PREFIX;
  if (!slug || !revision || !prefix) throw new Error("Set GC_ACCEPTANCE_DEPLOYMENT, GC_ACCEPTANCE_COMMIT and GC_ACCEPTANCE_IMAGE_PREFIX.");
  const deployment = await prisma.enrolledDeployment.findUniqueOrThrow({ where: { slug } });
  const artifact = await buildDaytonaRelease({
    deploymentId: deployment.id, branch: "main", commitSha: revision,
    composePath: process.env.GC_ACCEPTANCE_COMPOSE || "docker-compose.yml",
    services: (process.env.GC_ACCEPTANCE_SERVICES || "web").split(","),
    policy: parseReleaseBuildPolicy({ provider: "daytona", imagePrefix: prefix }),
    evidence: async line => { console.log(line); },
  });
  console.log("ACCEPTANCE_ARTIFACT=" + JSON.stringify(artifact));
}
main().catch(error => { console.error("ACCEPTANCE_FAILED=" + String(error.message).slice(0,2000)); process.exitCode = 1; }).finally(() => prisma.$disconnect());
