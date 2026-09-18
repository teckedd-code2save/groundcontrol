// @vitest-environment node
import { expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  requireAuth: () => ({ id: 1 }),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    systemConfig: {
      findUnique: async ({ where }: { where: { vpsConfigId: number } }) => ({
        vpsConfigId: where.vpsConfigId,
        sshDefaultCwd: where.vpsConfigId === 8 ? "/srv/remote" : "/srv/apps",
      }),
    },
    vpsConfig: {
      findUnique: async ({ where }: { where: { id: number } }) => ({
        id: where.id,
        host: "remote.example",
        port: 2222,
        username: "ubuntu",
        isLocal: false,
      }),
    },
  },
}));

vi.mock("@/lib/vps", () => ({
  getActiveVps: async () => ({
    id: 7,
    host: "pinned.example",
    port: 22,
    username: "ops",
    isLocal: false,
  }),
  shQuote: (value: string) => `'${String(value).replace(/'/g, "'\\''")}'`,
}));

import { initialTerminalTarget } from "./terminal-execution";

it("opens the global terminal in the configured shell working directory", async () => {
  await expect(initialTerminalTarget()).resolves.toEqual({
    vpsId: 7,
    host: "pinned.example",
    username: "ops",
    cwd: "/srv/apps",
  });
});

it("bootstraps an explicitly pinned target for contextual terminals", async () => {
  await expect(initialTerminalTarget(8)).resolves.toEqual({
    vpsId: 8,
    host: "remote.example",
    username: "ubuntu",
    cwd: "/srv/remote",
  });
});
