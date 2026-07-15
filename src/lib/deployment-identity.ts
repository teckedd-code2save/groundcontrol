export interface DeploymentIdentityInput {
  explicitName?: unknown;
  repoUrl?: unknown;
  localPath?: unknown;
  image?: unknown;
  domain?: unknown;
  templateName?: unknown;
}

export function inferDeploymentName(input: DeploymentIdentityInput): string {
  const explicit = clean(input.explicitName);
  if (explicit) return explicit;

  const repository = sourceBasename(input.repoUrl);
  if (repository) return repository;

  const local = sourceBasename(input.localPath);
  if (local) return local;

  const image = imageBasename(input.image);
  if (image) return image;

  const domain = clean(input.domain).replace(/^https?:\/\//, "").split("/")[0];
  if (domain) return domain.split(".")[0] || domain;

  return clean(input.templateName) || "deployment";
}

export function slugifyDeploymentName(value: unknown): string {
  return clean(value)
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "deployment";
}

function sourceBasename(value: unknown): string {
  const source = clean(value)
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "")
    .replace(/\.git$/i, "");
  if (!source) return "";
  return source.split(/[/:]/).filter(Boolean).pop() || "";
}

function imageBasename(value: unknown): string {
  const image = clean(value).replace(/@sha256:.*$/i, "");
  if (!image) return "";
  const last = image.split("/").pop() || "";
  return last.replace(/:[^:]+$/, "");
}

function clean(value: unknown): string {
  return String(value || "").trim();
}
