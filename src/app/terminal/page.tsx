"use client";

import { useEffect, useRef, useState } from "react";
import { useSidebar } from "@/components/SidebarContext";
import {
  type ServerCapabilities,
  buildHelperChips,
  hintForCommand,
} from "@/lib/server-capabilities-types";

interface HistoryEntry {
  type: "input" | "output" | "error" | "hint";
  text: string;
  cmd?: string;
}

interface Suggestion {
  value: string;
  label: string;
  type: "command" | "file" | "container" | "project" | "history";
}

interface AiSuggestion {
  command: string;
  explanation: string;
}

const HISTORY_KEY = "gc-terminal-history";

const BASHISM_PATTERNS: { pattern: RegExp; name: string }[] = [
  { pattern: /\[\[/, name: "[[ ]]" },
  { pattern: /\]\]/, name: "[[ ]]" },
  { pattern: /\bsource\b/, name: "source" },
  { pattern: /\bdeclare\s+-a\b/, name: "arrays" },
  { pattern: /\$\{[^}]*\[[^]]*\]\}/, name: "arrays" },
  { pattern: /<<<\s*/, name: "here-strings" },
  { pattern: /\bfunction\s+\w+\s*\(\)/, name: "function keyword" },
];

function rewriteBashCommand(cmd: string): { command: string; hint?: string } {
  const m = cmd.match(/^((?:\/usr)?\/bin\/)?bash\b([\s\S]*)$/);
  if (!m) return { command: cmd };

  const rest = (m[2] || "").trimStart();
  const dashC = rest.match(/^-c\b\s*([\s\S]*)$/);
  if (dashC) {
    return {
      command: `sh -c ${dashC[1]}`.trim(),
      hint: "Remote shell is sh (BusyBox) — `bash` isn't installed. Rewrote `bash -c` → `sh -c`.",
    };
  }
  if (rest) {
    return {
      command: `sh ${rest}`,
      hint: "Remote shell is sh (BusyBox) — `bash` isn't installed. Rewrote `bash` → `sh`.",
    };
  }
  return {
    command: "sh",
    hint: "Remote shell is sh (BusyBox) — `bash` isn't installed. Drop the `bash` prefix and run commands directly.",
  };
}

function detectBashisms(cmd: string): string[] {
  const found = new Set<string>();
  for (const { pattern, name } of BASHISM_PATTERNS) {
    if (pattern.test(cmd)) found.add(name);
  }
  return Array.from(found);
}

function capabilitySummary(capabilities: ServerCapabilities | null): string {
  if (!capabilities) return "";
  const parts: string[] = [capabilities.osFamily];
  if (capabilities.hasDocker) parts.push("Docker");
  if (capabilities.hasCaddy) parts.push("Caddy");
  if (capabilities.hasNginx) parts.push("Nginx");
  if (capabilities.hasNode) parts.push("Node");
  parts.push(capabilities.initSystem);
  return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" · ");
}

