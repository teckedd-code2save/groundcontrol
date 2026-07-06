"use client";

import { useState } from "react";
import { ContainersPanel } from "@/components/ContainersPanel";
import { ProjectsPanel } from "@/components/ProjectsPanel";
import { BootstrapPanel } from "@/components/BootstrapPanel";
import TerraformStacksTab from "@/components/TerraformStacksTab";

type TabKey = "containers" | "deployments" | "bootstrap" | "infrastructure";

export default function ServicesPage() {
  const [activeTab, setActiveTab] = useState<TabKey>("containers");

  const tabs = [
    { key: "containers", label: "Containers" },
    { key: "deployments", label: "Deployments" },
    { key: "bootstrap", label: "Install" },
    { key: "infrastructure", label: "Infrastructure" },
  ];

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Services</h1>
        <label className="mt-4 block md:hidden">
          <span className="mb-1 block text-[10px] font-mono tracking-wider text-muted">Section</span>
          <select
            value={activeTab}
            onChange={(event) => setActiveTab(event.target.value as TabKey)}
            className="w-full rounded-lg bg-background px-3 py-2 text-sm font-mono text-foreground outline-none focus:ring-1 focus:ring-accent"
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
                className={`shrink-0 rounded-lg px-4 py-2 text-xs font-mono transition-colors whitespace-nowrap ${
                  active
                    ? "bg-accent/10 text-accent"
                    : "text-muted hover:bg-card hover:text-foreground"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {activeTab === "containers" && <ContainersPanel />}
      {activeTab === "deployments" && <ProjectsPanel />}
      {activeTab === "bootstrap" && <BootstrapPanel />}
      {activeTab === "infrastructure" && <TerraformStacksTab />}
    </div>
  );
}
