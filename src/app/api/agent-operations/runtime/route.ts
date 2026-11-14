import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { agentOperationTarget } from "@/lib/agent-operation-target";
import { deploymentRuntime } from "@/lib/agent-runtime-capabilities";
import { executeRuntimeOperation } from "@/lib/agent-runtime-execution";
import { handleApiError, HttpError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { POST as composeOperation } from "@/app/api/projects/compose/route";

export async function POST(req: NextRequest) {
  try {
    requireAuth(req);
    const target = await agentOperationTarget(req, ["deployment.restart", "deployment.redeploy", "deployment.source.deploy", "deployment.first_launch"]);
    if (!target) throw new HttpError("A durable agent operation is required.", 403);
    // The worker owns dispatch; this second claim prevents duplicate HTTP execution.
    const claimed = await prisma.agentOperation.updateMany({
      where: { id: target.operation.id, status: "running", evidenceJson: null },
      data: { evidenceJson: JSON.stringify({ phase: "runtime_execution_started" }) },
    });
    if (claimed.count !== 1) return NextResponse.json({ uncertain: true, error: "This operation has already started. Inspect before retrying." }, { status: 409 });
    if (deploymentRuntime(target.deployment) === "compose" && !["deployment.restart", "deployment.first_launch"].includes(target.operation.type)) {
      return composeOperation(new NextRequest(req.url, { method: "POST", headers: req.headers, body: JSON.stringify({
        projectSlug: target.projectSlug,
        projectPath: target.projectPath,
        composePath: target.deployment.composePath,
        action: target.operation.type === "deployment.source.deploy" ? "source-deploy" : "redeploy",
        branch: target.input.branch,
      }) }));
    }
    try {
      return NextResponse.json(await executeRuntimeOperation(target));
    } catch (error) {
      // An exception after dispatch can be a lost SSH reply. Do not advertise a safe retry.
      if (!(error instanceof HttpError)) return NextResponse.json({ uncertain: true, error: "Runtime outcome could not be confirmed. Inspect before retrying." }, { status: 500 });
      throw error;
    }
  } catch (error) { return handleApiError(error); }
}
