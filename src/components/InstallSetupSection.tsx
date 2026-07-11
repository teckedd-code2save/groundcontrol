"use client";

import { useState } from "react";

const BOOTSTRAP_URL =
  "https://raw.githubusercontent.com/teckedd-code2save/groundcontrol/main/scripts/bootstrap";

export const INSTALL_COMMANDS = {
  withKey: `curl -fsSL ${BOOTSTRAP_URL} | bash -s -- -i ~/.ssh/id_ed25519 root@YOUR_VPS_IP`,
  interactive: `curl -fsSL ${BOOTSTRAP_URL} | bash -s -- --interactive`,
  local: `curl -fsSL ${BOOTSTRAP_URL} | bash`,
} as const;

export function scrollToInstall() {
  const el = document.getElementById("install");
  if (el) {
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    // Focus first copy button for keyboard users
    window.setTimeout(() => {
      (document.getElementById("install-copy-key") as HTMLButtonElement | null)?.focus();
    }, 400);
  }
}

type Palette = {
  bg: string;
  dark: string;
  darker: string;
  text: string;
  mut: string;
  dim: string;
  lin: string;
  accent?: string;
};

const DEFAULT: Palette = {
  bg: "#202427",
  dark: "#141618",
  darker: "#0D0E10",
  text: "#F5F6F7",
  mut: "rgba(245,246,247,0.45)",
  dim: "rgba(245,246,247,0.22)",
  lin: "rgba(245,246,247,0.08)",
  accent: "#E8542A",
};

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    textArea.style.opacity = "0";
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand("copy");
    document.body.removeChild(textArea);
  }
}

function CopyRow({
  id,
  label,
  hint,
  command,
  colors,
}: {
  id?: string;
  label: string;
  hint: string;
  command: string;
  colors: Palette;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div
      style={{
        border: `1px solid ${colors.lin}`,
        background: colors.darker,
        padding: "16px 18px",
        borderRadius: 10,
      }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 8,
          marginBottom: 10,
        }}
      >
        <div>
          <div style={{ fontSize: 13, fontWeight: 500, color: colors.text }}>{label}</div>
          <div style={{ fontSize: 11, color: colors.mut, marginTop: 4, lineHeight: 1.45 }}>{hint}</div>
        </div>
        <button
          id={id}
          type="button"
          onClick={async () => {
            await copyText(command);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2000);
          }}
          style={{
            padding: "8px 14px",
            background: "transparent",
            color: copied ? (colors.accent || "#E8542A") : colors.text,
            border: `1px solid ${copied ? colors.accent || "#E8542A" : colors.lin}`,
            fontFamily: "monospace",
            fontSize: 11,
            cursor: "pointer",
            borderRadius: 8,
            whiteSpace: "nowrap",
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <code
        style={{
          display: "block",
          fontSize: 11,
          color: colors.mut,
          fontFamily: "ui-monospace, monospace",
          lineHeight: 1.55,
          overflowWrap: "anywhere",
          whiteSpace: "pre-wrap",
        }}
      >
        {command}
      </code>
    </div>
  );
}

/** Full install / setup block for marketing pages. Anchor: #install */
export function InstallSetupSection({ colors = DEFAULT }: { colors?: Partial<Palette> }) {
  const C = { ...DEFAULT, ...colors };
  return (
    <section
      id="install"
      style={{
        padding: "100px 0",
        background: C.darker,
        borderTop: `1px solid ${C.lin}`,
        scrollMarginTop: 24,
      }}
    >
      <div className="max-w-3xl mx-auto px-6 md:px-12">
        <p
          style={{
            fontSize: 11,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: C.accent || "#E8542A",
            fontFamily: "monospace",
            marginBottom: 12,
          }}
        >
          Install · Setup
        </p>
        <h2
          style={{
            fontSize: "clamp(26px, 4vw, 36px)",
            fontWeight: 300,
            lineHeight: 1.15,
            margin: "0 0 12px",
            color: C.text,
          }}
        >
          Put GroundControl on your VPS
        </h2>
        <p style={{ fontSize: 15, color: C.mut, lineHeight: 1.65, margin: "0 0 28px", maxWidth: 520 }}>
          One command installs Docker if needed and starts GroundControl. Then open the URL and finish
          onboarding. Replace the key path and host with yours.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <CopyRow
            id="install-copy-key"
            label="Remote install with SSH key"
            hint="Same idea as ssh -i ~/.ssh/… root@host — recommended."
            command={INSTALL_COMMANDS.withKey}
            colors={C}
          />
          <CopyRow
            label="Interactive install"
            hint="Prompts for host, private key path, and SSH port (works with curl | bash)."
            command={INSTALL_COMMANDS.interactive}
            colors={C}
          />
          <CopyRow
            label="Local install"
            hint="Run on the VPS itself when you already have a shell there."
            command={INSTALL_COMMANDS.local}
            colors={C}
          />
        </div>

        <div
          style={{
            marginTop: 24,
            padding: "14px 16px",
            border: `1px solid ${C.lin}`,
            borderRadius: 10,
            fontSize: 12,
            color: C.mut,
            lineHeight: 1.6,
          }}
        >
          <strong style={{ color: C.text, fontWeight: 500 }}>After install</strong>
          <ol style={{ margin: "8px 0 0", paddingLeft: 18 }}>
            <li>
              Open{" "}
              <code style={{ color: C.text, fontFamily: "monospace", fontSize: 11 }}>
                http://YOUR_VPS_IP:3737
              </code>
            </li>
            <li>Create your admin account and complete onboarding (SSH or local host)</li>
            <li>Add more servers anytime via Add Server or Settings → Connections</li>
          </ol>
        </div>
      </div>
    </section>
  );
}
