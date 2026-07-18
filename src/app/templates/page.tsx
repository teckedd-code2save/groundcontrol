"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FolderGit2, Search } from "lucide-react";
import type { TemplateDefinition } from "@/lib/template-engine";
import { getTemplateSourcePlan } from "@/lib/template-source-requirements";
import { ModalSurface } from "@/components/ModalSurface";
import { PageHeader } from "@/components/PageHeader";
import { Notice, ProgressSteps } from "@/components/ui";

interface TemplateWithId extends TemplateDefinition {
  _filename: string;
}

interface SourceCheck {
  id: string;
  label: string;
  ok: boolean;
  detail?: string;
}

interface CloudflareTunnelOption {
  id: string;
  name: string;
  connectorStatus?: string;
  status?: string;
  hasToken?: boolean;
  domains?: string[];
}

interface CloudflareZoneOption {
  id: string;
  name: string;
  status?: string;
}

interface GithubRepositoryOption {
  id: number;
  name: string;
  fullName: string;
  url: string;
  htmlUrl: string;
  defaultBranch: string;
  description: string;
  updatedAt?: string | null;
}

interface TemplateDeployResult {
  slug?: string;
  deployPath?: string;
  composeProject?: string;
  dns?: unknown;
  health?: { domain: string; result: string }[];
  upOutput?: string | { stdout?: string; stderr?: string };
  tunnelId?: string | null;
  tunnelConfig?: unknown;
  enrolled?: boolean;
  status?: string;
  publicVerified?: boolean;
  error?: string | null;
}

type Step = "browse" | "source" | "configure" | "preview" | "deploy";

function templatePurpose(template: TemplateWithId): string {
  const category = template.category.toLowerCase();
  if (category === "static" || template.deploy_mode === "static") {
    return "Plain HTML/CSS/JS (or a built dist folder) from Git — no Docker, Caddy serves files.";
  }
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
  if (template.deploy_mode === "static" || template.category === "static") {
    return "Public DNS -> Caddy file_server -> static files on disk";
  }
  if (template.reverse_proxy.type === "traefik") return "Public 80/443 -> Traefik routers -> compose services";
  if (template.reverse_proxy.type === "nginx") return "Public DNS -> Nginx -> loopback service ports";
  return "Public DNS -> Caddy -> loopback service ports";
}

function templateSourceModes(template: TemplateWithId): string[] {
  const plan = getTemplateSourcePlan(template);
  return plan.allowedSources.map((mode) => {
    if (mode === "github") return plan.requiresDockerfile ? "Git repo with Dockerfile" : "Git repository";
    if (mode === "local") return "Local VPS path";
    if (mode === "ghcr") return "GHCR / container image";
    return mode;
  });
}

