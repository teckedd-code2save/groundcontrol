"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SensitiveInput } from "@/components/SensitiveField";

type Step = 1 | 2 | 3 | 4 | 5;
type Mode = "local" | "remote";

interface ServerLayout {
  osFamily: string;
  osName: string;
  osVersion: string;
  dockerAvailable: boolean;
  composeCommand: string;
  projectRoot: string;
  caddySitesDir: string;
  caddyFile: string;
  nginxSitesDir: string;
  staticRoot: string;
  sshDefaultCwd: string;
}

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [mode, setMode] = useState<Mode>("remote");
  const [form, setForm] = useState({
    name: "primary",
    host: "",
    port: 22,
    username: "root",
    authType: "key",
    privateKey: "",
    password: "",
  });
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [layout, setLayout] = useState<ServerLayout | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [availableKeys, setAvailableKeys] = useState<{ path: string; content: string }[]>([]);
  const [runtime, setRuntime] = useState<{ containerized: boolean; gatewayIp: string | null; sshPortOpen: boolean } | null>(null);

  useEffect(() => {
    fetch("/api/onboarding/ssh-keys")
      .then((r) => (r.ok ? r.json() : { keys: [] }))
      .then((data) => setAvailableKeys(data.keys || []))
      .catch(() => {});

    fetch("/api/onboarding/detect-host")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setRuntime(data))
      .catch(() => {});
  }, []);

  function canProceedToTest() {
    if (mode === "local") return true;
    return form.host && form.username && (form.authType === "key" ? form.privateKey : form.password);
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    setError("");
    try {
      const res = await fetch("/api/vps/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          isLocal: mode === "local",
        }),
      });
      const data = (await res.json()) as { success: boolean; message: string };
      setTestResult(data);
      if (data.success) setStep(4);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Connection test failed");
    } finally {
      setTesting(false);
    }
  }

  async function handleDetect() {
    setDetecting(true);
    setError("");
    try {
      const res = await fetch("/api/onboarding/detect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          isLocal: mode === "local",
        }),
      });
      const data = (await res.json()) as ServerLayout & { error?: string };
      if (!res.ok) throw new Error(data.error || "Detection failed");
      setLayout(data);
      setStep(5);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Detection failed");
    } finally {
      setDetecting(false);
    }
  }

  async function handleSave() {
    if (!layout) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/onboarding/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vps: { ...form, isLocal: mode === "local" },
          layout,
        }),
      });
      const data = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !data.success) throw new Error(data.error || "Failed to save");
      router.push("/dashboard");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save");
      setSaving(false);
    }
  }

  async function finishSetup(vps: {
    name: string;
    host: string;
    port: number;
    username: string;
    authType: string;
    privateKey: string;
    password: string;
    isLocal: boolean;
  }) {
    setTesting(true);
    setTestResult(null);
    setError("");
    try {
      const testRes = await fetch("/api/vps/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(vps),
      });
      const testData = (await testRes.json()) as { success: boolean; message: string };
      setTestResult(testData);
      if (!testData.success) {
        setError(testData.message);
        return;
      }

      const detectRes = await fetch("/api/onboarding/detect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(vps),
      });
      const detectData = (await detectRes.json()) as ServerLayout & { error?: string };
      if (!detectRes.ok) throw new Error(detectData.error || "Detection failed");
      setLayout(detectData);

      const saveRes = await fetch("/api/onboarding/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vps, layout: detectData }),
      });
      const saveData = (await saveRes.json()) as { success?: boolean; error?: string };
      if (!saveRes.ok || !saveData.success) throw new Error(saveData.error || "Failed to save");
      router.push("/dashboard");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Setup failed");
    } finally {
      setTesting(false);
    }
  }

  async function handleUseThisServer() {
    await finishSetup({
      name: form.name || "primary",
      host: "local",
      port: 22,
      username: "root",
      authType: "key",
      privateKey: "",
      password: "",
      isLocal: true,
    });
  }

  function handleUseHostAsVps() {
    if (!runtime?.gatewayIp) return;
    setMode("remote");
    setForm((f) => ({ ...f, host: runtime.gatewayIp as string }));
    setStep(2);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-2xl bg-card border border-border rounded-2xl p-8 shadow-xl">
        <div className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight">Welcome to GroundControl</h1>
          <p className="text-muted mt-1">Add your first server to get started.</p>
        </div>

        {/* Progress */}
        <div className="flex items-center gap-2 mb-8">
          {[1, 2, 3, 4, 5].map((s) => (
            <div
              key={s}
              className={`h-1.5 flex-1 rounded-full transition-colors ${
                s <= step ? "bg-accent" : "bg-border"
              }`}
            />
          ))}
        </div>

        {error && (
          <div className="mb-6 p-4 bg-error/10 border border-error/30 rounded-lg text-error text-sm">
            {error}
          </div>
        )}

        {step === 1 && (
          <div className="space-y-6">
            <h2 className="text-lg font-medium">Step 1: Choose server mode</h2>

            {runtime && (
              <div className="p-5 rounded-xl border border-accent/30 bg-accent/5">
                <div className="font-medium mb-1">
                  {runtime.containerized
                    ? "GroundControl is running inside Docker"
                    : "GroundControl is running on this server"}
                </div>
                <div className="text-xs text-muted mb-3">
                  {runtime.containerized
                    ? `GroundControl is containerized, so host-level commands need access to the Docker host. Detected gateway ${runtime.gatewayIp || "unknown"}. Provide SSH credentials for the host to use it as your active VPS.`
                    : "Use this server as your active VPS — no SSH credentials needed."}
                </div>
                {runtime.containerized ? (
                  <div className="space-y-2">
                    {runtime.sshPortOpen ? (
                      <div className="text-xs text-success">SSH port appears open on {runtime.gatewayIp}.</div>
                    ) : (
                      <div className="text-xs text-warning">Could not confirm SSH port is open on {runtime.gatewayIp}.</div>
                    )}
                    <button
                      onClick={handleUseHostAsVps}
                      disabled={!runtime.gatewayIp}
                      className="px-5 py-2 text-xs font-mono bg-accent/10 border border-accent/30 text-accent rounded-lg hover:bg-accent/20 transition-colors disabled:opacity-50"
                    >
                      Use host as my active VPS
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={handleUseThisServer}
                    disabled={testing}
                    className="px-5 py-2 text-xs font-mono bg-accent/10 border border-accent/30 text-accent rounded-lg hover:bg-accent/20 transition-colors disabled:opacity-50"
                  >
                    {testing ? "Setting up..." : "Use this server as my active VPS"}
                  </button>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <button
                onClick={() => setMode("local")}
                className={`p-5 rounded-xl border text-left transition-colors ${
                  mode === "local"
                    ? "border-accent bg-accent/10"
                    : "border-border hover:border-accent/50"
                }`}
              >
                <div className="font-medium mb-1">This server</div>
                <div className="text-xs text-muted">GroundControl runs on the VPS it manages. Commands execute locally.</div>
              </button>
              <button
                onClick={() => setMode("remote")}
                className={`p-5 rounded-xl border text-left transition-colors ${
                  mode === "remote"
                    ? "border-accent bg-accent/10"
                    : "border-border hover:border-accent/50"
                }`}
              >
                <div className="font-medium mb-1">Remote server</div>
                <div className="text-xs text-muted">Connect to another VPS over SSH with a key or password.</div>
              </button>
            </div>
            <div className="flex justify-end">
              <button
                onClick={() => setStep(2)}
                className="px-5 py-2 text-xs font-mono bg-accent/10 border border-accent/30 text-accent rounded-lg hover:bg-accent/20 transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-6">
            <h2 className="text-lg font-medium">Step 2: Server connection</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-mono text-muted mb-1.5">Name</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent transition-colors"
                />
              </div>
              {mode === "remote" && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <SensitiveInput
                      label="Host"
                      value={form.host}
                      onChange={(v) => setForm({ ...form, host: v })}
                      type="text"
                    />
                    <SensitiveInput
                      label="Port"
                      value={form.port}
                      onChange={(v) => setForm({ ...form, port: parseInt(v) || 22 })}
                      type="number"
                    />
                  </div>
                  <SensitiveInput
                    label="Username"
                    value={form.username}
                    onChange={(v) => setForm({ ...form, username: v })}
                    type="text"
                  />
                  <div>
                    <label className="block text-xs font-mono text-muted mb-1.5">Auth Type</label>
                    <div className="flex gap-3">
                      {["key", "password"].map((type) => (
                        <button
                          key={type}
                          onClick={() => setForm({ ...form, authType: type })}
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
                    <div>
                      <SensitiveInput
                        label="Private Key"
                        value={form.privateKey}
                        onChange={(v) => setForm({ ...form, privateKey: v })}
                        type="textarea"
                        rows={6}
                        placeholder="-----BEGIN OPENSSH PRIVATE KEY-----..."
                      />
                      {availableKeys.length > 0 && (
                        <div className="mt-2">
                          <span className="text-xs font-mono text-muted">Use scanned key:</span>
                          <div className="flex flex-wrap gap-2 mt-1">
                            {availableKeys.map((k) => (
                              <button
                                key={k.path}
                                onClick={() => setForm({ ...form, privateKey: k.content })}
                                className="px-2 py-1 text-[10px] font-mono border border-border rounded hover:border-accent hover:text-accent transition-colors"
                                title={k.path}
                              >
                                {k.path.split("/").pop() || k.path}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <SensitiveInput
                      label="Password"
                      value={form.password}
                      onChange={(v) => setForm({ ...form, password: v })}
                      type="password"
                    />
                  )}
                </>
              )}
            </div>
            <div className="flex justify-between">
              <button
                onClick={() => setStep(1)}
                className="px-5 py-2 text-xs font-mono border border-border rounded-lg hover:border-accent hover:text-accent transition-colors"
              >
                Back
              </button>
              <button
                onClick={() => setStep(3)}
                disabled={!canProceedToTest()}
                className="px-5 py-2 text-xs font-mono bg-accent/10 border border-accent/30 text-accent rounded-lg hover:bg-accent/20 transition-colors disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-6">
            <h2 className="text-lg font-medium">Step 3: Test connection</h2>
            <div className="bg-background border border-border rounded-xl p-4 text-sm space-y-2">
              <div><span className="text-muted">Name:</span> {form.name}</div>
              <div><span className="text-muted">Mode:</span> {mode === "local" ? "Local exec" : "SSH"}</div>
              {mode === "remote" && (
                <>
                  <div><span className="text-muted">Host:</span> {form.host}:{form.port}</div>
                  <div><span className="text-muted">User:</span> {form.username}</div>
                  <div><span className="text-muted">Auth:</span> {form.authType}</div>
                </>
              )}
            </div>
            <button
              onClick={handleTest}
              disabled={testing}
              className="px-5 py-2 text-xs font-mono bg-accent/10 border border-accent/30 text-accent rounded-lg hover:bg-accent/20 transition-colors disabled:opacity-50"
            >
              {testing ? "Testing..." : "Test Connection"}
            </button>
            {testResult && (
              <div className={`p-3 rounded-lg text-sm ${testResult.success ? "bg-success/10 border border-success/30 text-success" : "bg-error/10 border border-error/30 text-error"}`}>
                {testResult.message}
              </div>
            )}
            <div className="flex justify-between">
              <button
                onClick={() => setStep(2)}
                className="px-5 py-2 text-xs font-mono border border-border rounded-lg hover:border-accent hover:text-accent transition-colors"
              >
                Back
              </button>
              <button
                onClick={() => setStep(4)}
                disabled={!testResult?.success}
                className="px-5 py-2 text-xs font-mono bg-accent/10 border border-accent/30 text-accent rounded-lg hover:bg-accent/20 transition-colors disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-6">
            <h2 className="text-lg font-medium">Step 4: Auto-detect server layout</h2>
            <p className="text-sm text-muted">We&apos;ll probe the server for OS, Docker, compose command, and common paths.</p>
            <button
              onClick={handleDetect}
              disabled={detecting}
              className="px-5 py-2 text-xs font-mono bg-accent/10 border border-accent/30 text-accent rounded-lg hover:bg-accent/20 transition-colors disabled:opacity-50"
            >
              {detecting ? "Detecting..." : "Detect Layout"}
            </button>
            <div className="flex justify-between">
              <button
                onClick={() => setStep(3)}
                className="px-5 py-2 text-xs font-mono border border-border rounded-lg hover:border-accent hover:text-accent transition-colors"
              >
                Back
              </button>
            </div>
          </div>
        )}

        {step === 5 && layout && (
          <div className="space-y-6">
            <h2 className="text-lg font-medium">Step 5: Review detected layout</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {(
                [
                  { key: "osName", label: "OS" },
                  { key: "dockerAvailable", label: "Docker" },
                  { key: "composeCommand", label: "Compose" },
                  { key: "projectRoot", label: "Project Root" },
                  { key: "caddySitesDir", label: "Caddy Sites" },
                  { key: "caddyFile", label: "Caddyfile" },
                  { key: "nginxSitesDir", label: "Nginx Sites" },
                  { key: "staticRoot", label: "Static Root" },
                  { key: "sshDefaultCwd", label: "SSH CWD" },
                ] as { key: keyof ServerLayout; label: string }[]
              ).map((f) => (
                <div key={f.key}>
                  <label className="block text-xs font-mono text-muted mb-1">{f.label}</label>
                  <input
                    type="text"
                    value={String(layout[f.key])}
                    onChange={(e) => setLayout({ ...layout, [f.key]: e.target.value } as ServerLayout)}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent transition-colors font-mono"
                  />
                </div>
              ))}
            </div>
            <div className="flex justify-between">
              <button
                onClick={() => setStep(4)}
                className="px-5 py-2 text-xs font-mono border border-border rounded-lg hover:border-accent hover:text-accent transition-colors"
              >
                Back
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-5 py-2 text-xs font-mono bg-accent text-white rounded-lg hover:bg-accent/90 transition-colors disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save & Go to Dashboard"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
