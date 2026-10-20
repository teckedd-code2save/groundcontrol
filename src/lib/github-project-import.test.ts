// @vitest-environment node
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ list: vi.fn(), repo: vi.fn(), upsert: vi.fn(), token: vi.fn(), privateFetch: vi.fn(), fetch: vi.fn() }));
vi.mock("./prisma", () => ({ prisma: { githubRepository: { findMany: mocks.list, findUnique: mocks.repo }, projectGroup: { upsert: mocks.upsert } } }));
vi.mock("./crypto", () => ({ decryptMaybe: () => "server-only-key" }));
vi.mock("./github-app", () => ({ createGithubInstallationToken: mocks.token, githubInstallationFetch: mocks.privateFetch }));
import { githubProjectIdentity, inspectGithubProject, importGithubProject } from "./github-project-import";
const metadata = { name: "portal", full_name: "Team/portal", private: false, default_branch: "develop", description: "Customer portal" };
beforeEach(() => { vi.resetAllMocks(); mocks.list.mockResolvedValue([]); mocks.fetch.mockResolvedValue(new Response(JSON.stringify(metadata))); mocks.upsert.mockImplementation(async (args) => ({ id: 7, ...args.create })); vi.stubGlobal("fetch", mocks.fetch); });
afterEach(() => vi.unstubAllGlobals());
it("rejects non-GitHub destinations and embedded credentials before making requests", () => {
  for (const url of ["https://example.com/a/b", "http://github.com/a/b", "https://github.com:8080/a/b", "https://token@github.com/a/b", "https://github.com/a/b/tree/main", "https://github.com/a/b?token=secret", "file:///etc/passwd"]) expect(() => githubProjectIdentity(url)).toThrow();
  expect(githubProjectIdentity("https://github.com/Team/portal.git")).toBe("Team/portal"); expect(mocks.fetch).not.toHaveBeenCalled();
});
it("verifies a public repository and creates only a project with its real default branch", async () => {
  const result = await importGithubProject({ repositoryUrl: "https://github.com/Team/portal", name: "Customer Portal", description: "Orders and accounts" });
  expect(result.project).toMatchObject({ name: "Customer Portal", repositoryUrl: "https://github.com/Team/portal", repositoryDefaultBranch: "develop", description: "Orders and accounts" });
  expect(mocks.fetch.mock.calls[0][0]).toBe("https://api.github.com/repos/Team/portal");
  expect(mocks.upsert.mock.calls[0][0].update).toEqual({});
});
it("uses installed access for private repositories without returning credentials", async () => {
  mocks.list.mockResolvedValue([{ id: "r1", fullName: "Team/portal" }]);
  mocks.repo.mockResolvedValue({ installation: { id: "i1", suspendedAt: null, connection: { appId: "a1", privateKeyEncrypted: "encrypted" } } });
  mocks.token.mockResolvedValue({ token: "server-only-token" }); mocks.privateFetch.mockResolvedValue({ ...metadata, private: true });
  const result = await inspectGithubProject("https://github.com/team/portal");
  expect(result).toMatchObject({ private: true, access: "github_app", fullName: "Team/portal" });
  expect(JSON.stringify(result)).not.toMatch(/token|server-only|encrypted/); expect(mocks.fetch).not.toHaveBeenCalled();
});
it("does not create a project when repository access has been revoked", async () => {
  mocks.fetch.mockResolvedValue(new Response("{}", { status: 404 }));
  await expect(importGithubProject({ repositoryUrl: "https://github.com/Team/portal" })).rejects.toThrow("Connect GitHub");
  expect(mocks.upsert).not.toHaveBeenCalled();
});
it("preserves an existing project when the generated identifier is already in use", async () => {
  mocks.upsert.mockResolvedValue({ id: 9, repositoryUrl: "https://github.com/another/existing" });
  await expect(importGithubProject({ repositoryUrl: "https://github.com/Team/portal", name: "Customer Portal" })).rejects.toThrow("different project");
  expect(mocks.upsert.mock.calls[0][0].update).toEqual({});
});
it("blocks suspended and archived repositories", async () => {
  mocks.list.mockResolvedValue([{ id: "r1", fullName: "Team/portal" }]); mocks.repo.mockResolvedValue({ installation: { suspendedAt: new Date() } });
  await expect(inspectGithubProject("https://github.com/Team/portal")).rejects.toThrow("suspended"); expect(mocks.token).not.toHaveBeenCalled();
  mocks.list.mockResolvedValue([]); mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ ...metadata, archived: true })));
  await expect(importGithubProject({ repositoryUrl: "https://github.com/Team/portal" })).rejects.toThrow("archived"); expect(mocks.upsert).not.toHaveBeenCalled();
});
