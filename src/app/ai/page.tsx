"use client";

import { useState, useRef, useEffect } from "react";

interface ChatMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  toolCall?: string;
  _id?: string;
}

export default function AiCoPilotPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const chatRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [messages]);

  async function handleSend() {
    if (!input.trim() || loading) return;
    const currentInput = input;
    const userMsg: ChatMessage = { role: "user", content: currentInput };
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId, message: currentInput }),
      });
      if (!res.ok) throw new Error("Chat failed");

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No stream");
      const decoder = new TextDecoder();
      let buffer = "";
      let content = "";

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
            if (d.type === "thread" && d.threadId) setThreadId(d.threadId);
            else if (d.type === "content" && d.content) {
              content += d.content;
              setMessages(prev => {
                const last = prev[prev.length - 1];
                if (last?.role === "assistant") return [...prev.slice(0, -1), { role: "assistant", content }];
                return [...prev, { role: "assistant", content }];
              });
            } else if (d.type === "tool" && d.name) {
              if (d.status === "running") setMessages(prev => [...prev, { role: "tool", content: `Running: ${d.name}...`, toolCall: d.name }]);
              else if (d.status === "done") setMessages(prev => [...prev.filter(m => !(m.role === "tool" && m.toolCall === d.name)), { role: "tool", content: d.output || "Done", toolCall: d.name }]);
            } else if (d.type === "error") setMessages(prev => [...prev, { role: "assistant", content: `Error: ${d.error || "Unknown"}` }]);
          } catch {}
        }
      }
    } catch (err) {
      setMessages(prev => [...prev, { role: "assistant", content: `Error: ${err instanceof Error ? err.message : "Chat failed"}` }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto h-[calc(100vh-4rem)] flex flex-col">
      <div className="mb-4"><h1 className="text-3xl font-bold tracking-tight">AI Co-Pilot</h1><p className="text-muted mt-1 text-sm">Ask me anything about your server.</p></div>
      <div ref={chatRef} className="flex-1 overflow-y-auto space-y-4 mb-4 pr-2">
        {messages.length === 0 && (
          <div className="text-center py-20">
            <div className="w-16 h-16 rounded-2xl bg-accent/10 mx-auto mb-4 flex items-center justify-center border border-accent/20"><span className="text-2xl">◉</span></div>
            <h2 className="text-lg font-medium mb-2">Your VPS AI Co-Pilot</h2>
            <p className="text-sm text-muted max-w-md mx-auto leading-relaxed">I can check system stats, read container logs, restart services, find what&apos;s using CPU, inspect your reverse proxy config, and more.</p>
            <div className="flex flex-wrap gap-2 justify-center mt-6">
              {["What's using the most memory?", "Show me all running containers", "Check disk usage", "Any errors in Caddy logs?"].map(s => (
                <button key={s} onClick={() => setInput(s)} className="px-3 py-1.5 text-xs font-mono bg-card border border-border rounded-lg hover:border-accent hover:text-accent transition-colors">{s}</button>
              ))}
            </div>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] rounded-xl px-4 py-3 text-sm leading-relaxed font-mono ${msg.role === "user" ? "bg-accent text-white" : msg.role === "tool" ? "bg-muted/10 border border-muted/20 text-muted text-xs" : "bg-card border border-border"}`}>
              <div className="whitespace-pre-wrap">{msg.content}</div>
              {msg.toolCall && <div className="mt-1 text-[10px] text-muted/70 uppercase tracking-wider">{msg.toolCall}</div>}
            </div>
          </div>
        ))}
        {loading && <div className="flex justify-start"><div className="bg-card border border-border rounded-xl px-4 py-3"><div className="flex gap-1">{[0,1,2].map(i => <div key={i} className="w-1.5 h-1.5 rounded-full bg-accent/40 animate-bounce" style={{animationDelay:`${i*150}ms`}}/>)}</div></div></div>}
      </div>
      <div className="flex gap-3">
        <input type="text" value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSend()} placeholder="Ask about your server..." className="flex-1 bg-card border border-border rounded-xl px-4 py-3 text-sm outline-none focus:border-accent transition-colors font-mono" disabled={loading}/>
        <button onClick={handleSend} disabled={!input.trim() || loading} className="px-6 py-3 bg-accent text-white rounded-xl hover:bg-accent/90 transition-colors text-sm font-mono disabled:opacity-50">Send</button>
      </div>
    </div>
  );
}
