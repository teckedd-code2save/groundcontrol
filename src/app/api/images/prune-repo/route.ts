import { NextRequest, NextResponse } from "next/server";
import { execOnVps } from "@/lib/vps";

export async function POST(req: NextRequest) {
  try {
    const { repository, keepTag } = await req.json();
    if (!repository) {
      return NextResponse.json({ error: "repository required" }, { status: 400 });
    }

    // Get all images for this repository with their tags and IDs
    const result = await execOnVps(
      `docker images --format "{{.Repository}}|{{.Tag}}|{{.ID}}|{{.CreatedAt}}" | grep "^${repository}|"`
    );

    if (!result.stdout.trim()) {
      return NextResponse.json({ success: true, removed: [], message: "No images found" });
    }

    const images = result.stdout
      .trim()
      .split("\n")
      .map((line) => {
        const [repo, tag, id, createdAt] = line.split("|");
        return { repo, tag, id, createdAt, fullName: tag && tag !== "<none>" ? `${repo}:${tag}` : id };
      });

    // Determine which image(s) to keep
    const keepImages = new Set<string>();
    
    if (keepTag) {
      // Keep specific tag
      const keep = images.find((i) => i.tag === keepTag);
      if (keep) keepImages.add(keep.id);
    } else {
      // Keep the most recently created image
      images.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      if (images[0]) keepImages.add(images[0].id);
    }

    // Remove all others
    const removed: string[] = [];
    const errors: string[] = [];
    
    for (const img of images) {
      if (keepImages.has(img.id)) continue;
      
      const rmi = await execOnVps(`docker rmi ${img.id} 2>&1`);
      if (rmi.code === 0) {
        removed.push(img.fullName);
      } else {
        errors.push(`${img.fullName}: ${rmi.stderr || rmi.stdout}`);
      }
    }

    return NextResponse.json({
      success: true,
      removed,
      errors: errors.length > 0 ? errors : undefined,
      kept: Array.from(keepImages).map((id) => images.find((i) => i.id === id)?.fullName).filter(Boolean),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
