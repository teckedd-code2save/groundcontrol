"use client";

import { useCallback, useEffect, useState } from "react";
import { SensitiveField, SensitiveInput } from "@/components/SensitiveField";
import { ConfirmDelete } from "@/components/ConfirmDelete";
import VpsFilePicker from "@/components/VpsFilePicker";
import CloudflareSettingsTab from "@/components/CloudflareSettingsTab";
import AlertSettingsTab from "@/components/AlertSettingsTab";
import { LoaderOverlay3D } from "@/components/LoaderOverlay3D";
import { DeployTargetsTab } from "@/components/DeployTargetsTab";
import CloudAccountsTab from "@/components/CloudAccountsTab";
import TerraformStacksTab from "@/components/TerraformStacksTab";
import EnvProvidersTab from "@/components/EnvProvidersTab";

interface VpsConfig {
  id: number;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: string;
  isLocal: boolean;
  isActive: boolean;
  hasKey: boolean;
  hasPassword: boolean;
  createdAt: string;
}

type TabKey = "connections" | "layout" | "ai" | "security" | "alerts" | "cloudflare" | "env-providers" | "cloud-accounts" | "deploy-targets" | "infrastructure";

const settingsTabs: { key: TabKey; label: string; description: string }[] = [
  { key: "connections", label: "VPS", description: "Hosts, SSH, and active server" },
  { key: "layout", label: "Layout", description: "Deployment roots and scan paths" },
  { key: "ai", label: "AI", description: "Assistant provider and model" },
  { key: "security", label: "Security", description: "Access, sessions, and audit" },
  { key: "cloudflare", label: "Cloudflare", description: "DNS, zones, and tunnels" },
  { key: "env-providers", label: "Env", description: "Local and external secret sources" },
  { key: "alerts", label: "Alerts", description: "Rules, retention, and health checks" },
  { key: "cloud-accounts", label: "Cloud", description: "Cloud credentials and tests" },
  { key: "deploy-targets", label: "Targets", description: "Deployment backends" },
  { key: "infrastructure", label: "Infra", description: "Terraform stacks and outputs" },
];

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<TabKey>(() => {
    if (typeof window === "undefined") return "connections";
    const tab = new URLSearchParams(window.location.search).get("tab");
    if (
      tab &&
      ["connections", "layout", "ai", "security", "alerts", "cloudflare", "env-providers", "cloud-accounts", "deploy-targets", "infrastructure"].includes(tab)
    ) {
      return tab as TabKey;
    }
    return "connections";
  });
  const activeTabMeta = settingsTabs.find((tab) => tab.key === activeTab) || settingsTabs[0];

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto">
      <div className="mb-5 flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-xs text-muted">{activeTabMeta.description}</p>
      </div>

      <div className="mb-6 flex flex-wrap gap-1 rounded-xl bg-card p-1">
        {settingsTabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            title={tab.description}
            className={`shrink-0 rounded-lg px-3 py-2 text-xs font-mono transition-colors whitespace-nowrap ${
              activeTab === tab.key
                ? "bg-accent/10 text-accent"
                : "text-muted hover:bg-background hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "connections" && <ConnectionsTab />}
      {activeTab === "layout" && <ServerLayoutTab />}
      {activeTab === "ai" && <AIConfigTab />}
      {activeTab === "security" && <SecurityTab />}
      {activeTab === "cloudflare" && <CloudflareSettingsTab />}
      {activeTab === "env-providers" && <EnvProvidersTab />}
      {activeTab === "alerts" && <AlertSettingsTab />}
      {activeTab === "cloud-accounts" && (
        <div>
          <CloudAccountsTab />
        </div>
      )}
      {activeTab === "deploy-targets" && (
        <div>
          <DeployTargetsTab />
        </div>
      )}
      {activeTab === "infrastructure" && (
        <div>
          <TerraformStacksTab />
        </div>
      )}
    </div>
  );
}

function ConnectionsTab() {
  const [configs, setConfigs] = useState<VpsConfig[]>([]);
  const [form, setForm] = useState({
    name: "",
    host: "",
    port: 22,
    username: "",
    privateKey: "",
    password: "",
    authType: "key" as "key" | "password",
    isLocal: false,
  });
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [deleteConfigTarget, setDeleteConfigTarget] = useState<VpsConfig | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    fetch("/api/vps")
      .then((res) => res.json())
      .then((data) => setConfigs(data))
      .catch(() => setConfigs([]));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await fetch("/api/vps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      setForm({
        name: "",
        host: "",
        port: 22,
        username: "",
        privateKey: "",
        password: "",
        authType: "key",
        isLocal: false,
      });
      const refreshed = await fetch("/api/vps").then((r) => (r.ok ? r.json() : []));
      setConfigs(refreshed);
    } finally {
      setSubmitting(false);
    }
  }

  async function testConnection() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/vps/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      setTestResult(data);
    } finally {
      setTesting(false);
    }
  }

  async function refreshConfigs() {
    const refreshed = await fetch("/api/vps").then((r) => (r.ok ? r.json() : []));
    setConfigs(refreshed);
  }

  async function doDeleteConfig() {
    if (!deleteConfigTarget) return;
    setActionLoading(true);
    try {
      await fetch(`/api/vps?id=${deleteConfigTarget.id}`, { method: "DELETE" });
      setDeleteConfigTarget(null);
      await refreshConfigs();
    } finally {
      setActionLoading(false);
    }
  }

  async function activateConfig(id: number) {
    setActionLoading(true);
    try {
      await fetch("/api/vps/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      await refreshConfigs();
      window.dispatchEvent(new CustomEvent("gc:active-vps-changed"));
    } finally {
      setActionLoading(false);
    }
  }

  return (
    <div className="space-y-8">
      <LoaderOverlay3D open={testing || submitting || actionLoading} variant="generic" title={testing ? "Testing connection..." : submitting ? "Saving connection..." : "Updating connections..."} />
      <div className="bg-card border border-border rounded-xl p-6">
        <h2 className="text-sm font-mono text-muted mb-6">Add VPS Connection</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-mono text-muted mb-1.5">Name</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent transition-colors"
              />
            </div>
            <SensitiveInput
              label="Host"
              value={form.host}
              onChange={(v) => setForm({ ...form, host: v })}
              type="text"
            />
            <SensitiveInput
              label="Port"
              value={form.port}
              onChange={(v) => setForm({ ...form, port: parseInt(v) || 0 })}
              type="number"
            />
            <SensitiveInput
              label="Username"
              value={form.username}
              onChange={(v) => setForm({ ...form, username: v })}
              type="text"
              className="md:col-span-2"
            />
          </div>

          <div>
            <label className="block text-xs font-mono text-muted mb-1.5">Auth Type</label>
            <div className="flex gap-3">
              {["key", "password"].map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setForm({ ...form, authType: type as "key" | "password" })}
                  className={`px-4 py-2 text-xs font-mono border rounded-lg transition-colors ${
                    form.authType === type
                      ? "border-accent bg-accent/10 text-accent"
                      : "border-border hover:border-border-hover"
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>

          {form.authType === "key" ? (
            <SensitiveInput
              label="Private Key"
              value={form.privateKey}
              onChange={(v) => setForm({ ...form, privateKey: v })}
              type="textarea"
              rows={6}
              placeholder="-----BEGIN OPENSSH PRIVATE KEY-----..."
            />
          ) : (
            <SensitiveInput
              label="Password"
              value={form.password}
              onChange={(v) => setForm({ ...form, password: v })}
              type="password"
            />
          )}

          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="isLocal"
              checked={form.isLocal}
              onChange={(e) => setForm({ ...form, isLocal: e.target.checked })}
              className="w-4 h-4 accent-accent"
            />
            <label htmlFor="isLocal" className="text-sm">Running on VPS (local exec, no SSH)</label>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={testConnection}
              disabled={testing}
              className="px-4 py-2 text-xs font-mono border border-border rounded-lg hover:border-accent hover:text-accent transition-colors disabled:opacity-50"
            >
              Test Connection
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-xs font-mono bg-accent/10 border border-accent/30 text-accent rounded-lg hover:bg-accent/20 transition-colors disabled:opacity-50"
            >
              Save Connection
            </button>
          </div>

          {testResult && (
            <div
              className={`p-3 rounded-lg text-sm ${
                testResult.success
                  ? "bg-success/10 border border-success/30 text-success"
                  : "bg-error/10 border border-error/30 text-error"
              }`}
            >
              {testResult.message}
            </div>
          )}
        </form>
      </div>

      {configs.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-6">
          <h2 className="text-sm font-mono text-muted mb-2">Saved Connections</h2>
          <p className="text-[11px] text-muted/70 mb-4 leading-relaxed">
            These are servers you <strong>switch between</strong> — not separate accounts. Exactly one connection is{" "}
            <span className="text-accent font-mono">active</span> at a time, and every page targets whichever server is
            active. Switching changes which server GroundControl controls.
          </p>
          <div className="space-y-3">
            {configs.map((config) => (
              <div
                key={config.id}
                className={`flex items-center justify-between py-3 px-4 rounded-lg border ${
                  config.isActive ? "bg-accent/5 border-accent/40" : "bg-background/50 border-transparent"
                }`}
              >
                <div>
                  <div className="font-medium text-sm flex items-center gap-2">
                    {config.name}
                    {config.isActive && (
                      <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-accent/15 text-accent border border-accent/30">
                        active
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted font-mono mt-0.5 flex items-center gap-1 flex-wrap">
                    <SensitiveField value={`${config.username}@${config.host}:${config.port}`} />
                    <span>
                      · {config.authType} · {config.isLocal ? "local" : "ssh"}
                      {config.hasKey ? " · key set" : ""}
                      {config.hasPassword ? " · password set" : ""}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {config.isActive ? (
                    <span className="text-xs font-mono text-accent/70">current target</span>
                  ) : (
                    <button
                      onClick={() => activateConfig(config.id)}
                      className="text-xs font-mono px-3 py-1.5 border border-accent/30 text-accent rounded-lg hover:bg-accent/10 transition-colors"
                    >
                      Switch to this server
                    </button>
                  )}
                  <button
                    onClick={() => setDeleteConfigTarget(config)}
                    className="text-xs font-mono text-error/70 hover:text-error transition-colors"
                  >
                    remove
                  </button>
                </div>
              </div>
            ))}
          </div>
          <ConfirmDelete
            open={!!deleteConfigTarget}
            resourceName={deleteConfigTarget?.name || ""}
            resourceType="VPS Connection"
            onConfirm={doDeleteConfig}
            onCancel={() => setDeleteConfigTarget(null)}
          />
        </div>
      )}
    </div>
  );
}

interface SystemConfig {
  projectRoot: string;
  templateDeploymentRoot: string;
  caddySitesDir: string;
  caddyFile: string;
  nginxSitesDir: string;
  nginxLogPath: string;
  staticRoot: string;
  sshDefaultCwd: string;
  certDomain: string;
  composeCommand: string | null;
}

function ServerLayoutTab() {
  const [config, setConfig] = useState<SystemConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerTarget, setPickerTarget] = useState<string>("");
  const [pickerPath, setPickerPath] = useState("/");

  const loadConfig = useCallback((showLoading = true) => {
    if (showLoading) setLoading(true);
    fetch("/api/system-config")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        setConfig(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetch("/api/system-config")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        setConfig(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    function onChange() {
      loadConfig();
    }
    window.addEventListener("gc:active-vps-changed", onChange);
    return () => window.removeEventListener("gc:active-vps-changed", onChange);
  }, [loadConfig]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!config) return;
    setSaving(true);
    setResult(null);
    setWarnings([]);
    try {
      const res = await fetch("/api/system-config?validate=1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectRoot: config.projectRoot,
          templateDeploymentRoot: config.templateDeploymentRoot,
          caddySitesDir: config.caddySitesDir,
          caddyFile: config.caddyFile,
          nginxSitesDir: config.nginxSitesDir,
          nginxLogPath: config.nginxLogPath,
          staticRoot: config.staticRoot,
          sshDefaultCwd: config.sshDefaultCwd,
          certDomain: config.certDomain,
          composeCommand: config.composeCommand || null,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setConfig(data);
        setWarnings(data.warnings || []);
        setResult({ success: true, message: "System paths updated" });
      } else {
        setResult({ success: false, message: data.error || "Failed to update" });
      }
    } catch {
      setResult({ success: false, message: "Network error" });
    } finally {
      setSaving(false);
    }
  }

  async function autoDetect() {
    setDetecting(true);
    setResult(null);
    setWarnings([]);
    try {
      const res = await fetch("/api/system-config/detect");
      const data = await res.json();
      if (res.ok) {
        setConfig((prev) => ({ ...prev, ...data }));
        setResult({ success: true, message: "Layout auto-detected from active VPS" });
      } else {
        setResult({ success: false, message: data.error || "Detection failed" });
      }
    } catch {
      setResult({ success: false, message: "Network error" });
    } finally {
      setDetecting(false);
    }
  }

  function openPicker(key: string, currentValue: string) {
    setPickerTarget(key);
    setPickerPath(currentValue && currentValue.startsWith("/") ? currentValue : "/");
    setPickerOpen(true);
  }

  function onPickerSelect(path: string) {
    if (pickerTarget && config) {
      setConfig({ ...config, [pickerTarget]: path });
    }
    setPickerOpen(false);
  }

  if (loading) {
    return (
      <LoaderOverlay3D open={loading} variant="generic" title="Loading server layout..." />
    );
  }

  const fields: { key: keyof SystemConfig; label: string; placeholder: string; desc: string }[] = [
    { key: "projectRoot", label: "Legacy Project Root", placeholder: "/opt", desc: "Base directory scanned for existing/manual apps. Templates do not deploy here by default." },
    { key: "templateDeploymentRoot", label: "Template Deployment Root", placeholder: "/srv/groundcontrol/deployments", desc: "Managed root where new template deployments are created" },
    { key: "caddySitesDir", label: "Caddy Sites Directory", placeholder: "/etc/caddy/sites", desc: "Directory containing individual Caddy site config files" },
    { key: "caddyFile", label: "Caddy Main Config", placeholder: "/etc/caddy/Caddyfile", desc: "Path to the main Caddyfile if sites are defined there instead of separate files" },
    { key: "nginxSitesDir", label: "Nginx Sites Directory", placeholder: "/etc/nginx/sites-available", desc: "Directory containing Nginx virtual host configs" },
    { key: "nginxLogPath", label: "Nginx Error Log", placeholder: "/var/log/nginx/error.log", desc: "Path to Nginx error log for debugging" },
    { key: "staticRoot", label: "Static Files Root", placeholder: "/var/www", desc: "Directory served for static websites and file hosting" },
    { key: "sshDefaultCwd", label: "SSH Default Working Directory", placeholder: "/root", desc: "Default directory when opening the terminal" },
    { key: "certDomain", label: "SSL Certificate Domain", placeholder: "yourdomain.com (optional)", desc: "Primary domain for SSL certificate generation and monitoring" },
    { key: "composeCommand", label: "Docker Compose Command", placeholder: "auto", desc: "Override the docker compose command. Leave empty for auto-detect." },
  ];

  return (
    <div className="bg-card border border-border rounded-xl p-6">
      <LoaderOverlay3D open={detecting || saving} variant="generic" title={detecting ? "Detecting server layout..." : "Saving paths..."} />
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-mono text-muted">
          System Paths <span className="text-accent normal-case">(for the active VPS)</span>
        </h2>
        <button
          onClick={autoDetect}
          disabled={detecting}
          className="px-3 py-1.5 text-xs font-mono border border-accent/30 text-accent rounded-lg hover:bg-accent/10 transition-colors disabled:opacity-50"
        >
          Auto-detect from active VPS
        </button>
      </div>
      <p className="text-[11px] text-muted/70 mb-6 leading-relaxed max-w-2xl">
        These paths describe the filesystem layout of the <strong>currently active</strong> server. Each VPS keeps its
        own set, so a second server with a different layout can be adapted independently.
      </p>

      <form onSubmit={handleSave} className="space-y-4 max-w-2xl">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {fields.map((f) => (
            <div key={f.key}>
              <label className="block text-xs font-mono text-muted mb-1">{f.label}</label>
              <p className="text-[10px] text-muted/60 mb-1.5 leading-relaxed">{f.desc}</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={config?.[f.key] || ""}
                  onChange={(e) => setConfig((prev) => (prev ? { ...prev, [f.key]: e.target.value } : prev))}
                  placeholder={f.placeholder}
                  className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent transition-colors font-mono"
                />
                <button
                  type="button"
                  onClick={() => openPicker(f.key, config?.[f.key] || "")}
                  className="shrink-0 px-2.5 py-2 border border-border rounded-lg hover:border-accent hover:text-accent transition-colors"
                  title="Browse VPS filesystem"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>

        {warnings.length > 0 && (
          <div className="p-3 rounded-lg text-sm bg-warning/10 border border-warning/30 text-warning">
            <div className="font-medium mb-1">Warnings</div>
            <ul className="list-disc pl-4 space-y-0.5">
              {warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        )}

        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 text-xs font-mono bg-accent/10 border border-accent/30 text-accent rounded-lg hover:bg-accent/20 transition-colors disabled:opacity-50"
        >
          Save Paths
        </button>
        {result && (
          <div
            className={`p-3 rounded-lg text-sm ${
              result.success
                ? "bg-success/10 border border-success/30 text-success"
                : "bg-error/10 border border-error/30 text-error"
            }`}
          >
            {result.message}
          </div>
        )}
      </form>
      <VpsFilePicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={onPickerSelect}
        initialPath={pickerPath}
      />
    </div>
  );
}

interface ProviderState {
  configured: boolean;
  hasEnvKey: boolean;
}
interface AiConfigStatus {
  provider: "openai" | "anthropic";
  model: string;
  envModel?: string;
  openai: ProviderState;
  anthropic: ProviderState;
}

function AIConfigTab() {
  const [status, setStatus] = useState<AiConfigStatus | null>(null);
  const [provider, setProvider] = useState<"openai" | "anthropic">("openai");
  const [model, setModel] = useState("");
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  function applyStatus(data: AiConfigStatus | null) {
    if (!data) return;
    setStatus(data);
    if (data.provider) setProvider(data.provider);
    if (data.model) setModel(data.model);
  }

  useEffect(() => {
    fetch("/api/ai/config")
      .then((r) => (r.ok ? r.json() : null))
      .then(applyStatus)
      .catch(() => {});
  }, []);

  async function persist(payload: Record<string, unknown>, successMsg: string) {
    setSaving(true);
    setResult(null);
    try {
      const res = await fetch("/api/ai/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok) {
        applyStatus(data);
        setResult({ success: true, message: successMsg });
        return true;
      }
      setResult({ success: false, message: data.error || "Failed to save" });
    } catch {
      setResult({ success: false, message: "Network error" });
    } finally {
      setSaving(false);
    }
    return false;
  }

  async function selectProvider(p: "openai" | "anthropic") {
    setProvider(p);
    setKey("");
    await persist({ provider: p }, `Switched to ${p === "anthropic" ? "Anthropic" : "OpenAI"}`);
  }

  async function saveModel() {
    await persist({ model }, "Model saved");
  }

  async function handleSaveKey(e: React.FormEvent) {
    e.preventDefault();
    const field = provider === "anthropic" ? "anthropicApiKey" : "openaiApiKey";
    const ok = await persist({ provider, model, [field]: key || undefined }, key ? "API key saved" : "API key cleared");
    if (ok) setKey("");
  }

  const isAnthropic = provider === "anthropic";
  const active = isAnthropic ? status?.anthropic : status?.openai;
  const envVar = isAnthropic ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
  const placeholder = isAnthropic ? "sk-ant-api03-your-key-here" : "sk-your-openai-key-here";
  const providerLabel = isAnthropic ? "Anthropic (Claude)" : "OpenAI";

  return (
    <div className="bg-card border border-border rounded-xl p-6">
      <LoaderOverlay3D open={saving} variant="generic" title="Saving AI configuration..." />
      <h2 className="text-sm font-mono text-muted mb-2">AI Configuration</h2>
      <p className="text-[11px] text-muted/60 mb-6 leading-relaxed">
        Choose the model provider that powers the GroundControl AI assistant and configure its API key. Keys are
        encrypted at rest server-side. A matching environment variable ({envVar}) takes priority.
      </p>

      {/* Provider selector */}
      <div className="mb-5">
        <label className="block text-xs font-mono text-muted mb-1.5">Provider</label>
        <div className="flex gap-3">
          {(["openai", "anthropic"] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => selectProvider(p)}
              disabled={saving}
              className={`px-4 py-2 text-xs font-mono border rounded-lg transition-colors disabled:opacity-50 ${
                provider === p
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-border hover:border-border-hover"
              }`}
            >
              {p === "anthropic" ? "Anthropic (Claude)" : "OpenAI"}
            </button>
          ))}
        </div>
      </div>

      {/* Model selector */}
      <div className="mb-5">
        <label className="block text-xs font-mono text-muted mb-1.5">Model</label>
        <div className="flex gap-2 max-w-md">
          <input
            type="text"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder={isAnthropic ? "claude-3-5-sonnet-latest" : "gpt-4o-mini"}
            className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent transition-colors font-mono"
          />
          <button
            onClick={saveModel}
            disabled={saving || !model}
            className="px-4 py-2 text-xs font-mono bg-accent/10 border border-accent/30 text-accent rounded-lg hover:bg-accent/20 transition-colors disabled:opacity-50"
          >
            Save Model
          </button>
        </div>
        {status?.envModel && (
          <p className="text-[10px] text-muted/60 mt-1.5">
            Env override active: {status.envModel} (clear env var to use file model)
          </p>
        )}
      </div>

      <div className="flex items-center gap-2 mb-4">
        <div className={`w-2 h-2 rounded-full ${active?.configured || active?.hasEnvKey ? "bg-success" : "bg-error"}`} />
        <span className="text-xs font-mono">
          {active?.hasEnvKey
            ? `Using env var ${envVar}`
            : active?.configured
              ? `${providerLabel} key configured`
              : `No ${providerLabel} key configured`}
        </span>
      </div>

      <form onSubmit={handleSaveKey} className="space-y-3 max-w-md">
        <div>
          <label className="block text-xs font-mono text-muted mb-1">{providerLabel} API Key</label>
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={placeholder}
            className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent transition-colors font-mono"
          />
          <p className="text-[10px] text-muted/60 mt-1">Leave empty and save to clear the stored key.</p>
        </div>
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 text-xs font-mono bg-accent/10 border border-accent/30 text-accent rounded-lg hover:bg-accent/20 transition-colors disabled:opacity-50"
        >
          Save API Key
        </button>
        {result && (
          <div
            className={`p-3 rounded-lg text-sm ${
              result.success
                ? "bg-success/10 border border-success/30 text-success"
                : "bg-error/10 border border-error/30 text-error"
            }`}
          >
            {result.message}
          </div>
        )}
      </form>
    </div>
  );
}

function SecurityTab() {
  return (
    <div className="space-y-8">
      <ChangePasswordSection />
      <AuditLogSection />
      <BackupRestoreSection />
      <UserManagementSection />
    </div>
  );
}

function BackupRestoreSection() {
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const [backingUp, setBackingUp] = useState(false);

  async function handleBackup() {
    setBackingUp(true);
    try {
      const res = await fetch("/api/backup");
      if (!res.ok) throw new Error("Backup failed");
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `groundcontrol-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.db`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setResult({ success: false, message: err instanceof Error ? err.message : "Backup failed" });
    } finally {
      setBackingUp(false);
    }
  }

  async function handleRestore(e: React.FormEvent) {
    e.preventDefault();
    if (!restoreFile) return;
    setLoading(true);
    setResult(null);
    try {
      const formData = new FormData();
      formData.append("file", restoreFile);
      const res = await fetch("/api/backup", { method: "POST", body: formData });
      const data = await res.json();
      if (res.ok) {
        setResult({ success: true, message: "Database restored. Refresh the page." });
        setRestoreFile(null);
      } else {
        setResult({ success: false, message: data.error || "Restore failed" });
      }
    } catch {
      setResult({ success: false, message: "Network error" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-card border border-border rounded-xl p-6">
      <LoaderOverlay3D open={loading || backingUp} variant="generic" title={backingUp ? "Creating backup..." : "Restoring database..."} />
      <h2 className="text-sm font-mono text-muted mb-6">Database Backup & Restore</h2>
      <div className="space-y-4 max-w-md">
        <button
          onClick={handleBackup}
          disabled={backingUp}
          className="px-4 py-2 text-xs font-mono bg-accent/10 border border-accent/30 text-accent rounded-lg hover:bg-accent/20 transition-colors disabled:opacity-50"
        >
          Download Backup
        </button>
        <form onSubmit={handleRestore} className="space-y-3">
          <div>
            <label className="block text-xs font-mono text-muted mb-1.5">Restore from file</label>
            <input
              type="file"
              accept=".db"
              onChange={(e) => setRestoreFile(e.target.files?.[0] || null)}
              className="w-full text-xs file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border file:border-border file:bg-background file:text-foreground hover:file:border-accent"
            />
          </div>
          <button
            type="submit"
            disabled={!restoreFile || loading}
            className="px-4 py-2 text-xs font-mono bg-error/10 border border-error/30 text-error rounded-lg hover:bg-error/20 transition-colors disabled:opacity-50"
          >
            Restore Database
          </button>
          {result && (
            <div
              className={`p-3 rounded-lg text-sm ${
                result.success
                  ? "bg-success/10 border border-success/30 text-success"
                  : "bg-error/10 border border-error/30 text-error"
              }`}
            >
              {result.message}
            </div>
          )}
        </form>
      </div>
    </div>
  );
}

function UserManagementSection() {
  const [user, setUser] = useState<{ username: string; role: string } | null>(null);
  const [users, setUsers] = useState<{ id: number; username: string; role: string; createdAt: string }[]>([]);
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const [deleteUserTarget, setDeleteUserTarget] = useState<{ id: number; username: string } | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setUser(data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (user?.role !== "admin") return;
    fetch("/api/auth/users")
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setUsers(data))
      .catch(() => setUsers([]));
  }, [user]);

  async function fetchUsers() {
    try {
      const res = await fetch("/api/auth/users");
      if (res.ok) setUsers(await res.json());
    } catch {
      setUsers([]);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setResult(null);
    if (!newUsername || !newPassword) {
      setResult({ success: false, message: "Username and password required" });
      return;
    }
    if (newPassword.length < 8) {
      setResult({ success: false, message: "Password must be at least 8 characters" });
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: newUsername, password: newPassword }),
      });
      const data = await res.json();
      if (res.ok) {
        setResult({ success: true, message: `User ${data.username} created` });
        setNewUsername("");
        setNewPassword("");
        fetchUsers();
      } else {
        setResult({ success: false, message: data.error || "Failed to create user" });
      }
    } catch {
      setResult({ success: false, message: "Network error" });
    } finally {
      setLoading(false);
    }
  }

  async function doDeleteUser() {
    if (!deleteUserTarget) return;
    setDeleteLoading(true);
    try {
      const res = await fetch(`/api/auth/users?id=${deleteUserTarget.id}`, { method: "DELETE" });
      if (res.ok) fetchUsers();
    } catch {
      // ignore
    } finally {
      setDeleteLoading(false);
    }
    setDeleteUserTarget(null);
  }

  if (!user || user.role !== "admin") return null;

  return (
    <div className="bg-card border border-border rounded-xl p-6">
      <LoaderOverlay3D open={loading || deleteLoading} variant="generic" title={deleteLoading ? "Deleting user..." : "Creating user..."} />
      <h2 className="text-sm font-mono text-muted mb-6">User Management</h2>
      <form onSubmit={handleCreate} className="space-y-4 max-w-md mb-6">
        <div className="grid grid-cols-2 gap-4">
          <input
            type="text"
            placeholder="Username"
            value={newUsername}
            onChange={(e) => setNewUsername(e.target.value)}
            className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent transition-colors"
          />
          <SensitiveInput
            label=""
            value={newPassword}
            onChange={setNewPassword}
            type="password"
            placeholder="Password (min 8)"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="px-4 py-2 text-xs font-mono bg-accent/10 border border-accent/30 text-accent rounded-lg hover:bg-accent/20 transition-colors disabled:opacity-50"
        >
          Create User
        </button>
        {result && (
          <div
            className={`p-3 rounded-lg text-sm ${
              result.success
                ? "bg-success/10 border border-success/30 text-success"
                : "bg-error/10 border border-error/30 text-error"
            }`}
          >
            {result.message}
          </div>
        )}
      </form>

      <div className="space-y-2">
        {users.map((u) => (
          <div key={u.id} className="flex items-center justify-between py-2 px-3 bg-background/50 rounded-lg">
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium">{u.username}</span>
              <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-border text-muted">{u.role}</span>
            </div>
            {u.username !== user.username && (
              <button
                onClick={() => setDeleteUserTarget(u)}
                className="text-xs font-mono text-error/70 hover:text-error transition-colors"
              >
                delete
              </button>
            )}
          </div>
        ))}
      </div>

      <ConfirmDelete
        open={!!deleteUserTarget}
        resourceName={deleteUserTarget?.username || ""}
        resourceType="User"
        onConfirm={doDeleteUser}
        onCancel={() => setDeleteUserTarget(null)}
      />
    </div>
  );
}

interface AuditLog {
  id: number;
  userId: number;
  action: string;
  ip: string;
  userAgent: string;
  metadata: string;
  createdAt: string;
  user: { username: string };
}

const ACTION_LABELS: Record<string, string> = {
  login: "Signed in",
  logout: "Signed out",
  password_change: "Changed password",
  login_failed: "Failed sign-in",
  account_created: "Account created",
};

const ACTION_COLORS: Record<string, string> = {
  login: "bg-success/15 text-success border-success/30",
  logout: "bg-muted/40 text-muted border-border",
  password_change: "bg-accent/15 text-accent border-accent/30",
  login_failed: "bg-error/15 text-error border-error/30",
  account_created: "bg-info/15 text-info border-info/30",
};

function AuditLogSection() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");

  useEffect(() => {
    const url = filter === "all" ? "/api/audit-logs" : `/api/audit-logs?action=${filter}`;
    fetch(url)
      .then((res) => (res.ok ? res.json() : { logs: [] }))
      .then((data) => setLogs(data.logs || []))
      .catch(() => setLogs([]))
      .finally(() => setLoading(false));
  }, [filter]);

  return (
    <div className="bg-card border border-border rounded-xl p-6">
      <LoaderOverlay3D open={loading} variant="generic" title="Loading audit log..." />
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-mono text-muted">Authentication Audit Log</h2>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="bg-background border border-border rounded-lg px-2.5 py-1.5 text-xs font-mono outline-none focus:border-accent"
        >
          <option value="all">All events</option>
          <option value="login">Sign-ins</option>
          <option value="logout">Sign-outs</option>
          <option value="password_change">Password changes</option>
          <option value="login_failed">Failed sign-ins</option>
        </select>
      </div>
      <p className="text-[11px] text-muted/70 mb-4 leading-relaxed">
        Recent login, logout, and password-change events for this GroundControl instance.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <th className="py-2 pr-4 text-[11px] font-mono uppercase text-muted">Time</th>
              <th className="py-2 pr-4 text-[11px] font-mono uppercase text-muted">User</th>
              <th className="py-2 pr-4 text-[11px] font-mono uppercase text-muted">Event</th>
              <th className="py-2 pr-4 text-[11px] font-mono uppercase text-muted">IP</th>
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-8 text-center text-xs text-muted">
                  No audit events found.
                </td>
              </tr>
            ) : (
              logs.map((log) => (
                <tr key={log.id} className="border-b border-border/50 last:border-0">
                  <td className="py-3 pr-4 text-xs font-mono text-muted whitespace-nowrap">
                    {new Date(log.createdAt).toLocaleString()}
                  </td>
                  <td className="py-3 pr-4 text-xs font-medium">{log.user?.username || "unknown"}</td>
                  <td className="py-3 pr-4">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-md border text-[10px] font-mono uppercase ${
                        ACTION_COLORS[log.action] || ACTION_COLORS.login
                      }`}
                    >
                      {ACTION_LABELS[log.action] || log.action}
                    </span>
                  </td>
                  <td className="py-3 pr-4 text-xs font-mono text-muted">{log.ip || "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ChangePasswordSection() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  async function handleChange(e: React.FormEvent) {
    e.preventDefault();
    setResult(null);
    if (newPassword !== confirmPassword) {
      setResult({ success: false, message: "New passwords do not match" });
      return;
    }
    if (newPassword.length < 8) {
      setResult({ success: false, message: "Password must be at least 8 characters" });
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (res.ok) {
        setResult({ success: true, message: "Password updated successfully" });
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
      } else {
        setResult({ success: false, message: data.error || "Failed to update password" });
      }
    } catch {
      setResult({ success: false, message: "Network error" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-card border border-border rounded-xl p-6">
      <LoaderOverlay3D open={loading} variant="generic" title="Updating password..." />
      <h2 className="text-sm font-mono text-muted mb-6">Change Password</h2>
      <form onSubmit={handleChange} className="space-y-4 max-w-md">
        <SensitiveInput
          label="Current Password"
          value={currentPassword}
          onChange={setCurrentPassword}
          type="password"
        />
        <SensitiveInput label="New Password" value={newPassword} onChange={setNewPassword} type="password" />
        <SensitiveInput
          label="Confirm New Password"
          value={confirmPassword}
          onChange={setConfirmPassword}
          type="password"
        />
        <button
          type="submit"
          disabled={loading}
          className="px-4 py-2 text-xs font-mono bg-accent/10 border border-accent/30 text-accent rounded-lg hover:bg-accent/20 transition-colors disabled:opacity-50"
        >
          Update Password
        </button>
        {result && (
          <div
            className={`p-3 rounded-lg text-sm ${
              result.success
                ? "bg-success/10 border border-success/30 text-success"
                : "bg-error/10 border border-error/30 text-error"
            }`}
          >
            {result.message}
          </div>
        )}
      </form>
    </div>
  );
}
