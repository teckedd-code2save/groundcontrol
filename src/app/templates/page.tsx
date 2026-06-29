"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { TemplateDefinition } from "@/lib/template-engine";

interface TemplateWithId extends TemplateDefinition {
  _filename: string;
}

type Step = "browse" | "source" | "configure" | "preview" | "deploy";

export default function TemplatesPage() {
  const router = useRouter();
  const [templates, setTemplates] = useState<TemplateWithId[]>([]);
  const [selected, setSelected] = useState<TemplateWithId | null>(null);
  const [step, setStep] = useState<Step>("browse");
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  // Source connection
  const [sourceType, setSourceType] = useState<"github" | "ghcr" | "local">("github");
  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("main");
  const [ghcrImage, setGhcrImage] = useState("");
  const [localPath, setLocalPath] = useState("");

  // Configuration
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [envVars, setEnvVars] = useState<{ key: string; value: string }[]>([]);
  const [cloudflareZone, setCloudflareZone] = useState("");
  const [createDns, setCreateDns] = useState(true);

  // Preview
  const [preview, setPreview] = useState<string | null>(null);
  const [composeYml, setComposeYml] = useState("");
  const [proxyConfig, setProxyConfig] = useState("");

  useEffect(() => {
    fetch("/api/templates")
      .then(r => r.json())
      .then(d => setTemplates((d.templates || []).map((t: any) => ({ ...t })))).catch(() => {});
  }, []);

  function selectTemplate(t: TemplateWithId) {
    setSelected(t);
    const defaults: Record<string, string> = {};
    (t.inputs || []).forEach(i => { if (i.default) defaults[i.name] = i.default; });
    setInputs(defaults);
    setEnvVars([]);
    setStep("source");
    setResult(null);
    setPreview(null);
  }

  function addEnvVar() { setEnvVars([...envVars, { key: "", value: "" }]); }
  function updateEnvVar(i: number, field: "key" | "value", val: string) {
    const updated = [...envVars]; updated[i][field] = val; setEnvVars(updated);
  }
  function removeEnvVar(i: number) { setEnvVars(envVars.filter((_, idx) => idx !== i)); }

  async function handlePreview() {
    if (!selected) return;
    setApplying(true);
    try {
      const allInputs: Record<string, string> = { ...inputs };
      // Add source info
      if (sourceType === "github") allInputs["repo_url"] = repoUrl;
      else if (sourceType === "ghcr") allInputs["ghcr_image"] = ghcrImage;
      else allInputs["repo_dir"] = localPath || ".";

      const params = new URLSearchParams({ name: selected._filename, preview: "true", ...allInputs });
      const res = await fetch(`/api/templates?${params}`);
      const data = await res.json();
      if (data.preview) {
        setPreview(data.preview);
        setComposeYml(data.resolved?.dockerCompose || "");
        setProxyConfig(data.resolved?.proxyConfig || "");
        setStep("preview");
      } else {
        setResult({ ok: false, msg: data.error || "Failed to generate preview" });
      }
    } catch { setResult({ ok: false, msg: "Network error" }); }
    finally { setApplying(false); }
  }

  async function handleDeploy() {
    if (!selected) return;
    setApplying(true); setResult(null);
    try {
      const allInputs: Record<string, string> = { ...inputs };
      if (sourceType === "github") allInputs["repo_url"] = repoUrl;
      else if (sourceType === "ghcr") allInputs["ghcr_image"] = ghcrImage;
      else allInputs["repo_dir"] = localPath || ".";

      const res = await fetch("/api/templates/deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateName: selected._filename,
          inputs: allInputs,
          envVars: envVars.filter(e => e.key),
          repoUrl: sourceType === "github" ? repoUrl : undefined,
          domain: inputs.domain || undefined,
          createDns,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setResult({ ok: true, msg: data.message || "Deployed successfully" });
        setStep("deploy");
        setPreview(data.composeYml || "");
        setProxyConfig(data.proxyConfig || "");
      } else {
        setResult({ ok: false, msg: data.error || "Deploy failed" });
      }
    } catch (err) {
      setResult({ ok: false, msg: err instanceof Error ? err.message : "Failed" });
    } finally { setApplying(false); }
  }

  function steps(): { id: Step; label: string }[] {
    return [
      { id: "browse", label: "Choose" },
      { id: "source", label: "Source" },
      { id: "configure", label: "Config" },
      { id: "preview", label: "Review" },
      { id: "deploy", label: "Deploy" },
    ];
  }

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Deployment Templates</h1>
        <p className="text-muted mt-1 text-sm">Production stacks. Pick → connect source → configure → deploy.</p>
      </div>

      {/* Steps */}
      <div className="flex items-center gap-2 mb-8 flex-wrap">
        {steps().map((s, i) => (
          <div key={s.id} className="flex items-center gap-2">
            <button onClick={() => (i <= steps().findIndex(x => x.id === step) ? setStep(s.id) : null)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-mono transition-colors ${
                step === s.id ? "bg-accent/10 text-accent border border-accent/30" :
                i < steps().findIndex(x => x.id === step) ? "text-muted hover:text-foreground" :
                "text-muted/40"
              }`}>
              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${
                step === s.id ? "bg-accent text-white" : "bg-card border border-border"
              }`}>{i + 1}</span>
              {s.label}
            </button>
            {i < 4 && <span className="text-muted/30 text-xs">→</span>}
          </div>
        ))}
      </div>

      {/* Step 1: Browse */}
      {step === "browse" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {templates.map(t => (
            <button key={t._filename} onClick={() => selectTemplate(t)}
              className="text-left p-5 bg-card border border-border rounded-xl hover:border-accent hover:bg-accent/5 transition-colors">
              <div className="flex items-start justify-between mb-2">
                <h3 className="font-medium text-sm">{t.name || "Unnamed"}</h3>
                <span className="text-lg">{t.category === "static" ? "◈" : t.category === "microservices" ? "◐" : "◉"}</span>
              </div>
              <p className="text-xs text-muted leading-relaxed mb-3">{t.description}</p>
              <div className="flex flex-wrap gap-1.5">
                {t.requires?.docker && <span className="text-[9px] px-1.5 py-0.5 rounded bg-accent/10 text-accent border border-accent/20 font-mono">Docker</span>}
                {t.requires?.caddy && <span className="text-[9px] px-1.5 py-0.5 rounded bg-accent/10 text-accent border border-accent/20 font-mono">Caddy</span>}
                {t.requires?.traefik && <span className="text-[9px] px-1.5 py-0.5 rounded bg-accent/10 text-accent border border-accent/20 font-mono">Traefik</span>}
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-muted/10 text-muted border border-muted/20 font-mono">v{t.version}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Step 2: Source */}
      {step === "source" && selected && (
        <div className="space-y-6">
          <div className="bg-card border border-border rounded-xl p-5">
            <h2 className="text-sm font-medium mb-1">{selected.name}</h2>
            <p className="text-xs text-muted">{selected.description}</p>
          </div>

          <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="text-sm font-medium mb-4">Where is your code?</h3>
            <div className="flex gap-2 mb-6">
              {(["github", "ghcr", "local"] as const).map(t => (
                <button key={t} onClick={() => setSourceType(t)}
                  className={`px-4 py-2 text-xs font-mono rounded-lg border transition-colors ${
                    sourceType === t ? "border-accent bg-accent/10 text-accent" : "border-border hover:border-accent/50"
                  }`}>
                  {t === "github" ? "GitHub Repo" : t === "ghcr" ? "GHCR Image" : "Local Path"}
                </button>
              ))}
            </div>

            {sourceType === "github" && (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-mono text-muted mb-1">Repository URL</label>
                  <input type="text" value={repoUrl} onChange={e => setRepoUrl(e.target.value)}
                    placeholder="https://github.com/you/repo" className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm font-mono outline-none focus:border-accent"/>
                </div>
                <div>
                  <label className="block text-xs font-mono text-muted mb-1">Branch</label>
                  <input type="text" value={branch} onChange={e => setBranch(e.target.value)}
                    className="w-48 bg-background border border-border rounded-lg px-3 py-2 text-sm font-mono outline-none focus:border-accent"/>
                </div>
              </div>
            )}
            {sourceType === "ghcr" && (
              <div>
                <label className="block text-xs font-mono text-muted mb-1">GHCR Image</label>
                <input type="text" value={ghcrImage} onChange={e => setGhcrImage(e.target.value)}
                  placeholder="ghcr.io/you/app:latest" className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm font-mono outline-none focus:border-accent"/>
              </div>
            )}
            {sourceType === "local" && (
              <div>
                <label className="block text-xs font-mono text-muted mb-1">Project path on VPS</label>
                <input type="text" value={localPath} onChange={e => setLocalPath(e.target.value)}
                  placeholder="/opt/myapp" className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm font-mono outline-none focus:border-accent"/>
              </div>
            )}
          </div>

          <div className="flex gap-3">
            <button onClick={() => setStep("browse")} className="px-4 py-2 text-xs font-mono border border-border rounded-lg hover:border-accent transition-colors">← Back</button>
            <button onClick={() => setStep("configure")} className="px-4 py-2 text-xs font-mono bg-accent/10 border border-accent/30 text-accent rounded-lg hover:bg-accent/20 transition-colors">Next: Configure →</button>
          </div>
        </div>
      )}

      {/* Step 3: Configure */}
      {step === "configure" && selected && (
        <div className="space-y-6">
          <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="text-sm font-medium mb-4">Deployment Settings</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-lg">
              {/* Domain - always shown */}
              <div className="md:col-span-2">
                <label className="block text-xs font-mono text-muted mb-1">Domain <span className="text-accent">*</span></label>
                <input type="text" value={inputs["domain"] || ""}
                  onChange={e => setInputs({...inputs, domain: e.target.value})}
                  placeholder="app.example.com"
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm font-mono outline-none focus:border-accent"/>
              </div>
              {(selected.inputs || []).filter(i => i.name !== "domain" && (!["app_container", "db_password", "db_user", "db_name"].includes(i.name) || !i.generate)).map(inp => (
                <div key={inp.name} className={inp.name === "domain" ? "md:col-span-2" : ""}>
                  <label className="block text-xs font-mono text-muted mb-1">
                    {inp.prompt || inp.name}
                    {inp.generate && <span className="text-accent ml-1">(auto)</span>}
                  </label>
                  <input type="text" value={inputs[inp.name] || ""}
                    onChange={e => setInputs({...inputs, [inp.name]: e.target.value})}
                    placeholder={inp.example || inp.default || ""}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm font-mono outline-none focus:border-accent"/>
                </div>
              ))}
            </div>
          </div>

          {/* Environment Variables */}
          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium">Environment Variables</h3>
              <button onClick={addEnvVar} className="text-xs font-mono text-accent hover:underline">+ Add</button>
            </div>
            {envVars.length === 0 && <p className="text-xs text-muted font-mono">No custom environment variables. Add secrets, API keys, etc.</p>}
            {envVars.map((ev, i) => (
              <div key={i} className="flex gap-2 mb-2">
                <input type="text" value={ev.key} onChange={e => updateEnvVar(i, "key", e.target.value)}
                  placeholder="KEY" className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-xs font-mono outline-none focus:border-accent uppercase"/>
                <input type="text" value={ev.value} onChange={e => updateEnvVar(i, "value", e.target.value)}
                  placeholder="value" className="flex-[2] bg-background border border-border rounded-lg px-3 py-2 text-xs font-mono outline-none focus:border-accent"/>
                <button onClick={() => removeEnvVar(i)} className="text-xs text-error/70 hover:text-error font-mono px-2">×</button>
              </div>
            ))}
          </div>

          {/* Cloudflare DNS */}
          <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="text-sm font-medium mb-3">Cloudflare DNS</h3>
            <label className="flex items-center gap-3">
              <input type="checkbox" checked={createDns} onChange={e => setCreateDns(e.target.checked)} className="accent-accent w-4 h-4"/>
              <span className="text-sm">Auto-create A record for {inputs.domain || "your domain"} pointing to this VPS</span>
            </label>
            <p className="text-[10px] text-muted mt-2 ml-7">Requires Cloudflare API token configured in Settings.</p>
          </div>

          <div className="flex gap-3">
            <button onClick={() => setStep("source")} className="px-4 py-2 text-xs font-mono border border-border rounded-lg hover:border-accent transition-colors">← Back</button>
            <button onClick={handlePreview} disabled={applying}
              className="px-4 py-2 text-xs font-mono bg-accent/10 border border-accent/30 text-accent rounded-lg hover:bg-accent/20 transition-colors disabled:opacity-50">
              {applying ? "Generating..." : "Preview →"}
            </button>
          </div>
        </div>
      )}

      {/* Step 4 & 5: Preview / Deploy */}
      {(step === "preview" || step === "deploy") && preview && (
        <div className="space-y-6">
          {result && (
            <div className={`p-3 rounded-lg text-sm ${result.ok ? "bg-success/10 border border-success/30 text-success" : "bg-error/10 border border-error/30 text-error"}`}>{result.msg}</div>
          )}

          <div className="bg-card border border-accent/30 rounded-xl p-5">
            <h3 className="text-sm font-medium mb-3">Generated Configuration</h3>
            <pre className="text-xs font-mono text-foreground/70 whitespace-pre-wrap bg-background rounded-lg p-4 max-h-[50vh] overflow-y-auto leading-relaxed">
              {preview}
            </pre>
          </div>

          {composeYml && (
            <details className="bg-card border border-border rounded-xl p-5">
              <summary className="text-sm font-medium cursor-pointer">docker-compose.yml</summary>
              <pre className="text-xs font-mono text-foreground/70 whitespace-pre-wrap bg-background rounded-lg p-4 mt-3 max-h-60 overflow-y-auto">{composeYml}</pre>
            </details>
          )}

          {proxyConfig && (
            <details className="bg-card border border-border rounded-xl p-5">
              <summary className="text-sm font-medium cursor-pointer">Reverse Proxy Config</summary>
              <pre className="text-xs font-mono text-foreground/70 whitespace-pre-wrap bg-background rounded-lg p-4 mt-3 max-h-60 overflow-y-auto">{proxyConfig}</pre>
            </details>
          )}

          <div className="flex gap-3">
            <button onClick={() => setStep("configure")} className="px-4 py-2 text-xs font-mono border border-border rounded-lg hover:border-accent transition-colors">← Edit</button>
            {step === "preview" && (
              <button onClick={handleDeploy} disabled={applying}
                className="px-4 py-2 text-xs font-mono bg-accent text-white rounded-lg hover:bg-accent/90 transition-colors disabled:opacity-50">
                {applying ? "Deploying..." : "Deploy"}
              </button>
            )}
            {step === "deploy" && (
              <button onClick={() => router.push("/dashboard")}
                className="px-4 py-2 text-xs font-mono bg-success/10 border border-success/30 text-success rounded-lg hover:bg-success/20 transition-colors">
                Done → Dashboard
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
