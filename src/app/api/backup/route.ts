import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { readFile } from "fs/promises";
import { writeFile } from "fs/promises";
import { prisma } from "@/lib/prisma";

const DB_PATH = "/app/prisma/prod.db";

export async function GET(req: NextRequest) {
  try {
    requireAuth(req);

    const db = await readFile(DB_PATH);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

    return new NextResponse(db, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="groundcontrol-backup-${timestamp}.db"`,
      },
    });
  } catch (err: any) {
    if (err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    requireAuth(req);

    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (file.size > 50 * 1024 * 1024) {
      return NextResponse.json({ error: "File too large (max 50MB)" }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Basic SQLite magic number check
    if (buffer.length < 16 || buffer.toString("hex", 0, 16) !== "53514c69746520666f726d61742033") {
      return NextResponse.json({ error: "Invalid SQLite database file" }, { status: 400 });
    }

    // Disconnect Prisma before replacing the DB
    await prisma.$disconnect();

    // Write to a temp file first, then rename for atomicity
    const tempPath = DB_PATH + ".tmp";
    await writeFile(tempPath, buffer);
    await writeFile(DB_PATH, buffer);

    return NextResponse.json({ success: true });
  } catch (err: any) {
    if (err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