export default function TerminalPage() {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [input, setInput] = useState("");
  const [working, setWorking] = useState(false);
  const [cwd, setCwd] = useState("/opt");
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedSuggestion, setSelectedSuggestion] = useState(0);
  const [aiSuggestion, setAiSuggestion] = useState<AiSuggestion | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [bashismWarnings, setBashismWarnings] = useState<string[]>([]);
  const [capabilities, setCapabilities] = useState<ServerCapabilities | null>(null);
  const [capabilitiesLoading, setCapabilitiesLoading] = useState(true);
  const { setCollapsed } = useSidebar();
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(HISTORY_KEY);
      if (saved) setCommandHistory(JSON.parse(saved));
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetch("/api/server-capabilities")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setCapabilities(data))
      .catch(() => {})
      .finally(() => setCapabilitiesLoading(false));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [working, fullscreen]);

  useEffect(() => {
    const warnings = detectBashisms(input);
    setBashismWarnings(warnings);
  }, [input]);

  // Collapse sidebar while in fullscreen so content fills the viewport.
  useEffect(() => {
    if (fullscreen) {
      setCollapsed(true);
    }
  }, [fullscreen, setCollapsed]);

  const helperChips = buildHelperChips(capabilities);
  const summary = capabilitySummary(capabilities);

  async function fetchSuggestions(value: string) {
    if (!value.trim()) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    try {
      const res = await fetch("/api/terminal/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: value, cwd, history: commandHistory }),
      });
      const data = await res.json();
      const list = data.suggestions || [];
      setSuggestions(list);
      setShowSuggestions(list.length > 0);
      setSelectedSuggestion(0);
    } catch {
      setSuggestions([]);
      setShowSuggestions(false);
    }
  }

  async function executeCommand(
    cmd: string,
    currentCwd: string,
    opts?: { skipInputEcho?: boolean }
  ) {
    setWorking(true);
    setAiSuggestion(null);
    if (!opts?.skipInputEcho) {
      setHistory((h) => [...h, { type: "input", text: cmd }]);
    }
    try {
      const res = await fetch("/api/terminal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: cmd, cwd: currentCwd }),
      });
      const data = await res.json();
      if (data.stdout) {
        setHistory((h) => [...h, { type: "output", text: data.stdout, cmd }]);
      }
      if (data.stderr) {
        setHistory((h) => [...h, { type: "error", text: data.stderr, cmd }]);
      }
      if (data.code !== 0 && !data.stdout && !data.stderr) {
        setHistory((h) => [...h, { type: "error", text: `Exit code: ${data.code}`, cmd }]);
      }
    } catch (err: unknown) {
      setHistory((h) => [...h, { type: "error", text: err instanceof Error ? err.message : String(err), cmd }]);
    } finally {
      setWorking(false);
    }
  }

  function pushCommandHistory(cmd: string) {
    setCommandHistory((prev) => {
      const next = prev.filter((c) => c !== cmd);
      next.push(cmd);
      if (next.length > 200) next.shift();
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }

  async function handleAiIntent(intent: string) {
    setAiLoading(true);
    setAiSuggestion(null);
    try {
      const res = await fetch("/api/terminal/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent, cwd }),
      });
      const data = await res.json();
      if (res.ok) {
        setAiSuggestion(data);
      } else {
        setHistory((h) => [...h, { type: "error", text: data.error || "AI failed" }]);
      }
    } catch (err: unknown) {
      setHistory((h) => [...h, { type: "error", text: err instanceof Error ? err.message : String(err) }]);
    } finally {
      setAiLoading(false);
    }
  }

  function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!input.trim() || working) return;
    const raw = input.trim();
    setInput("");
    setSuggestions([]);
    setShowSuggestions(false);
    setAiSuggestion(null);

    // AI mode.
    if (raw.startsWith("/ai ")) {
      const intent = raw.slice(4).trim();
      setHistory((h) => [...h, { type: "input", text: raw }]);
      handleAiIntent(intent);
      return;
    }

    pushCommandHistory(raw);
    setHistoryIndex(-1);

    const cmd = raw;
    if (cmd.startsWith("cd ") || cmd === "cd") {
      const target = cmd === "cd" ? "/root" : cmd.slice(3).trim();
      let newCwd: string;
      if (target.startsWith("/")) {
        newCwd = target;
      } else {
        newCwd = cwd === "/" ? `/${target}` : `${cwd}/${target}`;
      }
      const parts = newCwd.split("/").filter((p) => p !== "" && p !== ".");
      const normalized: string[] = [];
      for (const part of parts) {
        if (part === "..") normalized.pop();
        else normalized.push(part);
      }
      newCwd = "/" + normalized.join("/");
      setCwd(newCwd || "/");
      setHistory((h) => [...h, { type: "input", text: cmd }]);
      return;
    }

    // Context-aware hint for commands known to be unavailable.
    const capabilityHint = hintForCommand(cmd, capabilities);
    if (capabilityHint) {
      setHistory((h) => [
        ...h,
        { type: "input", text: cmd },
        { type: "hint", text: `${capabilityHint} Running: ${cmd}` },
      ]);
      executeCommand(cmd, cwd, { skipInputEcho: true });
      return;
    }

    const { command: runCmd, hint } = rewriteBashCommand(cmd);
    if (hint) {
      setHistory((h) => [
        ...h,
        { type: "input", text: cmd },
        { type: "hint", text: `${hint} Running: ${runCmd}` },
      ]);
      executeCommand(runCmd, cwd, { skipInputEcho: true });
      return;
    }

    executeCommand(runCmd, cwd);
  }

  function applySuggestion(s: Suggestion) {
    const words = input.split(/\s+/);
    // For first word suggestions replace the whole input.
    if (words.length <= 1 && !input.includes(" ")) {
      setInput(s.value);
    } else {
      const lastSpace = input.lastIndexOf(" ");
      setInput(input.slice(0, lastSpace + 1) + s.value);
    }
    setShowSuggestions(false);
    inputRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (showSuggestions) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedSuggestion((i) => (i + 1) % suggestions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedSuggestion((i) => (i - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === "Tab" || e.key === "Enter") {
        e.preventDefault();
        applySuggestion(suggestions[selectedSuggestion]);
        return;
      }
      if (e.key === "Escape") {
        setShowSuggestions(false);
        return;
      }
    }

    if (e.key === "ArrowUp" && !showSuggestions) {
      e.preventDefault();
      if (commandHistory.length === 0) return;
      const idx = historyIndex === -1 ? commandHistory.length - 1 : Math.max(0, historyIndex - 1);
      setHistoryIndex(idx);
      setInput(commandHistory[idx]);
      return;
    }
    if (e.key === "ArrowDown" && !showSuggestions) {
      e.preventDefault();
      if (historyIndex === -1) return;
      const idx = historyIndex + 1;
      if (idx >= commandHistory.length) {
        setHistoryIndex(-1);
        setInput("");
      } else {
        setHistoryIndex(idx);
        setInput(commandHistory[idx]);
      }
      return;
    }
    if (e.key === "Tab" && !showSuggestions) {
      e.preventDefault();
      fetchSuggestions(input);
      return;
    }
  }

  function onInputChange(value: string) {
    setInput(value);
    setHistoryIndex(-1);
    if (value.endsWith(" ") || value.length > 2) {
      // Debounce path/command suggestions.
      const timer = setTimeout(() => fetchSuggestions(value), 150);
      return () => clearTimeout(timer);
    } else {
      setShowSuggestions(false);
    }
  }

  function formatOutput(entry: HistoryEntry): React.ReactNode {
    if (entry.type === "error") {
      return <pre className="text-error/80 whitespace-pre-wrap pl-4">{entry.text}</pre>;
    }
    if (entry.type === "hint") {
      return <pre className="text-warning/80 whitespace-pre-wrap pl-4">{entry.text}</pre>;
    }
    if (entry.type === "input") {
      return (
        <div className="text-accent">
          <span className="text-success">➜</span>{" "}
          <span className="text-primary/70">{cwd}</span> {entry.text}
        </div>
      );
    }

    const cmd = entry.cmd || "";
    const text = entry.text;

    if (cmd.startsWith("docker ps") || cmd.startsWith("docker container ls")) return formatDockerPs(text);
    if (cmd.startsWith("docker images") || cmd.startsWith("docker image ls")) return formatDockerImages(text);
    if (cmd.startsWith("docker stats")) return formatDockerStats(text);
    if (cmd.startsWith("docker network ls")) return formatDockerNetworkLs(text);
    if (cmd.startsWith("docker volume ls")) return formatDockerVolumeLs(text);

    return <pre className="text-foreground/80 whitespace-pre-wrap pl-4">{text}</pre>;
  }

  const mainClasses = fullscreen
    ? "fixed inset-0 z-[70] bg-background p-4 flex flex-col"
    : "p-4 md:p-8 max-w-7xl mx-auto h-[calc(100vh-2rem)] flex flex-col";

  return (
    <div className={mainClasses}>
      <div className={`flex items-center justify-between ${fullscreen ? "mb-2" : "mb-4"}`}>
        <div>
          <h1 className={`${fullscreen ? "text-xl" : "text-3xl"} font-bold tracking-tight`}>Terminal</h1>
          {!fullscreen && (
            <>
              <p className="text-muted mt-1">Execute commands on your VPS directly from the browser</p>
              <p className="text-warning/70 text-xs font-mono mt-1">
                Remote shell is <span className="font-semibold">sh</span> (BusyBox) —{" "}
                <span className="font-semibold">bash</span> is not installed. Use POSIX sh syntax.
              </p>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setFullscreen((f) => !f)}
            className="px-3 py-1.5 text-xs font-mono border border-border rounded-lg hover:border-accent hover:text-accent transition-colors"
            title={fullscreen ? "Exit full screen" : "Full screen"}
          >
            {fullscreen ? "Exit" : "Full Screen"}
          </button>
        </div>
      </div>

      {/* Capability summary + helper chips */}
      {!fullscreen && (
        <div className="mb-4 space-y-2">
          <div className="flex items-center gap-2 text-[10px] font-mono text-muted">
            <span className="">Capabilities</span>
            {capabilitiesLoading ? (
              <span className="animate-pulse">detecting…</span>
            ) : summary ? (
              <span className="text-foreground/70">{summary}</span>
            ) : (
              <span>unknown</span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {helperChips.map((chip) => (
              <button
                key={chip}
                onClick={() => {
                  setInput(chip);
                  inputRef.current?.focus();
                }}
                className="px-2.5 py-1 text-[10px] font-mono border border-border rounded-md hover:border-accent hover:text-accent transition-colors"
              >
                {chip}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex-1 bg-card border border-border rounded-xl flex flex-col overflow-hidden relative">
        <div className="flex-1 p-4 overflow-auto font-mono text-sm scrollbar-thin">
          {history.length === 0 && (
            <div className="text-muted text-sm">
              <p>GroundControl Terminal v1.0</p>
              <p className="mt-1">Type commands to execute on the VPS. Use with care.</p>
              <p className="mt-1">Mounted: /opt, /var/www, /etc, /var/run/docker.sock</p>
              <p className="mt-1 text-warning/70">Shell: sh (BusyBox) — bash is not available; `bash ...` is auto-rewritten to `sh ...`.</p>
              <p className="mt-1 text-accent/70">Tip: type `/ai &lt;intent&gt;` to generate a command with AI.</p>
            </div>
          )}
          {history.map((entry, i) => (
            <div key={i} className="mb-2">
              {formatOutput(entry)}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {/* AI suggestion / help */}
        {aiSuggestion && (
          <div className="border-t border-border bg-background/50 p-3">
            <div className="text-xs text-muted mb-1">AI {aiSuggestion.mode === "help" ? "assistant" : "suggestion"}</div>
            {aiSuggestion.help && <div className="text-xs text-foreground/80 mb-2 leading-relaxed">{aiSuggestion.help}</div>}
            {aiSuggestion.command && (
              <><div className="font-mono text-sm text-accent mb-1">{aiSuggestion.command}</div>
              {aiSuggestion.explanation && <div className="text-xs text-muted mb-2">{aiSuggestion.explanation}</div>}</>
            )}
            {aiSuggestion.suggestions?.length > 0 && (
              <div className="mb-2 space-y-1">
                {aiSuggestion.suggestions.map((s: string, i: number) => (
                  <div key={i} className="text-xs text-muted font-mono pl-2">→ {s}</div>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              {aiSuggestion.command && (<>
                <button onClick={() => { executeCommand(aiSuggestion.command!, cwd); setAiSuggestion(null); }}
                className="px-3 py-1 text-xs font-mono bg-accent/10 border border-accent/30 text-accent rounded hover:bg-accent/20 transition-colors"
              >
                Run
              </button>
              </>)}
              <button
                onClick={() => setAiSuggestion(null)}
                className="px-3 py-1 text-xs font-mono border border-border rounded hover:border-accent transition-colors"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        <form
          onSubmit={handleSubmit}
          className="border-t border-border p-3 flex items-center gap-3 relative"
        >
          <span className="text-success font-mono text-sm shrink-0">➜</span>
          <span className="text-primary/70 font-mono text-sm shrink-0 hidden sm:inline">{cwd}</span>
          <div className="relative flex-1">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => onInputChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={working ? "Executing..." : aiLoading ? "AI is thinking..." : "Type a command or /ai ..."}
              disabled={working}
              className="w-full bg-transparent text-sm font-mono outline-none text-foreground placeholder:text-muted min-w-0"
              autoFocus
            />
            {showSuggestions && (
              <div
                ref={suggestionsRef}
                className="absolute bottom-full left-0 mb-1 w-full max-h-56 overflow-auto bg-card border border-border rounded-lg shadow-lg z-10"
              >
                {suggestions.map((s, i) => (
                  <button
                    key={`${s.type}-${s.value}`}
                    type="button"
                    onClick={() => applySuggestion(s)}
                    className={`w-full text-left px-3 py-2 text-xs font-mono flex items-center justify-between ${
                      i === selectedSuggestion ? "bg-accent/10" : "hover:bg-background/50"
                    }`}
                  >
                    <span className="truncate">{s.label}</span>
                    <span className="text-[9px] uppercase text-muted ml-2 shrink-0">{s.type}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </form>

        {bashismWarnings.length > 0 && (
          <div className="px-3 pb-2 text-[10px] text-warning font-mono">
            Warning: possible bashisms detected ({bashismWarnings.join(", ")}). Remote shell is sh/BusyBox.
          </div>
        )}
      </div>
    </div>
  );
}

function formatDockerPs(output: string): React.ReactNode {
  const lines = output.split("\n").filter((l) => l.trim());
  if (lines.length < 1 || !lines[0].includes("CONTAINER ID")) {
    return <pre className="text-foreground/80 whitespace-pre-wrap pl-4">{output}</pre>;
  }

  const headers = ["CONTAINER ID", "IMAGE", "COMMAND", "CREATED", "STATUS", "PORTS", "NAMES"];
  const headerLine = lines[0];
  const positions = headers.map((h) => headerLine.indexOf(h)).filter((p) => p >= 0);
  positions.push(headerLine.length);

  const rows = lines.slice(1);

  return (
    <div className="pl-4 overflow-x-auto">
      <table className="text-[11px] font-mono border-collapse">
        <thead>
          <tr className="text-muted border-b border-border">
            {headers.map((h, i) => (
              <th key={i} className="text-left px-2 py-1 whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className="border-b border-border/30 hover:bg-background/30">
              {positions.slice(0, -1).map((pos, ci) => (
                <td key={ci} className="px-2 py-1 text-foreground/80 whitespace-nowrap">
                  {row.slice(pos, positions[ci + 1]).trim()}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatDockerImages(output: string): React.ReactNode {
  const lines = output.split("\n").filter((l) => l.trim());
  if (lines.length < 1 || !lines[0].includes("REPOSITORY")) {
    return <pre className="text-foreground/80 whitespace-pre-wrap pl-4">{output}</pre>;
  }

  const headers = ["REPOSITORY", "TAG", "IMAGE ID", "CREATED", "SIZE"];
  const headerLine = lines[0];
  const positions = headers.map((h) => headerLine.indexOf(h)).filter((p) => p >= 0);
  positions.push(headerLine.length);

  const rows = lines.slice(1);

  return (
    <div className="pl-4 overflow-x-auto">
      <table className="text-[11px] font-mono border-collapse">
        <thead>
          <tr className="text-muted border-b border-border">
            {headers.map((h, i) => (
              <th key={i} className="text-left px-2 py-1 whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className="border-b border-border/30 hover:bg-background/30">
              {positions.slice(0, -1).map((pos, ci) => (
                <td key={ci} className="px-2 py-1 text-foreground/80 whitespace-nowrap">
                  {row.slice(pos, positions[ci + 1]).trim()}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatDockerStats(output: string): React.ReactNode {
  const lines = output.split("\n").filter((l) => l.trim());
  if (lines.length < 1 || !lines[0].includes("CONTAINER ID")) {
    return <pre className="text-foreground/80 whitespace-pre-wrap pl-4">{output}</pre>;
  }

  const headers = ["CONTAINER ID", "NAME", "CPU %", "MEM USAGE / LIMIT", "MEM %", "NET I/O", "BLOCK I/O", "PIDS"];
  const headerLine = lines[0];
  const positions = headers.map((h) => headerLine.indexOf(h)).filter((p) => p >= 0);
  positions.push(headerLine.length);

  const rows = lines.slice(1);

  return (
    <div className="pl-4 overflow-x-auto">
      <table className="text-[11px] font-mono border-collapse">
        <thead>
          <tr className="text-muted border-b border-border">
            {headers.map((h, i) => (
              <th key={i} className="text-left px-2 py-1 whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className="border-b border-border/30 hover:bg-background/30">
              {positions.slice(0, -1).map((pos, ci) => (
                <td key={ci} className="px-2 py-1 text-foreground/80 whitespace-nowrap">
                  {row.slice(pos, positions[ci + 1]).trim()}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatDockerNetworkLs(output: string): React.ReactNode {
  const lines = output.split("\n").filter((l) => l.trim());
  if (lines.length < 1 || !lines[0].includes("NETWORK ID")) {
    return <pre className="text-foreground/80 whitespace-pre-wrap pl-4">{output}</pre>;
  }
  const headers = ["NETWORK ID", "NAME", "DRIVER", "SCOPE"];
  const headerLine = lines[0];
  const positions = headers.map((h) => headerLine.indexOf(h)).filter((p) => p >= 0);
  positions.push(headerLine.length);
  const rows = lines.slice(1);

  return (
    <div className="pl-4 overflow-x-auto">
      <table className="text-[11px] font-mono border-collapse">
        <thead>
          <tr className="text-muted border-b border-border">
            {headers.map((h, i) => (
              <th key={i} className="text-left px-2 py-1 whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className="border-b border-border/30 hover:bg-background/30">
              {positions.slice(0, -1).map((pos, ci) => (
                <td key={ci} className="px-2 py-1 text-foreground/80 whitespace-nowrap">
                  {row.slice(pos, positions[ci + 1]).trim()}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatDockerVolumeLs(output: string): React.ReactNode {
  const lines = output.split("\n").filter((l) => l.trim());
  if (lines.length < 1 || !lines[0].includes("VOLUME NAME")) {
    return <pre className="text-foreground/80 whitespace-pre-wrap pl-4">{output}</pre>;
  }
  const headers = ["DRIVER", "VOLUME NAME"];
  const headerLine = lines[0];
  const positions = headers.map((h) => headerLine.indexOf(h)).filter((p) => p >= 0);
  positions.push(headerLine.length);
  const rows = lines.slice(1);

  return (
    <div className="pl-4 overflow-x-auto">
      <table className="text-[11px] font-mono border-collapse">
        <thead>
          <tr className="text-muted border-b border-border">
            {headers.map((h, i) => (
              <th key={i} className="text-left px-2 py-1 whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className="border-b border-border/30 hover:bg-background/30">
              {positions.slice(0, -1).map((pos, ci) => (
                <td key={ci} className="px-2 py-1 text-foreground/80 whitespace-nowrap">
                  {row.slice(pos, positions[ci + 1]).trim()}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
