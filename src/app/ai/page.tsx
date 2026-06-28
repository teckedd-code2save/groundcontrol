"use client";

import { useState, useRef, useEffect } from "react";

interface ChatMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  toolCall?: string;
}

export default function AiCoPilotPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const chatRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [messages]);

  async function handleSend() {
    if (!input.trim() || loading) return;

    const userMsg: ChatMessage = { role: "user", content: input };
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId,
          message: input,
        }),
      });

      if (!res.ok) throw new Error("Chat failed");

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream");

      let assistantContent = "";
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value, { stream: true });
        for (const line of text.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === "thread" && data.threadId) {
              setThreadId(data.threadId);
            } else if (data.type === "content" && data.content) {
              assistantContent += data.content;
              setMessages(prev => {
                const last = prev[prev.length - 1];
                if (last?.role === "assistant" && !last.toolCall) {
                  return [...prev.slice(0, -1), { ...last, content: assistantContent }];
                }
                return [...prev, { role: "assistant", content: assistantContent }];
              });
            } else if (data.type === "tool_call" && data.toolName) {
              setMessages(prev => [
                ...prev,
                { role: "tool", content: `Running: ${data.toolName}...`, toolCall: data.toolName },
              ]);
            } else if (data.type === "tool_result" && data.content) {
              setMessages(prev => {
                const filtered = prev.filter(m => !(m.role === "tool" && m.content?.startsWith("Running:")));
                return [...filtered, { role: "tool", content: data.content }];
              });
            }
          } catch { /* skip malformed SSE */ }
        }
      }
    } catch (err) {
      setMessages(prev => [
        ...prev,
        { role: "assistant", content: `Error: ${err instanceof Error ? err.message : "Chat failed"}` },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto h-[calc(100vh-4rem)] flex flex-col">
      <div className="mb-4">
        <h1 className="text-3xl font-bold tracking-tight">AI Co-Pilot</h1>
        <p className="text-muted mt-1 text-sm">
          Ask me anything about your server — logs, containers, metrics, config.
        </p>
      </div>

      <div ref={chatRef} className="flex-1 overflow-y-auto space-y-4 mb-4 pr-2">
        {messages.length === 0 && (
          <div className="text-center py-20">
            <div className="w-16 h-16 rounded-2xl bg-accent/10 mx-auto mb-4 flex items-center justify-center border border-accent/20">
              <span className="text-2xl">◉</span>
            </div>
            <h2 className="text-lg font-medium mb-2">Your VPS AI Co-Pilot</h2>
            <p className="text-sm text-muted max-w-md mx-auto leading-relaxed">
              I can check system stats, read container logs, restart services, find what&apos;s using CPU,
              inspect your reverse proxy config, and more. Just ask.
            </p>
            <div className="flex flex-wrap gap-2 justify-center mt-6">
              {["What's using the most memory?", "Show me all running containers", "Check disk usage", "Any errors in Caddy logs?"].map(s => (
                <button
                  key={s}
                  onClick={() => { setInput(s); }}
                  className="px-3 py-1.5 text-xs font-mono bg-card border border-border rounded-lg hover:border-accent hover:text-accent transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] rounded-xl px-4 py-3 text-sm leading-relaxed font-mono ${
                msg.role === "user"
                  ? "bg-accent text-white"
                  : msg.role === "tool"
                  ? "bg-muted/10 border border-muted/20 text-muted text-xs"
                  : "bg-card border border-border"
              }`}
            >
              <div className="whitespace-pre-wrap">{msg.content}</div>
              {msg.toolCall && (
                <div className="mt-1 text-[10px] text-muted/70 uppercase tracking-wider">
                  {msg.toolCall}
                </div>
              )}
            </div>
          </div>
        ))}

        {loading && (
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

      <div className="flex gap-3">
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handleSend()}
          placeholder="Ask about your server..."
          className="flex-1 bg-card border border-border rounded-xl px-4 py-3 text-sm outline-none focus:border-accent transition-colors font-mono"
          disabled={loading}
        />
        <button
          onClick={handleSend}
          disabled={!input.trim() || loading}
          className="px-6 py-3 bg-accent text-white rounded-xl hover:bg-accent/90 transition-colors text-sm font-mono disabled:opacity-50"
        >
          Send
        </button>
      </div>
    </div>
  );
}
