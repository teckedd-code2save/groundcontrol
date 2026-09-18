"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Bot, Maximize2, Minimize2, RefreshCw, Trash2 } from "lucide-react";
import type { Socket } from "socket.io-client";
import { useSidebar } from "@/components/SidebarContext";

type ConnectionState = "connecting" | "connected" | "disconnected" | "error";

type TerminalTarget = {
  vpsId: number;
  host: string;
  username: string;
  cwd: string | null;
};

type ReadyInfo = {
  vpsId: number;
  host: string;
  mode: "local" | "ssh";
  cwd: string | null;
};

export default function TerminalPage() {
  const hostRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<Socket | null>(null);
  const terminalRef = useRef<{ focus: () => void; clear: () => void } | null>(null);
  const [target, setTarget] = useState<TerminalTarget | null>(null);
  const [ready, setReady] = useState<ReadyInfo | null>(null);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [sessionKey, setSessionKey] = useState(0);
  const { setCollapsed } = useSidebar();

  useEffect(() => {
    if (fullscreen) setCollapsed(true);
  }, [fullscreen, setCollapsed]);

  useEffect(() => {
    let disposed = false;
    let resizeObserver: ResizeObserver | null = null;
    let terminal: import("@xterm/xterm").Terminal | null = null;
    let fitAddon: import("@xterm/addon-fit").FitAddon | null = null;
    let socket: import("socket.io-client").Socket | null = null;

    async function boot() {
      setConnection("connecting");
      setError(null);
      setReady(null);

      const query = new URLSearchParams(window.location.search);
      const requestedVpsId = query.get("vpsId");
      const requestedCwd = query.get("cwd");
      const targetUrl = requestedVpsId
        ? `/api/terminal?vpsId=${encodeURIComponent(requestedVpsId)}`
        : "/api/terminal";

      const response = await fetch(targetUrl);
      const data = await response.json();
      if (!response.ok || data.error) throw new Error(data.error || "Could not resolve terminal target");
      if (disposed) return;

      const resolvedTarget: TerminalTarget = {
        vpsId: data.vpsId,
        host: data.host,
        username: data.username || "root",
        cwd: typeof data.cwd === "string" ? data.cwd : null,
      };
      setTarget(resolvedTarget);

      const [{ Terminal }, { FitAddon }, { io }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
        import("socket.io-client"),
      ]);
      if (disposed || !hostRef.current) return;

      terminal = new Terminal({
        cursorBlink: true,
        cursorStyle: "bar",
        convertEol: false,
        scrollback: 10000,
        fontSize: 13,
        lineHeight: 1.2,
        fontFamily: "SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace",
        theme: {
          background: "#0b0e0c",
          foreground: "#f1f2eb",
          cursor: "#94d85a",
          cursorAccent: "#0b0e0c",
          selectionBackground: "#4e5fd566",
          black: "#151916",
          red: "#f06b52",
          green: "#94d85a",
          yellow: "#e7b75b",
          blue: "#6578ea",
          magenta: "#9b82ef",
          cyan: "#72c9b8",
          white: "#f1f2eb",
          brightBlack: "#626960",
          brightRed: "#ff836d",
          brightGreen: "#afe978",
          brightYellow: "#f3ca75",
          brightBlue: "#8090ff",
          brightMagenta: "#b99fff",
          brightCyan: "#8fe0d0",
          brightWhite: "#ffffff",
        },
      });
      fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.open(hostRef.current);
      terminal.parser.registerOscHandler(52, () => true);
      terminal.attachCustomKeyEventHandler((event) => {
        if (event.type !== "keydown") return true;
        if (event.key === "Tab") {
          event.preventDefault();
          return true;
        }
        if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "c" && terminal?.hasSelection()) {
          event.preventDefault();
          void navigator.clipboard?.writeText(terminal.getSelection());
          return false;
        }
        return true;
      });
      fitAddon.fit();
      terminal.focus();
      terminalRef.current = terminal;

      socket = io({
        path: "/socket.io",
        transports: ["websocket"],
        withCredentials: true,
        reconnection: true,
        reconnectionAttempts: 6,
        reconnectionDelay: 600,
        timeout: 12000,
      });
      socketRef.current = socket;

      terminal.onData((chunk) => {
        if (socket?.connected) socket.emit("terminal:input", chunk);
      });
      terminal.onResize(({ cols, rows }) => {
        if (socket?.connected) socket.emit("terminal:resize", { cols, rows });
      });

      const startSession = () => {
        if (!terminal || !socket) return;
        setConnection("connecting");
        socket.emit("terminal:start", {
          vpsId: resolvedTarget.vpsId,
          cwd: requestedCwd || resolvedTarget.cwd || undefined,
          cols: terminal.cols,
          rows: terminal.rows,
        }, (ack: { ok?: boolean; error?: string }) => {
          if (!ack?.ok && ack?.error) {
            setConnection("error");
            setError(ack.error);
          }
        });
      };

      socket.on("connect", startSession);
      socket.on("terminal:ready", (info: ReadyInfo) => {
        setReady(info);
        setConnection("connected");
        setError(null);
        window.setTimeout(() => {
          fitAddon?.fit();
          terminal?.focus();
        }, 0);
      });
      socket.on("terminal:output", (chunk: string) => terminal?.write(chunk));
      socket.on("terminal:error", (payload: { message?: string }) => {
        const message = payload?.message || "Terminal session failed";
        setConnection("error");
        setError(message);
        terminal?.writeln(`\r\n\x1b[31m[GroundControl] ${message}\x1b[0m`);
      });
      socket.on("terminal:exit", () => {
        setConnection("disconnected");
        terminal?.writeln("\r\n\x1b[90m[GroundControl] session ended\x1b[0m");
      });
      socket.on("disconnect", () => {
        if (!disposed) setConnection("disconnected");
      });
      socket.on("connect_error", (connectError: Error) => {
        if (disposed) return;
        setConnection("error");
        setError(connectError.message || "Could not connect terminal transport");
      });

      resizeObserver = new ResizeObserver(() => {
        try { fitAddon?.fit(); } catch {}
      });
      resizeObserver.observe(hostRef.current);
    }

    boot().catch((bootError) => {
      if (disposed) return;
      setConnection("error");
      setError(bootError instanceof Error ? bootError.message : String(bootError));
    });

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      try { socket?.emit("terminal:close"); } catch {}
      socket?.disconnect();
      terminal?.dispose();
      socketRef.current = null;
      terminalRef.current = null;
    };
  }, [sessionKey]);

  function sendControl(data: string) {
    socketRef.current?.emit("terminal:input", data);
    terminalRef.current?.focus();
  }

  const stateLabel = connection === "connected"
    ? "Connected"
    : connection === "connecting"
      ? "Connecting"
      : connection === "error"
        ? "Attention"
        : "Disconnected";

  const shellLabel = target
    ? `${target.username}@${target.host}`
    : "Resolving target";

  const pageClass = fullscreen
    ? "fixed inset-0 z-[80] flex flex-col bg-background p-3 md:p-4"
    : "mx-auto flex h-[calc(100vh-2rem)] w-full max-w-[1500px] flex-col p-3 md:p-6";

  return (
    <div className={pageClass}>
      <header className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${
              connection === "connected"
                ? "bg-success"
                : connection === "connecting"
                  ? "animate-pulse bg-warning"
                  : "bg-error"
            }`} />
            <h1 className="truncate font-mono text-sm font-medium">{shellLabel}</h1>
            <span className="hidden font-mono text-[10px] text-muted sm:inline">
              {ready?.mode === "ssh" ? "SSH PTY" : ready?.mode === "local" ? "Host PTY" : "Terminal"}
            </span>
          </div>
          <p className="mt-1 truncate font-mono text-[10px] text-muted">
            {error || `${stateLabel} · native shell session · Tab and control keys go directly to the host`}
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          <Link href="/ai" className="gc-button gc-button-quiet" title="Open GroundControl intelligence">
            <Bot size={13} aria-hidden="true" />
            <span className="hidden sm:inline">Copilot</span>
          </Link>
          <button
            type="button"
            onClick={() => terminalRef.current?.clear()}
            className="gc-button gc-button-quiet"
            title="Clear terminal viewport"
          >
            <Trash2 size={13} aria-hidden="true" />
            <span className="hidden sm:inline">Clear</span>
          </button>
          <button
            type="button"
            onClick={() => setSessionKey((value) => value + 1)}
            className="gc-button gc-button-quiet"
            title="Start a fresh terminal session"
          >
            <RefreshCw size={13} aria-hidden="true" />
            <span className="hidden sm:inline">New session</span>
          </button>
          <button
            type="button"
            onClick={() => setFullscreen((value) => !value)}
            className="gc-button gc-button-quiet"
            title={fullscreen ? "Exit fullscreen" : "Fullscreen terminal"}
          >
            {fullscreen ? <Minimize2 size={13} aria-hidden="true" /> : <Maximize2 size={13} aria-hidden="true" />}
          </button>
        </div>
      </header>

      <section className="relative flex min-h-0 flex-1 flex-col overflow-hidden border border-border bg-bg-darker shadow-[0_20px_70px_rgba(0,0,0,0.22)]">
        <div className="flex h-8 shrink-0 items-center justify-between border-b border-border bg-card/80 px-3">
          <div className="flex items-center gap-1.5" aria-hidden="true">
            <span className="h-2 w-2 rounded-full bg-error/75" />
            <span className="h-2 w-2 rounded-full bg-warning/75" />
            <span className="h-2 w-2 rounded-full bg-success/75" />
          </div>
          <span className="max-w-[55vw] truncate font-mono text-[9px] text-muted">
            {ready?.cwd || target?.cwd || "home"} · {stateLabel}
          </span>
          <span className="font-mono text-[9px] text-muted">xterm-256color</span>
        </div>

        <div
          ref={hostRef}
          className="min-h-0 flex-1 bg-bg-darker px-2 py-2 md:px-3 md:py-3"
          onClick={() => terminalRef.current?.focus()}
        />

        <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-t border-border bg-card/70 px-2 py-1.5 md:hidden">
          <TerminalKey label="Tab" onClick={() => sendControl("\t")} />
          <TerminalKey label="Esc" onClick={() => sendControl("\x1b")} />
          <TerminalKey label="Ctrl+C" onClick={() => sendControl("\x03")} />
          <TerminalKey label="Ctrl+L" onClick={() => sendControl("\x0c")} />
          <TerminalKey label="↑" onClick={() => sendControl("\x1b[A")} />
          <TerminalKey label="↓" onClick={() => sendControl("\x1b[B")} />
        </div>
      </section>

      <footer className="mt-2 flex flex-wrap items-center justify-between gap-2 font-mono text-[9px] text-muted">
        <span>Tab completion · Ctrl+C interrupt · arrows/history · ANSI · interactive commands</span>
        <span>Session pinned to VPS {target?.vpsId ?? "…"}</span>
      </footer>
    </div>
  );
}

function TerminalKey({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 rounded border border-border bg-background px-2.5 py-1 font-mono text-[10px] text-muted active:border-accent active:text-foreground"
    >
      {label}
    </button>
  );
}
