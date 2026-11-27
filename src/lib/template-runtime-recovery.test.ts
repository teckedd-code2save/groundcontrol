import { expect, it } from "vitest";
import { templateRuntimeRecovery } from "./template-runtime-recovery";

const deployment = { slug: "shop-production", kind: "compose", managementMode: "managed", sourcePath: "/srv/shop-production", composePath: "/srv/shop-production/compose.yml", metadataJson: JSON.stringify({ source: "template", composeProject: "gc_shop_production" }) };
const labels = ["app", "db"].map(service => ({ name: `shop-production-${service}-1`, project: "shop-production", service, workingDir: deployment.sourcePath, configFiles: deployment.composePath, projectSlug: deployment.slug }));

it("offers the exact historical directory-name fallback without changing labels", () => {
  expect(templateRuntimeRecovery(deployment, labels)).toEqual({ composeProject: "shop-production", containers: labels.map(label => label.name) });
});

it("refuses existing expected runtime, ambiguous projects, and foreign paths/files", () => {
  expect(templateRuntimeRecovery(deployment, [...labels, { ...labels[0], project: "gc_shop_production" }])).toBeNull();
  expect(templateRuntimeRecovery(deployment, [...labels, { ...labels[0], project: "stage" }])).toBeNull();
  expect(templateRuntimeRecovery(deployment, labels.map(label => ({ ...label, workingDir: "/other" })))).toBeNull();
  expect(templateRuntimeRecovery(deployment, labels.map(label => ({ ...label, configFiles: "/other/compose.yml" })))).toBeNull();
  expect(templateRuntimeRecovery(deployment, [])).toBeNull();
});

it("never recovers an arbitrary enrolled identity or a non-template deployment", () => {
  for (const patch of [{ metadataJson: "{}" }, { metadataJson: "bad-json" }, { metadataJson: JSON.stringify({ source: "template", composeProject: "stage" }) }, { kind: "static" }, { managementMode: "track" }, { sourcePath: "/shared/source" }]) {
    expect(templateRuntimeRecovery({ ...deployment, ...patch }, labels)).toBeNull();
  }
});
