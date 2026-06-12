import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getActiveAi } from "@/lib/ai-config";
import { getDockerContainers, getSystemStats } from "@/lib/vps";
import { prisma } from "@/lib/prisma";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 60000;
let cache: {
  at: number;
  data: { summary: string; rootCauses: string[]; actions: string[] };
} | null = null;

const SYSTEM_PROMPT =
  `You are the GroundControl AI operations analyst. Given recent alerts, metric snapshots, container state, ` +
  `and top processes, produce a concise operational assessment. Return ONLY valid JSON with this shape:\n` +
  `{"summary": "one-sentence status summary", "rootCauses": ["hypothesis 1", "hypothesis 2"], "actions": ["action 1", "action 2"]}\n` +
  `If there are no alerts and metrics look healthy, the summary should say so and rootCauses/actions can be empty.`;

export async function GET(req: NextRequest) {
  try {
    await requireAuth(req);

    if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
      return NextResponse.json(cache.data);
    }

    const { provider, apiKey, model } = getActiveAi();
    if (!apiKey) {
      return NextResponse.json(
        { summary: "AI provider not configured.", rootCauses: [], actions: ["Add an API key in Settings → AI."] },
        { status: 503 }
      );
    }

    const [alerts, metrics, containers, stats] = await Promise.all([
      prisma.alert.findMany({ orderBy: { createdAt: "desc" }, take: 10 }).catch(() => []),
      prisma.metricSnapshot.findMany({ orderBy: { createdAt: "desc" }, take: 20 }).catch(() => []),
      getDockerContainers().catch(() => []),
      getSystemStats().catch(() => null),
    ]);

    const topMem = await execSafe(
      `ps -eo pid,comm,%mem,%cpu,rss --sort=-%mem 2>/dev/null | head -n 11 || ps -eo pid,comm,%mem,%cpu,rss 2>/dev/null | sort -k3 -nr | head -n 10`
    );
    const topCpu = await execSafe(
      `ps -eo pid,comm,%cpu,%mem --sort=-%cpu 2>/dev/null | head -n 11 || ps -eo pid,comm,%cpu,%mem 2>/dev/null | sort -k3 -nr | head -n 10`
    );

    const payload = {
      alerts: alerts.map((a) => ({
        title: a.title,
        severity: a.severity,
        message: a.message,
        read: a.read,
        createdAt: a.createdAt,
      })),
      metrics: metrics.map((m) => ({
        cpuLoad1: m.cpuLoad1,
        memPercent: m.memPercent,
        diskPercent: m.diskPercent,
        runningContainers: m.runningContainers,
        unhealthyContainers: m.unhealthyContainers,
        createdAt: m.createdAt,
      })),
      containers: containers.map((c) => ({ name: c.name, image: c.image, status: c.status, state: c.state })),
      stats,
      topMemoryProcesses: topMem,
      topCpuProcesses: topCpu,
    };

    const userPrompt = `Analyze the following VPS data and return JSON.\n\n${JSON.stringify(payload, null, 2)}`;

    let parsed: { summary: string; rootCauses: string[]; actions: string[] };

    if (provider === "anthropic") {
      const anthropic = new Anthropic({ apiKey });
      const response = await anthropic.messages.create({
        model,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt }],
      });
      const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
      parsed = parseResponse(textBlock?.text || "");
    } else {
      const openai = new OpenAI({ apiKey });
      const response = await openai.chat.completions.create({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.3,
      });
      const text = response.choices[0]?.message?.content || "";
      parsed = parseResponse(text);
    }

    cache = { at: Date.now(), data: parsed };
    return NextResponse.json(parsed);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { summary: "AI synthesis failed.", rootCauses: [message], actions: [] },
      { status: 500 }
    );
  }
}

async function execSafe(command: string): Promise<string> {
  try {
    const { execOnVps } = await import("@/lib/vps");
    const result = await execOnVps(command);
    return result.stdout || result.stderr || "(no output)";
  } catch (err: unknown) {
    return `ERROR: ${err instanceof Error ? err.message : String(err)}`;
  }
}

function parseResponse(text: string): { summary: string; rootCauses: string[]; actions: string[] } {
  try {
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const raw = fence ? fence[1] : text;
    const parsed = JSON.parse(raw);
    return {
      summary: String(parsed.summary || ""),
      rootCauses: Array.isArray(parsed.rootCauses) ? parsed.rootCauses.map(String) : [],
      actions: Array.isArray(parsed.actions) ? parsed.actions.map(String) : [],
    };
  } catch {
    return {
      summary: text.split("\n")[0] || "AI returned an unparsable response.",
      rootCauses: [],
      actions: [],
    };
  }
}
