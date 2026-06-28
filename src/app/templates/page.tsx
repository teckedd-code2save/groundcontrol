"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { TemplateDefinition, TemplateInput } from "@/lib/template-engine";

interface TemplateWithId extends TemplateDefinition {
  _filename: string;
}

export default function TemplatesPage() {
  const router = useRouter();
  const [templates, setTemplates] = useState<TemplateWithId[]>([]);
  const [selected, setSelected] = useState<TemplateWithId | null>(null);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const [step, setStep] = useState<"browse" | "configure" | "preview">("browse");

  useEffect(() => {
    fetch("/api/templates")
      .then(r => r.json())
      .then(d => setTemplates((d.templates || []).map((t: any, i: number) => ({
        ...t,
        _filename: t.name?.toLowerCase().replace(/\s+/g, "-") || `template-${i}`,
      }))))
      .catch(() => {});
  }, []);

  function selectTemplate(t: TemplateWithId) {
    setSelected(t);
    const defaults: Record<string, string> = {};
    (t.inputs || []).forEach(i => {
      if (i.default) defaults[i.name] = i.default;
    });
    setInputs(defaults);
    setStep("configure");
    setPreview(null);
    setResult(null);
  }

  async function handlePreview() {
    if (!selected) return;
    setApplying(true);
    try {
      const params = new URLSearchParams({ name: selected._filename, preview: "true", ...inputs });
      const res = await fetch(`/api/templates?${params}`);
      const data = await res.json();
      if (data.preview) { setPreview(data.preview); setStep("preview"); }
    } catch {}
    finally { setApplying(false); }
  }

  async function handleApply() {
    if (!selected) return;
    setApplying(true);
    try {
      const res = await fetch("/api/templates/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateName: selected._filename, inputs }),
      });
      const data = await res.json();
      if (data.success) {
        setResult({ success: true, message: `Template applied! Files generated in memory. Copy the config below to deploy.` });
        setPreview(data.preview || data.composeYml);
      } else {
        setResult({ success: false, message: data.error || "Failed" });
      }
    } catch (err) {
      setResult({ success: false, message: err instanceof Error ? err.message : "Failed" });
    } finally { setApplying(false); }
  }

  function updateInput(name: string, value: string) {
    setInputs(prev => ({ ...prev, [name]: value }));
  }

  const categoryIcons: Record<string, string> = {
    "web-app": "◉", "static": "◈", "microservices": "◐",
  };

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">Deployment Templates</h1>
        <p className="text-muted mt-1 text-sm">
          Pre-built production stacks. Pick a template, fill in your details, deploy.
        </p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-4 mb-8">
        {["browse", "configure", "preview"].map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-mono ${
              step === s ? "bg-accent text-white" : "bg-card border border-border text-muted"
            }`}>{i + 1}</div>
            <span className={`text-xs font-mono ${step === s ? "text-foreground" : "text-muted"}`}>
              {s === "browse" ? "Choose" : s === "configure" ? "Configure" : "Review"}
            </span>
            {i < 2 && <span className="text-muted">→</span>}
          </div>
        ))}
      </div>

      {/* Step 1: Browse */}
      {step === "browse" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {templates.length === 0 && (
            <p className="text-muted text-sm col-span-2">No templates found. Add .yml files to the templates/ directory.</p>
          )}
          {templates.map(t => (
            <button key={t._filename} onClick={() => selectTemplate(t)}
              className="text-left p-5 bg-card border border-border rounded-xl hover:border-accent hover:bg-accent/5 transition-colors">
              <div className="flex items-start justify-between mb-2">
                <h3 className="font-medium text-sm">{t.name}</h3>
                <span className="text-lg">{categoryIcons[t.category] || "◉"}</span>
              </div>
              <p className="text-xs text-muted leading-relaxed mb-3">{t.description}</p>
              <div className="flex flex-wrap gap-1.5">
                {t.requires?.docker && <span className="text-[9px] px-1.5 py-0.5 rounded bg-accent/10 text-accent border border-accent/20 font-mono">Docker</span>}
                {t.requires?.caddy && <span className="text-[9px] px-1.5 py-0.5 rounded bg-accent/10 text-accent border border-accent/20 font-mono">Caddy</span>}
                {t.requires?.traefik && <span className="text-[9px] px-1.5 py-0.5 rounded bg-accent/10 text-accent border border-accent/20 font-mono">Traefik</span>}
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-muted/10 text-muted border border-muted/20 font-mono">v{t.version}</span>
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-muted/10 text-muted border border-muted/20 font-mono">{t.category}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Step 2: Configure */}
      {step === "configure" && selected && (
        <div className="space-y-6">
          <div className="bg-card border border-border rounded-xl p-5">
            <h2 className="text-sm font-medium mb-1">{selected.name}</h2>
            <p className="text-xs text-muted">{selected.description}</p>
          </div>

          <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="text-xs font-mono uppercase tracking-wider text-muted mb-4">Configuration</h3>
            <div className="space-y-4 max-w-lg">
              {(selected.inputs || []).map(inp => (
                <div key={inp.name}>
                  <label className="block text-xs font-mono text-muted mb-1.5">
                    {inp.prompt || inp.name}
                    {inp.generate && <span className="text-accent ml-1">(auto-generated)</span>}
                  </label>
                  <input
                    type="text"
                    value={inputs[inp.name] || ""}
                    onChange={e => updateInput(inp.name, e.target.value)}
                    placeholder={inp.example || inp.default || ""}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm font-mono outline-none focus:border-accent transition-colors"
                    disabled={inp.generate && !!inputs[inp.name]}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-3">
            <button onClick={() => setStep("browse")} className="px-4 py-2 text-xs font-mono border border-border rounded-lg hover:border-accent transition-colors">
              ← Back
            </button>
            <button onClick={handlePreview} disabled={applying}
              className="px-4 py-2 text-xs font-mono bg-accent/10 border border-accent/30 text-accent rounded-lg hover:bg-accent/20 transition-colors disabled:opacity-50">
              {applying ? "Generating..." : "Preview →"}
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Preview */}
      {step === "preview" && preview && (
        <div className="space-y-6">
          <div className="bg-card border border-accent/30 rounded-xl p-5">
            <h3 className="text-xs font-mono uppercase tracking-wider text-accent mb-3">Generated Configuration</h3>
            <pre className="text-xs font-mono text-foreground/80 whitespace-pre-wrap bg-background rounded-lg p-4 max-h-[60vh] overflow-y-auto">
              {preview}
            </pre>
          </div>

          {result && (
            <div className={`p-3 rounded-lg text-sm ${result.success ? "bg-success/10 border border-success/30 text-success" : "bg-error/10 border border-error/30 text-error"}`}>
              {result.message}
            </div>
          )}

          <div className="flex gap-3">
            <button onClick={() => setStep("configure")} className="px-4 py-2 text-xs font-mono border border-border rounded-lg hover:border-accent transition-colors">
              ← Edit
            </button>
            {!result?.success && (
              <button onClick={handleApply} disabled={applying}
                className="px-4 py-2 text-xs font-mono bg-accent text-white rounded-lg hover:bg-accent/90 transition-colors disabled:opacity-50">
                {applying ? "Deploying..." : "✓ Generate & Deploy"}
              </button>
            )}
            {result?.success && (
              <button onClick={() => router.push("/dashboard")}
                className="px-4 py-2 text-xs font-mono bg-success/10 border border-success/30 text-success rounded-lg hover:bg-success/20 transition-colors">
                Go to Dashboard →
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
