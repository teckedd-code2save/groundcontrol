import { parse, stringify } from "yaml";

export const COMPOSE_FILE_CANDIDATES = [
  "compose.yaml",
  "compose.yml",
  "docker-compose.yaml",
  "docker-compose.yml",
] as const;

export const MANAGED_IMAGE_OVERRIDE_FILE = ".groundcontrol/compose.image.override.yml";
export const MANAGED_ENV_OVERRIDE_FILE = ".groundcontrol/compose.env.override.yml";
export const MANAGED_ENV_FILES_MANIFEST = ".groundcontrol/compose.env.files";

type ComposeDocument = {
  services?: Record<string, Record<string, unknown>>;
  [key: string]: unknown;
};

function asComposeDocument(content: string): ComposeDocument {
  if (!content.trim()) return { services: {} };
  const parsed = parse(content) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Compose YAML must be an object");
  }
  return parsed as ComposeDocument;
}

export function assertComposeServiceName(value: unknown): string {
  const service = String(value || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(service)) {
    throw new Error("Select a valid Compose service");
  }
  return service;
}

export function assertDockerImageReference(value: unknown): string {
  const image = String(value || "").trim();
  if (!image || image.length > 512 || /[\s\u0000-\u001f]/.test(image) || image.startsWith("-")) {
    throw new Error("Enter a valid container image reference");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._/:@+-]*$/.test(image)) {
    throw new Error("The image reference contains unsupported characters");
  }
  if (image.includes("@") && !/@sha256:[a-fA-F0-9]{64}$/.test(image)) {
    throw new Error("Pinned images must end with a complete sha256 digest");
  }
  return image;
}

export function composeServiceImages(content: string): Record<string, string> {
  const document = asComposeDocument(content);
  const services = document.services;
  if (!services || typeof services !== "object" || Array.isArray(services)) {
    throw new Error("Compose file has no services mapping");
  }
  return Object.fromEntries(Object.entries(services).flatMap(([service, config]) => {
    const image = config && typeof config === "object" && typeof config.image === "string"
      ? config.image.trim()
      : "";
    return image ? [[service, image]] : [];
  }));
}

export function composeServiceNames(content: string): string[] {
  const document = asComposeDocument(content);
  if (!document.services || typeof document.services !== "object" || Array.isArray(document.services)) {
    throw new Error("Compose file has no services mapping");
  }
  return Object.keys(document.services);
}

export function readManagedImageOverrides(content: string): Record<string, string> {
  if (!content.trim()) return {};
  return composeServiceImages(content);
}

export function updateManagedImageOverride(
  content: string,
  serviceValue: unknown,
  imageValue: unknown
): { content: string; images: Record<string, string> } {
  const service = assertComposeServiceName(serviceValue);
  const image = imageValue == null || String(imageValue).trim() === ""
    ? ""
    : assertDockerImageReference(imageValue);
  const document = asComposeDocument(content);
  const services = document.services && typeof document.services === "object" && !Array.isArray(document.services)
    ? document.services
    : {};

  if (image) {
    services[service] = { ...(services[service] || {}), image };
  } else {
    delete services[service];
  }

  const images = Object.fromEntries(Object.entries(services).flatMap(([name, config]) => {
    const configured = config && typeof config === "object" && typeof config.image === "string"
      ? config.image.trim()
      : "";
    return configured ? [[name, configured]] : [];
  }));
  if (Object.keys(images).length === 0) return { content: "", images: {} };

  return {
    content: stringify({
      services: Object.fromEntries(Object.entries(images).map(([name, configured]) => [name, { image: configured }])),
    }, { lineWidth: 0 }),
    images,
  };
}

function normalizeImageReference(value: string): string {
  return value.trim().replace(/^docker\.io\/library\//, "");
}

export function imageReferenceMatches(expected: string, actual: string): boolean {
  return normalizeImageReference(expected) === normalizeImageReference(actual);
}
