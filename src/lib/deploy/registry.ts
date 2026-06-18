/**
 * Registry push helper for managed/serverless deployment targets.
 *
 * Handles tagging, authenticating, and pushing a locally-built Docker image
 * to GCR, GAR, GHCR, Docker Hub, or ECR. All commands run on the active VPS
 * (or the supplied one) via execOnVps and are shell-quoted with shQuote.
 */

import { execOnVps, shQuote, type VpsConnection } from "@/lib/vps";

export type RegistryProvider = "gcr" | "gar" | "ghcr" | "dockerhub" | "ecr";

export interface RegistryCredentials {
  /** GCP OAuth2 access token used for GCR/GAR docker login. */
  accessToken?: string;
  /** Generic username for docker login (Docker Hub, GHCR). */
  username?: string;
  /** Generic password or token for docker login. */
  password?: string;
  /** GitHub Container Registry personal access token (alternative to password). */
  pat?: string;
  /** AWS access key ID for ECR. */
  accessKeyId?: string;
  /** AWS secret access key for ECR. */
  secretAccessKey?: string;
  /** AWS region for ECR (overrides region parsed from the repository URI). */
  region?: string;
}

export interface PushImageOptions {
  /** Existing local image tag (must already be built). */
  localTag: string;
  registry: RegistryProvider;
  /**
   * Full registry repository path without tag.
   *  - gcr:    gcr.io/PROJECT/IMAGE
   *  - gar:    REGION-docker.pkg.dev/PROJECT/REPO/IMAGE
   *  - ghcr:   ghcr.io/OWNER/IMAGE
   *  - dockerhub: USERNAME/IMAGE
   *  - ecr:    ACCOUNT.dkr.ecr.REGION.amazonaws.com/IMAGE
   */
  repository: string;
  /** Image tag suffix, e.g. "latest" or a git sha. */
  tag: string;
  credentials?: RegistryCredentials;
  vps?: VpsConnection | null;
}

export interface TagImageOptions {
  localTag: string;
  fullImageUri: string;
  vps?: VpsConnection | null;
}

/**
 * Construct a registry image URI without a tag suffix.
 *
 * The returned value is intended to be combined with a tag and passed as the
 * `repository` argument to pushImage, or used directly with tagImage.
 */
export function getRegistryUri(
  provider: RegistryProvider,
  projectId: string,
  region: string,
  serviceName: string
): string {
  switch (provider) {
    case "gcr":
      return `gcr.io/${projectId}/${serviceName}`;
    case "gar":
      return `${region}-docker.pkg.dev/${projectId}/${serviceName}/${serviceName}`;
    case "ghcr":
      return `ghcr.io/${projectId}/${serviceName}`;
    case "dockerhub":
      return `${projectId}/${serviceName}`;
    case "ecr":
      return `${projectId}.dkr.ecr.${region}.amazonaws.com/${serviceName}`;
    default:
      throw new Error(`Unknown registry provider: ${provider}`);
  }
}

/**
 * Tag an existing local image with a full registry URI.
 */
export async function tagImage(
  localTag: string,
  fullImageUri: string,
  vps?: VpsConnection | null
): Promise<void> {
  const result = await execOnVps(
    `docker tag ${shQuote(localTag)} ${shQuote(fullImageUri)}`,
    vps
  );
  if (result.code !== 0) {
    throw new Error(
      result.stderr || `docker tag failed: ${localTag} -> ${fullImageUri}`
    );
  }
}

/**
 * Push a locally-built Docker image to a remote registry.
 *
 * 1. Verifies the local image exists.
 * 2. Tags it with the full registry URI.
 * 3. Logs in to the registry.
 * 4. Pushes the image.
 */
export async function pushImage(
  options: PushImageOptions
): Promise<{ fullImageUri: string }> {
  const { localTag, registry, repository, tag, credentials, vps } = options;

  await ensureImageExists(localTag, vps);

  const fullImageUri = `${repository}:${tag}`;
  await tagImage(localTag, fullImageUri, vps);
  await loginToRegistry(registry, repository, credentials, vps);

  const result = await execOnVps(
    `docker push ${shQuote(fullImageUri)}`,
    vps
  );
  if (result.code !== 0) {
    throw new Error(result.stderr || `docker push failed: ${fullImageUri}`);
  }

  return { fullImageUri };
}

