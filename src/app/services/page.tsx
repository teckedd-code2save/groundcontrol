"use client";

import { useState } from "react";
import { ContainersPanel } from "@/components/ContainersPanel";
import { ProjectsPanel } from "@/components/ProjectsPanel";
import { BootstrapPanel } from "@/components/BootstrapPanel";
import TerraformStacksTab from "@/components/TerraformStacksTab";
import { PageHeader } from "@/components/PageHeader";

type TabKey = "containers" | "deployments" | "bootstrap" | "infrastructure";

const tabs: { key: TabKey; label: string; description: string }[] = [
  { key: "containers", label: "Containers", description: "Runtime state, health, images, and safe actions" },
  { key: "deployments", label: "Deployments", description: "Apps, components, routes, env, and release history" },
  { key: "bootstrap", label: "Install", description: "Host tools, package checks, and setup actions" },
  { key: "infrastructure", label: "Infrastructure", description: "Stacks, plans, applies, and protected resources" },
];

export default function ServicesPage() {
  const [activeTab, setActiveTab] = useState<TabKey>("containers");
  const activeTabMeta = tabs.find((tab) => tab.key === activeTab) || tabs[0];

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto">
      <div className="mb-5 flex flex-col gap-1">
        <PageHeader title="Services" description={activeTabMeta.description} className="mb-0" />
        <label className="mt-4 block md:hidden">
          <span className="mb-1 block text-[10px] font-mono text-muted">Section</span>
          <select
            value={activeTab}
            onChange={(event) => setActiveTab(event.target.value as TabKey)}
            className="w-full rounded-md bg-background px-3 py-2 text-sm font-mono text-foreground outline-none focus:ring-1 focus:ring-accent"
          >
            {tabs.map((tab) => (
              <option key={tab.key} value={tab.key}>
                {tab.label}
              </option>
            ))}
          </select>
        </label>
        <div className="mt-4 hidden flex-wrap gap-1 rounded-lg bg-card p-1 md:flex">
          {tabs.map((tab) => {
            const active = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                title={tab.description}
                className={`shrink-0 rounded-md px-3 py-2 text-xs font-mono transition-colors whitespace-nowrap ${
                  active
                    ? "bg-accent/10 text-accent"
                    : "text-muted hover:bg-background hover:text-foreground"
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
