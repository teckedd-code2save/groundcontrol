"use client";
import { useEffect, useState } from "react";
type Key = { service: string; key: string; required: boolean; saved?: boolean; configured?: boolean; version?: number };
type Metadata = { revision: number; keys: Key[] };
type Entry = { service: string; key: string; value: string; required: boolean };
const blank = (): Entry => ({ service: "app", key: "", value: "", required: true });
async function json(response: Response) { const data = await response.json(); if (!response.ok) throw new Error(data.error || "Configuration could not be saved"); return data; }
export function AgentProposalConfiguration({ proposalId, contentHash, disabled, onSaved }: { proposalId: string; contentHash: string; disabled: boolean; onSaved: () => void }) {
  const [metadata, setMetadata] = useState<Metadata>({ revision: 0, keys: [] });
  const [entries, setEntries] = useState<Entry[]>([blank()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const url = `/api/agent-proposals/${encodeURIComponent(proposalId)}/configuration`;
  useEffect(() => { let active = true; fetch(url, { cache: "no-store" }).then(json).then(data => { if (active) setMetadata(data); }).catch(e => { if (active) setError(e.message); }); return () => { active = false; }; }, [url]);
  function update(index: number, patch: Partial<Entry>) { setSaved(false); setEntries(rows => rows.map((row, i) => i === index ? { ...row, ...patch } : row)); }
  async function save() {
    setBusy(true); setError(""); setSaved(false);
    try {
      const values = entries.filter(entry => entry.key || entry.value);
      const result = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contentHash, expectedRevision: metadata.revision, values }) }).then(json);
      setMetadata(result); setEntries([blank()]); setSaved(true); onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  return <section className="space-y-4 rounded border border-border bg-card p-5">
    <h2 className="font-semibold">Configuration for this isolated deployment</h2>
    <p className="text-sm text-muted">Enter only values you authorize for this server and application. Nothing is copied from production. Values are encrypted in GroundControl and sent privately to the selected host only during an approved launch. They are not returned to Hermes or displayed after saving.</p>
    {error && <p role="alert" className="text-sm text-error">{error}</p>}
    {saved && <p role="status" className="text-sm text-success">Saved. Review the deployment again to bind this configuration.</p>}
    {metadata.keys.length > 0 && <ul className="space-y-1 text-xs text-muted">{metadata.keys.map(item => <li key={`${item.service}.${item.key}`}><code>{item.service}.{item.key}</code> · saved{item.version ? ` version ${item.version}` : ""}{item.required ? " · required" : ""}</li>)}</ul>}
    <fieldset disabled={disabled || busy} className="space-y-3">
      {entries.map((entry, i) => <div key={i} className="grid gap-2 sm:grid-cols-[1fr_2fr_2fr_auto]">
        <label className="text-xs">Compose service<input aria-label={`Service ${i + 1}`} className="mt-1 w-full rounded border border-border bg-background p-2" value={entry.service} onChange={e => update(i, { service: e.target.value })} /></label>
        <label className="text-xs">Variable name<input aria-label={`Variable ${i + 1}`} autoComplete="off" className="mt-1 w-full rounded border border-border bg-background p-2 font-mono" value={entry.key} onChange={e => update(i, { key: e.target.value })} /></label>
        <label className="text-xs">New value<input aria-label={`Value ${i + 1}`} type="password" autoComplete="new-password" className="mt-1 w-full rounded border border-border bg-background p-2" value={entry.value} onChange={e => update(i, { value: e.target.value })} /></label>
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={entry.required} onChange={e => update(i, { required: e.target.checked })} />Required</label>
      </div>)}
      <div className="flex flex-wrap gap-2"><button type="button" className="gc-button gc-button-quiet" onClick={() => setEntries(rows => [...rows, blank()])}>Add variable</button><button type="button" className="gc-button gc-button-primary" disabled={!entries.some(row => row.key)} onClick={() => void save()}>{busy ? "Saving…" : "Save entered values"}</button></div>
    </fieldset>
    <p className="text-xs text-muted">Saving updates only the entered keys; other saved candidate values stay unchanged. Runtime configuration only. Build arguments and credentials baked into images are not enabled by this form.</p>
  </section>;
}
