"use client";

import { useState } from "react";
import { ModalSurface } from "@/components/ModalSurface";
import { Button, Notice } from "@/components/ui";

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

  return (
    <ModalSurface
      open={open}
      onClose={() => {
        setInput("");
        onCancel();
      }}
      title={`Delete ${resourceType}`}
      description="This action cannot be undone."
      size="sm"
      tone="danger"
      footer={
        <>
          <Button onClick={() => { setInput(""); onCancel(); }} variant="quiet">Cancel</Button>
          <Button
            onClick={() => { if (match) { setInput(""); onConfirm(); } }}
            disabled={!match}
            variant="danger"
          >
            Delete {resourceType}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Notice tone="danger">
          Type <strong className="font-mono text-foreground">{resourceName}</strong> to confirm deletion.
        </Notice>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={`Type "${resourceName}" to confirm`}
          className="gc-field w-full"
          autoFocus
        />
      </div>
    </ModalSurface>
  );
}
