"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

interface Message {
  role: "system" | "user" | "assistant";
  content: string;
  _id?: string;
  questions?: { id: string; question: string; suggestions: string[] }[];
  actions?: { label: string; action: string }[];
}

export default function OnboardingPage() {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [probing, setProbing] = useState(true);
  const [saving, setSaving] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [activeQuestions, setActiveQuestions] = useState<{ id: string; question: string; suggestions: string[] }[]>([]);
  const [chatting, setChatting] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);

  useEffect(() => { runProbe(); }, []);
  useEffect(() => { if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight; }, [messages]);

  async function runProbe() {
    setProbing(true);
    try {
      const res = await fetch("/api/onboarding/probe");
      if (!res.ok) throw new Error("Probe failed");
      const data = await res.json();
      const findings = summarizeFindings(data);
      setMessages([{ role: "system", content: findings, questions: data.questions || [], actions: generateFollowUpActions(data) }]);
      setActiveQuestions(data.questions || []);
    } catch {
      setMessages([{ role: "system", content: "I couldn't probe your server. Make sure a VPS is connected in Settings → VPS.", actions: [{ label: "Go to Settings → VPS", action: "goto-settings" }] }]);
    } finally { setProbing(false); }
  }

  function summarizeFindings(data: any): string {
    const l = data.layout; const p = data.reverseProxy; const c = data.containers || []; const pr = data.projects || [];
    if (!l) return "Connected. Ready to configure your server.";
    const lines = [
      "I've scanned your server. Here's what I found:\n",
      `**OS:** ${l.osName || "unknown"} (${l.osFamily})`,
      `**Docker:** ${l.dockerAvailable ? "✓ running" : "✗ not installed — I can install it for you"}`,
      `**Containers:** ${c.length} running\n`,
    ];
    if (c.length > 0) {
      const manual = c.filter((x: any) => !x.composeProject).length;
      if (manual > 0) lines.push(`${manual} container(s) are not managed by Docker Compose.\n`);
    }
    if (p.type !== "none") lines.push(`**Reverse Proxy:** ${p.type}${p.configPaths?.length ? " at " + p.configPaths[0] : ""}`);
    else lines.push("**Reverse Proxy:** None detected — I can help set one up");
    if (pr.length > 0) {
      const names = pr.map((x: any) => x.path.split("/").pop()).slice(0, 4).join(", ");
      lines.push(`**Projects:** ${pr.length} found (${names}${pr.length > 4 ? "..." : ""})`);
      const stopped = pr.filter((proj: any) => !c.some((ctr: any) => ctr.composeProject?.toLowerCase() === proj.path.split("/").pop()?.toLowerCase()));
      if (stopped.length > 0) lines.push(`${stopped.length} project(s) have compose files but no running containers.`);
    }
    lines.push(data.questions?.length ? "\nLet me confirm a few things about your setup:" : "\nEverything looks clear! What would you like to do next?");
    return lines.join("\n");
  }

  function generateFollowUpActions(data: any): { label: string; action: string }[] {
    const a: { label: string; action: string }[] = [];
    if (data.layout && !data.layout.dockerAvailable) a.push({ label: "Install Docker", action: "install-docker" });
    if (data.reverseProxy?.type === "none") a.push({ label: "Set up Caddy reverse proxy", action: "install-caddy" });
    if (data.reverseProxy?.type !== "none" && data.reverseProxy?.configPaths?.length) a.push({ label: `Review my ${data.reverseProxy.type} configuration`, action: "review-proxy" });
    a.push({ label: "Show me my server health dashboard", action: "goto-dashboard" });
    return a;
  }

  function handleSendText() {
    if (!input.trim() || chatting) return;
    const text = input.trim();
    setMessages(prev => [...prev, { role: "user", content: text }]); setInput("");
    if (activeQuestions.length > 0) {
      const cur = activeQuestions[0]; setAnswers(prev => ({ ...prev, [cur.id]: text }));
      const remaining = activeQuestions.filter(q => q.id !== cur.id); setActiveQuestions(remaining);
      if (remaining.length > 0) setMessages(prev => [...prev, { role: "system", content: `Thanks! Next: ${remaining[0].question}`, questions: remaining }]);
      else allQuestionsDone();
      return;
    }
    streamAiResponse(text);
  }

  function handleSuggestionClick(s: string, qid: string) {
    setAnswers(prev => ({ ...prev, [qid]: s })); setMessages(prev => [...prev, { role: "user", content: s }]);
    const remaining = activeQuestions.filter(q => q.id !== qid); setActiveQuestions(remaining);
    if (remaining.length > 0) setMessages(prev => [...prev, { role: "system", content: `Thanks! Next: ${remaining[0].question}`, questions: remaining }]);
    else allQuestionsDone();
  }

  function handleActionClick(action: string) {
    switch (action) {
      case "goto-dashboard": router.push("/dashboard"); break;
      case "goto-settings": router.push("/settings"); break;
      default: streamAiResponse(action.replace(/-/g, " ")); break;
    }
  }

  function allQuestionsDone() {
    setMessages(prev => [...prev, { role: "system", content: "All clear! I can now:\n\n• Install missing software (Docker, Caddy, etc.)\n• Configure your reverse proxy for your projects\n• Review your server health\n• Set up monitoring alerts\n\nJust ask me anything. Or click Save & Finish to go to your dashboard." }]);
  }

  async function streamAiResponse(prompt: string) {
    setChatting(true);
    let content = "";
    const sid = Date.now().toString();
    setMessages(prev => [...prev, { role: "assistant", content: "", _id: sid }]);
    try {
      const res = await fetch("/api/ai/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: prompt }) });
      if (!res.ok) throw new Error("Chat failed");
      const reader = res.body?.getReader(); if (!reader) throw new Error("No stream");
      const decoder = new TextDecoder(); let buffer = "";
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n"); buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const d = JSON.parse(line);
            if (d.type === "content" && d.content) {
              content += d.content;
              setMessages(prev => { const idx = prev.findIndex(m => m._id === sid); if (idx >= 0) { const u = [...prev]; u[idx] = { ...u[idx], content }; return u; } return prev; });
            }
          } catch {}
        }
      }
    } catch (err) {
      setMessages(prev => [...prev.filter(m => m._id !== sid), { role: "assistant", content: `Sorry, I couldn't process that. ${err instanceof Error ? err.message : ""}` }]);
    } finally { setChatting(false); }
  }

  async function handleSave() {
    setSaving(true);
    try { await fetch("/api/onboarding/apply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answers, setupComplete: true }) }); router.push("/dashboard"); }
    catch { setSaving(false); }
  }

  if (probing) return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center space-y-6">
        <div className="w-20 h-20 rounded-2xl bg-accent/10 mx-auto flex items-center justify-center border border-accent/20"><span className="text-3xl animate-pulse">◉</span></div>
        <div><h1 className="text-xl font-bold tracking-tight mb-2">Scanning your server</h1><p className="text-sm text-muted font-mono max-w-sm">Discovering OS, Docker, containers, reverse proxy, projects...</p></div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background p-4 md:p-8 flex flex-col">
      <div className="max-w-2xl mx-auto w-full flex-1 flex flex-col">
        <div className="mb-6"><h1 className="text-2xl font-bold tracking-tight">Welcome to GroundControl</h1><p className="text-muted mt-1 text-sm">I&apos;ve scanned your server and found your setup. Let me confirm a few things.</p></div>
        <div ref={chatRef} className="flex-1 space-y-4 overflow-y-auto mb-6 min-h-[50vh] max-h-[60vh] pr-2">
          {messages.map((msg, i) => (
            <div key={i}>
              <div className={`p-4 rounded-xl text-sm leading-relaxed ${msg.role === "system" ? "bg-card border border-border" : msg.role === "assistant" ? "bg-card border border-border" : "bg-accent/5 border border-accent/20 ml-8"}`}>
                <div className={`whitespace-pre-wrap ${msg.role === "assistant" ? "" : "font-mono"}`}>{msg.content || (msg.role === "assistant" && chatting ? "..." : "")}</div>
              </div>
              {msg.questions && msg.questions.length > 0 && (
                <div className="mt-3 space-y-2 ml-4">
                  {msg.questions.map(q => (
                    <div key={q.id} className="p-3 bg-card/50 rounded-lg border border-border">
                      <p className="text-sm font-medium mb-2">{q.question}</p>
                      <div className="flex flex-wrap gap-2">{q.suggestions.map(s => <button key={s} onClick={() => handleSuggestionClick(s, q.id)} className="px-3 py-1.5 text-xs font-mono bg-accent/10 border border-accent/20 rounded-lg hover:bg-accent/20 transition-colors">{s}</button>)}</div>
                    </div>
                  ))}
                </div>
              )}
              {msg.actions && msg.actions.length > 0 && (
                <div className="mt-3 ml-4 flex flex-wrap gap-2">{msg.actions.map(a => <button key={a.action} onClick={() => handleActionClick(a.action)} className="px-3 py-1.5 text-xs font-mono bg-accent/10 border border-accent/20 rounded-lg hover:bg-accent/20 transition-colors">{a.label}</button>)}</div>
              )}
            </div>
          ))}
        </div>
        <div className="flex gap-3">
          <input type="text" value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSendText()} placeholder={activeQuestions.length > 0 ? "Type your answer..." : chatting ? "AI is responding..." : "Ask me to install software, review config, start projects..."} className="flex-1 bg-card border border-border rounded-xl px-4 py-3 text-sm outline-none focus:border-accent transition-colors font-mono" disabled={chatting}/>
          <button onClick={handleSendText} disabled={!input.trim() || chatting} className="px-4 py-3 bg-accent/10 border border-accent/30 text-accent rounded-xl hover:bg-accent/20 transition-colors text-sm font-mono disabled:opacity-50">Send</button>
          <button onClick={handleSave} disabled={saving} className="px-6 py-3 bg-accent text-white rounded-xl hover:bg-accent/90 transition-colors text-sm font-mono disabled:opacity-50 whitespace-nowrap">{saving ? "Saving..." : "Save & Finish →"}</button>
        </div>
      </div>
    </div>
  );
}
