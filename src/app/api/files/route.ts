import { NextRequest, NextResponse } from "next/server";
import { execOnVps } from "@/lib/vps";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const path = searchParams.get("path") || "/opt";

  try {
    const result = await execOnVps(
      `ls -la "${path.replace(/"/g, '\\"')}"`
    );
    if (!result.stdout.trim()) return NextResponse.json({ files: [] });

    const lines = result.stdout.trim().split("\n").slice(1);
    const files = lines.map((line) => {
      const match = line.match(/^([\-dlcbsp][rwxst\-]{9}[+@]?)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+\s+\S+\s+\S+)\s+(.+)$/);
      if (!match) return null;
      const perms = match[1];
      const isDir = perms.startsWith("d");
      return {
        name: match[7].trim(),
        perms,
        owner: match[3],
        group: match[4],
        size: match[5],
        date: match[6],
        isDir,
      };
    }).filter(Boolean);

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