function isStaticTpl(t: TemplateWithId): boolean {
  return t.deploy_mode === "static" || t.category === "static";
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
  const [deploymentName, setDeploymentName] = useState("");
  const [ghcrImage, setGhcrImage] = useState("");
  const [localPath, setLocalPath] = useState("");
  const [repoValidating, setRepoValidating] = useState(false);
  const [sourceValidated, setSourceValidated] = useState(false);
  const [sourceChecks, setSourceChecks] = useState<SourceCheck[]>([]);
  const [sourceSuggestion, setSourceSuggestion] = useState("");

  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [envVars, setEnvVars] = useState<{ key: string; value: string }[]>([]);
  const [createDns, setCreateDns] = useState(false);
  const [tunnels, setTunnels] = useState<CloudflareTunnelOption[]>([]);
  const [selectedTunnelId, setSelectedTunnelId] = useState("");
  const [zones, setZones] = useState<CloudflareZoneOption[]>([]);
  const [selectedZoneId, setSelectedZoneId] = useState("");
  const [githubOpen, setGithubOpen] = useState(false);
  const [githubOwner, setGithubOwner] = useState("teckedd-code2save");
  const [githubRepos, setGithubRepos] = useState<GithubRepositoryOption[]>([]);
  const [githubLoading, setGithubLoading] = useState(false);
  const [githubError, setGithubError] = useState("");

  const [previewText, setPreviewText] = useState("");
  const [composeYml, setComposeYml] = useState("");
  const [proxyConfig, setProxyConfig] = useState("");
  const [deployResult, setDeployResult] = useState<TemplateDeployResult | null>(null);
  const [deployStatus, setDeployStatus] = useState("");

  useEffect(() => {
    fetch("/api/templates").then(r => r.json())
      .then(d => setTemplates(d.templates || [])).catch(() => {});
    fetch("/api/cloudflare/tunnels").then(r => r.json())
      .then(d => setTunnels(d.tunnels || [])).catch(() => setTunnels([]));
    fetch("/api/cloudflare/zones").then(r => r.json())
      .then(d => setZones(d.zones || [])).catch(() => setZones([]));
  }, []);

  function selectTemplate(t: TemplateWithId) {
    setSelected(t);
    const defaults: Record<string, string> = {};
    (t.inputs || []).forEach(i => { if (i.default != null && i.default !== undefined) defaults[i.name] = i.default; });
    setInputs(defaults);
    setEnvVars([]);
    const plan = getTemplateSourcePlan(t);
    const preferred = plan.allowedSources.includes("github")
      ? "github"
      : plan.allowedSources.includes("local")
        ? "local"
        : plan.allowedSources.includes("ghcr")
          ? "ghcr"
          : "github";
    setSourceType(preferred);
    setStep("source");
    setResult(null);
    setPreviewText("");
    setDeployResult(null);
    setSelectedTunnelId("");
    setSelectedZoneId("");
    setDeploymentName("");
    setSourceValidated(false);
    setSourceChecks([]);
    setSourceSuggestion("");
  }

  async function validateSource(opts?: { silentOk?: boolean }): Promise<boolean> {
    if (!selected) return false;
    const plan = getTemplateSourcePlan(selected);
    if (sourceType === "github" && !repoUrl.trim()) {
      setResult({ ok: false, msg: "Enter a GitHub repository URL." });
      setSourceValidated(false);
      return false;
    }
    if (sourceType === "local" && !localPath.trim()) {
      setResult({ ok: false, msg: "Enter a path on the VPS." });
      setSourceValidated(false);
      return false;
    }
    if (sourceType === "ghcr" && plan.requiresImage && !ghcrImage.trim()) {
      setResult({ ok: false, msg: "Enter a container image (e.g. ghcr.io/you/app:latest)." });
      setSourceValidated(false);
      return false;
    }
    // Image-only templates with defaults: nothing to probe
    if (!plan.requiresDockerfile && !isStaticTpl(selected) && sourceType === "ghcr" && !plan.requiresGitOrLocal) {
      setSourceValidated(true);
      setSourceChecks([]);
      setSourceSuggestion("");
      if (!opts?.silentOk) setResult({ ok: true, msg: "✓ Image source OK for this template" });
      return true;
    }
    if (!plan.requiresDockerfile && !isStaticTpl(selected) && !plan.requiresGitOrLocal && sourceType !== "github" && sourceType !== "local") {
      setSourceValidated(true);
      setSourceChecks([]);
      if (!opts?.silentOk) setResult({ ok: true, msg: "✓ Template uses defaults — no source tree required" });
      return true;
    }

    setRepoValidating(true);
    setSourceSuggestion("");
    try {
      const res = await fetch("/api/templates/validate-source", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateName: selected._filename,
          sourceType,
          repoUrl: sourceType === "github" ? repoUrl : undefined,
          branch: sourceType === "github" ? branch : undefined,
          localPath: sourceType === "local" ? localPath : undefined,
          ghcrImage: sourceType === "ghcr" ? ghcrImage : undefined,
          outputDir: inputs.output_dir || ".",
          buildCommand: inputs.build_command || "",
        }),
      });
      const d = await res.json();
      setSourceChecks(Array.isArray(d.checks) ? d.checks : []);
      if (d.suggestion) setSourceSuggestion(String(d.suggestion));

      if (d.ok) {
        setSourceValidated(true);
        const name = d.repo?.name || repoUrl || localPath || "source";
        if (!deploymentName.trim()) {
          const inferred = String(d.repo?.name || repoUrl || localPath || ghcrImage || "")
            .replace(/[?#].*$/, "")
            .replace(/\/+$/, "")
            .replace(/\.git$/i, "")
            .split(/[/:]/)
            .filter(Boolean)
            .pop();
          if (inferred) setDeploymentName(inferred.replace(/:[^:]+$/, ""));
        }
        const checkSummary = (d.checks || [])
          .filter((c: SourceCheck) => c.ok)
          .map((c: SourceCheck) => c.label)
          .slice(0, 2)
          .join("; ");
        if (!opts?.silentOk) {
          setResult({
            ok: true,
            msg: `✓ Source matches this template${d.repo?.name ? `: ${d.repo.name}` : name ? `: ${name}` : ""}${checkSummary ? ` — ${checkSummary}` : ""}`,
          });
        }
        if (Array.isArray(d.warnings) && d.warnings.length > 0) {
          setResult({
            ok: true,
            msg: `✓ Source OK with notes: ${d.warnings[0]}`,
          });
        }
        return true;
      }

      setSourceValidated(false);
      const err = d.error || (Array.isArray(d.errors) && d.errors[0]) || "Source does not meet template requirements";
      setResult({ ok: false, msg: err });
      return false;
    } catch {
      setSourceValidated(false);
      setResult({ ok: false, msg: "Could not validate source against this template" });
      return false;
    } finally {
      setRepoValidating(false);
    }
  }

  async function continueFromSource() {
    const ok = await validateSource();
    if (ok) setStep("configure");
  }

  function updateInput(name: string, value: string) {
    setInputs(prev => ({ ...prev, [name]: value }));
  }

  function deploymentInputs(): Record<string, string> {
    const merged = { ...inputs };
    // Override domain with the resolved FQDN (e.g. pocket-models → pocket-models.serendepify.com)
    if (resolvedDomain) merged.domain = resolvedDomain;
    // Use deployment name as app_slug when the template default kicks in
    if (!merged.app_slug && deploymentName.trim()) merged.app_slug = deploymentName.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-");
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
  const matchingZone = zones.find((zone) => {
    const hostname = String(inputs.domain || "").trim().toLowerCase();
    return hostname === zone.name || hostname.endsWith(`.${zone.name}`);
  });
  const effectiveZoneId = selectedZoneId || matchingZone?.id || "";
  const dnsRecordType = usesCloudflareTunnel && selectedTunnelId ? "CNAME" : "A";

  // Resolve the full domain: if the user typed a bare name (no dot),
  // auto-append the matched Cloudflare zone so they see the final FQDN.
  // If the field is empty but a zone is selected and DNS is enabled,
  // infer the apex domain (e.g. serendepify.com).
  const resolvedDomain = (() => {
    const raw = String(inputs.domain || "").trim();
    if (raw && raw.includes(".")) return raw; // already a FQDN
    if (raw && matchingZone) return `${raw}.${matchingZone.name}`; // subdomain
    if (!raw && createDns && matchingZone) return matchingZone.name; // apex
    return raw;
  })();

  function addEnvVar() { setEnvVars([...envVars, { key: "", value: "" }]); }
  function updateEnvVar(i: number, f: "key" | "value", v: string) {
    const u = [...envVars]; u[i][f] = v; setEnvVars(u);
  }
  function removeEnvVar(i: number) { setEnvVars(envVars.filter((_, idx) => idx !== i)); }

  function validateDnsConfiguration(): boolean {
    if (!createDns) return true;
    // Allow apex: empty domain is fine if a zone is selected
    if (!String(inputs.domain || "").trim() && !effectiveZoneId) {
      setResult({ ok: false, msg: "Enter a domain or select a Cloudflare zone for apex hosting." });
      return false;
    }
    if (!effectiveZoneId) {
      setResult({ ok: false, msg: `No connected Cloudflare zone matches ${inputs.domain}. Select its zone or connect it in Settings.` });
      return false;
    }
    return true;
  }

  async function handlePreview() {
    if (!selected) return;
    if (!validateDnsConfiguration()) return;
    setLoading(true); setResult(null); setDeployStatus("Validating source and required inputs…");
    // Re-validate source before generating preview (catches wrong template + repo combo)
    const sourceOk = sourceValidated || (await validateSource({ silentOk: true }));
    if (!sourceOk) {
      setLoading(false);
      setStep("source");
      return;
    }
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
    if (!validateDnsConfiguration()) return;
    setLoading(true); setResult(null);
    const sourceOk = sourceValidated || (await validateSource({ silentOk: true }));
    if (!sourceOk) {
      setLoading(false);
      setStep("source");
      return;
    }
    try {
      setDeployStatus("Creating the workspace, applying runtime configuration and checking the public route…");
      const res = await fetch("/api/templates/deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateName: selected._filename,
          deploymentName: deploymentName.trim() || undefined,
          inputs: deploymentInputs(),
          envVars: envVars.filter(e => e.key),
          repoUrl: sourceType === "github" ? repoUrl : undefined,
          branch: sourceType === "github" ? branch : undefined,
          ghcrImage: sourceType === "ghcr" ? ghcrImage : undefined,
          localPath: sourceType === "local" ? localPath : undefined,
          domain: resolvedDomain || inputs.domain || undefined,
          createDns: createDns && !!(resolvedDomain || inputs.domain),
          zoneId: createDns ? effectiveZoneId || undefined : undefined,
          proxied: createDns ? true : undefined,
          tunnelId: usesCloudflareTunnel && selectedTunnelId ? selectedTunnelId : undefined,
          tunnelService: usesCloudflareTunnel ? `http://app:${inputs.app_port || inputs.port || "80"}` : undefined,
        }),
      });
      const data = await res.json();
      if (data.success || data.deployed) {
        setDeployStatus("Deployment created, enrolled and attached to its environment source.");
        setDeployResult(data);
        const parts = [data.message];
        if (Array.isArray(data.dns) && data.dns.length > 0) parts.push(`DNS: ${data.dns.length} record${data.dns.length === 1 ? "" : "s"} created`);
        else if (data.dns?.error) parts.push(`DNS needs attention: ${data.dns.error}`);
        setResult({ ok: data.success === true, msg: parts.join(" — ") });
        setStep("deploy");
        setPreviewText(data.composeYml || data.proxyConfig || "");
        setComposeYml(data.composeYml || "");
        setProxyConfig(data.proxyConfig || "");
      } else {
        setDeployStatus("");
        const extra = data.suggestion ? ` — ${data.suggestion}` : "";
        setResult({ ok: false, msg: `${data.error || "Deploy failed"}${extra}` });
        if (data.checks) setSourceChecks(data.checks);
        if (data.suggestion) setSourceSuggestion(data.suggestion);
      }
    } catch {
      setDeployStatus("");
      setResult({ ok: false, msg: "Connection error" });
    } finally { setLoading(false); }
  }

  async function loadGithubRepositories() {
    if (!githubOwner.trim()) return;
    setGithubLoading(true);
    setGithubError("");
    try {
      const response = await fetch(`/api/github/repositories?owner=${encodeURIComponent(githubOwner.trim())}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || data.error) throw new Error(data.error || "Could not load repositories");
      setGithubRepos(data.repositories || []);
    } catch (error) {
      setGithubError(error instanceof Error ? error.message : String(error));
      setGithubRepos([]);
    } finally {
      setGithubLoading(false);
    }
  }

  const steps = [
    { id: "browse" as Step, label: "Choose" },
    { id: "source" as Step, label: "Source" },
    { id: "configure" as Step, label: "Config" },
    { id: "preview" as Step, label: "Review" },
    { id: "deploy" as Step, label: "Deploy" },
  ];

  function isRecommended(t: TemplateWithId): boolean {
    // First-time / Product Hunt friendly starters
    return (
      t._filename === "vps-caddy-static-site" ||
      t._filename === "vps-caddy-source-build" ||
      t._filename === "cloudflare-tunnel-private-apps"
    );
  }

  const sortedTemplates = [...templates].sort((a, b) => {
    const ar = isRecommended(a) ? 0 : 1;
    const br = isRecommended(b) ? 0 : 1;
    if (ar !== br) return ar - br;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="gc-page">
      <PageHeader
        eyebrow="Build"
        title="Templates"
        description="Production-shaped workflows that validate, create, and enrol a deployment—not loose boilerplate files."
      />

      <ProgressSteps label="Deployment template workflow" steps={steps} current={step} onSelect={setStep} className="mb-8" />

      {result && step !== "source" && (
        <Notice className="mb-6" tone={result.ok ? "success" : "danger"}>
          {result.msg}
          {result.dns && <span className="block text-[10px] mt-1 opacity-75">{result.dns}</span>}
        </Notice>
      )}

      {deployStatus && (
        <div className="mb-6 border-l-2 border-accent bg-card px-3 py-2 text-xs font-mono text-muted">
          {loading ? <span className="text-accent">Working · </span> : <span className="text-success">Complete · </span>}
          {deployStatus}
        </div>
      )}

      {/* Step 1: Browse */}
      {step === "browse" && (
        <div className="space-y-4">
          <p className="max-w-xl text-xs text-muted leading-relaxed">
            Choose a deployment shape. GroundControl provisions the reverse proxy, DNS, and runtime — you supply the source and domain.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {sortedTemplates.map(t => (
            <button key={t._filename} onClick={() => selectTemplate(t)}
              className={`text-left p-4 bg-card border transition-colors hover:border-accent/40 ${
                isRecommended(t) ? "border-accent/40" : "border-border"
              }`}>
              <div className="flex items-center justify-between gap-2 mb-2">
                <h3 className="font-medium text-sm truncate">{t.name}</h3>
                <span className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-mono uppercase text-muted border border-border">
                  {t.deploy_mode === "static" ? "static" : "compose"}
                </span>
              </div>
              <p className="text-[11px] text-muted leading-relaxed line-clamp-2">{templatePurpose(t)}</p>
              <div className="mt-3 flex flex-wrap gap-1">
                {t.requires?.docker && <Tag>Docker</Tag>}
                {t.requires?.caddy && <Tag>Caddy</Tag>}
                {t.requires?.nginx && <Tag>Nginx</Tag>}
                {t.requires?.k3s && <Tag>k3s</Tag>}
                {isStaticTpl(t) && <Tag>No Docker</Tag>}
              </div>
            </button>
          ))}
          </div>
        </div>
      )}

      {/* Step 2: Source */}
      {step === "source" && selected && (() => {
        const plan = getTemplateSourcePlan(selected);
        const allowed = plan.allowedSources.filter((m): m is "github" | "ghcr" | "local" =>
          m === "github" || m === "ghcr" || m === "local"
        );
        return (
        <div className="space-y-6">
          <SelectedTemplateCard selected={selected} />
          <div className="rounded-md border border-border bg-card/60 px-4 py-3 text-[11px] text-muted leading-relaxed">
            <span className="font-mono text-accent">Requirements: </span>
            {plan.summary}
            {plan.requiresDockerfile && (
              <span className="block mt-1">Looks for <span className="font-mono text-foreground/70">Dockerfile</span> at the repo root before you continue.</span>
            )}
            {isStaticTpl(selected) && (
              <span className="block mt-1">
                Looks for <span className="font-mono text-foreground/70">index.html</span> / HTML files (or package.json for a build). Example:{" "}
                <span className="font-mono text-foreground/70">teckedd-code2save/pocket-models</span>
              </span>
            )}
          </div>
          <div className="bg-card border border-border p-5">
            <h3 className="text-sm font-medium mb-4">Where is your code?</h3>
            <div className="flex gap-2 mb-6 flex-wrap">
              {allowed.map(t => (
                <button key={t} onClick={() => {
                  setSourceType(t);
                  setResult(null);
                  setSourceValidated(false);
                  setSourceChecks([]);
                  setSourceSuggestion("");
                }}
                  className={`px-4 py-2 text-xs font-mono border ${sourceType === t ? "border-accent text-accent" : "border-border hover:border-accent/50"}`}>{t === "github" ? "GitHub" : t === "ghcr" ? "GHCR" : "Local"}</button>
              ))}
            </div>
            {sourceType === "github" && (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <label className="block text-xs font-mono text-muted">Repository</label>
                  <button type="button" onClick={() => setGithubOpen(true)} className="gc-button gc-button-quiet">
                    <FolderGit2 size={14} aria-hidden="true" />
                    Choose from GitHub
                  </button>
                </div>
                <div className="flex gap-2">
                  <input type="text" value={repoUrl} onChange={e => {
                    setRepoUrl(e.target.value);
                    setSourceValidated(false);
                  }}
                    placeholder={isStaticTpl(selected)
                      ? "https://github.com/teckedd-code2save/pocket-models"
                      : "https://github.com/you/repo"}
                    className="flex-1 bg-background border border-border px-3 py-2 text-sm font-mono outline-none focus:border-accent"/>
                  <button onClick={() => validateSource()} disabled={repoValidating || !repoUrl}
                    className="px-3 py-2 text-xs font-mono border border-border hover:border-accent disabled:opacity-50">
                    {repoValidating ? "Checking…" : "Verify source"}
                  </button>
                </div>
                <label className="block text-xs font-mono text-muted mt-3">Branch</label>
                <input type="text" value={branch} onChange={e => { setBranch(e.target.value); setSourceValidated(false); }}
                  className="w-40 bg-background border border-border px-3 py-2 text-sm font-mono outline-none focus:border-accent"/>
              </div>
            )}
            {sourceType === "ghcr" && (
              <div>
                <label className="block text-xs font-mono text-muted mb-1">GHCR Image</label>
                <input type="text" value={ghcrImage} onChange={e => { setGhcrImage(e.target.value); setSourceValidated(false); }}
                  placeholder="ghcr.io/you/app:latest" className="w-full bg-background border border-border px-3 py-2 text-sm font-mono outline-none focus:border-accent"/>
              </div>
            )}
            {sourceType === "local" && (
              <div className="space-y-3">
                <label className="block text-xs font-mono text-muted mb-1">Path on VPS</label>
                <div className="flex gap-2">
                  <input type="text" value={localPath} onChange={e => { setLocalPath(e.target.value); setSourceValidated(false); }}
                    placeholder="/opt/myapp" className="flex-1 bg-background border border-border px-3 py-2 text-sm font-mono outline-none focus:border-accent"/>
                  <button onClick={() => validateSource()} disabled={repoValidating || !localPath}
                    className="px-3 py-2 text-xs font-mono border border-border hover:border-accent disabled:opacity-50">
                    {repoValidating ? "..." : "Check fit"}
                  </button>
                </div>
              </div>
            )}
            {sourceChecks.length > 0 && (
              <ul className="mt-4 space-y-1.5 border-t border-border pt-4">
                {sourceChecks.map((c) => (
                  <li key={c.id} className={`text-[11px] font-mono ${c.ok ? "text-success" : "text-error"}`}>
                    {c.ok ? "✓" : "✗"} {c.label}
                    {c.detail ? <span className="text-muted"> — {c.detail}</span> : null}
                  </li>
                ))}
              </ul>
            )}
            {result && (
              <Notice className="mt-4" tone={result.ok ? "success" : "danger"}>{result.msg}</Notice>
            )}
            {sourceSuggestion && (
              <Notice className="mt-3" tone="warning">{sourceSuggestion}</Notice>
            )}
          </div>
          <div className="flex gap-3">
            <BackBtn onClick={() => setStep("browse")} />
            <button onClick={continueFromSource} disabled={repoValidating}
              className="px-4 py-2 text-xs font-mono bg-accent/10 border border-accent/30 text-accent hover:bg-accent/20 transition-colors disabled:opacity-50">
              {repoValidating ? "Checking source…" : "Check & continue →"}
            </button>
          </div>
        </div>
        );
      })()}

      {/* Step 3: Configure */}
      {step === "configure" && selected && (
        <div className="space-y-6">
          <div className="bg-card border border-border p-5">
            <h3 className="text-sm font-medium mb-4">Deployment</h3>
            <div className="space-y-4 max-w-lg">
              <div>
                <label className="block text-xs font-mono text-muted mb-1">Name</label>
                <input
                  type="text"
                  value={deploymentName}
                  onChange={event => setDeploymentName(event.target.value)}
                  placeholder={repoUrl ? repoUrl.replace(/\.git$/, "").split("/").pop() || "deployment" : "deployment"}
                  className="w-full bg-background border border-border px-3 py-2 text-sm outline-none focus:border-accent"
                />
                <p className="mt-1 text-[10px] text-muted">Defaults to the repository, image, or source-folder name.</p>
              </div>
              <div>
                <label className="block text-xs font-mono text-muted mb-1">Domain</label>
                <input type="text" value={inputs.domain || ""}
                  onChange={e => {
                    const val = e.target.value;
                    // If the user types a bare name and a zone is selected,
                    // keep the zone match but let them type freely
                    updateInput("domain", val);
                  }}
                  placeholder="app.example.com"
                  className="w-full bg-background border border-border px-3 py-2 text-sm font-mono outline-none focus:border-accent"/>
                <p className="mt-1 text-[10px] text-muted">
                  Use a domain from a connected Cloudflare zone. GroundControl only reports success after the public route responds.
                </p>
                {resolvedDomain && resolvedDomain !== String(inputs.domain || "").trim() && (
                  <div className="mt-1.5 rounded border border-accent/30 bg-accent/5 px-2.5 py-1.5">
                    <p className="text-[10px] text-muted mb-0.5">Final domain with zone:</p>
                    <p className="font-mono text-xs text-accent font-medium">{resolvedDomain}</p>
                    <p className="mt-1 text-[9px] text-muted">The DNS record will be created for this full domain. Caddy will serve at this address.</p>
                  </div>
                )}
              </div>
              {(selected.inputs || []).filter(i => ![
                "domain",
                "tunnel_token",
                "app_slug",
                "repo_url",
                "repo_branch",
                "repo_dir",
                "ghcr_image",
              ].includes(i.name)).map(inp => (
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
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-sm font-medium">Cloudflare DNS</h3>
                <p className="mt-1 text-xs text-muted">Create the public record as part of this deployment.</p>
              </div>
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={createDns} onChange={e => setCreateDns(e.target.checked)} className="accent-accent w-4 h-4"/>
                Configure DNS
              </label>
            </div>
            {createDns && (<div>
              <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                <label className="block">
                  <span className="gc-label">Cloudflare zone</span>
                  <select value={effectiveZoneId} onChange={event => setSelectedZoneId(event.target.value)} className="gc-field w-full">
                    <option value="">Select the zone for {inputs.domain || "this domain"}</option>
                    {zones.map(zone => <option key={zone.id} value={zone.id}>{zone.name}{zone.status ? ` · ${zone.status}` : ""}</option>)}
                  </select>
                </label>
                <span className="pb-2 font-mono text-[10px] text-muted">
                  {resolvedDomain && effectiveZoneId
                    ? `${resolvedDomain} → points to your VPS`
                    : `${dnsRecordType} record — ${dnsRecordType === "CNAME" ? "routes through Cloudflare Tunnel" : "points to your server"}`}
                </span>
              </div>
              {resolvedDomain && effectiveZoneId && (
                <p className="text-[10px] text-muted leading-relaxed">
                  A {dnsRecordType} record will be created in Cloudflare so{" "}
                  <span className="font-mono">{resolvedDomain}</span> reaches
                  your VPS. Caddy automatically serves the site at this domain.
                </p>
              )}
            </div>)}
            {createDns && zones.length === 0 && (
              <p className="mt-3 border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">No active Cloudflare zones are available. Connect Cloudflare in Settings first.</p>
            )}
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
          {composeYml && !composeYml.includes("Static site — no Docker Compose") && (
            <details className="bg-card border border-border p-5">
              <summary className="text-sm font-medium cursor-pointer">docker-compose.yml</summary>
              <pre className="text-xs font-mono text-foreground/70 whitespace-pre-wrap bg-background p-4 mt-3 max-h-60 overflow-y-auto">{composeYml}</pre>
            </details>
          )}
          {composeYml && composeYml.includes("Static site — no Docker Compose") && (
            <div className="bg-card border border-border p-4 text-[11px] font-mono text-muted">
              No docker-compose.yml — static files only.
            </div>
          )}
          {proxyConfig && (
            <details className="bg-card border border-border p-5">
              <summary className="text-sm font-medium cursor-pointer">Reverse Proxy Config</summary>
              <pre className="text-xs font-mono text-foreground/70 whitespace-pre-wrap bg-background p-4 mt-3 max-h-60 overflow-y-auto">{proxyConfig}</pre>
            </details>
          )}
          {deployResult && (
            <div className={`rounded-md border p-5 ${deployResult.publicVerified === false ? "border-warning/30 bg-warning/5" : "border-success/25 bg-success/5"}`}>
              <h3 className={`text-sm font-medium mb-2 ${deployResult.publicVerified === false ? "text-warning" : "text-success"}`}>
                {deployResult.publicVerified === false ? "Deployed, public route needs attention" : "Deployed and verified"}
              </h3>
              {deployResult.error && <p className="mb-2 text-xs font-mono text-error">{deployResult.error}</p>}
              <p className="text-xs text-muted font-mono">Path: {deployResult.deployPath}</p>
              {deployResult.composeProject && <p className="text-xs text-muted font-mono mt-1">Compose project: {deployResult.composeProject}</p>}
              {deployResult.enrolled && <p className="mt-1 text-xs font-mono text-success">Enrolled in GroundControl inventory</p>}
              {Array.isArray(deployResult.dns) && deployResult.dns.length > 0 && <p className="text-xs text-success font-mono mt-1">DNS: {deployResult.dns.length} record{deployResult.dns.length === 1 ? "" : "s"} created</p>}
              {typeof deployResult.dns === "object" && deployResult.dns !== null && !Array.isArray(deployResult.dns) && "error" in deployResult.dns && (
                <p className="mt-1 text-xs font-mono text-error">DNS: {String((deployResult.dns as { error: unknown }).error)}</p>
              )}
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
              <p className="mt-3 text-[11px] text-muted">
                Manage environment, evidence and runtime context from Deployments.
              </p>
            </div>
          )}
          <div className="flex flex-wrap gap-3">
            <BackBtn onClick={() => setStep("configure")} />
            {step === "preview" && (
              <button onClick={handleDeploy} disabled={loading}
                className="rounded-md px-4 py-2 text-xs font-mono bg-accent text-[var(--accent-ink)] hover:bg-accent-bright disabled:opacity-50 transition-colors">
                {loading ? "Deploying..." : "Deploy"}
              </button>
            )}
            {step === "deploy" && (
              <>
                <button onClick={() => router.push(deployResult?.slug ? `/deployments/${deployResult.slug}` : "/deployments")}
                  className="rounded-md px-4 py-2 text-xs font-mono bg-accent text-[var(--accent-ink)] hover:bg-accent-bright transition-colors">
                  Open Deployments
                </button>
                <button onClick={() => router.push("/dashboard")}
                  className="rounded-md px-4 py-2 text-xs font-mono bg-success/10 border border-success/30 text-success hover:bg-success/20 transition-colors">
                  Dashboard
                </button>
                <button onClick={() => { setStep("browse"); setSelected(null); setDeployResult(null); setResult(null); }}
                  className="rounded-md px-4 py-2 text-xs font-mono border border-border text-muted hover:border-accent hover:text-accent transition-colors">
                  Deploy another
                </button>
              </>
            )}
          </div>
        </div>
      )}

      <ModalSurface
        open={githubOpen}
        onClose={() => setGithubOpen(false)}
        title="Choose a GitHub repository"
        description="Browse public repositories for a GitHub user or organization. Private repository access can be connected separately later."
      >
        <div className="space-y-4">
          <form onSubmit={(event) => {
            event.preventDefault();
            void loadGithubRepositories();
          }} className="flex gap-2">
            <label className="min-w-0 flex-1">
              <span className="gc-label">GitHub user or organization</span>
              <input value={githubOwner} onChange={event => setGithubOwner(event.target.value)} placeholder="github-owner" className="gc-field w-full" />
            </label>
            <button type="submit" disabled={!githubOwner.trim() || githubLoading} className="gc-button gc-button-secondary self-end">
              <Search size={14} aria-hidden="true" />
              {githubLoading ? "Loading…" : "Browse"}
            </button>
          </form>
          {githubError && <p className="border border-error/30 bg-error/5 px-3 py-2 text-xs text-error">{githubError}</p>}
          <div className="max-h-[50vh] space-y-1 overflow-y-auto pr-1">
            {githubRepos.map(repo => (
              <button
                key={repo.id}
                type="button"
                onClick={() => {
                  setRepoUrl(repo.url);
                  setBranch(repo.defaultBranch || "main");
                  setDeploymentName(repo.name);
                  setSourceValidated(false);
                  setSourceChecks([]);
                  setResult(null);
                  setGithubOpen(false);
                }}
                className="flex w-full items-start justify-between gap-4 border border-border px-3 py-3 text-left hover:border-accent/50 hover:bg-card"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{repo.fullName}</span>
                  <span className="mt-1 line-clamp-2 block text-[11px] leading-relaxed text-muted">{repo.description || "No description"}</span>
                </span>
                <span className="shrink-0 font-mono text-[9px] text-muted">{repo.defaultBranch}</span>
              </button>
            ))}
            {!githubLoading && githubRepos.length === 0 && !githubError && (
              <p className="border border-dashed border-border p-4 text-center text-xs text-muted">Enter an account and browse its public repositories.</p>
            )}
          </div>
        </div>
      </ModalSurface>
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
