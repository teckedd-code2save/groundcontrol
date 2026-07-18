"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useSidebar } from "./SidebarContext";
import { renderMarkdown } from "@/lib/markdown";
import { ToolConfirmCard } from "./ToolConfirmCard";

interface ToolEvent {
  name: string;
  args?: Record<string, unknown>;
  status: "running" | "done" | "error";
  output?: string;
}

interface ConfirmRequest {
  name: string;
  args: Record<string, unknown>;
  description?: string;
  resolved?: "approved" | "cancelled";
}

interface Message {
  role: "user" | "assistant" | "error";
  content: string;
  tools?: ToolEvent[];
  confirm?: ConfirmRequest;
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

type WireEvent =
  | { type: "thread"; threadId: number }
  | { type: "tool"; name: string; args?: Record<string, unknown>; status: "running" | "done" | "error"; output?: string }
  | { type: "confirm"; name: string; args: Record<string, unknown>; description?: string }
  | { type: "text"; delta: string }
  | { type: "error"; error: string }
  | { type: "done" };

const STORAGE_OPEN = "gc:ai-chat:open";
const STORAGE_EXPANDED = "gc:ai-chat:expanded";
const STORAGE_THREAD_ID = "gc:ai-chat:thread-id";

function ToolChip({ tool }: { tool: ToolEvent }) {
  const [expanded, setExpanded] = useState(false);
  const icon = tool.status === "running" ? "⏳" : tool.status === "error" ? "⚠" : "✓";
  const label = tool.status === "running" ? `Running ${tool.name}…` : tool.name;
  const tone =
    tool.status === "running"
      ? "border-accent/30 bg-accent/10 text-accent"
      : tool.status === "error"
        ? "border-error/30 bg-error/10 text-error"
        : "border-success/30 bg-success/10 text-success";
  return (
    <div className="my-1">
      <button
        onClick={() => tool.output && setExpanded((v) => !v)}
        className={`flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-mono ${tone}`}
        title={tool.args ? JSON.stringify(tool.args) : undefined}
      >
        <span>{icon}</span>
        <span>{label}</span>
        {tool.output ? <span className="text-muted">{expanded ? "▲" : "▼"}</span> : null}
      </button>
      {expanded && tool.output && (
        <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-bg-darker p-2 text-[11px] leading-snug text-muted">
          {tool.output}
        </pre>
      )}
    </div>
  );
}

function safeJson(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function threadMessagesToUi(thread: ThreadDetail): Message[] {
  const out: Message[] = [];
  for (const m of thread.messages) {
    if (m.role === "user") {
      out.push({ role: "user", content: m.content });
    } else if (m.role === "assistant") {
      const tools: ToolEvent[] = m.toolCalls.map((tc) => ({
        name: tc.name,
        args: safeJson(tc.args),
        status: (tc.status === "running" || tc.status === "done" || tc.status === "error"
          ? tc.status
          : "done") as ToolEvent["status"],
        output: tc.output ?? undefined,
      }));
      out.push({ role: "assistant", content: m.content, tools });
    }
  }
  if (!out.length) {
    out.push({
      role: "assistant",
      content:
        'Hi! I\'m GroundControl AI. I can inspect your server directly — ask me things like "which service is using the most memory", "show me the caddy config", or "tail the logs for <container>".',
    });
  }
  return out;
}

export default function AIChatWidget() {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [threadId, setThreadId] = useState<number | null>(null);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [showThreadMenu, setShowThreadMenu] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content:
        'Hi! I\'m GroundControl AI. I can inspect your server directly — ask me things like "which service is using the most memory", "show me the caddy config", or "tail the logs for <container>".',
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [unread, setUnread] = useState(0);
  const [guideContext, setGuideContext] = useState<{ guideSlug: string; stepId: string } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const { setCollapsed } = useSidebar();

  // Restore persisted UI state on mount.
  useEffect(() => {
    try {
      const savedOpen = localStorage.getItem(STORAGE_OPEN);
      const savedExpanded = localStorage.getItem(STORAGE_EXPANDED);
      const savedThreadId = localStorage.getItem(STORAGE_THREAD_ID);
      if (savedOpen === "true") setOpen(true);
      if (savedExpanded === "true") setExpanded(true);
      if (savedThreadId) {
        const id = parseInt(savedThreadId, 10);
        if (!Number.isNaN(id)) setThreadId(id);
      }
    } catch {
      // localStorage may be unavailable.
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_OPEN, String(open));
      localStorage.setItem(STORAGE_EXPANDED, String(expanded));
      if (threadId) localStorage.setItem(STORAGE_THREAD_ID, String(threadId));
    } catch {
      // ignore
    }
  }, [open, expanded, threadId]);

  useEffect(() => {
    if (expanded) setCollapsed(true);
  }, [expanded, setCollapsed]);

  useEffect(() => {
    if (open) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      setUnread(0);
    }
  }, [messages, open]);

