import { NextResponse } from "next/server";
import { execOnVps } from "@/lib/vps";

export async function GET() {
  try {
    // Try procps ps first, fallback to busybox ps
    const result = await execOnVps(
      `ps -eo pid,ppid,user,%cpu,%mem,vsz,rss,stat,comm,args 2>/dev/null || ps aux 2>/dev/null || ps`
    );
    if (!result.stdout.trim()) return NextResponse.json([]);

    const lines = result.stdout.trim().split("\n");
    // Skip header line and parse
    const processes = lines.slice(1).map((line) => {
      const parts = line.trim().split(/\s+/);
      return {
        pid: parts[0] || "",
        ppid: parts[1] || "",
        user: parts[2] || "",
        cpu: parts[3] || "0.0",
        mem: parts[4] || "0.0",
        vsz: parts[5] || "",
        rss: parts[6] || "",
        stat: parts[7] || "",
        command: parts.slice(9).join(" ") || parts[8] || "",
      };
    });

    return NextResponse.json(processes);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
