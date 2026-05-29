import { NextRequest, NextResponse } from "next/server";
import { execOnVps } from "@/lib/vps";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const path = searchParams.get("path") || "/opt";

  try {
    const result = await execOnVps(
      `ls -la "${path.replace(/"/g, '\\"')}" | awk '{printf "%s|%s|%s|%s|%s|%s|%s\n", $1,$2,$3,$4,$5,$6,$7,$8,$9}'`
    );
    if (!result.stdout.trim()) return NextResponse.json({ files: [] });

    const lines = result.stdout.trim().split("\n").slice(1);
    const files = lines.map((line) => {
      const parts = line.split("|");
      const perms = parts[0];
      const isDir = perms.startsWith("d");
      const name = parts.slice(6).join("|");
      return {
        name: name.trim(),
        perms,
        owner: parts[2],
        group: parts[3],
        size: parts[4],
        date: `${parts[5]} ${parts[6]}`,
        isDir,
      };
    }).filter((f) => f.name && f.name !== "." && f.name !== "..");

    return NextResponse.json({ path, files });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { path, content } = await req.json();
    const escaped = content.replace(/'/g, "'\\''").replace(/"/g, '\\"');
    const result = await execOnVps(`echo '${escaped}' > "${path.replace(/"/g, '\\"')}"`);
    return NextResponse.json({ success: result.code === 0, error: result.stderr });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
