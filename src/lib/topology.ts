export function getSiteSlugs(domain: string): string[] {
  const slugs = new Set<string>();
  const clean = domain.toLowerCase().trim();

  // Remove common TLDs
  const withoutTld = clean.replace(
    /\.(com|net|org|io|dev|app|co|uk|us|de|fr|nl|be|eu|tech|cloud|space|online|store|site|blog|info|biz|ai|gh|za|ng)$/i,
    ""
  );

  // Remove www
  const withoutWww = withoutTld.replace(/^www\./, "");

  slugs.add(withoutWww);
  slugs.add(withoutWww.replace(/-/g, ""));
  slugs.add(withoutWww.replace(/[^a-z0-9]/g, ""));

  // Add each dot-separated part (e.g., "api.example.com" -> "api", "example")
  withoutWww.split(".").forEach((part) => {
    if (part.length > 2) slugs.add(part);
  });

  return Array.from(slugs).filter((s) => s.length > 2);
}

export function matchContainersToSite<T extends { name: string; image: string }>(
  domain: string,
  proxy: string | null,
  containers: T[]
): T[] {
  const slugs = getSiteSlugs(domain);
  const proxyBase = proxy?.replace(/:.*/, "").toLowerCase() || "";

  return containers.filter((c) => {
    const cName = c.name.toLowerCase();
    if (proxyBase && cName.includes(proxyBase)) return true;
    for (const slug of slugs) {
      if (cName.includes(slug)) return true;
    }
    return false;
  });
}
