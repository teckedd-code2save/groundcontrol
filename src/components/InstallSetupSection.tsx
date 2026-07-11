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
    window.setTimeout(() => {
      (document.getElementById("install-copy-key") as HTMLButtonElement | null)?.focus();
    }, 400);
  }
}

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

const rows: { id?: string; label: string; badge?: string; hint: string; command: string }[] = [
  {
    id: "install-copy-key",
    label: "Remote with SSH key",
    badge: "Recommended",
    hint: "Same as ssh -i — pass your private key and user@host.",
    command: INSTALL_COMMANDS.withKey,
  },
  {
    label: "Interactive",
    hint: "Prompts for host, key path, or paste PEM private key (curl | bash).",
    command: INSTALL_COMMANDS.interactive,
  },
  {
    label: "Local",
    hint: "Run on the VPS when you already have a shell open.",
    command: INSTALL_COMMANDS.local,
  },
];

/** Full install / setup block. Anchor: #install */
export function InstallSetupSection() {
  return (
    <section
      id="install"
      className="scroll-mt-6 border-t border-white/[0.06] bg-[#0D0E10] py-20 md:py-24"
    >
      <div className="mx-auto max-w-2xl px-6 md:px-8">
        <p className="mb-3 text-[11px] font-medium tracking-[0.16em] text-[#E8542A]/90 uppercase">
          Setup
        </p>
        <h2 className="mb-3 text-[clamp(1.5rem,3.5vw,2rem)] font-medium tracking-tight text-[#F5F6F7]">
          Install on your VPS
        </h2>
        <p className="mb-10 max-w-lg text-[15px] leading-relaxed text-white/45">
          One command installs Docker if needed and starts GroundControl. Use your{" "}
          <span className="text-white/70">private</span> key path (not{" "}
          <span className="font-mono text-[12px] text-white/55">.pub</span>), or run interactive
          and choose paste. Then open the URL to finish onboarding.
        </p>

        <div className="space-y-3">
          {rows.map((row) => (
            <InstallCommandCard key={row.label} {...row} />
          ))}
        </div>

        <div className="mt-8 rounded-xl bg-white/[0.03] px-5 py-4 text-[13px] leading-relaxed text-white/40">
          <p className="mb-2 font-medium text-white/70">After install</p>
          <ol className="list-decimal space-y-1.5 pl-4">
            <li>
              Open{" "}
              <code className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[12px] text-white/70">
                http://YOUR_VPS_IP:3737
              </code>
            </li>
            <li>Create your admin account and complete onboarding</li>
            <li>Add more hosts later via Add Server or Settings → Connections</li>
          </ol>
        </div>
      </div>
    </section>
  );
}

function InstallCommandCard({
  id,
  label,
  badge,
  hint,
  command,
}: {
  id?: string;
  label: string;
  badge?: string;
  hint: string;
  command: string;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="overflow-hidden rounded-xl border border-white/[0.07] bg-[#141618]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.05] px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-[#F5F6F7]">{label}</span>
            {badge ? (
              <span className="rounded-full bg-[#E8542A]/12 px-2 py-0.5 text-[10px] font-medium tracking-wide text-[#E8542A]">
                {badge}
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 text-[12px] text-white/40">{hint}</p>
        </div>
        <button
          id={id}
          type="button"
          onClick={async () => {
            await copyText(command);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2000);
          }}
          className={`shrink-0 rounded-lg px-3.5 py-2 text-[12px] font-medium transition-colors ${
            copied
              ? "bg-[#E8542A] text-white"
              : "bg-white/[0.06] text-white/80 hover:bg-white/[0.1] hover:text-white"
          }`}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto px-4 py-3.5 font-mono text-[11.5px] leading-relaxed text-white/50 sm:px-5 sm:text-[12px]">
        {command}
      </pre>
    </div>
  );
}
