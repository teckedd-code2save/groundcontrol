"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

interface ProbeMessage {
  role: "system" | "user";
  content: string;
  findings?: Record<string, string>;
  questions?: { id: string; question: string; suggestions: string[] }[];
}

export default function OnboardingPage() {
  const router = useRouter();
  const [messages, setMessages] = useState<ProbeMessage[]>([]);
  const [input, setInput] = useState("");
  const [probing, setProbing] = useState(true);
  const [saving, setSaving] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [activeQuestions, setActiveQuestions] = useState<{ id: string; question: string; suggestions: string[] }[]>([]);
  const chatRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    runProbe();
  }, []);

  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [messages]);

  async function runProbe() {
    setProbing(true);
    try {
      const res = await fetch("/api/onboarding/probe");
      if (!res.ok) throw new Error("Probe failed");
      const data = await res.json();

      const findings = summarizeFindings(data);
      const msg: ProbeMessage = {
        role: "system",
        content: findings,
        questions: data.questions || [],
      };
      setMessages([msg]);
      setActiveQuestions(data.questions || []);
    } catch (err) {
      setMessages([{
        role: "system",
        content: "I couldn't probe your server. Is the VPS connected and reachable? Try adding it in Settings → VPS first.",
      }]);
    } finally {
      setProbing(false);
    }
  }

  function summarizeFindings(data: any): string {
    const p = data.reverseProxy;
    const c = data.containers || [];
    const pr = data.projects || [];
    const l = data.layout;

    if (!l) return "Connected. Ready to configure your server.";

    const lines = [
      `I've scanned your server. Here's what I found:`,
      ``,
      `**OS:** ${l.osName || "unknown"} (${l.osFamily})`,
      `**Docker:** ${l.dockerAvailable ? "✓ running" : "✗ not installed"}`,
      `**Containers:** ${c.length} running${c.length > 0 ? " — " + c.map((x: any) => x.name).slice(0, 8).join(", ") + (c.length > 8 ? "..." : "") : ""}`,
    ];

    if (p.type !== "none") {
      lines.push(`**Reverse Proxy:** ${p.type}${p.configPaths?.length ? " at " + p.configPaths[0] : ""}`);
    }

    if (pr.length > 0) {
      const names = pr.map((x: any) => x.path.split("/").pop()).slice(0, 5).join(", ");
      lines.push(`**Projects:** ${pr.length} found${pr.length > 0 ? " (" + names + (pr.length > 5 ? "..." : "") + ")" : ""}`);
    }

    if (data.questions?.length > 0) {
      lines.push(``);
      lines.push(`I have ${data.questions.length} question(s) to make sure I understand your setup correctly.`);
    } else {
      lines.push(``);
      lines.push(`Everything looks clear! Click "Save & Finish" to complete setup.`);
    }

    return lines.join("\n");
  }

  function handleSuggestionClick(suggestion: string, questionId: string, question: string) {
    // Record the answer
    setAnswers(prev => ({ ...prev, [questionId]: suggestion }));

    // Add user message
    const userMsg: ProbeMessage = { role: "user", content: suggestion };
    setMessages(prev => [...prev, userMsg]);

    // Remove this question from active
    const remaining = activeQuestions.filter(q => q.id !== questionId);
    setActiveQuestions(remaining);

    // If no more questions, show confirmation
    if (remaining.length === 0) {
      const doneMsg: ProbeMessage = {
        role: "system",
        content: `Got it! I've recorded your answer for "${question}". Ready to complete setup.`,
      };
      setMessages(prev => [...prev, doneMsg]);
    } else {
      // Acknowledge and show next question reminder
      const next = remaining[0];
      const ack: ProbeMessage = {
        role: "system",
        content: `Thanks! Noted: "${question}" → ${suggestion}. Next: ${next.question}`,
        questions: remaining,
      };
      setMessages(prev => [...prev, ack]);
    }
  }

  function handleSendText() {
    if (!input.trim()) return;

    const userMsg: ProbeMessage = { role: "user", content: input };
    setMessages(prev => [...prev, userMsg]);

    if (activeQuestions.length > 0) {
      const current = activeQuestions[0];
      setAnswers(prev => ({ ...prev, [current.id]: input }));
      const remaining = activeQuestions.filter(q => q.id !== current.id);
      setActiveQuestions(remaining);

      if (remaining.length === 0) {
        const doneMsg: ProbeMessage = {
          role: "system",
          content: "Got it! All questions answered. Ready to complete setup.",
        };
        setMessages(prev => [...prev, doneMsg]);
      } else {
        const next = remaining[0];
        const ack: ProbeMessage = {
          role: "system",
          content: `Thanks! Next: ${next.question}`,
          questions: remaining,
        };
        setMessages(prev => [...prev, ack]);
      }
    }

    setInput("");
  }

  async function handleSave() {
    setSaving(true);
    try {
      await fetch("/api/onboarding/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          answers,
          setupComplete: true,
        }),
      });
      router.push("/dashboard");
    } catch {
      setSaving(false);
    }
  }

  if (probing) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-6">
          <div className="w-20 h-20 rounded-2xl bg-accent/10 mx-auto flex items-center justify-center border border-accent/20">
            <span className="text-3xl animate-pulse">◉</span>
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight mb-2">Scanning your server</h1>
            <p className="text-sm text-muted font-mono max-w-sm">
              Discovering OS, Docker, containers, reverse proxy, projects...
            </p>
          </div>
          <div className="flex justify-center gap-1">
            {[0, 1, 2].map(i => (
              <div key={i} className="w-2 h-2 rounded-full bg-accent/40 animate-bounce" style={{ animationDelay: `${i * 150}ms` }} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4 md:p-8 flex flex-col">
      <div className="max-w-2xl mx-auto w-full flex-1 flex flex-col">
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight">Welcome to GroundControl</h1>
          <p className="text-muted mt-1 text-sm">
            I&apos;ve scanned your server and found your setup. Let me confirm a few things.
          </p>
        </div>

        <div ref={chatRef} className="flex-1 space-y-4 overflow-y-auto mb-6 min-h-[50vh] max-h-[60vh] pr-2">
          {messages.map((msg, i) => (
            <div key={i}>
              <div
                className={`p-4 rounded-xl text-sm leading-relaxed ${
                  msg.role === "system"
                    ? "bg-card border border-border"
                    : "bg-accent/5 border border-accent/20 ml-8"
                }`}
              >
                <div className="whitespace-pre-wrap font-mono">{msg.content}</div>
              </div>

              {msg.questions && msg.questions.length > 0 && (
                <div className="mt-3 space-y-2 ml-4">
                  {msg.questions.map(q => (
                    <div key={q.id} className="p-3 bg-card/50 rounded-lg border border-border">
                      <p className="text-sm font-medium mb-2">{q.question}</p>
                      <div className="flex flex-wrap gap-2">
                        {q.suggestions.map(s => (
                          <button
                            key={s}
                            onClick={() => handleSuggestionClick(s, q.id, q.question)}
                            className="px-3 py-1.5 text-xs font-mono bg-accent/10 border border-accent/20 rounded-lg hover:bg-accent/20 transition-colors"
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <span className="text-[10px] text-muted">or type your answer:</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}

          {activeQuestions.length > 0 && messages.length > 0 && messages[messages.length - 1].questions?.length === 0 && (
            <div className="p-4 bg-card/50 rounded-lg border border-border ml-4">
              <p className="text-sm font-medium mb-2">{activeQuestions[0].question}</p>
              <div className="flex flex-wrap gap-2">
                {activeQuestions[0].suggestions.map(s => (
                  <button
                    key={s}
                    onClick={() => handleSuggestionClick(s, activeQuestions[0].id, activeQuestions[0].question)}
                    className="px-3 py-1.5 text-xs font-mono bg-accent/10 border border-accent/20 rounded-lg hover:bg-accent/20 transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-3">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSendText()}
            placeholder={activeQuestions.length > 0 ? "Type your answer..." : "Setup complete — click Save"}
            className="flex-1 bg-card border border-border rounded-xl px-4 py-3 text-sm outline-none focus:border-accent transition-colors font-mono"
          />
          <button
            onClick={handleSendText}
            disabled={!input.trim()}
            className="px-4 py-3 bg-accent/10 border border-accent/30 text-accent rounded-xl hover:bg-accent/20 transition-colors text-sm font-mono disabled:opacity-50"
          >
            Send
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-6 py-3 bg-accent text-white rounded-xl hover:bg-accent/90 transition-colors text-sm font-mono disabled:opacity-50 whitespace-nowrap"
          >
            {saving ? "Saving..." : "Save & Finish →"}
          </button>
        </div>
      </div>
    </div>
  );
}
