"""Rehearse project migrations on synthetic SQLite data, never an operator DB."""
import json
from pathlib import Path
import sqlite3

root = Path(__file__).resolve().parent.parent
migrations = sorted((root / "prisma/migrations").glob("*/migration.sql"))
new_names = {"20261003000000_project_sources_and_instances", "20261003140000_project_repository_branch"}
db = sqlite3.connect(":memory:")
for migration in migrations:
    if migration.parent.name not in new_names:
        db.executescript(migration.read_text())


def seed(table, values):
    values = dict(values)
    for _, name, kind, required, default, primary in db.execute(f'PRAGMA table_info("{table}")'):
        if name in values or default is not None or not required:
            continue
        values[name] = 1 if "INT" in kind else "2026-10-20T00:00:00.000Z" if "DATE" in kind else "fixture"
    columns = ",".join(f'"{name}"' for name in values)
    db.execute(f'INSERT INTO "{table}" ({columns}) VALUES ({",".join("?" for _ in values)})', list(values.values()))


seed("User", {"id": 1, "username": "fixture", "password": "synthetic-hash"})
seed("VpsConfig", {"id": 1, "host": "fixture.example", "privateKey": "encrypted-fixture", "isActive": True})
seed("ProjectGroup", {"id": 1, "slug": "fixture", "name": "Existing product"})
seed("Project", {"id": 1, "slug": "fixture-production", "path": "/fixtures/live", "projectGroupId": 1, "envVars": '{"SYNTHETIC":"preserve"}'})
seed("DeploymentTarget", {"id": 1, "vpsConfigId": 1})
seed("Deployment", {"id": 1, "projectId": 1, "targetId": 1, "status": "success", "commitSha": "existing-revision", "imageDigest": "sha256:fixture"})
seed("EnrolledDeployment", {"id": 1, "slug": "fixture-live", "kind": "compose", "sourcePath": "/fixtures/live", "vpsConfigId": 1, "projectGroupId": 1, "legacyProjectId": 1, "managementMode": "managed"})
seed("EnrolledDeployment", {"id": 2, "slug": "fixture-source", "kind": "source", "sourcePath": "/fixtures/source", "vpsConfigId": 1, "projectGroupId": 1})
seed("OAuthClient", {"id": 1})
seed("OAuthGrant", {"id": 1, "userId": 1, "clientDbId": 1, "resources": "[1]", "scope": "deployment:read"})
seed("OAuthToken", {"id": 1, "grantId": 1, "kind": "access", "tokenHash": "synthetic-token-hash"})
seed("AgentOperation", {"id": "fixture-operation", "grantId": 1, "deploymentId": 1, "status": "success", "resultJson": '{"preserved":true}'})
db.commit()
assert not db.execute("PRAGMA foreign_key_check").fetchall()

# Compare every old column in every existing table, including credentials,
# authorization, release history and the original source-only record.
snapshots = {}
for (table,) in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"):
    columns = [column[1] for column in db.execute(f'PRAGMA table_info("{table}")')]
    query = 'SELECT ' + ','.join(f'"{column}"' for column in columns) + f' FROM "{table}" ORDER BY rowid'
    snapshots[table] = (query, db.execute(query).fetchall())
for migration in migrations:
    if migration.parent.name in new_names:
        db.executescript(migration.read_text())
for table, (query, rows) in snapshots.items():
    assert db.execute(query).fetchall() == rows, f"Existing data changed in {table}"
assert db.execute('SELECT "projectGroupId", "vpsConfigId", "path" FROM "ProjectSource"').fetchall() == [(1, 1, "/fixtures/source")]
assert db.execute('SELECT "environmentName" FROM "EnrolledDeployment" WHERE id=1').fetchone() == ("Unspecified",)
seed("EnrolledDeployment", {"id": 3, "slug": "fixture-stage", "kind": "compose", "sourcePath": "/fixtures/live", "vpsConfigId": 1, "projectGroupId": 1, "environmentName": "Staging"})
assert db.execute('SELECT count(*) FROM "EnrolledDeployment" WHERE "sourcePath"=?', ("/fixtures/live",)).fetchone() == (2,)
assert not db.execute("PRAGMA foreign_key_check").fetchall()
assert db.execute("PRAGMA integrity_check").fetchone() == ("ok",)
print(json.dumps({"existingTablesPreserved": len(snapshots), "sourceMigration": "passed", "sharedSourceInstances": "passed", "foreignKeys": "passed", "integrity": "passed"}))