async function ensureImageExists(
  localTag: string,
  vps?: VpsConnection | null
): Promise<void> {
  const result = await execOnVps(
    `docker images -q ${shQuote(localTag)}`,
    vps
  );
  if (result.code !== 0 || !result.stdout.trim()) {
    throw new Error(
      `Local image ${localTag} not found. Build it before calling pushImage.`
    );
  }
}

function getRegistryHost(provider: RegistryProvider, repository: string): string {
  const firstSlash = repository.indexOf("/");
  if (firstSlash === -1) {
    // Fallback host for bare repository names.
    switch (provider) {
      case "gcr":
        return "gcr.io";
      case "gar":
        throw new Error("GAR repository must include the full registry host");
      case "ghcr":
        return "ghcr.io";
      case "dockerhub":
        return "docker.io";
      case "ecr":
        throw new Error("ECR repository must include the full registry host");
    }
  }
  return repository.slice(0, firstSlash);
}

async function loginToRegistry(
  provider: RegistryProvider,
  repository: string,
  credentials: RegistryCredentials = {},
  vps?: VpsConnection | null
): Promise<void> {
  const host = getRegistryHost(provider, repository);

  switch (provider) {
    case "gcr":
    case "gar": {
      const token = credentials.accessToken;
      if (!token) {
        throw new Error(
          `credentials.accessToken is required for ${provider.toUpperCase()} push`
        );
      }
      // GCP artifact registries accept oauth2accesstoken as the username
      // and the access token as the password.
      await dockerLogin(host, "oauth2accesstoken", token, vps);
      return;
    }

    case "ghcr": {
      const username = credentials.username || credentials.password || "";
      const password = credentials.pat || credentials.password;
      if (!password) {
        throw new Error(
          "credentials.pat or credentials.password is required for GHCR push"
        );
      }
      await dockerLogin(host, username || "_", password, vps);
      return;
    }

    case "dockerhub": {
      const username = credentials.username;
      const password = credentials.password;
      if (!username || !password) {
        throw new Error(
          "credentials.username and credentials.password are required for Docker Hub push"
        );
      }
      await dockerLogin(host, username, password, vps);
      return;
    }

    case "ecr": {
      const region =
        credentials.region || parseEcrRegion(repository) || "us-east-1";
      await ecrLogin(host, region, credentials, vps);
      return;
    }

    default: {
      throw new Error(`Unsupported registry provider: ${provider}`);
    }
  }
}

async function dockerLogin(
  host: string,
  username: string,
  password: string,
  vps?: VpsConnection | null
): Promise<void> {
  const result = await execOnVps(
    `printf '%s' ${shQuote(password)} | docker login --username ${shQuote(
      username
    )} --password-stdin ${shQuote(host)}`,
    vps
  );
  if (result.code !== 0) {
    throw new Error(
      result.stderr || `docker login failed for ${host} as ${username}`
    );
  }
}

async function ecrLogin(
  host: string,
  region: string,
  credentials: RegistryCredentials,
  vps?: VpsConnection | null
): Promise<void> {
  let envPrefix = "";
  if (credentials.accessKeyId && credentials.secretAccessKey) {
    envPrefix = `AWS_ACCESS_KEY_ID=${shQuote(
      credentials.accessKeyId
    )} AWS_SECRET_ACCESS_KEY=${shQuote(credentials.secretAccessKey)} `;
  }

  const result = await execOnVps(
    `${envPrefix}aws ecr get-login-password --region ${shQuote(
      region
    )} | docker login --username AWS --password-stdin ${shQuote(host)}`,
    vps
  );
  if (result.code !== 0) {
    throw new Error(result.stderr || `ECR login failed for ${host}`);
  }
}

function parseEcrRegion(repository: string): string | null {
  // ECR host format: ACCOUNT.dkr.ecr.REGION.amazonaws.com
  const match = repository.match(/\.dkr\.ecr\.([a-z0-9-]+)\.amazonaws\.com/);
  return match?.[1] ?? null;
}
