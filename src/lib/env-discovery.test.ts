import { describe, expect, it } from "vitest";
import {
  discoverEnvFromComposeContent,
  discoverRuntimeEnvFromInspectContent,
  parseProcessEnvSnapshotContent,
} from "./env-discovery";

describe("env discovery", () => {
  it("discovers component env declarations without exposing values", () => {
    const entries = discoverEnvFromComposeContent(`
services:
  web:
    environment:
      NEXT_PUBLIC_API_URL: https://api.example.com
      SECRET_TOKEN: super-secret
  worker:
    environment:
      - QUEUE_NAME=default
`);

    expect(entries).toEqual([
      { key: "NEXT_PUBLIC_API_URL", source: "compose", scope: "component", component: "web", masked: "", hasValue: false },
      { key: "SECRET_TOKEN", source: "compose", scope: "component", component: "web", masked: "", hasValue: false },
      { key: "QUEUE_NAME", source: "compose", scope: "component", component: "worker", masked: "", hasValue: false },
    ]);
  });

  it("resolves the effective environment from running Compose containers", () => {
    const result = discoverRuntimeEnvFromInspectContent(JSON.stringify([
      {
        Name: "/payments-api-1",
        Config: {
          Labels: { "com.docker.compose.service": "payments-api" },
          Env: [
            "DATABASE_URL=postgres://db/prod",
            "API_TOKEN=runtime-secret",
            "FEATURE_FLAG=enabled=gradual",
          ],
        },
        State: { Running: true, Status: "running" },
      },
    ]));

    expect(result.containerCount).toBe(1);
    expect(result.runningContainerCount).toBe(1);
    expect(result.values).toEqual({
      DATABASE_URL: "postgres://db/prod",
      API_TOKEN: "runtime-secret",
      FEATURE_FLAG: "enabled=gradual",
    });
    expect(result.scopedValues["payments-api:API_TOKEN"]).toBe("runtime-secret");
    expect(result.entries.find((entry) => entry.key === "API_TOKEN")).toMatchObject({
      source: "running container",
      component: "payments-api",
      container: "payments-api-1",
      state: "running",
      runtime: true,
      masked: "••••••••••cret",
      hasValue: true,
    });
  });

  it("fails closed when Docker inspect output is unavailable", () => {
    expect(discoverRuntimeEnvFromInspectContent("not-json")).toEqual({
      entries: [],
      values: {},
      scopedValues: {},
      containerCount: 0,
      runningContainerCount: 0,
    });
  });

  it("prefers the environment of the running process over container configuration", () => {
    const processPayload = Buffer.from("DATABASE_URL=postgres://db/live\0AGENT_TOKEN=injected\0", "utf8").toString("base64");
    const snapshots = parseProcessEnvSnapshotContent(`container-123\t${processPayload}\n`);
    const result = discoverRuntimeEnvFromInspectContent(JSON.stringify([
      {
        Id: "container-123",
        Name: "/agent-deployed-api",
        Config: {
          Labels: { "com.docker.compose.service": "api" },
          Env: ["DATABASE_URL=postgres://db/configured", "CONFIG_ONLY=yes"],
        },
        State: { Running: true, Status: "running", Pid: 4242 },
      },
    ]), snapshots);

    expect(result.values).toEqual({
      DATABASE_URL: "postgres://db/live",
      AGENT_TOKEN: "injected",
    });
    expect(result.entries.find((entry) => entry.key === "AGENT_TOKEN")).toMatchObject({
      source: "running process",
      runtime: true,
      component: "api",
    });
  });
});
