// @vitest-environment node
import { expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  requireAuth: () => ({ id: 1 }),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {},
}));

vi.mock("@/lib/vps", () => ({
  getActiveVps: async () => ({
    id: 7,
    host: "pinned.example",
    port: 22,
    username: "ops",
    isLocal: false,
  }),
  getSystemConfig: async () => ({
    projectRoot: "/srv/apps",
  }),
  shQuote: (value: string) => `'${String(value).replace(/'/g, "'\\''")}'`,
}));

import { initialTerminalTarget } from "./terminal-execution";

it("opens the terminal in the configured project root", async () => {
  await expect(initialTerminalTarget()).resolves.toEqual({
    vpsId: 7,
    host: "pinned.example",
    cwd: "/srv/apps",
  });
});
