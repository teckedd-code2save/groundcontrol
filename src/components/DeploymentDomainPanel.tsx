"use client";

export function DeploymentDomainPanel({ domain, value, onChange, busy, onApply }: {
  domain?: string | null; value: string; onChange: (value: string) => void; busy: boolean; onApply: () => void;
}) {
  return <section className="border border-border bg-card p-5">
    <details open={Boolean(domain)}>
      <summary className="cursor-pointer text-base font-medium">{domain ? `Public domain: ${domain}` : "Public domain (optional)"}</summary>
      <p className="mt-2 text-xs leading-relaxed text-muted">Only configure this for an app that needs a public web address. Private services and workers can stay without a domain. Applying a Cloudflare domain changes DNS and the reverse proxy.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <input aria-label="Public domain" value={value} onChange={(event) => onChange(event.target.value)} placeholder="app.example.com" className="gc-field min-w-0 flex-1 font-mono" />
        <button type="button" onClick={onApply} disabled={busy || !value.trim()} className="gc-button gc-button-primary">{busy ? "Applying…" : "Apply domain"}</button>
      </div>
    </details>
  </section>;
}
