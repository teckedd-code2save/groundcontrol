import { createHash } from "node:crypto";
import { prisma } from "./prisma";
import { decryptMaybe } from "./crypto";
import { HttpError } from "./errors";
import { createGithubInstallationToken, githubInstallationFetch } from "./github-app";

type RepositoryMetadata = { full_name: string; name: string; default_branch: string; description?: string | null; private: boolean; archived?: boolean };
export type GithubProjectSource = { name: string; fullName: string; url: string; defaultBranch: string; description: string; private: boolean; access: "github_app" | "public" };
export function githubProjectIdentity(input: unknown) {
  try {
    const url = new URL(String(input || "").trim());
    if (url.protocol !== "https:" || url.hostname !== "github.com" || url.port || url.username || url.password || url.search || url.hash) throw new Error();
    const parts = url.pathname.replace(/\/$/, "").split("/").slice(1);
    if (parts.length !== 2) throw new Error();
    const [owner, rawName] = parts;
    const name = rawName.replace(/\.git$/i, "");
    if (!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}$/.test(owner) || !/^[a-zA-Z0-9_.-]{1,100}$/.test(name) || [".", ".."].includes(name)) throw new Error();
    return `${owner}/${name}`;
  } catch { throw new HttpError("Choose a GitHub repository or use its https://github.com/owner/repository link.", 400); }
}

/** Verify metadata through the existing connection; credentials never leave the server. */
export async function inspectGithubProject(input: unknown): Promise<GithubProjectSource> {
  const identity = githubProjectIdentity(input);
  const known = await prisma.githubRepository.findMany({ select: { id: true, fullName: true } });
  const match = known.find((repo) => repo.fullName.toLowerCase() === identity.toLowerCase());
  const saved = match ? await prisma.githubRepository.findUnique({ where: { id: match.id }, include: { installation: { include: { connection: true } } } }) : null;
  let metadata: RepositoryMetadata;
  const endpoint = `/repos/${identity.split("/").map(encodeURIComponent).join("/")}`;
  if (saved) {
    if (saved.installation.suspendedAt) throw new HttpError("GitHub access for this repository is suspended. Review the connection before importing it.", 403);
    const privateKey = decryptMaybe(saved.installation.connection.privateKeyEncrypted);
    if (!privateKey) throw new HttpError("The GitHub connection needs attention. Reconnect GitHub and try again.", 403);
    const credential = await createGithubInstallationToken({ appId: saved.installation.connection.appId, privateKey, installationId: saved.installation.id });
    metadata = await githubInstallationFetch<RepositoryMetadata>(credential.token, endpoint, { signal: AbortSignal.timeout(8000), cache: "no-store" });
  } else {
    const response = await fetch(`https://api.github.com${endpoint}`, { headers: { Accept: "application/vnd.github+json", "User-Agent": "GroundControl" }, signal: AbortSignal.timeout(8000), cache: "no-store" });
    if (!response.ok) throw new HttpError(response.status === 404 ? "Repository not found or private. Connect GitHub and grant access to this repository, then try again." : response.status === 403 || response.status === 429 ? "GitHub’s request limit was reached. Connect GitHub or try again later." : "GitHub could not be reached. Try again.", response.status === 404 ? 404 : 502);
    metadata = await response.json();
    if (metadata.private) throw new HttpError("Connect GitHub to import this private repository.", 403);
  }
  if (metadata.archived) throw new HttpError("This repository is archived. Choose an active repository.", 400);
  const canonical = githubProjectIdentity(`https://github.com/${metadata.full_name}`);
  return { name: metadata.name, fullName: canonical, url: `https://github.com/${canonical}`, defaultBranch: metadata.default_branch || "main", description: metadata.description || "", private: Boolean(metadata.private), access: saved ? "github_app" : "public" };
}

export async function importGithubProject(body: { repositoryUrl?: unknown; name?: unknown; description?: unknown }) {
  const repository = await inspectGithubProject(body.repositoryUrl);
  const name = String(body.name || repository.name).trim().slice(0, 120);
  if (!name) throw new HttpError("Give your project a name.", 400);
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "project";
  const slug = `${base}-${createHash("sha256").update(repository.fullName.toLowerCase()).digest("hex").slice(0, 8)}`;
  const project = await prisma.projectGroup.upsert({ where: { slug }, update: {}, create: { slug, name, repositoryUrl: repository.url, repositoryDefaultBranch: repository.defaultBranch, description: typeof body.description === "string" ? body.description.trim().slice(0, 2000) : repository.description } });
  if (project.repositoryUrl?.toLowerCase().replace(/\.git$/i, "") !== repository.url.toLowerCase()) throw new HttpError("A different project already uses this name. Choose another project name.", 409);
  return { project, repository };
}
