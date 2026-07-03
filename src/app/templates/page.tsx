"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { TemplateDefinition } from "@/lib/template-engine";

interface TemplateWithId extends TemplateDefinition {
  _filename: string;
}

interface CloudflareTunnelOption {
  id: string;
  name: string;
  connectorStatus?: string;
  status?: string;
  hasToken?: boolean;
  domains?: string[];
}

interface TemplateDeployResult {
  deployPath?: string;
  composeProject?: string;
  dns?: unknown;
  health?: { domain: string; result: string }[];
  upOutput?: string | { stdout?: string; stderr?: string };
  tunnelId?: string | null;
  tunnelConfig?: unknown;
}

type Step = "browse" | "source" | "configure" | "preview" | "deploy";

function templatePurpose(template: TemplateWithId): string {
  const category = template.category.toLowerCase();
  if (category === "source") return "Dockerfile apps built from Git, with Caddy and DNS wired after deploy.";
  if (category === "private") return "Admin and internal apps that should enter through Cloudflare Tunnel, not public host ports.";
  if (category === "commerce") return "SaaS or commerce stacks with web, API, workers, data stores, and object storage.";
  if (category === "polyglot") return "Mixed frontend/backend stacks that need a shared database and reverse proxy.";
  if (category === "microservices") return "Scale-ready web/API services behind Traefik with middleware and observability.";
  if (category === "kubernetes") return "k3s workloads exposed through host Caddy without Traefik or ServiceLB port conflicts.";
  return template.description;
}

function templateExposure(template: TemplateWithId): string {
  const usesTunnel = (template.components || []).some((component) => component.kind === "tunnel");
  if (usesTunnel) return "Cloudflare Tunnel CNAME -> cloudflared -> app service";
  if (template.reverse_proxy.type === "traefik") return "Public 80/443 -> Traefik routers -> compose services";
  if (template.reverse_proxy.type === "nginx") return "Public DNS -> Nginx -> loopback service ports";
  return "Public DNS -> Caddy -> loopback service ports";
}

function templateSourceModes(template: TemplateWithId): string[] {
  const hasBuild = template.services.some((service) => service.build);
  const imageInputs = template.inputs.filter((input) => input.name.endsWith("_image") || input.name === "app_image");
  if (hasBuild) return ["Git repo with Dockerfile", "Local VPS path"];
  if (imageInputs.length > 0) return ["GHCR/container image", "Template defaults"];
  return ["Template defaults"];
}

function templateComplexity(template: TemplateWithId): string {
  const serviceCount = template.services.length;
  const dataCount = (template.components || []).filter((component) => component.layer === "data").length;
  if (serviceCount <= 2 && dataCount === 0) return "simple";
  if (serviceCount <= 4) return "standard";
  return "full stack";
}

