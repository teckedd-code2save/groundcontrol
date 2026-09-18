// @vitest-environment node
import { describe, expect, it } from "vitest";
import { summarizeEnvKeyPresence } from "./env-management";

describe("deployment env key presence", () => {
  it("distinguishes configured, missing, and unmanaged keys without values", () => {
    const result = summarizeEnvKeyPresence(
      [
        { key: "PAYSTACK_SECRET_KEY", required: true, component: "api" },
        { key: "PAYSTACK_PUBLIC_KEY", required: false, component: "web" },
        { key: "DATABASE_URL", required: true },
      ],
      {
        DATABASE_URL: "postgres://secret-value",
      },
      {
        api: {
          PAYSTACK_SECRET_KEY: "sk_live_secret",
        },
        web: {},
      },
      [
        "PAYSTACK_SECRET_KEY",
        "PAYSTACK_PUBLIC_KEY",
        "DATABASE_URL",
        "UNMANAGED_KEY",
      ]
    );

    expect(result).toEqual([
      {
        key: "PAYSTACK_SECRET_KEY",
        state: "configured",
        configured: true,
        declared: true,
        matches: [{ component: "api", required: true, configured: true }],
      },
      {
        key: "PAYSTACK_PUBLIC_KEY",
        state: "missing",
        configured: false,
        declared: true,
        matches: [{ component: "web", required: false, configured: false }],
      },
      {
        key: "DATABASE_URL",
        state: "configured",
        configured: true,
        declared: true,
        matches: [{ component: null, required: true, configured: true }],
      },
      {
        key: "UNMANAGED_KEY",
        state: "unmanaged",
        configured: false,
        declared: false,
        matches: [],
      },
    ]);

    expect(JSON.stringify(result)).not.toContain("sk_live_secret");
    expect(JSON.stringify(result)).not.toContain("postgres://secret-value");
  });

  it("recognizes configured keys that exist outside the declared schema", () => {
    const result = summarizeEnvKeyPresence(
      [],
      { PAYSTACK_WEBHOOK_SECRET: "configured-but-not-declared" },
      {},
      ["PAYSTACK_WEBHOOK_SECRET"]
    );

    expect(result[0]).toMatchObject({
      state: "configured",
      configured: true,
      declared: false,
      matches: [{ component: null, required: false, configured: true }],
    });
    expect(JSON.stringify(result)).not.toContain("configured-but-not-declared");
  });
});
