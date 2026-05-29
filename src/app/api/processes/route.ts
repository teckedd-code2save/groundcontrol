import { NextResponse } from "next/server";
import { execOnVps } from "@/lib/vps";

export async function GET() {
  try {
    const result = await execOnVps(
      `ps aux --sort=-%cpu | head -51 | awk '{printf "%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s\n", $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11}'`
    );
    if (!result.stdout.trim()) return NextResponse.json([]);

    const lines = result.stdout.trim().split("\n");
    const headers = lines[0].split("|");
    const processes = lines.slice(1).map((line) => {
      const parts = line.split("|");
      return {
        user: parts[0],
        pid: parts[1],
        cpu: parts[2],
        mem: parts[3],
        vsz: parts[4],
        rss: parts[5],
        tty: parts[6],
        stat: parts[7],
        start: parts[8],
        time: parts[9],
        command: parts.slice(10).join(" "),
      };
    });

    return NextResponse.json({ headers, processes });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
