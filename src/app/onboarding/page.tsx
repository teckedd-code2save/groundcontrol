"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { AmbientShader } from "@/components/AmbientShader";

interface Message {
  role: "system" | "user" | "assistant";
  content: string;
  _id?: string;
  questions?: { id: string; question: string; suggestions: string[] }[];
  actions?: { label: string; action: string }[];
}

type WizardStep = "welcome" | "connect" | "domain" | "probing" | "ready";

const WIZARD_STEPS: { id: WizardStep; label: string }[] = [
  { id: "welcome", label: "Welcome" },
  { id: "connect", label: "Connect" },
  { id: "domain", label: "Domain" },
  { id: "probing", label: "Scan" },
  { id: "ready", label: "Ready" },
];

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState<WizardStep>("welcome");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [activeQuestions, setActiveQuestions] = useState<
    { id: string; question: string; suggestions: string[] }[]
  >([]);
  const [chatting, setChatting] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);

  const [serverForm, setServerForm] = useState({
    name: "primary",
    host: "",
    port: 22,
    username: "root",
    authType: "key" as "key" | "password",
    privateKey: "",
    password: "",
    isLocal: false,
  });
  const [connecting, setConnecting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [connectError, setConnectError] = useState("");
  const [testOk, setTestOk] = useState<string | null>(null);
  const [hasVps, setHasVps] = useState<boolean | null>(null);

  const [domainForm, setDomainForm] = useState({
    primaryDomain: "",
    skipDomain: true,
  });

  useEffect(() => {
    fetch("/api/vps")
      .then((r) => (r.ok ? r.json() : []))
      .then((configs: unknown[]) => {
        if (Array.isArray(configs) && configs.length > 0) {
          setHasVps(true);
          setStep("probing");
          runProbe();
        } else {
          setHasVps(false);
          setStep("welcome");
        }
      })
      .catch(() => {
        setHasVps(false);
        setStep("welcome");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [messages]);

  async function testSshConnection(): Promise<boolean> {
    setTesting(true);
    setConnectError("");
    setTestOk(null);
    try {
      const res = await fetch("/api/vps/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          host: serverForm.host,
          port: serverForm.port,
          username: serverForm.username,
          authType: serverForm.authType,
          privateKey: serverForm.privateKey || undefined,
          password: serverForm.password || undefined,
          isLocal: serverForm.isLocal,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setTestOk(data.message || "Connection successful");
        return true;
      }
      setConnectError(data.message || data.error || "Connection test failed");
      return false;
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : "Connection test failed");
      return false;
    } finally {
      setTesting(false);
    }
  }

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault();
    if (!serverForm.isLocal && (!serverForm.host || !serverForm.username)) {
      setConnectError("Host and username are required for remote servers.");
      return;
    }
    if (!serverForm.isLocal && serverForm.authType === "key" && !serverForm.privateKey.trim()) {
      setConnectError("Paste an SSH private key, or switch to password auth.");
      return;
    }
    if (!serverForm.isLocal && serverForm.authType === "password" && !serverForm.password) {
      setConnectError("Password is required.");
      return;
    }

    setConnecting(true);
    setConnectError("");
    try {
      // Always test before save (remote)
      if (!serverForm.isLocal) {
        const ok = await testSshConnection();
        if (!ok) {
          setConnecting(false);
          return;
        }
      }

      const res = await fetch("/api/vps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(serverForm),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Failed to save server");
      }
      const configs = await fetch("/api/vps").then((r) => r.json());
      if (configs.length > 0) {
        await fetch("/api/vps/activate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: configs[0].id }),
        });
      }
      setStep("domain");
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : "Connection failed");
    } finally {
      setConnecting(false);
    }
  }

  async function finishDomainAndProbe() {
    // Persist optional cert domain into system config after probe via answers
    if (domainForm.primaryDomain.trim()) {
      setAnswers((prev) => ({ ...prev, certDomain: domainForm.primaryDomain.trim() }));
    }
    setStep("probing");
    await runProbe();
  }

  async function runProbe() {
    setStep("probing");
    try {
      const res = await fetch("/api/onboarding/probe");
      if (!res.ok) throw new Error("Probe failed");
      const data = await res.json();
      const findings = summarizeFindings(data);
      setMessages([
        {
          role: "system",
          content: findings,
          questions: data.questions || [],
          actions: generateFollowUpActions(data),
        },
      ]);
      setActiveQuestions(data.questions || []);
      setStep("ready");
    } catch {
      setMessages([
        {
          role: "system",
          content:
            "I couldn't probe your server. Is the VPS reachable? Check your connection details.",
          actions: [{ label: "Try a different server", action: "reconnect" }],
        },
      ]);
      setStep("ready");
    }
  }

  function summarizeFindings(data: {
    layout?: {
      osName?: string;
      osFamily?: string;
      dockerAvailable?: boolean;
    };
    reverseProxy?: { type?: string; configPaths?: string[] };
    containers?: { composeProject?: string }[];
    projects?: { path: string }[];
    questions?: unknown[];
  }): string {
    const l = data.layout;
    const p = data.reverseProxy;
    const c = data.containers || [];
    const pr = data.projects || [];
    if (!l) return "Connected. Running system probe...";
    const lines = [
      "I've scanned your server. Here's what I found:\n",
      `**OS:** ${l.osName || "unknown"} (${l.osFamily})`,
      `**Docker:** ${l.dockerAvailable ? "✓ running" : "✗ not installed — install from Services → Install"}`,
      `**Containers:** ${c.length} found\n`,
    ];
    if (c.length > 0) {
      const manual = c.filter((x) => !x.composeProject).length;
      if (manual > 0) lines.push(`${manual} container(s) not managed by Compose.\n`);
    }
    if (p?.type && p.type !== "none") {
      lines.push(
        `**Reverse Proxy:** ${p.type}${p.configPaths?.length ? " at " + p.configPaths[0] : ""}`
      );
    } else {
      lines.push("**Reverse Proxy:** None detected — templates can install Caddy/Nginx as needed");
    }
    if (pr.length > 0) {
      const names = pr
        .map((x) => x.path.split("/").pop())
        .slice(0, 4)
        .join(", ");
      lines.push(
        `**Deployments:** ${pr.length} found (${names}${pr.length > 4 ? "..." : ""})`
      );
    }
    lines.push(
      data.questions?.length
        ? "\nLet me confirm a few things:"
        : "\nYou're ready. Open Templates to deploy, or the dashboard to monitor."
    );
    return lines.join("\n");
  }

  function generateFollowUpActions(data: {
    layout?: { dockerAvailable?: boolean };
    reverseProxy?: { type?: string };
  }): { label: string; action: string }[] {
    const a: { label: string; action: string }[] = [];
    if (data.layout && !data.layout.dockerAvailable) {
      a.push({ label: "Install Docker", action: "install-docker" });
    }
    if (data.reverseProxy?.type === "none") {
      a.push({ label: "Set up Caddy reverse proxy", action: "install-caddy" });
    }
    a.push({ label: "Deploy a template", action: "goto-templates" });
    a.push({ label: "Open dashboard", action: "goto-dashboard" });
    return a;
  }

  function handleSendText() {
    if (!input.trim() || chatting) return;
    const text = input.trim();
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setInput("");
    if (activeQuestions.length > 0) {
      const cur = activeQuestions[0];
      setAnswers((prev) => ({ ...prev, [cur.id]: text }));
      const remaining = activeQuestions.filter((q) => q.id !== cur.id);
      setActiveQuestions(remaining);
      if (remaining.length > 0) {
        setMessages((prev) => [
          ...prev,
          {
            role: "system",
            content: `Thanks! Next: ${remaining[0].question}`,
            questions: remaining,
          },
        ]);
      } else {
        allQuestionsDone();
      }
      return;
    }
    streamAiResponse(text);
  }

  function handleSuggestionClick(s: string, qid: string) {
    setAnswers((prev) => ({ ...prev, [qid]: s }));
    setMessages((prev) => [...prev, { role: "user", content: s }]);
    const remaining = activeQuestions.filter((q) => q.id !== qid);
    setActiveQuestions(remaining);
    if (remaining.length > 0) {
      setMessages((prev) => [
        ...prev,
        {
          role: "system",
          content: `Thanks! Next: ${remaining[0].question}`,
          questions: remaining,
        },
      ]);
    } else {
      allQuestionsDone();
    }
  }

  function handleActionClick(action: string) {
    if (action === "goto-dashboard") router.push("/dashboard");
    else if (action === "goto-templates") router.push("/templates");
    else if (action === "reconnect") {
      setStep("connect");
      setMessages([]);
      setTestOk(null);
    } else streamAiResponse(action.replace(/-/g, " "));
  }

  function allQuestionsDone() {
    setMessages((prev) => [
      ...prev,
      {
        role: "system",
        content:
          "All clear! Deploy a template, open the dashboard, or ask me to install tooling. Click Finish when you're ready.",
        actions: [
          { label: "Deploy a template", action: "goto-templates" },
          { label: "Open dashboard", action: "goto-dashboard" },
        ],
      },
    ]);
  }

  async function streamAiResponse(prompt: string) {
    setChatting(true);
    let content = "";
    const sid = Date.now().toString();
    setMessages((prev) => [...prev, { role: "assistant", content: "", _id: sid }]);
    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: prompt }),
      });
      if (!res.ok) throw new Error("Chat failed — configure AI in Settings if needed");
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No stream");
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const d = JSON.parse(line);
            if ((d.type === "content" || d.type === "text") && (d.content || d.delta)) {
              content += d.content || d.delta || "";
              setMessages((prev) => {
                const idx = prev.findIndex((m) => m._id === sid);
                if (idx >= 0) {
                  const u = [...prev];
                  u[idx] = { ...u[idx], content };
                  return u;
                }
                return prev;
              });
            }
          } catch {
            /* ignore */
          }
        }
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev.filter((m) => m._id !== sid),
        {
          role: "assistant",
          content: `Sorry: ${err instanceof Error ? err.message : ""}`,
        },
      ]);
    } finally {
      setChatting(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      // VPS is already saved + activated in the Connect step.
      // Persist optional cert domain into active system config.
      const certDomain = domainForm.primaryDomain.trim() || answers.certDomain || "";
      if (certDomain) {
        try {
          await fetch("/api/system-config", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ certDomain }),
          });
        } catch {
          /* optional — don't block finish */
        }
      }
      router.push("/dashboard");
    } catch {
      setSaving(false);
    }
  }

  function onKeyFile(file: File | null) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setServerForm((f) => ({
        ...f,
        privateKey: String(reader.result || ""),
        authType: "key",
      }));
    };
    reader.readAsText(file);
  }

  const stepIndex = WIZARD_STEPS.findIndex((s) => s.id === step);

  function WizardChrome({ children }: { children: React.ReactNode }) {
    return (
      <div className="relative min-h-screen overflow-hidden bg-background">
        <AmbientShader forceCss className="opacity-60" />
        <div className="relative z-10 mx-auto flex min-h-screen max-w-xl flex-col px-4 py-10 md:py-16">
          <div className="mb-8">
            <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-accent">
              GroundControl setup
            </p>
            <div className="flex flex-wrap gap-2">
              {WIZARD_STEPS.filter((s) => s.id !== "probing" || step === "probing").map((s, i) => {
                const active = s.id === step;
                const done = stepIndex > i || (step === "ready" && s.id !== "ready");
                return (
                  <div
                    key={s.id}
                    className={`rounded-md px-2.5 py-1 text-[10px] font-mono ${
                      active
                        ? "bg-accent text-white"
                        : done
                          ? "bg-accent/15 text-accent"
                          : "bg-card text-muted border border-border"
                    }`}
                  >
                    {s.label}
                  </div>
                );
              })}
            </div>
          </div>
          {children}
        </div>
      </div>
    );
  }

  if (hasVps === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="font-mono text-xs text-muted">Checking setup…</p>
      </div>
    );
  }

  // ── Welcome ──────────────────────────────────────────
  if (step === "welcome" && hasVps === false) {
    return (
      <WizardChrome>
        <h1 className="text-3xl font-semibold tracking-tight">Connect your VPS</h1>
        <p className="mt-2 max-w-md text-sm text-muted leading-relaxed">
          GroundControl runs as a control plane. Point it at a server (this host or remote SSH),
          scan what is already running, then deploy templates with DNS and health checks.
        </p>
        <ul className="mt-6 space-y-2 text-sm text-muted">
          <li className="flex gap-2">
            <span className="text-accent">1.</span> SSH or local host connection
          </li>
          <li className="flex gap-2">
            <span className="text-accent">2.</span> Optional primary domain
          </li>
          <li className="flex gap-2">
            <span className="text-accent">3.</span> Auto-detect Docker, proxy, stacks
          </li>
          <li className="flex gap-2">
            <span className="text-accent">4.</span> Deploy from Templates
          </li>
        </ul>
        <button
          type="button"
          onClick={() => setStep("connect")}
          className="mt-8 w-full rounded-md bg-accent py-3 text-sm font-mono text-white hover:bg-accent-bright"
        >
          Get started →
        </button>
        <p className="mt-4 text-center text-[11px] font-mono text-muted">
          Already installed on the VPS? Choose “This server” on the next step.
        </p>
      </WizardChrome>
    );
  }

  // ── Connect ──────────────────────────────────────────
  if (step === "connect") {
    return (
      <WizardChrome>
        <h1 className="text-2xl font-semibold tracking-tight">Server connection</h1>
        <p className="mt-1 text-xs text-muted">
          We test SSH before saving credentials. Secrets are encrypted at rest.
        </p>

        <form onSubmit={handleConnect} className="mt-6 space-y-4 rounded-lg border border-border bg-card p-5">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setServerForm({ ...serverForm, isLocal: true })}
              className={`flex-1 rounded-md border p-3 text-center text-sm ${
                serverForm.isLocal
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-border hover:border-accent/40"
              }`}
            >
              This server
              <span className="mt-1 block text-[10px] font-mono text-muted">Local / same host</span>
            </button>
            <button
              type="button"
              onClick={() => setServerForm({ ...serverForm, isLocal: false })}
              className={`flex-1 rounded-md border p-3 text-center text-sm ${
                !serverForm.isLocal
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-border hover:border-accent/40"
              }`}
            >
              Remote SSH
              <span className="mt-1 block text-[10px] font-mono text-muted">Any VPS you can reach</span>
            </button>
          </div>

          <div>
            <label className="mb-1 block text-xs font-mono text-muted">Connection name</label>
            <input
              type="text"
              value={serverForm.name}
              onChange={(e) => setServerForm({ ...serverForm, name: e.target.value })}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono outline-none focus:border-accent"
            />
          </div>

          {!serverForm.isLocal && (
            <>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="mb-1 block text-xs font-mono text-muted">Host / IP</label>
                  <input
                    type="text"
                    value={serverForm.host}
                    onChange={(e) => setServerForm({ ...serverForm, host: e.target.value })}
                    placeholder="198.51.100.12 or vps.example.com"
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono outline-none focus:border-accent"
                    required
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-mono text-muted">Port</label>
                  <input
                    type="number"
                    value={serverForm.port}
                    onChange={(e) =>
                      setServerForm({ ...serverForm, port: parseInt(e.target.value, 10) || 22 })
                    }
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono outline-none focus:border-accent"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-mono text-muted">SSH username</label>
                <input
                  type="text"
                  value={serverForm.username}
                  onChange={(e) => setServerForm({ ...serverForm, username: e.target.value })}
                  placeholder="root"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-mono text-muted">Authentication</label>
                <div className="mb-2 flex gap-2">
                  {(["key", "password"] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setServerForm({ ...serverForm, authType: t })}
                      className={`rounded-md border px-3 py-1.5 text-xs font-mono ${
                        serverForm.authType === t
                          ? "border-accent bg-accent/10 text-accent"
                          : "border-border"
                      }`}
                    >
                      {t === "key" ? "Private key" : "Password"}
                    </button>
                  ))}
                </div>
                {serverForm.authType === "key" ? (
                  <div className="space-y-2">
                    <textarea
                      value={serverForm.privateKey}
                      onChange={(e) => setServerForm({ ...serverForm, privateKey: e.target.value })}
                      placeholder="Paste PEM private key…"
                      rows={4}
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-xs font-mono outline-none focus:border-accent"
                    />
                    <label className="inline-flex cursor-pointer items-center gap-2 text-[11px] font-mono text-muted hover:text-accent">
                      <input
                        type="file"
                        accept=".pem,.key,text/*"
                        className="hidden"
                        onChange={(e) => onKeyFile(e.target.files?.[0] || null)}
                      />
                      Or upload key file
                    </label>
                  </div>
                ) : (
                  <input
                    type="password"
                    value={serverForm.password}
                    onChange={(e) => setServerForm({ ...serverForm, password: e.target.value })}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono outline-none focus:border-accent"
                  />
                )}
              </div>
            </>
          )}

          {testOk && (
            <div className="rounded-md border border-success/30 bg-success/10 p-3 text-sm text-success">
              {testOk}
            </div>
          )}
          {connectError && (
            <div className="rounded-md border border-error/30 bg-error/10 p-3 text-sm text-error">
              {connectError}
            </div>
          )}

          <div className="flex flex-col gap-2 sm:flex-row">
            {!serverForm.isLocal && (
              <button
                type="button"
                disabled={testing || connecting}
                onClick={() => testSshConnection()}
                className="rounded-md border border-border px-4 py-3 text-sm font-mono hover:border-accent hover:text-accent disabled:opacity-50"
              >
                {testing ? "Testing…" : "Test connection"}
              </button>
            )}
            <button
              type="submit"
              disabled={connecting || testing}
              className="flex-1 rounded-md bg-accent py-3 text-sm font-mono text-white hover:bg-accent-bright disabled:opacity-50"
            >
              {connecting ? "Saving…" : "Continue →"}
            </button>
          </div>
        </form>
        <button
          type="button"
          onClick={() => setStep("welcome")}
          className="mt-4 text-xs font-mono text-muted hover:text-accent"
        >
          ← Back
        </button>
      </WizardChrome>
    );
  }

  // ── Domain (optional) ────────────────────────────────
  if (step === "domain") {
    return (
      <WizardChrome>
        <h1 className="text-2xl font-semibold tracking-tight">Domain (optional)</h1>
        <p className="mt-1 text-xs text-muted">
          Used as a default for TLS/DNS when deploying templates. You can configure Cloudflare
          fully later in Settings.
        </p>
        <div className="mt-6 space-y-4 rounded-lg border border-border bg-card p-5">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={domainForm.skipDomain}
              onChange={(e) =>
                setDomainForm({ ...domainForm, skipDomain: e.target.checked })
              }
              className="mt-1 accent-accent"
            />
            <span>
              <span className="text-sm">Skip for now</span>
              <span className="mt-0.5 block text-[11px] text-muted">
                Deploy with IPs or add domains per template later
              </span>
            </span>
          </label>
          {!domainForm.skipDomain && (
            <div>
              <label className="mb-1 block text-xs font-mono text-muted">Primary domain</label>
              <input
                type="text"
                value={domainForm.primaryDomain}
                onChange={(e) =>
                  setDomainForm({ ...domainForm, primaryDomain: e.target.value })
                }
                placeholder="app.example.com"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono outline-none focus:border-accent"
              />
              <p className="mt-2 text-[11px] text-muted">
                Point DNS A/CNAME to this VPS after deploy, or use Cloudflare integration in
                Settings → Cloudflare.
              </p>
            </div>
          )}
          <button
            type="button"
            onClick={finishDomainAndProbe}
            className="w-full rounded-md bg-accent py-3 text-sm font-mono text-white hover:bg-accent-bright"
          >
            Scan server →
          </button>
        </div>
        <button
          type="button"
          onClick={() => setStep("connect")}
          className="mt-4 text-xs font-mono text-muted hover:text-accent"
        >
          ← Back
        </button>
      </WizardChrome>
    );
  }

  // ── Probing ──────────────────────────────────────────
  if (step === "probing") {
    return (
      <WizardChrome>
        <div className="flex flex-1 flex-col items-center justify-center py-20 text-center">
          <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-lg border border-accent/30 bg-accent/10">
            <span className="text-2xl text-accent animate-pulse">◉</span>
          </div>
          <h1 className="text-xl font-semibold tracking-tight">Scanning your server</h1>
          <p className="mt-2 max-w-sm text-sm font-mono text-muted">
            OS · Docker · containers · reverse proxy · existing projects
          </p>
        </div>
      </WizardChrome>
    );
  }

  // ── Ready / chat ─────────────────────────────────────
  return (
    <WizardChrome>
      <h1 className="text-2xl font-semibold tracking-tight">You&apos;re almost live</h1>
      <p className="mt-1 text-xs text-muted">
        Review the scan, answer any questions, then open Templates or the dashboard.
      </p>

      <div
        ref={chatRef}
        className="mt-6 max-h-[50vh] min-h-[40vh] flex-1 space-y-4 overflow-y-auto pr-1"
      >
        {messages.map((msg, i) => (
          <div key={i}>
            <div
              className={`rounded-md border p-4 text-sm leading-relaxed ${
                msg.role === "user"
                  ? "ml-6 border-accent/20 bg-accent/5"
                  : "border-border bg-card"
              }`}
            >
              <div className="whitespace-pre-wrap">
                {msg.content || (msg.role === "assistant" && chatting ? "…" : "")}
              </div>
            </div>
            {msg.questions && msg.questions.length > 0 && (
              <div className="mt-3 ml-2 space-y-2">
                {msg.questions.map((q) => (
                  <div key={q.id} className="rounded-md border border-border bg-card/80 p-3">
                    <p className="mb-2 text-sm font-medium">{q.question}</p>
                    <div className="flex flex-wrap gap-2">
                      {q.suggestions.map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => handleSuggestionClick(s, q.id)}
                          className="rounded-md border border-accent/20 bg-accent/10 px-3 py-1.5 text-xs font-mono hover:bg-accent/20"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {msg.actions && msg.actions.length > 0 && (
              <div className="mt-3 ml-2 flex flex-wrap gap-2">
                {msg.actions.map((a) => (
                  <button
                    key={a.action}
                    type="button"
                    onClick={() => handleActionClick(a.action)}
                    className="rounded-md border border-accent/20 bg-accent/10 px-3 py-1.5 text-xs font-mono hover:bg-accent/20"
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSendText()}
          placeholder={
            activeQuestions.length > 0
              ? "Type your answer…"
              : chatting
                ? "AI responding…"
                : "Ask about Docker, proxy, or next steps…"
          }
          className="flex-1 rounded-md border border-border bg-card px-4 py-3 text-sm font-mono outline-none focus:border-accent"
          disabled={chatting}
        />
        <button
          type="button"
          onClick={handleSendText}
          disabled={!input.trim() || chatting}
          className="rounded-md border border-accent/30 bg-accent/10 px-4 py-3 text-sm font-mono text-accent hover:bg-accent/20 disabled:opacity-50"
        >
          Send
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="rounded-md bg-accent px-6 py-3 text-sm font-mono text-white hover:bg-accent-bright disabled:opacity-50 whitespace-nowrap"
        >
          {saving ? "Saving…" : "Finish →"}
        </button>
      </div>
    </WizardChrome>
  );
}
