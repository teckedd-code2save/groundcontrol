/**
 * Google Cloud Platform helpers for GroundControl.
 *
 * - Service-account JWT -> access token exchange.
 * - Cloud Run (v2) service lifecycle.
 */

import { createSign } from "crypto";

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

export interface ServiceAccountJson {
  type: string;
  project_id: string;
  private_key: string;
  client_email: string;
  token_uri?: string;
}

export interface CloudRunService {
  apiVersion?: string;
  kind?: string;
  metadata?: {
    name?: string;
    namespace?: string;
    annotations?: Record<string, string>;
  };
  spec?: {
    template?: CloudRunRevisionTemplate;
    traffic?: CloudRunTrafficTarget[];
  };
  status?: {
    uri?: string;
    url?: string;
    conditions?: unknown[];
  };
}

export interface CloudRunRevisionTemplate {
  containers?: CloudRunContainer[];
  scaling?: {
    minInstanceCount?: number;
    maxInstanceCount?: number;
  };
  maxInstanceRequestConcurrency?: number;
  serviceAccount?: string;
  timeout?: string;
}

export interface CloudRunContainer {
  image: string;
  resources?: {
    limits?: Record<string, string>;
    cpuIdle?: boolean;
  };
  env?: Array<{ name: string; value: string }>;
  ports?: Array<{ containerPort: number }>;
}

export interface CloudRunTrafficTarget {
  type?: "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST" | "TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION";
  revision?: string;
  percent?: number;
  tag?: string;
}

export interface CloudRunRevision {
  name: string;
  createTime: string;
}

export interface CloudRunDeployOptions {
  accessToken: string;
  projectId: string;
  region: string;
  serviceName: string;
  image: string;
  cpu?: number | string;
  memory?: string;
  concurrency?: number;
  maxInstances?: number;
  minInstances?: number;
  env?: Record<string, string>;
}

export interface CloudRunServiceRef {
  accessToken: string;
  projectId: string;
  region: string;
  serviceName: string;
}

function base64Url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function parseServiceAccountJson(
  value: string | Record<string, unknown>
): ServiceAccountJson {
  const obj =
    typeof value === "string"
      ? (JSON.parse(value) as Record<string, unknown>)
      : value;

  if (
    !obj.client_email ||
    !obj.private_key ||
    typeof obj.client_email !== "string" ||
    typeof obj.private_key !== "string"
  ) {
    throw new Error(
      "Service account JSON must contain client_email and private_key"
    );
  }

  return obj as unknown as ServiceAccountJson;
}

/**
 * Exchange a GCP service account JSON key for an OAuth2 access token.
 *
 * Signs a JWT assertion with the service account private key and posts it to
 * Google's token endpoint.
 */
export async function getGcpAccessToken(
  serviceAccountJson: string | Record<string, unknown>
): Promise<string> {
  const sa = parseServiceAccountJson(serviceAccountJson);
  const now = Math.floor(Date.now() / 1000);

  const header = JSON.stringify({ alg: "RS256", typ: "JWT" });
  const payload = JSON.stringify({
    iss: sa.client_email,
    sub: sa.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: TOKEN_ENDPOINT,
    iat: now,
    exp: now + 3600,
  });

  const signingInput = `${base64Url(header)}.${base64Url(payload)}`;

  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  const signatureBase64 = signer.sign(sa.private_key, "base64");
  const jwt = `${signingInput}.${base64Url(Buffer.from(signatureBase64, "base64"))}`;

  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`GCP token exchange failed: ${response.status} ${text}`);
  }

  const data = JSON.parse(text) as {
    access_token: string;
    expires_in?: number;
    token_type?: string;
  };
  if (!data.access_token) {
    throw new Error("GCP token response did not include access_token");
  }
  return data.access_token;
}

function serviceUrl(
  region: string,
  projectId: string,
  serviceName?: string,
  extraPath?: string
): string {
  let url = `https://${region}-run.googleapis.com/v2/projects/${projectId}/locations/${region}/services`;
  if (serviceName) url += `/${serviceName}`;
  if (extraPath) url += `/${extraPath}`;
  return url;
}

