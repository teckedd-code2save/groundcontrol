import { NextResponse } from "next/server";
import { execOnVps } from "@/lib/vps";

export async function GET() {
  try {
    const result = await execOnVps(`ps aux`);
    if (!result.stdout.trim()) return NextResponse.json([]);

    const lines = result.stdout.trim().split("\n").slice(1); // skip header
    const processes = lines.map((line) => {
      const parts = line.trim().split(/\s+/);
      return {
        user: parts[0] || "",
        pid: parts[1] || "",
        cpu: parts[2] || "0.0",
        mem: parts[3] || "0.0",
        vsz: parts[4] || "",
        rss: parts[5] || "",
        tty: parts[6] || "",
        stat: parts[7] || "",
        start: parts[8] || "",
        time: parts[9] || "",
        command: parts.slice(10).join(" ") || "",
      };
    });

    return NextResponse.json(processes);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
