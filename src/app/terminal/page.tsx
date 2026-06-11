"use client";

import { useEffect, useRef, useState } from "react";

interface HistoryEntry {
  type: "input" | "output" | "error" | "hint";
  text: string;
  cmd?: string;
}

// The remote VPS shell is BusyBox/sh — `bash` is not installed. Detect a
// leading `bash` invocation and rewrite it to a POSIX-sh equivalent, surfacing
// a hint so the user understands why. Mirrors the server-side fallback.
function rewriteBashCommand(cmd: string): { command: string; hint?: string } {
  // Match a leading `bash` token (optionally `/bin/bash`, `/usr/bin/bash`).
  const m = cmd.match(/^((?:\/usr)?\/bin\/)?bash\b([\s\S]*)$/);
  if (!m) return { command: cmd };

  const rest = (m[2] || "").trimStart();

  // `bash -c "..."` → `sh -c "..."`
  const dashC = rest.match(/^-c\b\s*([\s\S]*)$/);
  if (dashC) {
    return {
      command: `sh -c ${dashC[1]}`.trim(),
      hint: "Remote shell is sh (BusyBox) — `bash` isn't installed. Rewrote `bash -c` → `sh -c`.",
    };
  }

  // `bash script.sh ...` → `sh script.sh ...`
  if (rest) {
    return {
      command: `sh ${rest}`,
      hint: "Remote shell is sh (BusyBox) — `bash` isn't installed. Rewrote `bash` → `sh`.",
    };
  }

  // Bare `bash` (would open an interactive shell, which we can't do here).
  return {
    command: "sh",
    hint: "Remote shell is sh (BusyBox) — `bash` isn't installed. Drop the `bash` prefix and run commands directly.",
  };
}

export default function TerminalPage() {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
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

  async function executeCommand(
    cmd: string,
    currentCwd: string,
    opts?: { skipInputEcho?: boolean }
  ) {
    setWorking(true);
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
    } catch (err: any) {
      setHistory((h) => [...h, { type: "error", text: err.message, cmd }]);
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
      let newCwd: string;
      if (target.startsWith("/")) {
        newCwd = target;
      } else {
        newCwd = cwd === "/" ? `/${target}` : `${cwd}/${target}`;
      }
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

    // sh-portability: the remote shell is BusyBox/sh, not bash. Rewrite a
    // leading `bash` and tell the user what happened.
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

    // Docker ps
    if (cmd.startsWith("docker ps") || cmd.startsWith("docker container ls")) {
      return formatDockerPs(text);
    }
    // Docker images
    if (cmd.startsWith("docker images") || cmd.startsWith("docker image ls")) {
      return formatDockerImages(text);
    }
    // Docker stats
    if (cmd.startsWith("docker stats")) {
      return formatDockerStats(text);
    }
    // Docker network ls
    if (cmd.startsWith("docker network ls")) {
      return formatDockerNetworkLs(text);
    }
    // Docker volume ls
    if (cmd.startsWith("docker volume ls")) {
      return formatDockerVolumeLs(text);
    }

    return <pre className="text-foreground/80 whitespace-pre-wrap pl-4">{text}</pre>;
  }

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto h-[calc(100vh-2rem)] flex flex-col">
      <div className="mb-4">
        <h1 className="text-3xl font-bold tracking-tight">Terminal</h1>
        <p className="text-muted mt-1">Execute commands on your VPS directly from the browser</p>
        <p className="text-warning/70 text-xs font-mono mt-1">
          Remote shell is <span className="font-semibold">sh</span> (BusyBox) — <span className="font-semibold">bash</span> is not installed. Use POSIX sh syntax.
        </p>
      </div>

      <div className="flex-1 bg-card border border-border rounded-xl flex flex-col overflow-hidden">
        <div className="flex-1 p-4 overflow-auto font-mono text-sm scrollbar-thin">
          {history.length === 0 && (
            <div className="text-muted text-sm">
              <p>GroundControl Terminal v1.0</p>
              <p className="mt-1">Type commands to execute on the VPS. Use with care.</p>
              <p className="mt-1">Mounted: /opt, /var/www, /etc, /var/run/docker.sock</p>
              <p className="mt-1 text-warning/70">Shell: sh (BusyBox) — bash is not available; `bash ...` is auto-rewritten to `sh ...`.</p>
            </div>
          )}
          {history.map((entry, i) => (
            <div key={i} className="mb-2">
              {formatOutput(entry)}
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

// Formatters for common docker commands

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
