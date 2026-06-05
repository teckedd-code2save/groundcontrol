"use client";

import { useState, useEffect } from "react";

interface FileEntry {
  name: string;
  perms: string;
  owner: string;
  group: string;
  size: string;
  date: string;
  isDir: boolean;
}

interface VpsFilePickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (path: string) => void;
  initialPath?: string;
  selectFile?: boolean; // if false, only allow selecting directories
}

export default function VpsFilePicker({ open, onClose, onSelect, initialPath = "/", selectFile = false }: VpsFilePickerProps) {
  const [path, setPath] = useState(initialPath);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<string[]>([initialPath]);

  useEffect(() => {
    if (open) {
      setPath(initialPath);
      setHistory([initialPath]);
      loadPath(initialPath);
    }
  }, [open, initialPath]);

  async function loadPath(p: string) {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/files?path=${encodeURIComponent(p)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to list directory");
      setFiles(data.files || []);
      setPath(data.path || p);
    } catch (err: any) {
      setError(err.message);
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }

  function enterDir(name: string) {
    const newPath = path.endsWith("/") ? `${path}${name}` : `${path}/${name}`;
    setHistory((h) => [...h, newPath]);
    loadPath(newPath);
  }

  function goUp() {
    const parent = path.replace(/\/?[^/]*$/, "") || "/";
    setHistory((h) => [...h, parent]);
    loadPath(parent);
  }

  function goBack() {
    if (history.length <= 1) return;
    const newHistory = history.slice(0, -1);
    setHistory(newHistory);
    loadPath(newHistory[newHistory.length - 1]);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center pt-[15vh] bg-black/70 p-4">
      <div className="w-full max-w-lg bg-card border border-border rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[70vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <button onClick={goBack} disabled={history.length <= 1} className="text-muted hover:text-foreground disabled:opacity-30 transition-colors">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </button>
            <button onClick={goUp} className="text-muted hover:text-foreground transition-colors">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
              </svg>
            </button>
            <span className="text-xs font-mono text-muted truncate max-w-[200px]">{path}</span>
          </div>
          <button onClick={onClose} className="text-muted hover:text-foreground transition-colors">✕</button>
        </div>

        {/* File list */}
        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="p-8 text-center text-sm text-muted animate-pulse">Loading...</div>
          ) : error ? (
            <div className="p-4 text-sm text-error">{error}</div>
          ) : (
            <div className="divide-y divide-border/50">
              {path !== "/" && (
                <button onClick={goUp} className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-background/50 transition-colors">
                  <svg className="w-4 h-4 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
                  </svg>
                  <span className="text-sm text-muted">..</span>
                </button>
              )}
              {files
                .filter((f) => f.isDir || selectFile)
                .sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1))
                .map((file) => (
                  <div key={file.name} className="flex items-center justify-between px-4 py-2 hover:bg-background/50 transition-colors">
                    <button
                      onClick={() => file.isDir && enterDir(file.name)}
                      className="flex items-center gap-3 flex-1 text-left"
                    >
                      {file.isDir ? (
                        <svg className="w-4 h-4 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                      )}
                      <span className={`text-sm ${file.isDir ? "text-foreground" : "text-muted"}`}>
                        {file.name}
                      </span>
                    </button>
                    {!selectFile && file.isDir && (
                      <button
                        onClick={() => onSelect(path.endsWith("/") ? `${path}${file.name}` : `${path}/${file.name}`)}
                        className="text-[10px] font-mono px-2 py-1 bg-accent/10 border border-accent/30 text-accent rounded hover:bg-accent/20 transition-colors"
                      >
                        Select
                      </button>
                    )}
                    {selectFile && !file.isDir && (
                      <button
                        onClick={() => onSelect(path.endsWith("/") ? `${path}${file.name}` : `${path}/${file.name}`)}
                        className="text-[10px] font-mono px-2 py-1 bg-accent/10 border border-accent/30 text-accent rounded hover:bg-accent/20 transition-colors"
                      >
                        Select
                      </button>
                    )}
                  </div>
                ))}
              {files.length === 0 && !loading && <div className="p-8 text-center text-sm text-muted">Empty directory</div>}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-border">
          <span className="text-[10px] text-muted font-mono">{files.filter((f) => f.isDir).length} dirs</span>
          {!selectFile && (
            <button
              onClick={() => onSelect(path)}
              className="text-xs font-mono px-3 py-1.5 bg-accent/10 border border-accent/30 text-accent rounded hover:bg-accent/20 transition-colors"
            >
              Select Current Dir
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
