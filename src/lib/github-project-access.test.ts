// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const { mint, find, decrypt } = vi.hoisted(() => ({ mint: vi.fn(), find: vi.fn(), decrypt: vi.fn() }));
vi.mock("./prisma", () => ({ prisma: { githubRepository: { findMany: async () => [{ id: "repo-1", fullName: "team/private" }], findUnique: find } } }));
vi.mock("./crypto", () => ({ decryptMaybe: decrypt }));
vi.mock("./github-app", () => ({ createGithubInstallationToken: mint }));
import { githubProjectAccess } from "./github-project-import";
beforeEach(() => { mint.mockReset(); find.mockReset(); decrypt.mockReset(); decrypt.mockReturnValue("fixture-key"); mint.mockResolvedValue({ token: "fixture-token", permissions: { contents: "read" } }); find.mockResolvedValue({ id: "repo-1", installationId: 1, installation: { suspendedAt: null, connection: { appId: "app", privateKeyEncrypted: "encrypted" } } }); });
it("reuses the connected app for private repository reads and checkout", async () => {
 const access = await githubProjectAccess("https://github.com/TEAM/private.git");
 expect(access.repositoryId).toBe("repo-1"); expect(access.headers.Authorization).toBe("Bearer fixture-token"); expect(access.token).toBe("fixture-token");
});
it("refuses suspended access rather than falling back to another credential", async () => {
 find.mockResolvedValue({ installation: { suspendedAt: new Date() } });
 await expect(githubProjectAccess("https://github.com/team/private")).rejects.toThrow("unavailable"); expect(mint).not.toHaveBeenCalled();
});
it("rejects non-GitHub or credential-bearing repository URLs", async () => {
 await expect(githubProjectAccess("https://github.com.evil.test/team/private")).rejects.toThrow("GitHub repository");
 await expect(githubProjectAccess("https://token@github.com/team/private")).rejects.toThrow("GitHub repository"); expect(mint).not.toHaveBeenCalled();
});
