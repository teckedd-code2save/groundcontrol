"use client";

import { useEffect, useState } from "react";
import { SensitiveField } from "@/components/SensitiveField";

interface FileEntry {
  name: string;
  perms: string;
  owner: string;
  group: string;
  size: string;
  date: string;
  isDir: boolean;
}

export default function FilesPage() {
  const [path, setPath] = useState("/opt");
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState<string[]>(["/opt"]);

  async function loadFiles(newPath: string) {
    setLoading(true);
    try {
      const res = await fetch(`/api/files?path=${encodeURIComponent(newPath)}`);
      const data = await res.json();
      setFiles(data.files || []);
      setPath(newPath);
    } catch {
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadFiles("/opt");
  }, []);

  function navigateTo(name: string) {
    const newPath = path.endsWith("/") ? `${path}${name}` : `${path}/${name}`;
    setHistory([...history, newPath]);
    loadFiles(newPath);
  }

  function goBack() {
    if (history.length > 1) {
      const newHistory = history.slice(0, -1);
      setHistory(newHistory);
      loadFiles(newHistory[newHistory.length - 1]);
    }
  }

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Files</h1>
        <p className="text-muted mt-1">Browse the VPS filesystem</p>
      </div>

      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={goBack}
          disabled={history.length <= 1}
          className="px-3 py-1.5 text-xs font-mono border border-border rounded-lg hover:border-accent transition-colors disabled:opacity-30"
        >
          ← back
        </button>
        <div className="flex-1 bg-card border border-border rounded-lg px-3 py-2 text-sm font-mono text-muted">
          {path}
        </div>
      </div>

      {loading ? (
        <div className="animate-pulse space-y-2">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="h-10 bg-card border border-border rounded-lg" />
          ))}
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-muted text-xs font-mono uppercase">
                <th className="text-left p-3">Name</th>
                <th className="text-left p-3">Permissions</th>
                <th className="text-left p-3">Owner</th>
                <th className="text-left p-3">Size</th>
                <th className="text-left p-3">Date</th>
              </tr>
            </thead>
            <tbody>
              {files.map((file) => (
                <tr
                  key={file.name}
                  className="border-b border-border/50 hover:bg-background/50 transition-colors"
                >
                  <td className="p-3">
                    {file.isDir ? (
                      <button
                        onClick={() => navigateTo(file.name)}
                        className="flex items-center gap-2 text-accent hover:underline"
                      >
                        <span>📁</span> {file.name}/
                      </button>
                    ) : (
                      <span className="flex items-center gap-2">
                        <span>📄</span> {file.name}
                      </span>
                    )}
                  </td>
                  <td className="p-3 font-mono text-xs text-muted">{file.perms}</td>
                  <td className="p-3 font-mono text-xs text-muted">
                    <SensitiveField value={`${file.owner}:${file.group}`} />
                  </td>
                  <td className="p-3 font-mono text-xs text-muted">{file.size}</td>
                  <td className="p-3 font-mono text-xs text-muted">{file.date}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {files.length === 0 && (
            <p className="text-muted text-sm p-4 text-center">Empty directory</p>
          )}
        </div>
      )}
    </div>
  );
}
