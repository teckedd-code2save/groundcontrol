import { HttpError } from "./errors";
export function repositoryUrl(input: unknown): string | null {
  if (!input) return null;
  try {
    const url = new URL(String(input).trim());
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw new Error();
    return url.href;
  } catch { throw new HttpError("Use an http or https repository link without embedded credentials.", 400); }
}
