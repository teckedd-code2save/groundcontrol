"use client";

import { ContainersPanel } from "@/components/ContainersPanel";
import { PageHeader } from "@/components/PageHeader";

export default function ContainersPage() {
  return (
    <div className="gc-page gc-page--wide">
      <PageHeader eyebrow="Docker runtime" title="Runtime" description="Inspect containers and images, then take scoped operational actions." />
      <ContainersPanel />
    </div>
  );
}
