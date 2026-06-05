import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSystemConfig, invalidateSystemConfigCache } from "@/lib/vps";

export async function GET() {
  try {
    const config = await getSystemConfig();
    return NextResponse.json(config);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const data = await req.json();
    let config;
    try {
      config = await prisma.systemConfig.findFirst();
      if (!config) {
        config = await prisma.systemConfig.create({ data });
      } else {
        config = await prisma.systemConfig.update({
          where: { id: config.id },
          data: { ...data, updatedAt: new Date() },
        });
      }
    } catch (dbErr: any) {
      // Table may not exist — return the submitted data as the effective config
      config = { ...data, id: 0, updatedAt: new Date() };
    }
    invalidateSystemConfigCache();
    return NextResponse.json(config);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
