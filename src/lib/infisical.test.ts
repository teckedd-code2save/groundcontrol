import { afterEach, describe, expect, it, vi } from "vitest";
import {
  listInfisicalSecrets,
  loginInfisicalUniversalAuth,
  normalizeInfisicalHost,
  normalizeInfisicalProjects,
} from "./infisical";

describe("infisical provider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("normalizes hosts", () => {
    expect(normalizeInfisicalHost("https://secrets.example.com/api")).toBe("https://secrets.example.com");
    expect(normalizeInfisicalHost("https://secrets.example.com/")).toBe("https://secrets.example.com");
  });

  it("normalizes accessible projects and their named environments", () => {
    expect(normalizeInfisicalProjects({ projects: [{
      id: "project-1",
      name: "RentAWeekend",
      slug: "rentaweekend",
      environments: [{ name: "Production", slug: "prod" }, { name: "Staging", slug: "staging" }],
    }] })).toEqual([{
      id: "project-1",
      name: "RentAWeekend",
      slug: "rentaweekend",
      environments: [{ name: "Production", slug: "prod" }, { name: "Staging", slug: "staging" }],
    }]);
  });

  it("logs in with universal auth", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ accessToken: "token" }),
    } as Response);

    await expect(loginInfisicalUniversalAuth(
      { host: "https://secrets.example.com" },
      { clientId: "id", clientSecret: "secret" }
    )).resolves.toBe("token");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://secrets.example.com/api/v1/auth/universal-auth/login",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("lists secrets through v4 API", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ accessToken: "token" }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({
          secrets: [
            { secretKey: "DATABASE_URL", secretValue: "postgres://db" },
            { secretKey: "API_KEY", secretValue: "secret" },
          ],
        }),
      } as Response);

    await expect(listInfisicalSecrets(
      { host: "https://secrets.example.com", projectId: "project", environment: "prod", secretPath: "/" },
      { clientId: "id", clientSecret: "secret" }
    )).resolves.toEqual({ DATABASE_URL: "postgres://db", API_KEY: "secret" });
  });
});
