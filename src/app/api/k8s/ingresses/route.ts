import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { execKubectl } from "@/lib/k8s/utils";
import { shQuote } from "@/lib/vps";
import type { K8sList, K8sIngress, K8sIngressRule } from "@/lib/k8s/types";

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
      `get ingresses -n ${shQuote(namespace)} -o json`
    );
    if (result.code !== 0) {
      return NextResponse.json(
        { error: result.stderr || "kubectl get ingresses failed" },
        { status: 500 }
      );
    }

    const data = safeParseJson<K8sList<K8sIngress>>(result.stdout);
    const items = Array.isArray(data?.items) ? data.items : [];
    const ingresses = items.map((ing) => ({
      name: ing.metadata?.name,
      namespace: ing.metadata?.namespace,
      class: ing.spec?.ingressClassName,
      hosts: (ing.spec?.rules || []).map((r: K8sIngressRule) => r.host),
      paths: (ing.spec?.rules || []).flatMap((r: K8sIngressRule) =>
        (r.http?.paths || []).map((p) => ({
          path: p.path,
          service: p.backend?.service?.name,
          port: p.backend?.service?.port?.number,
        }))
      ),
      addresses:
        ing.status?.loadBalancer?.ingress?.map((lb) => lb.ip || lb.hostname) || [],
      createdAt: ing.metadata?.creationTimestamp,
    }));

    return NextResponse.json({ ingresses });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

function safeParseJson<T>(json: string): T | null {
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}
