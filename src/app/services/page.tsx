"use client";

import { useState } from "react";
import { ContainersPanel } from "@/components/ContainersPanel";
import { ProxyPanel } from "@/components/ProxyPanel";
import { ProjectsPanel } from "@/components/ProjectsPanel";
import { DeploymentsPanel } from "@/components/DeploymentsPanel";
import CloudflarePanel from "@/components/CloudflarePanel";
import { BootstrapPanel } from "@/components/BootstrapPanel";
import TerraformStacksTab from "@/components/TerraformStacksTab";

type TabKey = "containers" | "proxy" | "projects" | "deployments" | "cloudflare" | "bootstrap" | "infrastructure";

export default function ServicesPage() {
  const [activeTab, setActiveTab] = useState<TabKey>("containers");

  const tabs = [
    { key: "containers", label: "Containers" },
    { key: "proxy", label: "Proxy" },
    { key: "projects", label: "Projects" },
    { key: "deployments", label: "Deployments" },
    { key: "cloudflare", label: "Cloudflare" },
    { key: "bootstrap", label: "Install" },
    { key: "infrastructure", label: "Infrastructure" },
  ];

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Services</h1>
        {/* Tabs */}
        <div className="flex items-center gap-1 overflow-x-auto pb-1 -mx-2 px-2">
          {tabs.map((tab) => {
            const active = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key as TabKey)}
                className={`shrink-0 px-4 py-2 text-xs font-mono border transition-colors whitespace-nowrap ${
                  active
                    ? "border-accent text-accent"
                    : "border-transparent text-muted hover:text-foreground hover:border-border"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {activeTab === "containers" && <ContainersPanel />}
      {activeTab === "proxy" && <ProxyPanel />}
      {activeTab === "projects" && <ProjectsPanel />}
      {activeTab === "deployments" && <DeploymentsPanel />}
      {activeTab === "cloudflare" && <CloudflarePanel />}
      {activeTab === "bootstrap" && <BootstrapPanel />}
      {activeTab === "infrastructure" && <TerraformStacksTab />}
    </div>
  );
}
