import { describe, expect, it } from "vitest";
import { discoverEnvFromComposeContent } from "./env-discovery";

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
});
