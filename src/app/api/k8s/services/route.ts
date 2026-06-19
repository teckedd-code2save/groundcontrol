import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { execKubectl } from "@/lib/k8s/utils";
import { shQuote } from "@/lib/vps";
import { handleApiError, sanitizeStderr } from "@/lib/errors";
import type { K8sList, K8sService } from "@/lib/k8s/types";

export async function GET(req: NextRequest) {
  try {
    requireAuth(req);
    const { searchParams } = new URL(req.url);
    const namespace = searchParams.get("namespace");
    if (!namespace) {
      return NextResponse.json(
        { error: "namespace query param is required" },
        { status: 400 }
      );
    }

    const result = await execKubectl(
      `get services -n ${shQuote(namespace)} -o json`
    );
    if (result.code !== 0) {
      const details = sanitizeStderr(result.stderr);
      return NextResponse.json(
        { error: "kubectl get services failed", ...(details ? { details } : {}) },
        { status: 500 }
      );
    }

    const data = safeParseJson<K8sList<K8sService>>(result.stdout);
    const items = Array.isArray(data?.items) ? data.items : [];
    const services = items.map((svc) => ({
      name: svc.metadata?.name,
      namespace: svc.metadata?.namespace,
      type: svc.spec?.type,
      clusterIp: svc.spec?.clusterIP,
      ports: (svc.spec?.ports || []).map((p) => ({
        port: p.port,
        targetPort: p.targetPort,
        nodePort: p.nodePort,
        protocol: p.protocol,
      })),
      createdAt: svc.metadata?.creationTimestamp,
    }));

    return NextResponse.json({ services });
  } catch (err: unknown) {
    return handleApiError(err);
  }
}

function safeParseJson<T>(json: string): T | null {
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}
