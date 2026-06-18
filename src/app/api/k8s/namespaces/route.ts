import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { execKubectl } from "@/lib/k8s/utils";
import type { K8sList, K8sNamespace } from "@/lib/k8s/types";

export async function GET(req: NextRequest) {
  try {
    requireAuth(req);
    const result = await execKubectl("get namespaces -o json");
    if (result.code !== 0) {
      return NextResponse.json(
        { error: result.stderr || "kubectl get namespaces failed" },
        { status: 500 }
      );
    }

    const data = safeParseJson<K8sList<K8sNamespace>>(result.stdout);
    const items = Array.isArray(data?.items) ? data.items : [];
    const namespaces = items
      .filter(
        (ns) =>
          typeof ns?.metadata?.name === "string" && ns.metadata.name.startsWith("gc-")
      )
      .map((ns) => ({
        name: ns.metadata?.name,
        status: ns.status?.phase,
        createdAt: ns.metadata?.creationTimestamp,
      }));

    return NextResponse.json({ namespaces });
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
