"use client";

import { useState } from "react";

interface SensitiveFieldProps {
  value: string | number;
  className?: string;
  maskChar?: string;
  alwaysShowLast?: number;
}

export function SensitiveField({
  value,
  className = "",
  maskChar = "•",
  alwaysShowLast = 0,
}: SensitiveFieldProps) {
  const [revealed, setRevealed] = useState(false);
  const text = String(value);

  const masked =
    text.length === 0
      ? ""
      : alwaysShowLast > 0 && text.length > alwaysShowLast
        ? maskChar.repeat(text.length - alwaysShowLast) + text.slice(-alwaysShowLast)
        : maskChar.repeat(Math.min(text.length, 12));

  return (
    <span
      className={`inline-flex items-center gap-1.5 ${className}`}
      onClick={() => setRevealed(!revealed)}
      title="Click to toggle"
    >
      <span className="font-mono cursor-pointer select-none">
        {revealed ? text : masked}
      </span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setRevealed(!revealed);
        }}
        className="text-muted hover:text-foreground transition-colors text-xs leading-none"
        title={revealed ? "Hide" : "Reveal"}
      >
        {revealed ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
            <line x1="1" y1="1" x2="23" y2="23" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        )}
      </button>
    </span>
  );
}

interface SensitiveInputProps {
  label: string;
  value: string | number;
  onChange: (val: string) => void;
  type?: "text" | "password" | "number" | "textarea";
  placeholder?: string;
  rows?: number;
  className?: string;
}

export function SensitiveInput({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  rows = 6,
  className = "",
}: SensitiveInputProps) {
  const [revealed, setRevealed] = useState(false);
  const inputType = type === "password" ? (revealed ? "text" : "password") : type;

  const baseClasses =
    "w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent transition-colors";

  return (
    <div className={className}>
      <div className="flex items-center justify-between mb-1.5">
        <label className="block text-xs font-mono text-muted">{label}</label>
        <button
          type="button"
          onClick={() => setRevealed(!revealed)}
          className="text-muted hover:text-foreground transition-colors text-xs flex items-center gap-1"
        >
          {revealed ? (
            <>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                <line x1="1" y1="1" x2="23" y2="23" />
              </svg>
              hide
            </>
          ) : (
            <>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              show
            </>
          )}
        </button>
      </div>
      {type === "textarea" ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={rows}
          placeholder={placeholder}
          className={`${baseClasses} font-mono resize-none`}
        />
      ) : (
        <input
          type={inputType}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={baseClasses}
        />
      )}
    </div>
  );
}
