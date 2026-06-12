"use client";

import { useState } from "react";
import { ContainersPanel } from "@/components/ContainersPanel";
import { ProxyPanel } from "@/components/ProxyPanel";
import { ProjectsPanel } from "@/components/ProjectsPanel";
import CloudflarePanel from "@/components/CloudflarePanel";
import { BootstrapPanel } from "@/components/BootstrapPanel";

type TabKey = "containers" | "proxy" | "projects" | "cloudflare" | "bootstrap";

export default function ServicesPage() {
  const [activeTab, setActiveTab] = useState<TabKey>("containers");

  const tabs = [
    { key: "containers", label: "Containers" },
    { key: "proxy", label: "Proxy" },
    { key: "projects", label: "Projects" },
    { key: "cloudflare", label: "Cloudflare" },
    { key: "bootstrap", label: "Install" },
  ];

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Services</h1>
        <p className="text-muted mt-1">Containers, reverse proxy, projects, Cloudflare, and one-click installs</p>
      </div>

      <div className="flex items-center gap-1 border-b border-border mb-6 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as TabKey)}
            className={`px-5 py-2.5 text-xs font-mono uppercase tracking-wider border-b-2 transition-colors whitespace-nowrap ${
              activeTab === tab.key
                ? "border-accent text-accent"
                : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "containers" && <ContainersPanel />}
      {activeTab === "proxy" && <ProxyPanel />}
      {activeTab === "projects" && <ProjectsPanel />}
      {activeTab === "cloudflare" && <CloudflarePanel />}
      {activeTab === "bootstrap" && <BootstrapPanel />}
    </div>
  );
}