  // Load thread list on mount and when a new thread is created.
  const loadThreads = useCallback(async () => {
    try {
      const res = await fetch("/api/ai/threads");
      if (!res.ok) return;
      const data = await res.json();
      setThreads(data.threads ?? []);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadThreads();
  }, [loadThreads]);

  // When threadId changes, load messages.
  useEffect(() => {
    if (!threadId) return;
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/ai/threads/${threadId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled || !data.thread) return;
        const loaded = threadMessagesToUi(data.thread as ThreadDetail);
        setMessages(loaded);
      } catch {
        // ignore
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [threadId]);

  async function startNewThread() {
    try {
      const res = await fetch("/api/ai/threads", { method: "POST" });
      if (!res.ok) return;
      const data = await res.json();
      if (data.thread?.id) {
        setThreadId(data.thread.id);
        setMessages([
          {
            role: "assistant",
            content:
              'Hi! I\'m GroundControl AI. I can inspect your server directly — ask me things like "which service is using the most memory", "show me the caddy config", or "tail the logs for <container>".',
          },
        ]);
        setShowThreadMenu(false);
        await loadThreads();
      }
    } catch {
      // ignore
    }
  }

  async function selectThread(id: number) {
    setThreadId(id);
    setShowThreadMenu(false);
  }

  async function deleteThread(id: number, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm("Delete this chat thread?")) return;
    try {
      const res = await fetch(`/api/ai/threads/${id}`, { method: "DELETE" });
      if (!res.ok) return;
      if (threadId === id) {
        setThreadId(null);
        setMessages([
          {
            role: "assistant",
            content:
              'Hi! I\'m GroundControl AI. I can inspect your server directly — ask me things like "which service is using the most memory", "show me the caddy config", or "tail the logs for <container>".',
          },
        ]);
      }
      await loadThreads();
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    function handleExternalQuery(e: Event) {
      const detail = (e as CustomEvent).detail;
      let message = "";
      let context: { guideSlug: string; stepId: string } | null = null;

      if (typeof detail === "string" && detail.trim()) {
        message = detail.trim();
      } else if (detail && typeof detail === "object") {
        if (typeof detail.message === "string" && detail.message.trim()) {
          message = detail.message.trim();
        }
        if (detail.guideContext && typeof detail.guideContext.guideSlug === "string") {
          context = {
            guideSlug: detail.guideContext.guideSlug,
            stepId: detail.guideContext.stepId || "",
          };
        }
      }

      if (message) {
        setInput(message);
        setGuideContext(context);
        setOpen(true);
        setExpanded(false);
        setUnread(0);
      }
    }
    window.addEventListener("gc:ai-chat-query", handleExternalQuery);
    return () => window.removeEventListener("gc:ai-chat-query", handleExternalQuery);
  }, []);

  useEffect(() => {
    function handleToggle() {
      setOpen((prevOpen) => {
        if (prevOpen) {
          setExpanded((prevExpanded) => !prevExpanded);
          return true;
        }
        return true;
      });
    }
    window.addEventListener("gc:ai-chat-toggle", handleToggle);
    return () => window.removeEventListener("gc:ai-chat-toggle", handleToggle);
  }, []);

  useEffect(() => {
    function handleGlobalKeydown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "g" || e.key === "G")) {
        e.preventDefault();
        setOpen((prevOpen) => {
          if (prevOpen) {
            setExpanded((prevExpanded) => !prevExpanded);
            return true;
          }
          return true;
        });
      }
    }
    window.addEventListener("keydown", handleGlobalKeydown);
    return () => window.removeEventListener("keydown", handleGlobalKeydown);
  }, []);

  async function runTurn(opts: {
    message?: string;
    confirmedTool?: { name: string; args: Record<string, unknown> };
    guideContext?: { guideSlug: string; stepId: string } | null;
  }) {
    setLoading(true);
    const assistantIndexRef = { current: -1 };
    setMessages((prev) => {
      const next = [...prev, { role: "assistant" as const, content: "", tools: [] as ToolEvent[] }];
      assistantIndexRef.current = next.length - 1;
      return next;
    });

    const updateAssistant = (mut: (m: Message) => void) => {
      setMessages((prev) => {
        const next = [...prev];
        const idx = assistantIndexRef.current;
        if (idx >= 0 && next[idx]) {
          const copy = { ...next[idx], tools: [...(next[idx].tools || [])] };
          mut(copy);
          next[idx] = copy;
        }
        return next;
      });
    };

    try {
      const body: Record<string, unknown> = { threadId };
      if (opts.message) body.message = opts.message;
      if (opts.confirmedTool) body.confirmedTool = opts.confirmedTool;
      if (opts.guideContext) body.guideContext = opts.guideContext;

      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let answer = "";

      const handleEvent = (ev: WireEvent) => {
        if (ev.type === "thread") {
          setThreadId(ev.threadId);
        } else if (ev.type === "tool") {
          updateAssistant((m) => {
            const tools = m.tools || [];
            const existingIdx = tools.findIndex((t) => t.name === ev.name && t.status === "running");
            const entry: ToolEvent = {
              name: ev.name,
              args: ev.args,
              status: ev.status,
              output: ev.output,
            };
            if (existingIdx >= 0) tools[existingIdx] = entry;
            else tools.push(entry);
            m.tools = tools;
          });
        } else if (ev.type === "confirm") {
          updateAssistant((m) => {
            m.confirm = { name: ev.name, args: ev.args, description: ev.description };
          });
        } else if (ev.type === "text") {
          answer += ev.delta;
          updateAssistant((m) => {
            m.content = answer;
          });
        } else if (ev.type === "error") {
          updateAssistant((m) => {
            m.role = "error";
            m.content = `Error: ${ev.error}`;
          });
        }
      };

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let nl;
          while ((nl = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, nl).trim();
            buffer = buffer.slice(nl + 1);
            if (!line) continue;
            try {
              handleEvent(JSON.parse(line) as WireEvent);
            } catch {
              // ignore malformed line
            }
          }
        }
        const tail = buffer.trim();
        if (tail) {
          try {
            handleEvent(JSON.parse(tail) as WireEvent);
          } catch {
            /* ignore */
          }
        }
      }

      await loadThreads();
    } catch (err: unknown) {
      updateAssistant((m) => {
        m.role = "error";
        m.content = `Error: ${err instanceof Error ? err.message : String(err)}`;
      });
    } finally {
      setLoading(false);
      if (!open) setUnread((u) => u + 1);
    }
  }

  async function sendMessage() {
    const text = input.trim();
    if (!text || loading) return;

    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setInput("");
    await runTurn({ message: text, guideContext });
    // Clear guide context after sending so it does not leak into unrelated follow-ups.
    setGuideContext(null);
  }

  async function approveConfirm(msgIndex: number) {
    const confirm = messages[msgIndex]?.confirm;
    if (!confirm || loading) return;
    setMessages((prev) => {
      const next = [...prev];
      if (next[msgIndex]?.confirm) {
        next[msgIndex] = {
          ...next[msgIndex],
          confirm: { ...next[msgIndex].confirm!, resolved: "approved" },
        };
      }
      return next;
    });
    await runTurn({ confirmedTool: { name: confirm.name, args: confirm.args } });
    // Refresh Services inventory after mutating deployment tools
    if (
      confirm.name === "delete_deployment" ||
      confirm.name === "compose_up" ||
      confirm.name === "compose_down"
    ) {
      try {
        window.dispatchEvent(new CustomEvent("gc:services-refresh"));
      } catch {
        /* ignore */
      }
    }
  }

  function cancelConfirm(msgIndex: number) {
    setMessages((prev) => {
      const next = [...prev];
      if (next[msgIndex]?.confirm) {
        next[msgIndex] = {
          ...next[msgIndex],
          confirm: { ...next[msgIndex].confirm!, resolved: "cancelled" },
        };
      }
      return next;
    });
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function toggleOpen() {
    setOpen((v) => !v);
    if (!open) setUnread(0);
  }

  function toggleExpand() {
    setExpanded((v) => !v);
  }

  const currentThread = threads.find((t) => t.id === threadId);
  const threadTitle = currentThread?.title || "GroundControl AI";

  const header = (
    <div className="flex items-center justify-between border-b border-border px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-accent/15 text-accent">
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        </div>
        <div>
          <p className="text-sm font-semibold text-foreground">{threadTitle}</p>
          <p className="text-xs text-muted font-mono">Co-Pilot</p>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <div className="relative">
          <button
            onClick={() => setShowThreadMenu((v) => !v)}
            className="rounded-md p-2 text-muted hover:bg-border/40 hover:text-foreground"
            aria-label="Threads"
            title="Threads"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          {showThreadMenu && (
            <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-lg border border-border bg-card shadow-xl">
              <div className="flex items-center justify-between border-b border-border px-3 py-2">
                <span className="text-xs font-mono text-muted">Threads</span>
                <button
                  onClick={startNewThread}
                  className="text-xs font-mono text-accent hover:text-accent-bright"
                >
                  + New
                </button>
              </div>
              <div className="max-h-60 overflow-y-auto py-1">
                {threads.length === 0 && (
                  <p className="px-3 py-2 text-xs text-muted">No saved threads yet.</p>
                )}
                {threads.map((t) => (
                  <div
                    key={t.id}
                    onClick={() => selectThread(t.id)}
                    className={`group flex cursor-pointer items-center justify-between px-3 py-2 text-sm hover:bg-border/30 ${
                      t.id === threadId ? "bg-accent/10" : ""
                    }`}
                  >
                    <span className="truncate text-foreground">{t.title}</span>
                    <button
                      onClick={(e) => deleteThread(t.id, e)}
                      className="ml-2 rounded p-1 text-muted opacity-0 hover:bg-error/15 hover:text-error group-hover:opacity-100"
                      title="Delete"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        {open && (
          <button
            onClick={toggleExpand}
            className="rounded-md p-2 text-muted hover:bg-border/40 hover:text-foreground"
            aria-label={expanded ? "Collapse" : "Expand"}
            title={expanded ? "Collapse" : "Expand"}
          >
            {expanded ? (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
              </svg>
            ) : (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
              </svg>
            )}
          </button>
        )}
        <button
          onClick={toggleOpen}
          className="rounded-md p-2 text-muted hover:bg-border/40 hover:text-foreground"
          aria-label={open ? "Close" : "Open"}
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );

  const messageList = (
    <div className={`flex-1 overflow-y-auto px-4 py-3 space-y-3 ${expanded ? "md:px-8" : ""}`}>
      {messages.map((m, i) => (
        <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
          <div
            className={`rounded-lg px-3 py-2 ${
              expanded ? "max-w-4xl text-base" : "max-w-[85%] text-sm"
            } ${
              m.role === "user"
                ? "bg-accent text-[var(--accent-ink)]"
                : m.role === "error"
                ? "border border-error/30 bg-error/10 text-error"
                : "border border-border bg-card text-foreground"
            }`}
          >
            {m.tools && m.tools.length > 0 && (
              <div className="mb-1">
                {m.tools.map((t, ti) => (
                  <ToolChip key={ti} tool={t} />
                ))}
              </div>
            )}

            {m.content ? (
              m.role === "assistant" ? (
                <div
                  className="prose-sm leading-relaxed text-foreground [&_code]:break-words"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content) }}
                />
              ) : (
                <span className="whitespace-pre-wrap">{m.content}</span>
              )
            ) : (
              m.role === "assistant" &&
              loading &&
              !(m.tools && m.tools.length) &&
              !m.confirm ? (
                <span className="inline-flex gap-1">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent [animation-delay:0.15s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent [animation-delay:0.3s]" />
                </span>
              ) : null
            )}

            {m.confirm && (
              <div className="mt-2">
                <ToolConfirmCard
                  name={m.confirm.name}
                  args={m.confirm.args}
                  description={m.confirm.description}
                  resolved={m.confirm.resolved}
                  loading={loading}
                  onApprove={() => approveConfirm(i)}
                  onCancel={() => cancelConfirm(i)}
                />
              </div>
            )}
          </div>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );

  const inputArea = (
    <div className="border-t border-border px-4 py-3">
      <div className={`flex items-end gap-2 ${expanded ? "mx-auto max-w-4xl" : ""}`}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about Docker, Caddy, deployments..."
          rows={expanded ? 2 : 1}
          className={`flex-1 resize-none rounded-lg border border-border bg-bg-darker px-3 py-2 text-foreground placeholder:text-text-dim focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent ${
            expanded ? "text-base" : "text-sm"
          }`}
          style={{ maxHeight: expanded ? "160px" : "100px" }}
        />
        <button
          onClick={sendMessage}
          disabled={loading || !input.trim()}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-[var(--accent-ink)] transition-colors hover:bg-accent-bright disabled:cursor-not-allowed disabled:opacity-50"
          aria-label="Send"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M12 5l7 7-7 7" />
          </svg>
        </button>
      </div>
      {expanded && (
        <p className="mx-auto mt-2 max-w-4xl text-[11px] text-muted">
          Tip: type <code className="rounded bg-border/50 px-1 py-0.5 font-mono">/ai &lt;intent&gt;</code> in the Terminal to generate commands.
        </p>
      )}
    </div>
  );

  return (
    <>
      <button
        onClick={toggleOpen}
        className="fixed bottom-6 right-6 z-50 hidden h-14 w-14 items-center justify-center rounded-md bg-accent text-[var(--accent-ink)] shadow-lg shadow-black/30 transition-colors hover:bg-accent-bright md:flex"
        aria-label="Toggle AI Chat"
      >
        {open ? (
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
          </svg>
        )}
        {!open && unread > 0 && (
          <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-md bg-error text-xs font-bold">
            {unread}
          </span>
        )}
      </button>

      {open && (
        <div
          className={`fixed flex flex-col border border-border bg-card shadow-2xl ${
            expanded
              ? "inset-0 z-[70] rounded-none"
              : "inset-x-2 top-16 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-50 sm:inset-x-auto sm:top-auto sm:bottom-24 sm:right-6 sm:h-[500px] sm:w-[380px] rounded-lg"
          }`}
        >
          {header}
          {messageList}
          {inputArea}
        </div>
      )}
    </>
  );
}
