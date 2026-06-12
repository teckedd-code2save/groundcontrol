import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { readdirSync, readFileSync, statSync } from "fs";
import { homedir } from "os";
import { join } from "path";

interface SshKey {
  path: string;
  content: string;
}

const KNOWN_FILES = new Set(["known_hosts", "config", "authorized_keys"]);
const KEY_MARKERS = [
  "BEGIN OPENSSH PRIVATE KEY",
  "BEGIN RSA PRIVATE KEY",
  "BEGIN EC PRIVATE KEY",
  "BEGIN DSA PRIVATE KEY",
];

function looksLikeKey(content: string): boolean {
  return KEY_MARKERS.some((marker) => content.includes(marker));
}

/**
 * Scan ~/.ssh for candidate private key files and return their contents so the
 * onboarding wizard can populate the key field.
 */
export async function GET(req: NextRequest) {
  try {
    await requireAuth(req);
    const sshDir = join(homedir(), ".ssh");
    const keys: SshKey[] = [];

    try {
      const entries = readdirSync(sshDir);
      for (const name of entries) {
        if (name.endsWith(".pub") || KNOWN_FILES.has(name)) continue;
        const fullPath = join(sshDir, name);
        try {
          const st = statSync(fullPath);
          if (!st.isFile()) continue;
          const content = readFileSync(fullPath, "utf-8");
          if (looksLikeKey(content)) {
            keys.push({ path: fullPath, content });
          }
        } catch {
          // skip unreadable files
        }
      }
    } catch {
      // directory may not exist or be unreadable
    }

    return NextResponse.json({ keys });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 }
    );
  }
}
