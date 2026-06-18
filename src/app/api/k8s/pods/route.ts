import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { execKubectl } from "@/lib/k8s/utils";
import { shQuote } from "@/lib/vps";
import type { K8sList, K8sPod } from "@/lib/k8s/types";

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
      `get pods -n ${shQuote(namespace)} -o json`
    );
    if (result.code !== 0) {
      return NextResponse.json(
        { error: result.stderr || "kubectl get pods failed" },
        { status: 500 }
      );
    }

    const data = safeParseJson<K8sList<K8sPod>>(result.stdout);
    const items = Array.isArray(data?.items) ? data.items : [];
    const pods = items.map((pod) => {
      const containerStatuses = pod.status?.containerStatuses || [];
      const ready = containerStatuses.filter((c) => c.ready).length;
      const restarts = containerStatuses.reduce(
        (sum, c) => sum + (c.restartCount || 0),
        0
      );
      return {
        name: pod.metadata?.name,
        namespace: pod.metadata?.namespace,
        status: pod.status?.phase,
        ready: `${ready}/${containerStatuses.length}`,
        restarts,
        createdAt: pod.metadata?.creationTimestamp,
      };
    });

    return NextResponse.json({ pods });
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
