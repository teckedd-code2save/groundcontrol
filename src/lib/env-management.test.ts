import { describe, expect, it } from "vitest";
import {
  buildMaterializeEnvCommand,
  hashEnv,
  maskSecret,
  parseDotenv,
  parseEnvSchema,
  serializeDotenv,
  validateEnv,
} from "./env-management";

describe("env management", () => {
  it("parses env schemas into required keys", () => {
    const schema = parseEnvSchema(`
# comment
DATABASE_URL=<SET_ME>
REDIS_URL=redis://redis:6379
BAD LINE
DATABASE_URL=duplicate
`);

    expect(schema).toEqual([
      { key: "DATABASE_URL", required: true, defaultValue: undefined },
      { key: "REDIS_URL", required: true, defaultValue: "redis://redis:6379" },
    ]);
  });

  it("validates required keys and produces stable hashes", () => {
    const schema = parseEnvSchema("A=<SET_ME>\nB=default\n");
    const values = { B: "2", A: "1" };

    expect(validateEnv(schema, values)).toEqual({
      ok: true,
      missing: [],
      hash: hashEnv(values),
    });
    expect(validateEnv(schema, { A: "1" }).missing).toEqual(["B"]);
    expect(hashEnv({ A: "1", B: "2" })).toBe(hashEnv({ B: "2", A: "1" }));
  });

  it("serializes and parses dotenv values", () => {
    const serialized = serializeDotenv({ TOKEN: "abc def", PORT: "3000" });

    expect(serialized).toContain("PORT=3000");
    expect(serialized).toContain('TOKEN="abc def"');
    expect(parseDotenv(serialized)).toEqual({ PORT: "3000", TOKEN: "abc def" });
  });

  it("masks secrets and builds atomic materialization command", () => {
    expect(maskSecret("supersecret")).toBe("•••••••cret");

    const command = buildMaterializeEnvCommand("/srv/app", "A=1\n");
    expect(command).toContain("cat > .env.new");
    expect(command).toContain("chmod 600 .env.new");
    expect(command).toContain("mv .env.new .env");
    expect(command).toContain(".groundcontrol/env-backups");
  });
});
