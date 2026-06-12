"use client";

import { useState, useRef, useEffect } from "react";
import { useSidebar } from "./SidebarContext";

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

type WireEvent =
  | { type: "tool"; name: string; args?: Record<string, unknown>; status: "running" | "done" | "error"; output?: string }
  | { type: "confirm"; name: string; args: Record<string, unknown>; description?: string }
  | { type: "text"; delta: string }
  | { type: "error"; error: string };

const STORAGE_OPEN = "gc:ai-chat:open";
const STORAGE_EXPANDED = "gc:ai-chat:expanded";

/** Minimal, safe-ish markdown -> HTML for assistant answers. */
function renderMarkdown(md: string): string {
  const esc = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  // Extract fenced code blocks first so their content isn't further processed.
  const blocks: string[] = [];
  let text = md.replace(/```(?:[a-zA-Z0-9]*)\n?([\s\S]*?)```/g, (_m, code) => {
    blocks.push(
      `<pre class="my-2 overflow-x-auto rounded-lg bg-gray-900 p-2 text-xs text-gray-100"><code>${esc(
        code.replace(/\n$/, "")
      )}</code></pre>`
    );
    return `\x00BLOCK${blocks.length - 1}\x00`;
  });

  text = esc(text);
  // Inline code
  text = text.replace(/`([^`]+)`/g, '<code class="rounded bg-gray-200 px-1 py-0.5 text-xs dark:bg-gray-700">$1</code>');
  // Bold / italic
  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
  // Headings
  text = text.replace(/^###\s+(.*)$/gm, '<p class="font-semibold mt-2">$1</p>');
  text = text.replace(/^##\s+(.*)$/gm, '<p class="font-semibold mt-2">$1</p>');
  text = text.replace(/^#\s+(.*)$/gm, '<p class="font-bold mt-2">$1</p>');
  // Bullet lists
  text = text.replace(/^\s*[-*]\s+(.*)$/gm, "<li>$1</li>");
  text = text.replace(/(<li>[\s\S]*?<\/li>)/g, '<ul class="list-disc pl-5 my-1">$1</ul>');
  // Paragraph breaks
  text = text.replace(/\n{2,}/g, "<br/><br/>").replace(/\n/g, "<br/>");

  // Restore code blocks
  text = text.replace(/\x00BLOCK(\d+)\x00/g, (_m, i) => blocks[Number(i)]);
  return text;
}

function ToolChip({ tool }: { tool: ToolEvent }) {
  const [expanded, setExpanded] = useState(false);
  const icon = tool.status === "running" ? "⏳" : tool.status === "error" ? "⚠" : "⚙";
  const label =
    tool.status === "running" ? `Running ${tool.name}…` : `ran ${tool.name}`;
  return (
    <div className="my-1">
      <button
        onClick={() => tool.output && setExpanded((v) => !v)}
        className="flex items-center gap-1 rounded-full border border-gray-300 bg-gray-50 px-2 py-0.5 text-[11px] text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
        title={tool.args ? JSON.stringify(tool.args) : undefined}
      >
        <span>{icon}</span>
        <span className="font-mono">{label}</span>
        {tool.output ? <span className="text-gray-400">{expanded ? "▲" : "▼"}</span> : null}
      </button>
      {expanded && tool.output && (
        <pre className="mt-1 max-h-48 overflow-auto rounded-lg bg-gray-900 p-2 text-[11px] leading-snug text-gray-100">
          {tool.output}
        </pre>
      )}
    </div>
  );
}

export default function AIChatWidget() {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content:
        'Hi! I\'m GroundControl AI. I can inspect your server directly — ask me things like "which service is using the most memory", "show me the caddy config", or "tail the logs for <container>".',    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [unread, setUnread] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const { setCollapsed } = useSidebar();

  // Restore persisted state on mount.
  useEffect(() => {
    try {
      const savedOpen = localStorage.getItem(STORAGE_OPEN);
      const savedExpanded = localStorage.getItem(STORAGE_EXPANDED);
      if (savedOpen === "true") setOpen(true);
      if (savedExpanded === "true") setExpanded(true);
    } catch {
      // localStorage may be unavailable.
    }
  }, []);

  // Persist open/expanded state.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_OPEN, String(open));
      localStorage.setItem(STORAGE_EXPANDED, String(expanded));
    } catch {
      // ignore
    }
  }, [open, expanded]);

  // Collapse sidebar when expanded so chat fills the viewport.
  useEffect(() => {
    if (expanded) {
      setCollapsed(true);
    }
  }, [expanded, setCollapsed]);

  useEffect(() => {
    if (open) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      setUnread(0);
    }
  }, [messages, open]);

  useEffect(() => {
    function handleExternalQuery(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (typeof detail === "string" && detail.trim()) {
        setInput(detail.trim());
        setOpen(true);
        setExpanded(false);
        setUnread(0);
      }
    }
    window.addEventListener("gc:ai-chat-query", handleExternalQuery);
    return () => window.removeEventListener("gc:ai-chat-query", handleExternalQuery);
  }, []);

  // Listen for the layout-level global shortcut event.
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

  // Global keyboard shortcut: Ctrl/Cmd+Shift+G.
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

  /** Build the wire history (role + content) from local messages. */
  function buildHistory(): { role: string; content: string }[] {
    return messages
      .filter((m) => m.role !== "error" && (m.content || "").trim())
      .map((m) => ({ role: m.role, content: m.content }));
  }

  /**
   * Core streaming call. Either a fresh user turn (text provided) or a
   * confirmed mutating tool (confirmedTool provided). Streams NDJSON events
   * into a single assistant message.
   */
  async function runTurn(opts: {
    historyOverride?: { role: string; content: string }[];
    confirmedTool?: { name: string; args: Record<string, unknown> };
  }) {
    setLoading(true);
    // Append a fresh assistant message that we stream into.
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
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: opts.historyOverride ?? buildHistory(),
          confirmedTool: opts.confirmedTool,
        }),
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
        if (ev.type === "tool") {
          updateAssistant((m) => {
            const tools = m.tools || [];
            // Update an existing running entry for the same tool, else push.
            const existingIdx = tools.findIndex(
              (t) => t.name === ev.name && t.status === "running"
            );
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
        // Flush any trailing buffered line.
        const tail = buffer.trim();
        if (tail) {
          try {
            handleEvent(JSON.parse(tail) as WireEvent);
          } catch {
            /* ignore */
          }
        }
      }
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

    const history = [...buildHistory(), { role: "user", content: text }];
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setInput("");
    await runTurn({ historyOverride: history });
  }

  async function approveConfirm(msgIndex: number) {
    const confirm = messages[msgIndex]?.confirm;
    if (!confirm || loading) return;
    // Mark resolved so buttons disappear.
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
    await runTurn({
      historyOverride: buildHistory(),
      confirmedTool: { name: confirm.name, args: confirm.args },
    });
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

  const header = (
    <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-300">
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        </div>
        <div>
          <p className="text-sm font-semibold text-gray-900 dark:text-white">GroundControl AI</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">Your DevOps assistant</p>
        </div>
      </div>
      <div className="flex items-center gap-1">
        {open && (
          <button
            onClick={toggleExpand}
            className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
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
          className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
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
            className={`rounded-2xl px-3 py-2 ${
              expanded ? "max-w-4xl text-base" : "max-w-[85%] text-sm"
            } ${
              m.role === "user"
                ? "bg-blue-600 text-white rounded-br-md"
                : m.role === "error"
                ? "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300 rounded-bl-md"
                : "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200 rounded-bl-md"
            }`}
          >
            {/* Tool activity chips */}
            {m.tools && m.tools.length > 0 && (
              <div className="mb-1">
                {m.tools.map((t, ti) => (
                  <ToolChip key={ti} tool={t} />
                ))}
              </div>
            )}

            {/* Answer text (markdown for assistant, plain otherwise) */}
            {m.content ? (
              m.role === "assistant" ? (
                <div
                  className="prose-sm leading-relaxed [&_code]:break-words"
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
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:0.15s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:0.3s]" />
                </span>
              ) : null
            )}

            {/* Confirmation prompt for mutating tools */}
            {m.confirm && (
              <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200">
                <p className="font-semibold">Confirm action</p>
                <p className="mt-0.5 font-mono">
                  {m.confirm.name}({Object.entries(m.confirm.args || {})
                    .map(([k, v]) => `${k}: ${String(v)}`)
                    .join(", ")})
                </p>
                <p className="mt-1 text-amber-800 dark:text-amber-300">
                  This changes server state and won&apos;t run until you approve.
                </p>
                {m.confirm.resolved ? (
                  <p className="mt-2 italic text-amber-700 dark:text-amber-400">
                    {m.confirm.resolved === "approved" ? "Approved." : "Cancelled."}
                  </p>
                ) : (
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={() => approveConfirm(i)}
                      disabled={loading}
                      className="rounded-md bg-amber-600 px-2 py-1 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => cancelConfirm(i)}
                      disabled={loading}
                      className="rounded-md border border-amber-400 px-2 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50 dark:text-amber-200 dark:hover:bg-amber-900/30"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );

  const inputArea = (
    <div className="border-t border-gray-200 px-4 py-3 dark:border-gray-700">
      <div className={`flex items-end gap-2 ${expanded ? "mx-auto max-w-4xl" : ""}`}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about Docker, Caddy, deployments..."
          rows={expanded ? 2 : 1}
          className={`flex-1 resize-none rounded-xl border border-gray-300 bg-gray-50 px-3 py-2 text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:placeholder-gray-500 ${
            expanded ? "text-base" : "text-sm"
          }`}
          style={{ maxHeight: expanded ? "160px" : "100px" }}
        />
        <button
          onClick={sendMessage}
          disabled={loading || !input.trim()}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          aria-label="Send"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M12 5l7 7-7 7" />
          </svg>
        </button>
      </div>
      {expanded && (
        <p className="mx-auto mt-2 max-w-4xl text-[11px] text-gray-500 dark:text-gray-400">
          Tip: type <code className="rounded bg-gray-200 px-1 py-0.5 dark:bg-gray-700">/ai &lt;intent&gt;</code> in the Terminal to generate commands.
        </p>
      )}
    </div>
  );

  return (
    <>
      {/* Floating toggle */}
      <button
        onClick={toggleOpen}
        className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg hover:bg-blue-700 transition-colors"
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
          <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-xs font-bold">
            {unread}
          </span>
        )}
      </button>

      {/* Chat panel */}
      {open && (
        <div
          className={`fixed flex flex-col bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900 ${
            expanded
              ? "inset-0 z-[70] rounded-none"
              : "bottom-24 right-2 sm:right-6 z-50 h-[500px] w-[calc(100vw-1rem)] sm:w-[360px] rounded-2xl border border-gray-200"
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
