"use client";

import Link from "next/link";
import { useState, useRef, useEffect, useCallback } from "react";
import { renderMarkdown } from "@/lib/markdown";

interface ToolEvent {
  name: string;
  args?: Record<string, unknown>;
  status: "running" | "done" | "error";
  output?: string;
}

interface PendingConfirm {
  name: string;
  args: Record<string, unknown>;
  description: string;
}

interface ChatMessage {
  role: "user" | "assistant" | "tool" | "error";
  content: string;
  tools?: ToolEvent[];
}

interface ThreadSummary {
  id: number;
  title: string;
  updatedAt: string;
  _count?: { messages: number };
}

interface ThreadDetail {
  id: number;
  title: string;
  messages: {
    id: number;
    role: string;
    content: string;
    sortOrder: number;
    toolCalls: {
      id: number;
      name: string;
      args: string;
      output: string | null;
      status: string;
      readOnly: boolean;
    }[];
  }[];
}

interface GuideSummary {
  slug: string;
  title: string;
  category: string;
  progress?: { status: string };
}

const STORAGE_THREAD = "gc:copilot:thread-id";

export default function AiCoPilotPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "assistant", content: "Hi! I'm your VPS AI Co-Pilot. I can inspect your server, read logs, manage services, restart containers, and now manage Cloudflare DNS. Ask me anything — or tell me what to do." },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [threadId, setThreadId] = useState<number | null>(null);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [guides, setGuides] = useState<GuideSummary[]>([]);
  const [showThreadMenu, setShowThreadMenu] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // ── Persistence ──────────────────────────────────────
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_THREAD);
      if (saved) { const id = parseInt(saved, 10); if (!isNaN(id)) setThreadId(id); }
    } catch {}
  }, []);

  useEffect(() => {
    try { if (threadId) localStorage.setItem(STORAGE_THREAD, String(threadId)); }
    catch {}
  }, [threadId]);

  useEffect(() => {
    fetch("/api/guides")
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setGuides(Array.isArray(data) ? data.slice(0, 4) : []))
      .catch(() => setGuides([]));
  }, []);

  // ── Scroll ───────────────────────────────────────────
  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, pendingConfirm]);

  // ── Keyboard shortcut ────────────────────────────────
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  // ── Thread management ────────────────────────────────
  const loadThreads = useCallback(async () => {
    try {
      const res = await fetch("/api/ai/threads");
      if (res.ok) { const data = await res.json(); setThreads(data.threads ?? []); }
    } catch {}
  }, []);

  useEffect(() => { loadThreads(); }, [loadThreads]);

  // Load messages when thread changes
  useEffect(() => {
    if (!threadId) return;
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/ai/threads/${threadId}`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!data.thread) return;
        const loaded = threadMessagesToUi(data.thread as ThreadDetail);
        setMessages(loaded);
      } catch {}
    }
    load();
    return () => { cancelled = true; };
  }, [threadId]);

  async function startNewThread() {
    try {
      const res = await fetch("/api/ai/threads", { method: "POST" });
      if (!res.ok) return;
      const data = await res.json();
      if (data.thread?.id) {
        setThreadId(data.thread.id);
        setMessages([{ role: "assistant", content: "Hi! I'm your VPS AI Co-Pilot. I can inspect your server, read logs, manage services, restart containers, and manage Cloudflare DNS. Ask me anything." }]);
        setShowThreadMenu(false);
        await loadThreads();
      }
    } catch {}
  }

  async function switchThread(id: number) {
    setThreadId(id);
    setShowThreadMenu(false);
  }

  async function deleteThread(id: number) {
    try {
      await fetch(`/api/ai/threads/${id}`, { method: "DELETE" });
      if (threadId === id) { setThreadId(null); setMessages([{ role: "assistant", content: "Thread deleted. Start a new conversation?" }]); }
      await loadThreads();
    } catch {}
  }

  // ── Send message ─────────────────────────────────────
  async function handleSend(confirmedTool?: { name: string; args: Record<string, unknown> }) {
    if (!input.trim() && !confirmedTool) return;
    if (loading) return;

    const currentInput = confirmedTool ? "" : input;
    if (!confirmedTool) {
      setMessages(prev => [...prev, { role: "user", content: input }]);
      setInput("");
    }
    setLoading(true);

    try {
      const body: Record<string, unknown> = { threadId };
      if (confirmedTool) body.confirmedTool = confirmedTool;
      else body.message = currentInput;

      const res = await fetch("/api/ai/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error("Chat failed");
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No stream");
      const decoder = new TextDecoder();
      let buffer = "";
      let content = "";
      const tools: ToolEvent[] = [];

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

            if (d.type === "thread" && d.threadId) {
              setThreadId(d.threadId);
              await loadThreads();
            }
            else if ((d.type === "content" || d.type === "text") && (d.content || d.delta)) {
              content += (d.content || d.delta || "");
              setMessages(prev => {
                const last = prev[prev.length - 1];
                if (last?.role === "assistant" && !last.tools?.length)
                  return [...prev.slice(0, -1), { role: "assistant", content, tools }];
                return [...prev, { role: "assistant", content, tools }];
              });
            }
            else if (d.type === "tool" && d.name) {
              const te: ToolEvent = { name: d.name, args: d.args, status: d.status, output: d.output };
              if (d.status === "running") tools.push(te);
              else if (d.status === "done" || d.status === "error") {
                const idx = tools.findIndex(t => t.name === d.name && t.status === "running");
                if (idx >= 0) tools[idx] = te; else tools.push(te);
              }
              setMessages(prev => {
                const last = prev[prev.length - 1];
                if (last?.role === "assistant") return [...prev.slice(0, -1), { ...last, tools: [...tools] }];
                return prev;
              });
            }
            else if (d.type === "confirm" && d.name) {
              setPendingConfirm({ name: d.name, args: d.args || {}, description: d.description || d.name });
            }
            else if (d.type === "error") {
              setMessages(prev => [...prev, { role: "error", content: d.error || "Unknown error" }]);
              setPendingConfirm(null);
            }
          } catch {}
        }
      }
      // Refresh thread list after message
      if (!confirmedTool) await loadThreads();
    } catch (err) {
      setMessages(prev => [...prev, { role: "error", content: err instanceof Error ? err.message : "Chat failed" }]);
      setPendingConfirm(null);
    } finally {
      setLoading(false);
    }
  }

  function handleConfirm() {
    if (!pendingConfirm) return;
    const tool = { ...pendingConfirm };
    setPendingConfirm(null);
    setMessages(prev => [...prev, { role: "tool", content: `Approved: ${tool.name}` }]);
    handleSend({ name: tool.name, args: tool.args });
  }

  function handleReject() {
    setMessages(prev => [...prev, { role: "tool", content: `Cancelled: ${pendingConfirm?.name}` }]);
    setPendingConfirm(null);
  }

  // ── Markdown rendering ───────────────────────────────
  function MessageContent({ msg }: { msg: ChatMessage }) {
    const isUser = msg.role === "user";
    if (isUser) return <div className="whitespace-pre-wrap">{msg.content}</div>;
    if (msg.role === "tool" || msg.role === "error") return <div className="whitespace-pre-wrap text-xs">{msg.content}</div>;
    return <div dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }} />;
  }

  function ToolChips({ tools }: { tools?: ToolEvent[] }) {
    if (!tools?.length) return null;
    return (
      <div className="mt-2 flex flex-wrap gap-1.5">
        {tools.map((t, i) => {
          const icon = t.status === "running" ? "⏳" : t.status === "error" ? "✗" : "✓";
          const cls = t.status === "running" ? "bg-accent/10 border-accent/30 text-accent" :
                      t.status === "error" ? "bg-error/10 border-error/30 text-error" :
                      "bg-success/10 border-success/30 text-success";
          return (
            <span key={i} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-mono ${cls}`}>
              {icon} {t.name}
            </span>
          );
        })}
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-4rem)] flex flex-col">
      {/* Header + Thread selector */}
      <div className="px-4 md:px-8 py-3 border-b border-border flex items-center gap-3 shrink-0">
        <div className="flex-1">
          <h1 className="text-lg font-bold tracking-tight">AI Co-Pilot</h1>
          <p className="text-[10px] text-muted font-mono">⌘K to focus · I can query, manage, and deploy</p>
        </div>
        {guides.length > 0 && (
          <div className="hidden max-w-sm items-center gap-2 lg:flex">
            <span className="text-[10px] font-mono uppercase tracking-wider text-muted">Guides</span>
            {guides.slice(0, 2).map((guide) => (
              <Link
                key={guide.slug}
                href={`/guides/${guide.slug}`}
                className="max-w-36 truncate rounded-lg border border-border bg-card px-2.5 py-1.5 text-[11px] text-muted transition-colors hover:border-accent hover:text-accent"
                title={guide.title}
              >
                {guide.title}
              </Link>
            ))}
            <Link href="/guides" className="text-[11px] font-mono text-accent hover:text-accent/80">
              all
            </Link>
          </div>
        )}
        <div className="relative">
          <button
            onClick={() => { setShowThreadMenu(!showThreadMenu); loadThreads(); }}
            className="px-3 py-1.5 text-xs font-mono bg-card border border-border rounded-lg hover:border-accent transition-colors flex items-center gap-2"
          >
            <span>{threadId ? threads.find(t => t.id === threadId)?.title || `Thread #${threadId}` : "New conversation"}</span>
            <span className="text-muted">{showThreadMenu ? "▲" : "▼"}</span>
          </button>
          {showThreadMenu && (
            <div className="absolute right-0 top-full mt-1 w-72 bg-card border border-border rounded-xl shadow-xl z-50 max-h-80 overflow-y-auto">
              <button onClick={startNewThread} className="w-full text-left px-4 py-2.5 text-xs font-mono text-accent hover:bg-accent/5 border-b border-border">
                + New conversation
              </button>
              {threads.length === 0 && (
                <p className="px-4 py-3 text-xs text-muted font-mono">No conversations yet.</p>
              )}
              {threads.map(t => (
                <div key={t.id} className={`flex items-center justify-between px-4 py-2.5 hover:bg-accent/5 ${t.id === threadId ? "bg-accent/10" : ""}`}>
                  <button onClick={() => switchThread(t.id)} className="text-left flex-1 text-xs font-mono truncate">
                    {t.title || `Thread #${t.id}`}
                    <span className="block text-[10px] text-muted">{t._count?.messages || 0} messages</span>
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); deleteThread(t.id); }} className="text-[10px] text-muted hover:text-error ml-2 font-mono">del</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Messages */}
      <div ref={chatRef} className="flex-1 overflow-y-auto px-4 md:px-8 py-4 space-y-4">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] rounded-xl px-4 py-3 text-sm leading-relaxed ${
              msg.role === "user" ? "bg-accent text-white" :
              msg.role === "error" ? "bg-error/10 border border-error/30 text-error" :
              msg.role === "tool" ? "bg-muted/10 border border-muted/20 text-muted text-xs font-mono" :
              "bg-card border border-border markdown-body"
            }`}>
              <MessageContent msg={msg} />
              <ToolChips tools={msg.tools} />
            </div>
          </div>
        ))}

        {/* Tool confirmation */}
        {pendingConfirm && (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-xl border-2 border-accent/40 bg-accent/5 p-4 animate-in">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
                <span className="text-xs font-mono  text-accent">Approval Required</span>
              </div>
              <p className="text-sm font-medium mb-1">{pendingConfirm.name}</p>
              <p className="text-xs text-muted mb-3">{pendingConfirm.description}</p>
              <div className="bg-background/50 rounded-lg p-2 mb-3">
                <p className="text-[10px] text-muted font-mono whitespace-pre-wrap">
                  {JSON.stringify(pendingConfirm.args, null, 2)}
                </p>
              </div>
              <div className="flex gap-2">
                <button onClick={handleConfirm} className="px-4 py-2 text-xs font-mono bg-accent text-white rounded-lg hover:bg-accent/90 transition-colors">
                  ✓ Approve
                </button>
                <button onClick={handleReject} className="px-4 py-2 text-xs font-mono border border-border rounded-lg hover:border-error hover:text-error transition-colors">
                  ✕ Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {loading && !pendingConfirm && (
          <div className="flex justify-start">
            <div className="bg-card border border-border rounded-xl px-4 py-3">
              <div className="flex gap-1">
                {[0, 1, 2].map(i => (
                  <div key={i} className="w-1.5 h-1.5 rounded-full bg-accent/40 animate-bounce" style={{ animationDelay: `${i * 150}ms` }} />
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="px-4 md:px-8 py-3 border-t border-border shrink-0">
        <div className="flex gap-3 max-w-3xl mx-auto">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSend()}
            placeholder={loading ? "AI is responding..." : "Ask anything or tell me what to do... (⌘K)"}
            className="flex-1 bg-card border border-border rounded-xl px-4 py-3 text-sm outline-none focus:border-accent transition-colors font-mono"
            disabled={loading}
          />
          <button
            onClick={() => handleSend()}
            disabled={(!input.trim() && !pendingConfirm) || loading}
            className="px-6 py-3 bg-accent text-white rounded-xl hover:bg-accent/90 transition-colors text-sm font-mono disabled:opacity-50"
          >
            Send
          </button>
        </div>
        <p className="text-[10px] text-muted/50 text-center mt-2 font-mono">
          I can query metrics, read logs, restart services, create DNS records — and ask before making changes.
        </p>
      </div>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────

function threadMessagesToUi(thread: ThreadDetail): ChatMessage[] {
  return thread.messages
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map(m => {
      const tools: ToolEvent[] = (m.toolCalls || []).map(tc => ({
        name: tc.name,
        args: tc.args ? JSON.parse(tc.args) : undefined,
        status: tc.status as ToolEvent["status"],
        output: tc.output || undefined,
      }));
      return {
        role: m.role as ChatMessage["role"],
        content: m.content,
        tools: tools.length > 0 ? tools : undefined,
      };
    });
}
