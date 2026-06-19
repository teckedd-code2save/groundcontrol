import { NextResponse } from "next/server";

export type SanitizedError = {
  message: string;
  code?: string;
  details?: string;
};

const GENERIC_MESSAGE = "An unexpected error occurred. Please try again later.";

// Patterns that may expose secrets or credentials if reflected to clients.
const SENSITIVE_PATTERNS: RegExp[] = [
  /-----BEGIN[\s\S]*?-----END [^-]+-----/g,
  /"private_key"\s*:\s*"[^"]*"/gi,
  /'private_key'\s*:\s*'[^']*'/gi,
  /private_key\s*=\s*[^\s]+/gi,
  /"token"\s*:\s*"[^"]*"/gi,
  /'token'\s*:\s*'[^']*'/gi,
  /token\s*=\s*[^\s]+/gi,
  /"password"\s*:\s*"[^"]*"/gi,
  /'password'\s*:\s*'[^']*'/gi,
  /password\s*=\s*[^\s]+/gi,
  /"secret"\s*:\s*"[^"]*"/gi,
  /'secret'\s*:\s*'[^']*'/gi,
  /secret\s*=\s*[^\s]+/gi,
  /"credential"\s*:\s*"[^"]*"/gi,
  /'credential'\s*:\s*'[^']*'/gi,
  /credential\s*=\s*[^\s]+/gi,
];

export function redactSensitive(str: string): string {
  return SENSITIVE_PATTERNS.reduce((acc, pattern) => acc.replace(pattern, "[REDACTED]"), str);
}

export function sanitizeError(
  error: unknown,
  opts: { exposeDetails?: boolean } = {}
): SanitizedError {
  const isProduction = process.env.NODE_ENV === "production";
  const exposeDetails = opts.exposeDetails ?? !isProduction;

  if (error instanceof HttpError) {
    return {
      message: redactSensitive(error.message),
      code: error.code,
      ...(exposeDetails && error.details ? { details: redactSensitive(error.details) } : {}),
    };
  }

  if (error instanceof Error) {
    // Always log the full error on the server for observability.
    console.error("[sanitizeError]", error);

    if (exposeDetails) {
      const details = error.stack ? redactSensitive(error.stack) : undefined;
      return {
        message: redactSensitive(error.message),
        ...(details ? { details } : {}),
      };
    }

    return { message: GENERIC_MESSAGE };
  }

  console.error("[sanitizeError] Non-Error thrown:", error);

  if (exposeDetails) {
    const stringified = typeof error === "string" ? error : JSON.stringify(error);
    return { message: redactSensitive(stringified) };
  }

  return { message: GENERIC_MESSAGE };
}

export class HttpError extends Error {
  status: number;
  code?: string;
  details?: string;

  constructor(
    message: string,
    status: number,
    opts: { code?: string; details?: string; cause?: unknown } = {}
  ) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = opts.code;
    this.details = opts.details;
  }
}

export function isUnauthorizedError(error: unknown): boolean {
  return error instanceof Error && error.message === "Unauthorized";
}

export function handleApiError(error: unknown): NextResponse {
  if (isUnauthorizedError(error)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const status = error instanceof HttpError ? error.status : 500;
  const { message, code, details } = sanitizeError(error);
  return NextResponse.json(
    { error: message, ...(code ? { code } : {}), ...(details ? { details } : {}) },
    { status }
  );
}

/**
 * Sanitizes a raw stderr string for client exposure. Returns undefined if the
 * caller should fall back to a generic message instead of exposing the stderr.
 */
export function sanitizeStderr(stderr: string, safe: boolean = false): string | undefined {
  if (safe) {
    return redactSensitive(stderr) || undefined;
  }
  // By default, do not leak raw host command stderr to clients.
  return undefined;
}
