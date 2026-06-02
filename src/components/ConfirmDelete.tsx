"use client";

import { useState } from "react";

interface ConfirmDeleteProps {
  open: boolean;
  resourceName: string;
  resourceType: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDelete({ open, resourceName, resourceType, onConfirm, onCancel }: ConfirmDeleteProps) {
  const [input, setInput] = useState("");
  const match = input.trim() === resourceName;

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4">
      <div className="bg-card border border-error/30 rounded-xl w-full max-w-md p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-error/10 flex items-center justify-center text-error">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              <line x1="10" y1="11" x2="10" y2="17" />
              <line x1="14" y1="11" x2="14" y2="17" />
            </svg>
          </div>
          <div>
            <h3 className="font-medium">Delete {resourceType}</h3>
            <p className="text-xs text-muted mt-0.5">
              This action cannot be undone.
            </p>
          </div>
        </div>

        <div className="bg-error/5 border border-error/20 rounded-lg p-3 mb-4">
          <p className="text-xs text-error/80">
            Type <strong className="font-mono">{resourceName}</strong> to confirm deletion.
          </p>
        </div>

        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={`Type "${resourceName}" to confirm`}
          className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-error transition-colors mb-4"
          autoFocus
        />

        <div className="flex gap-3 justify-end">
          <button
            onClick={() => {
              setInput("");
              onCancel();
            }}
            className="px-4 py-2 text-xs font-mono border border-border rounded-lg hover:border-accent hover:text-accent transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              if (match) {
                setInput("");
                onConfirm();
              }
            }}
            disabled={!match}
            className="px-4 py-2 text-xs font-mono bg-error/10 border border-error/30 text-error rounded-lg hover:bg-error/20 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Delete {resourceType}
          </button>
        </div>
      </div>
    </div>
  );
}
