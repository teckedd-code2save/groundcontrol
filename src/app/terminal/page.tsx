"use client";

import { useEffect, useRef, useState } from "react";

export default function TerminalPage() {
  const [history, setHistory] = useState<{ type: "input" | "output" | "error"; text: string }[]>([]);
  const [input, setInput] = useState("");
  const [working, setWorking] = useState(false);
  const [cwd, setCwd] = useState("/opt");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [working]);

  async function executeCommand(cmd: string, currentCwd: string) {
    setWorking(true);
    setHistory((h) => [...h, { type: "input", text: cmd }]);
    try {
      const res = await fetch("/api/terminal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: cmd, cwd: currentCwd }),
      });
      const data = await res.json();
      if (data.stdout) {
        setHistory((h) => [...h, { type: "output", text: data.stdout }]);
      }
      if (data.stderr) {
        setHistory((h) => [...h, { type: "error", text: data.stderr }]);
      }
      if (data.code !== 0 && !data.stdout && !data.stderr) {
        setHistory((h) => [...h, { type: "error", text: `Exit code: ${data.code}` }]);
      }
    } catch (err: any) {
      setHistory((h) => [...h, { type: "error", text: err.message }]);
    } finally {
      setWorking(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || working) return;
    const cmd = input.trim();
    setInput("");

    // Handle cd locally
    if (cmd.startsWith("cd ") || cmd === "cd") {
      const target = cmd === "cd" ? "/root" : cmd.slice(3).trim();
      // Resolve relative paths
      let newCwd: string;
      if (target.startsWith("/")) {
        newCwd = target;
      } else {
        newCwd = cwd === "/" ? `/${target}` : `${cwd}/${target}`;
      }
      // Simple path normalization
      const parts = newCwd.split("/").filter((p) => p !== "" && p !== ".");
      const normalized: string[] = [];
      for (const part of parts) {
        if (part === "..") {
          normalized.pop();
        } else {
          normalized.push(part);
        }
      }
      newCwd = "/" + normalized.join("/");
      setCwd(newCwd || "/");
      setHistory((h) => [...h, { type: "input", text: cmd }]);
      return;
    }

    executeCommand(cmd, cwd);
  }

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto h-[calc(100vh-2rem)] flex flex-col">
      <div className="mb-4">
        <h1 className="text-3xl font-bold tracking-tight">Terminal</h1>
        <p className="text-muted mt-1">Execute commands on your VPS directly from the browser</p>
      </div>

      <div className="flex-1 bg-card border border-border rounded-xl flex flex-col overflow-hidden">
        <div className="flex-1 p-4 overflow-auto font-mono text-sm scrollbar-thin">
          {history.length === 0 && (
            <div className="text-muted text-sm">
              <p>GroundControl Terminal v1.0</p>
              <p className="mt-1">Type commands to execute on the VPS. Use with care.</p>
              <p className="mt-1">Mounted: /opt, /var/www, /etc, /var/run/docker.sock</p>
            </div>
          )}
          {history.map((entry, i) => (
            <div key={i} className="mb-2">
              {entry.type === "input" && (
                <div className="text-accent">
                  <span className="text-success">➜</span>{" "}
                  <span className="text-primary/70">{cwd}</span> {entry.text}
                </div>
              )}
              {entry.type === "output" && (
                <pre className="text-foreground/80 whitespace-pre-wrap pl-4">{entry.text}</pre>
              )}
              {entry.type === "error" && (
                <pre className="text-error/80 whitespace-pre-wrap pl-4">{entry.text}</pre>
              )}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        <form
          onSubmit={handleSubmit}
          className="border-t border-border p-3 flex items-center gap-3"
        >
          <span className="text-success font-mono text-sm shrink-0">➜</span>
          <span className="text-primary/70 font-mono text-sm shrink-0 hidden sm:inline">{cwd}</span>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={working ? "Executing..." : "Type a command..."}
            disabled={working}
            className="flex-1 bg-transparent text-sm font-mono outline-none text-foreground placeholder:text-muted min-w-0"
            autoFocus
          />
        </form>
      </div>
    </div>
  );
}
