// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const installer = readFileSync(join(process.cwd(), "scripts", "install"), "utf8");

describe("GroundControl distribution installer contract", () => {
  it("keeps preview, upgrade and uninstall on the canonical install surface", () => {
    expect(installer).toContain("--preview");
    expect(installer).toContain("--upgrade");
    expect(installer).toContain("--uninstall");
    expect(installer).toContain('"stage":"upgrade_preview"');
    expect(installer).toContain('"stage":"uninstalled"');
  });

  it("pins the requested image to a resolved registry digest when available", () => {
    expect(installer).toContain("image_repo_digest");
    expect(installer).toContain("RESOLVED_IMAGE");
    expect(installer).toContain('IMAGE="$RESOLVED_IMAGE"');
    expect(installer).toContain("starting GroundControl with immutable image");
  });

  it("requires persistent database identity before upgrading", () => {
    expect(installer).toContain('Destination "/app/prisma"');
    expect(installer).toContain("persistent /app/prisma storage could not be identified for backup");
    expect(installer).toContain("backup_existing");
  });

  it("backs up SQLite before upgrade and restores it on failed health", () => {
    expect(installer).toContain("consistent SQLite backup");
    expect(installer).toContain("restore_backup");
    expect(installer).toContain('"stage":"upgrade_rolled_back"');
    expect(installer).toContain('"stage":"rollback_failed"');
    expect(installer).toContain("failed-upgrade.log");
  });

  it("reports a distinct successful upgrade result with rollback evidence", () => {
    expect(installer).toContain('"stage":"upgrade_complete"');
    expect(installer).toContain('"storageBackup":"ready"');
    expect(installer).toContain("result.json");
  });

  it("keeps uninstall data-preserving by default", () => {
    expect(installer).toContain('"dataPreserved":true');
    expect(installer).toContain("Database volume");
    expect(installer).not.toContain("docker compose down -v");
  });

  it("keeps the management port loopback-only", () => {
    expect(installer).toContain('127.0.0.1:');
    expect(installer).not.toContain("/root/.ssh");
  });
});