async function apiFetch<T>(
  url: string,
  accessToken: string,
  options?: RequestInit
): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      ...(options?.headers || {}),
    },
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Cloud Run API error: ${response.status} ${text}`);
  }

  return text ? (JSON.parse(text) as T) : (undefined as unknown as T);
}

/**
 * Create or update a Cloud Run service.
 *
 * Uses the v2 API. If the service already exists it is PATCHed, otherwise a new
 * service is created with POST.
 */
export async function cloudRunDeploy(
  options: CloudRunDeployOptions
): Promise<{ url: string }> {
  const {
    accessToken,
    projectId,
    region,
    serviceName,
    image,
    cpu,
    memory,
    concurrency,
    maxInstances,
    minInstances,
    env,
  } = options;

  const container: CloudRunContainer = { image };

  if (cpu != null || memory != null) {
    container.resources = { limits: {} };
    if (cpu != null) container.resources.limits!.cpu = String(cpu);
    if (memory != null) container.resources.limits!.memory = memory;
  }

  if (env && Object.keys(env).length > 0) {
    container.env = Object.entries(env).map(([name, value]) => ({
      name,
      value,
    }));
  }

  const template: CloudRunRevisionTemplate = { containers: [container] };

  if (concurrency != null) {
    template.maxInstanceRequestConcurrency = concurrency;
  }
  if (minInstances != null || maxInstances != null) {
    template.scaling = {};
    if (minInstances != null) template.scaling.minInstanceCount = minInstances;
    if (maxInstances != null) template.scaling.maxInstanceCount = maxInstances;
  }

  const service: CloudRunService = {
    apiVersion: "serving.knative.dev/v1",
    kind: "Service",
    metadata: { name: serviceName },
    spec: {
      template,
      traffic: [
        { type: "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST", percent: 100 },
      ],
    },
  };

  let existing: CloudRunService | null = null;
  try {
    existing = await cloudRunGetService({
      accessToken,
      projectId,
      region,
      serviceName,
    });
  } catch {
    existing = null;
  }

  let result: CloudRunService;
  if (existing?.metadata?.name) {
    const updateMask = ["template"].join(",");
    result = await apiFetch<CloudRunService>(
      `${serviceUrl(region, projectId, serviceName)}?updateMask=${updateMask}`,
      accessToken,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(service),
      }
    );
  } else {
    result = await apiFetch<CloudRunService>(
      `${serviceUrl(region, projectId)}?serviceId=${serviceName}`,
      accessToken,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(service),
      }
    );
  }

  const url = result.status?.uri || result.status?.url;
  if (!url) {
    throw new Error("Cloud Run deploy succeeded but returned no service URL");
  }
  return { url };
}

export async function cloudRunGetService(
  ref: CloudRunServiceRef
): Promise<CloudRunService> {
  return apiFetch<CloudRunService>(
    serviceUrl(ref.region, ref.projectId, ref.serviceName),
    ref.accessToken,
    { method: "GET" }
  );
}

export async function listCloudRunServices(
  ref: Omit<CloudRunServiceRef, "serviceName">
): Promise<CloudRunService[]> {
  const url = `${serviceUrl(ref.region, ref.projectId)}?pageSize=100`;
  const data = await apiFetch<{ services?: CloudRunService[] }>(url, ref.accessToken, {
    method: "GET",
  });
  return data.services || [];
}

export async function listCloudRunRevisions(
  ref: CloudRunServiceRef
): Promise<CloudRunRevision[]> {
  const url = `${serviceUrl(ref.region, ref.projectId, ref.serviceName, "revisions")}?pageSize=100`;
  const data = await apiFetch<{ revisions?: CloudRunRevision[] }>(url, ref.accessToken, {
    method: "GET",
  });
  return (data.revisions || []).sort(
    (a, b) =>
      new Date(b.createTime).getTime() - new Date(a.createTime).getTime()
  );
}

/**
 * Roll a service back to the previous revision by shifting 100% traffic to it.
 */
export async function cloudRunRollbackToPrevious(
  ref: CloudRunServiceRef
): Promise<{ revision: string; url: string }> {
  const revisions = await listCloudRunRevisions(ref);
  if (revisions.length < 2) {
    throw new Error("No previous Cloud Run revision available for rollback");
  }

  const previous = revisions[1];
  const updateMask = "traffic";
  const service: CloudRunService = {
    spec: {
      traffic: [
        {
          type: "TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION",
          revision: previous.name,
          percent: 100,
        },
      ],
    },
  };

  const result = await apiFetch<CloudRunService>(
    `${serviceUrl(ref.region, ref.projectId, ref.serviceName)}?updateMask=${updateMask}`,
    ref.accessToken,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(service),
    }
  );

  const url = result.status?.uri || result.status?.url;
  if (!url) {
    throw new Error("Cloud Run rollback succeeded but returned no service URL");
  }
  return { revision: previous.name, url };
}

/**
 * Delete a Cloud Run service.
 */
export async function cloudRunDeleteService(
  ref: CloudRunServiceRef
): Promise<void> {
  await apiFetch<CloudRunService>(
    serviceUrl(ref.region, ref.projectId, ref.serviceName),
    ref.accessToken,
    { method: "DELETE" }
  );
}
