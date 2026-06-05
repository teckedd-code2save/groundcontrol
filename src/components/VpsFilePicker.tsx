"use client";

import { useState, useEffect, useCallback } from "react";

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
  selectFile?: boolean;
}

export default function VpsFilePicker({ open, onClose, onSelect, initialPath = "/", selectFile = false }: VpsFilePickerProps) {
  const [path, setPath] = useState(initialPath);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadPath = useCallback(async (p: string) => {
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
  }, []);

  useEffect(() => {
    if (open) {
      const start = initialPath && initialPath.startsWith("/") ? initialPath : "/";
      setPath(start);
      loadPath(start);
    }
  }, [open, initialPath, loadPath]);

  function enterDir(name: string) {
    const newPath = path.endsWith("/") ? `${path}${name}` : `${path}/${name}`;
    loadPath(newPath);
  }

  function goUp() {
    const parent = path.replace(/\/?[^/]*$/, "") || "/";
    loadPath(parent);
  }

  function selectCurrent() {
    onSelect(path);
  }

  function selectEntry(name: string, isDir: boolean) {
    const fullPath = path.endsWith("/") ? `${path}${name}` : `${path}/${name}`;
    if (!selectFile && isDir) {
      onSelect(fullPath);
    } else if (selectFile && !isDir) {
      onSelect(fullPath);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center pt-[15vh] bg-black/70 p-4">
      <div className="w-full max-w-lg bg-card border border-border rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[70vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2 min-w-0">
            <button onClick={goUp} disabled={path === "/"} className="text-muted hover:text-foreground disabled:opacity-30 transition-colors shrink-0">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
              </svg>
            </button>
            <span className="text-xs font-mono text-muted truncate">{path}</span>
          </div>
          <button onClick={onClose} className="text-muted hover:text-foreground transition-colors shrink-0">✕</button>
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
                .filter((f) => f.name !== "." && f.name !== "..")
                .sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1))
                .map((file) => (
                  <div key={file.name} className="flex items-center px-4 py-2 hover:bg-background/50 transition-colors group">
                    <button
                      onClick={() => file.isDir ? enterDir(file.name) : selectEntry(file.name, false)}
                      className="flex items-center gap-3 flex-1 text-left min-w-0"
                    >
                      {file.isDir ? (
                        <svg className="w-4 h-4 text-accent shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4 text-muted shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                      )}
                      <span className={`text-sm truncate ${file.isDir ? "text-foreground" : "text-muted"}`}>
                        {file.name}
                      </span>
                    </button>
                    {/* Select button — visible on hover or for non-navigable items */}
                    {(!selectFile && file.isDir) || (selectFile && !file.isDir) ? (
                      <button
                        onClick={() => selectEntry(file.name, file.isDir)}
                        className="text-[10px] font-mono px-2 py-1 bg-accent/10 border border-accent/30 text-accent rounded hover:bg-accent/20 transition-colors opacity-0 group-hover:opacity-100"
                      >
                        Select
                      </button>
                    ) : null}
                  </div>
                ))}
              {files.length === 0 && !loading && <div className="p-8 text-center text-sm text-muted">Empty directory</div>}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-border">
          <span className="text-[10px] text-muted font-mono">{files.filter((f) => f.isDir).length} dirs · {files.filter((f) => !f.isDir).length} files</span>
          <button
            onClick={selectCurrent}
            className="text-xs font-mono px-3 py-1.5 bg-accent/10 border border-accent/30 text-accent rounded hover:bg-accent/20 transition-colors"
          >
            Select Current Dir
          </button>
        </div>
      </div>
    </div>
  );
}
