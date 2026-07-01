"use client";

import { useState } from "react";
import { ContainersPanel } from "@/components/ContainersPanel";
import { ProxyPanel } from "@/components/ProxyPanel";
import { ProjectsPanel } from "@/components/ProjectsPanel";
import { DeploymentsPanel } from "@/components/DeploymentsPanel";
import { BootstrapPanel } from "@/components/BootstrapPanel";
import TerraformStacksTab from "@/components/TerraformStacksTab";

type TabKey = "containers" | "proxy" | "deployments" | "bootstrap" | "infrastructure";

export default function ServicesPage() {
  const [activeTab, setActiveTab] = useState<TabKey>("containers");

  const tabs = [
    { key: "containers", label: "Containers" },
    { key: "proxy", label: "Proxy" },
    { key: "deployments", label: "Deployments" },
    { key: "bootstrap", label: "Install" },
    { key: "infrastructure", label: "Infrastructure" },
  ];

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Services</h1>
        <label className="mt-4 block md:hidden">
          <span className="mb-1 block text-[10px] font-mono uppercase tracking-wider text-muted">Section</span>
          <select
            value={activeTab}
            onChange={(event) => setActiveTab(event.target.value as TabKey)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono text-foreground outline-none focus:border-accent"
          >
            {tabs.map((tab) => (
              <option key={tab.key} value={tab.key}>
                {tab.label}
              </option>
            ))}
          </select>
        </label>
        <div className="mt-4 hidden flex-wrap items-center gap-1 pb-1 md:flex">
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
      {activeTab === "deployments" && (
        <div className="space-y-8">
          <ProjectsPanel />
          <DeploymentsPanel />
        </div>
      )}
      {activeTab === "bootstrap" && <BootstrapPanel />}
      {activeTab === "infrastructure" && <TerraformStacksTab />}
    </div>
  );
}