export default function TemplatesPage() {
  const router = useRouter();
  const [templates, setTemplates] = useState<TemplateWithId[]>([]);
  const [selected, setSelected] = useState<TemplateWithId | null>(null);
  const [step, setStep] = useState<Step>("browse");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string; dns?: string } | null>(null);

  const [sourceType, setSourceType] = useState<"github" | "ghcr" | "local">("github");
  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("main");
  const [ghcrImage, setGhcrImage] = useState("");
  const [localPath, setLocalPath] = useState("");
  const [repoValidating, setRepoValidating] = useState(false);

  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [envVars, setEnvVars] = useState<{ key: string; value: string }[]>([]);
  const [createDns, setCreateDns] = useState(false);
  const [autoDomain, setAutoDomain] = useState(false);
  const [tunnels, setTunnels] = useState<CloudflareTunnelOption[]>([]);
  const [selectedTunnelId, setSelectedTunnelId] = useState("");

  const [previewText, setPreviewText] = useState("");
  const [composeYml, setComposeYml] = useState("");
  const [proxyConfig, setProxyConfig] = useState("");
  const [deployResult, setDeployResult] = useState<TemplateDeployResult | null>(null);

  useEffect(() => {
    fetch("/api/templates").then(r => r.json())
      .then(d => setTemplates(d.templates || [])).catch(() => {});
    fetch("/api/cloudflare/tunnels").then(r => r.json())
      .then(d => setTunnels(d.tunnels || [])).catch(() => setTunnels([]));
  }, []);

  function selectTemplate(t: TemplateWithId) {
    setSelected(t);
    const defaults: Record<string, string> = {};
    (t.inputs || []).forEach(i => { if (i.default) defaults[i.name] = i.default; });
    setInputs(defaults);
    setEnvVars([]);
    setStep("source");
    setResult(null);
    setPreviewText("");
    setDeployResult(null);
    setSelectedTunnelId("");
  }

  async function validateRepo() {
    if (!repoUrl) return;
    setRepoValidating(true);
    try {
      const r = await fetch(`/api/github/validate?url=${encodeURIComponent(repoUrl)}`);
      const d = await r.json();
      if (d.valid) setResult({ ok: true, msg: `✓ Repo found: ${d.name || repoUrl}` });
      else setResult({ ok: false, msg: `Repo not accessible: ${d.error}` });
    } catch { setResult({ ok: false, msg: "Could not validate repo URL" }); }
    finally { setRepoValidating(false); }
  }

  function updateInput(name: string, value: string) {
    setInputs(prev => ({ ...prev, [name]: value }));
  }

  function deploymentInputs(): Record<string, string> {
    const merged = { ...inputs };
    if (!selected || sourceType !== "ghcr" || !ghcrImage) return merged;
    for (const input of selected.inputs || []) {
      if (input.name.endsWith("_image") || input.name === "app_image") {
        merged[input.name] = ghcrImage;
      }
    }
    return merged;
  }

  function previewInputs(): Record<string, string> {
    const merged = deploymentInputs();
    if (usesCloudflareTunnel && selectedTunnelId) {
      merged.tunnel_token = "stored-in-groundcontrol";
    }
    return merged;
  }

  const usesCloudflareTunnel = Boolean(selected && (
    (selected.inputs || []).some((input) => input.name === "tunnel_token") ||
    (selected.components || []).some((component) => component.kind === "tunnel" || component.id === "tunnel" || component.id === "cloudflare")
  ));

  const selectedTunnel = tunnels.find((tunnel) => tunnel.id === selectedTunnelId);
  const dnsRecordType = usesCloudflareTunnel && selectedTunnelId ? "CNAME" : "A";

  function addEnvVar() { setEnvVars([...envVars, { key: "", value: "" }]); }
  function updateEnvVar(i: number, f: "key" | "value", v: string) {
    const u = [...envVars]; u[i][f] = v; setEnvVars(u);
  }
  function removeEnvVar(i: number) { setEnvVars(envVars.filter((_, idx) => idx !== i)); }

  async function handlePreview() {
    if (!selected) return;
    setLoading(true); setResult(null);
    try {
      const res = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: selected._filename,
          preview: true,
          inputs: previewInputs(),
          repoUrl: sourceType === "github" ? repoUrl : undefined,
          branch: sourceType === "github" ? branch : undefined,
          ghcrImage: sourceType === "ghcr" ? ghcrImage : undefined,
          localPath: sourceType === "local" ? localPath : undefined,
        }),
      });
      const data = await res.json();
      if (data.error) {
        setResult({ ok: false, msg: data.error });
      } else {
        setPreviewText(data.preview || "");
        setComposeYml(data.dockerCompose || "");
        setProxyConfig(data.proxyConfig || "");
        setStep("preview");
      }
    } catch { setResult({ ok: false, msg: "Preview failed — check your connection" }); }
    finally { setLoading(false); }
  }

  async function handleDeploy() {
    if (!selected) return;
    setLoading(true); setResult(null);
    try {
      const res = await fetch("/api/templates/deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateName: selected._filename,
          inputs: deploymentInputs(),
          envVars: envVars.filter(e => e.key),
          repoUrl: sourceType === "github" ? repoUrl : undefined,
          branch: sourceType === "github" ? branch : undefined,
          ghcrImage: sourceType === "ghcr" ? ghcrImage : undefined,
          localPath: sourceType === "local" ? localPath : undefined,
          domain: inputs.domain || undefined,
          createDns: createDns && !!inputs.domain,
          tunnelId: usesCloudflareTunnel && selectedTunnelId ? selectedTunnelId : undefined,
          tunnelService: usesCloudflareTunnel ? `http://app:${inputs.app_port || inputs.port || "80"}` : undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setDeployResult(data);
        const parts = [data.message];
        if (data.dns) parts.push("DNS: record created");
        setResult({ ok: true, msg: parts.join(" — ") });
        setStep("deploy");
        setPreviewText(data.composeYml || "");
        setComposeYml(data.composeYml || "");
      } else {
        setResult({ ok: false, msg: data.error || "Deploy failed — check VPS connection" });
      }
    } catch {
      setResult({ ok: false, msg: "Connection error" });
    } finally { setLoading(false); }
  }

  const steps = [
    { id: "browse" as Step, label: "Choose" },
    { id: "source" as Step, label: "Source" },
    { id: "configure" as Step, label: "Config" },
    { id: "preview" as Step, label: "Review" },
    { id: "deploy" as Step, label: "Deploy" },
  ];

  const currentStepIdx = steps.findIndex(s => s.id === step);

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold tracking-tight mb-1">Deployment Templates</h1>
      <p className="text-muted text-sm mb-8">Pick a template, connect your code, configure, deploy.</p>

      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-8 flex-wrap">
        {steps.map((s, i) => (
          <div key={s.id} className="flex items-center gap-2">
            <button onClick={() => i <= currentStepIdx && setStep(s.id)}
              className={`flex items-center gap-2 px-3 py-1.5 text-xs font-mono transition-colors ${
                step === s.id ? "border border-accent text-accent" :
                i < currentStepIdx ? "text-muted hover:text-foreground" : "text-muted/40"
              }`}>
              <span className={`w-5 h-5 flex items-center justify-center text-[10px] ${
                step === s.id ? "bg-accent text-white" : "bg-card border border-border"
              }`}>{i + 1}</span>
              {s.label}
            </button>
            {i < 4 && <span className="text-muted/30 text-xs">→</span>}
          </div>
        ))}
      </div>

      {result && (
        <div className={`mb-6 p-3 rounded text-sm font-mono ${result.ok ? "bg-success/10 border border-success/30 text-success" : "bg-error/10 border border-error/30 text-error"}`}>
          {result.msg}
          {result.dns && <span className="block text-[10px] mt-1 opacity-75">{result.dns}</span>}
        </div>
      )}

      {/* Step 1: Browse */}
      {step === "browse" && (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="border border-border bg-card p-4">
              <div className="mb-1 text-[10px] font-mono uppercase tracking-wider text-muted">Pick by app shape</div>
              <p className="text-[11px] text-muted/75 leading-relaxed">
                Templates describe deployable app shapes: source builds, private tunnel apps, SaaS stacks, polyglot
                services, Traefik microservices, and k3s edge setups.
              </p>
            </div>
            <div className="border border-border bg-card p-4">
              <div className="mb-1 text-[10px] font-mono uppercase tracking-wider text-muted">Know the exposure</div>
              <p className="text-[11px] text-muted/75 leading-relaxed">
                Each card shows whether traffic enters through Caddy, Nginx, Traefik, or Cloudflare Tunnel before it
                reaches the app service.
              </p>
            </div>
            <div className="border border-border bg-card p-4">
              <div className="mb-1 text-[10px] font-mono uppercase tracking-wider text-muted">Then deploy</div>
              <p className="text-[11px] text-muted/75 leading-relaxed">
                Successful deployments are managed under <span className="font-mono">/srv/groundcontrol/deployments</span>{" "}
                and appear on the Deployments page.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {templates.map(t => (
            <button key={t._filename} onClick={() => selectTemplate(t)}
              className="text-left p-5 bg-card border border-border hover:border-accent/30 hover:bg-accent/5 transition-colors">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <h3 className="font-medium text-sm">{t.name}</h3>
                  <p className="mt-1 text-[10px] font-mono uppercase tracking-wider text-accent">{t.category} · {templateComplexity(t)}</p>
                </div>
                <span className="text-lg">{t.category === "private" ? "◎" : t.category === "kubernetes" ? "▦" : "◉"}</span>
              </div>
              <p className="text-xs text-muted leading-relaxed mb-3">{templatePurpose(t)}</p>
              <div className="mb-3 space-y-1.5 text-[10px] text-muted/80">
                <p><span className="font-mono text-muted">Exposure:</span> {templateExposure(t)}</p>
                <p><span className="font-mono text-muted">Source:</span> {templateSourceModes(t).join(" or ")}</p>
                <p><span className="font-mono text-muted">Services:</span> {t.services.map((service) => service.name).join(", ")}</p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {t.requires?.docker && <Tag>Docker</Tag>}
                {t.requires?.caddy && <Tag>Caddy</Tag>}
                {t.requires?.traefik && <Tag>Traefik</Tag>}
                {t.requires?.nginx && <Tag>Nginx</Tag>}
                {t.requires?.k3s && <Tag>k3s</Tag>}
                {(t.components || []).some((component) => component.kind === "tunnel") && <Tag>Tunnel</Tag>}
                <span className="text-[9px] px-1.5 py-0.5 bg-muted/10 text-muted border border-muted/20 font-mono">v{t.version}</span>
              </div>
            </button>
          ))}
          </div>
        </div>
      )}

      {/* Step 2: Source */}
      {step === "source" && selected && (
        <div className="space-y-6">
          <SelectedTemplateCard selected={selected} />
          <div className="bg-card border border-border p-5">
            <h3 className="text-sm font-medium mb-4">Where is your code?</h3>
            <div className="flex gap-2 mb-6">
              {(["github", "ghcr", "local"] as const).map(t => (
                <button key={t} onClick={() => { setSourceType(t); setResult(null); }}
                  className={`px-4 py-2 text-xs font-mono border ${sourceType === t ? "border-accent text-accent" : "border-border hover:border-accent/50"}`}>{t === "github" ? "GitHub" : t === "ghcr" ? "GHCR" : "Local"}</button>
              ))}
            </div>
            {sourceType === "github" && (
              <div className="space-y-3">
                <label className="block text-xs font-mono text-muted">Repo URL</label>
                <div className="flex gap-2">
                  <input type="text" value={repoUrl} onChange={e => setRepoUrl(e.target.value)}
                    placeholder="https://github.com/you/repo" className="flex-1 bg-background border border-border px-3 py-2 text-sm font-mono outline-none focus:border-accent"/>
                  <button onClick={validateRepo} disabled={repoValidating || !repoUrl}
                    className="px-3 py-2 text-xs font-mono border border-border hover:border-accent disabled:opacity-50">
                    {repoValidating ? "..." : "Validate"}
                  </button>
                </div>
                <label className="block text-xs font-mono text-muted mt-3">Branch</label>
                <input type="text" value={branch} onChange={e => setBranch(e.target.value)}
                  className="w-40 bg-background border border-border px-3 py-2 text-sm font-mono outline-none focus:border-accent"/>
              </div>
            )}
            {sourceType === "ghcr" && (
              <div>
                <label className="block text-xs font-mono text-muted mb-1">GHCR Image</label>
                <input type="text" value={ghcrImage} onChange={e => setGhcrImage(e.target.value)}
                  placeholder="ghcr.io/you/app:latest" className="w-full bg-background border border-border px-3 py-2 text-sm font-mono outline-none focus:border-accent"/>
              </div>
            )}
            {sourceType === "local" && (
              <div>
                <label className="block text-xs font-mono text-muted mb-1">Path on VPS</label>
                <input type="text" value={localPath} onChange={e => setLocalPath(e.target.value)}
                  placeholder="/opt/myapp" className="w-full bg-background border border-border px-3 py-2 text-sm font-mono outline-none focus:border-accent"/>
              </div>
            )}
          </div>
          <div className="flex gap-3">
            <BackBtn onClick={() => setStep("browse")} />
            <button onClick={() => setStep("configure")}
              className="px-4 py-2 text-xs font-mono bg-accent/10 border border-accent/30 text-accent hover:bg-accent/20 transition-colors">Next →</button>
          </div>
        </div>
      )}

      {/* Step 3: Configure */}
      {step === "configure" && selected && (
        <div className="space-y-6">
          <div className="bg-card border border-border p-5">
            <h3 className="text-sm font-medium mb-4">Deployment Settings</h3>
            <div className="space-y-4 max-w-lg">
              <div>
                <label className="block text-xs font-mono text-muted mb-1">Domain</label>
                <input type="text" value={inputs.domain || ""}
                  onChange={e => { updateInput("domain", e.target.value); setAutoDomain(false); }}
                  placeholder="app.example.com" disabled={autoDomain}
                  className="w-full bg-background border border-border px-3 py-2 text-sm font-mono outline-none focus:border-accent disabled:opacity-40"/>
                <label className="flex items-center gap-2 mt-2">
                  <input type="checkbox" checked={autoDomain} onChange={e => { setAutoDomain(e.target.checked); if (e.target.checked) updateInput("domain", `${(Math.random()*9999|0)}.groundcontrol.run`); }}
                    className="accent-accent"/>
                  <span className="text-xs text-muted font-mono">Auto-generate subdomain</span>
                </label>
              </div>
              {(selected.inputs || []).filter(i => i.name !== "domain" && i.name !== "tunnel_token").map(inp => (
                <div key={inp.name}>
                  <label className="block text-xs font-mono text-muted mb-1">
                    {inp.prompt || inp.name}
                    {inp.generate && <span className="text-accent ml-1">(auto)</span>}
                  </label>
                  <input type="text" value={inputs[inp.name] || ""}
                    onChange={e => updateInput(inp.name, e.target.value)}
                    placeholder={inp.example || inp.default || ""}
                    className="w-full bg-background border border-border px-3 py-2 text-sm font-mono outline-none focus:border-accent"/>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-card border border-border p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium">Environment Variables</h3>
              <button onClick={addEnvVar} className="text-xs font-mono text-accent hover:underline">+ Add</button>
            </div>
            {envVars.length === 0 && <p className="text-xs text-muted font-mono">None added. Add database URLs, API keys, etc.</p>}
            {envVars.map((ev, i) => (
              <div key={i} className="flex gap-2 mb-2">
                <input type="text" value={ev.key} onChange={e => updateEnvVar(i, "key", e.target.value)}
                  placeholder="KEY" className="flex-1 bg-background border border-border px-3 py-2 text-xs font-mono outline-none focus:border-accent"/>
                <input type="text" value={ev.value} onChange={e => updateEnvVar(i, "value", e.target.value)}
                  placeholder="value" className="flex-[2] bg-background border border-border px-3 py-2 text-xs font-mono outline-none focus:border-accent"/>
                <button onClick={() => removeEnvVar(i)} className="text-xs text-error/70 hover:text-error font-mono px-2">×</button>
              </div>
            ))}
          </div>

          <div className="bg-card border border-border p-5">
            <h3 className="text-sm font-medium mb-3">Cloudflare DNS</h3>
            <label className="flex items-center gap-3">
              <input type="checkbox" checked={createDns} onChange={e => setCreateDns(e.target.checked)} className="accent-accent w-4 h-4"/>
              <span className="text-sm">Auto-create {dnsRecordType} record for {inputs.domain || "your domain"} → {dnsRecordType === "CNAME" ? "selected tunnel" : "this VPS"}</span>
            </label>
            <p className="text-[10px] text-muted mt-2 ml-7">Cloudflare token required in Settings.</p>
          </div>

          {usesCloudflareTunnel && (
            <div className="bg-card border border-border p-5">
              <h3 className="text-sm font-medium mb-3">Cloudflare Tunnel</h3>
              <label className="block text-xs font-mono text-muted mb-1">Saved tunnel</label>
              <select value={selectedTunnelId} onChange={e => setSelectedTunnelId(e.target.value)}
                className="w-full max-w-lg bg-background border border-border px-3 py-2 text-sm font-mono outline-none focus:border-accent">
                <option value="">Select tunnel...</option>
                {tunnels.map((tunnel) => (
                  <option key={tunnel.id} value={tunnel.id}>
                    {tunnel.name || tunnel.id} · {tunnel.connectorStatus || tunnel.status || "unknown"}{tunnel.hasToken ? "" : " · no token"}
                  </option>
                ))}
              </select>
              <p className="text-[10px] text-muted mt-2">
                GroundControl injects the saved token, configures the tunnel hostname, and creates a CNAME to <span className="font-mono">{selectedTunnelId || "<tunnel-id>"}.cfargotunnel.com</span>.
              </p>
              {selectedTunnel && selectedTunnel.domains && selectedTunnel.domains.length > 0 && (
                <p className="text-[10px] text-muted mt-1 font-mono break-all">Current domains: {selectedTunnel.domains.join(", ")}</p>
              )}
              {tunnels.length === 0 && (
                <p className="text-xs text-error mt-3 font-mono">No saved tunnels found. Create one in Settings → Cloudflare first.</p>
              )}
            </div>
          )}

          <div className="flex gap-3">
            <BackBtn onClick={() => setStep("source")} />
            <button onClick={handlePreview} disabled={loading}
              className="px-4 py-2 text-xs font-mono bg-accent/10 border border-accent/30 text-accent hover:bg-accent/20 disabled:opacity-40 transition-colors">
              {loading ? "Generating..." : "Preview →"}
            </button>
          </div>
        </div>
      )}

      {/* Step 4 & 5: Preview / Deploy */}
      {(step === "preview" || step === "deploy") && (
        <div className="space-y-6">
          {previewText && (
            <div className="bg-card border border-accent/30 p-5">
              <h3 className="text-sm font-medium mb-3">Generated Configuration</h3>
              <pre className="text-xs font-mono text-foreground/70 whitespace-pre-wrap bg-background p-4 max-h-[50vh] overflow-y-auto leading-relaxed">{previewText}</pre>
            </div>
          )}
          {composeYml && (
            <details className="bg-card border border-border p-5">
              <summary className="text-sm font-medium cursor-pointer">docker-compose.yml</summary>
              <pre className="text-xs font-mono text-foreground/70 whitespace-pre-wrap bg-background p-4 mt-3 max-h-60 overflow-y-auto">{composeYml}</pre>
            </details>
          )}
          {proxyConfig && (
            <details className="bg-card border border-border p-5">
              <summary className="text-sm font-medium cursor-pointer">Reverse Proxy Config</summary>
              <pre className="text-xs font-mono text-foreground/70 whitespace-pre-wrap bg-background p-4 mt-3 max-h-60 overflow-y-auto">{proxyConfig}</pre>
            </details>
          )}
          {deployResult && (
            <div className="bg-success/5 border border-success/20 p-5">
              <h3 className="text-sm font-medium text-success mb-2">Deploy Result</h3>
              <p className="text-xs text-muted font-mono">Path: {deployResult.deployPath}</p>
              {deployResult.composeProject && <p className="text-xs text-muted font-mono mt-1">Compose project: {deployResult.composeProject}</p>}
              {Boolean(deployResult.dns) && <p className="text-xs text-muted font-mono mt-1">DNS: record created</p>}
              {Array.isArray(deployResult.health) && deployResult.health.length > 0 && (
                <div className="mt-2 space-y-1">
                  {deployResult.health.map((h: { domain: string; result: string }) => (
                    <p key={h.domain} className="text-xs text-muted font-mono break-all">
                      Health {h.domain}: {h.result || "not checked"}
                    </p>
                  ))}
                </div>
              )}
              {deployResult.upOutput && (
                <p className="text-xs text-muted font-mono mt-1 break-all">
                  Output: {typeof deployResult.upOutput === "string"
                    ? deployResult.upOutput.slice(0, 200)
                    : String(deployResult.upOutput.stdout || deployResult.upOutput.stderr || "").slice(0, 200)}
                </p>
              )}
            </div>
          )}
          <div className="flex gap-3">
            <BackBtn onClick={() => setStep("configure")} />
            {step === "preview" && (
              <button onClick={handleDeploy} disabled={loading}
                className="px-4 py-2 text-xs font-mono bg-accent text-white hover:bg-accent/90 disabled:opacity-50 transition-colors">
                {loading ? "Deploying..." : "Deploy"}
              </button>
            )}
            {step === "deploy" && (
              <button onClick={() => router.push("/dashboard")}
                className="px-4 py-2 text-xs font-mono bg-success/10 border border-success/30 text-success hover:bg-success/20 transition-colors">
                Done → Dashboard
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────

function Tag({ children }: { children: React.ReactNode }) {
  return <span className="text-[9px] px-1.5 py-0.5 bg-accent/10 text-accent border border-accent/20 font-mono">{children}</span>;
}

function BackBtn({ onClick }: { onClick: () => void }) {
  return <button onClick={onClick} className="px-4 py-2 text-xs font-mono border border-border hover:border-accent transition-colors">← Back</button>;
}

function SelectedTemplateCard({ selected }: { selected: TemplateWithId }) {
  const grouped = (selected.components || []).reduce<Record<string, NonNullable<TemplateWithId["components"]>>>((acc, component) => {
    const key = component.layer || "application";
    acc[key] = acc[key] || [];
    acc[key].push(component);
    return acc;
  }, {});

  return (
    <div className="bg-card border border-border p-5 space-y-4">
      <h2 className="text-sm font-medium mb-1">{selected.name}</h2>
      <p className="text-xs text-muted">{templatePurpose(selected)}</p>
      <div className="grid gap-2 md:grid-cols-3">
        <div className="border border-border bg-background/40 p-3">
          <div className="mb-1 text-[10px] font-mono uppercase tracking-wider text-muted">Best for</div>
          <p className="text-xs text-muted leading-relaxed">{selected.description}</p>
        </div>
        <div className="border border-border bg-background/40 p-3">
          <div className="mb-1 text-[10px] font-mono uppercase tracking-wider text-muted">Exposure</div>
          <p className="text-xs text-muted leading-relaxed">{templateExposure(selected)}</p>
        </div>
        <div className="border border-border bg-background/40 p-3">
          <div className="mb-1 text-[10px] font-mono uppercase tracking-wider text-muted">Source</div>
          <p className="text-xs text-muted leading-relaxed">{templateSourceModes(selected).join(" or ")}</p>
        </div>
      </div>
      {Object.keys(grouped).length > 0 && (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {Object.entries(grouped).map(([layer, components]) => (
            <div key={layer} className="border border-border bg-background/40 p-3">
              <div className="mb-2 text-[10px] font-mono uppercase tracking-wider text-accent">{layer}</div>
              <div className="space-y-1">
                {components.map((component) => (
                  <div key={component.id} className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate">{component.label}</span>
                    <span className="shrink-0 font-mono text-[10px] text-muted">{component.kind}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
