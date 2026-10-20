// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const rows = vi.hoisted(() => new Map<string, string>());
vi.mock("./prisma", () => ({ prisma: { appConfig: {
  upsert: async ({ where, create }: { where: { key: string }; create: { value: string } }) => rows.set(where.key, create.value),
  findMany: async ({ where }: { where: { key: { startsWith: string } } }) => [...rows].filter(([key]) => key.startsWith(where.key.startsWith)).map(([key, value]) => ({ key, value })),
  deleteMany: async ({ where }: { where: { key: string } }) => rows.delete(where.key),
} } }));
import { buildInventoryCandidates, candidateIdentity, dismissedSuggestions, setSuggestionHidden } from "./inventory-discovery";
import { describeSource } from "./source-discovery";

beforeEach(() => rows.clear());
const containers = ["postgres", "redis", "web"].map((name) => ({ name, image: `${name}:latest`, state: "running" }));
const labels = containers.map((container) => ({ name: container.name, project: "my-app", service: container.name, workingDir: "/Users/me/my-app", configFiles: "/Users/me/my-app/compose.yml", projectSlug: "my-app" }));

it("groups a Compose application into one stable suggestion, retaining every service", () => {
  const candidates = buildInventoryCandidates([], [], containers, labels, []);
  expect(candidates).toHaveLength(1);
  expect(candidates[0].id).toBe("compose:my-app");
  expect(candidates[0].services).toHaveLength(3);
  expect(candidates[0].containerName).toBeNull();
  expect(buildInventoryCandidates([], [], [...containers].reverse(), labels, [])[0].id).toBe(candidates[0].id);
});

it("keeps source detection separate from instances", () => {
  const source = describeSource("/Users/me/my-app", ["package.json"]);
  const candidates = buildInventoryCandidates([], [source], containers, labels, []);
  expect(candidates).toHaveLength(2);
  expect(candidates.map((item) => item.kind).sort()).toEqual(["compose", "source"]);
  expect(buildInventoryCandidates([], [source], containers, labels, [{ sourcePath: source.sourcePath }])).toEqual([]);
});

it("excludes GroundControl, installation backups and helpers without hiding user workloads", () => {
  const own = ["groundcontrol-web", "gc-desktop-before-ui-123", "reader", "renamed-install"].map((name) => ({ name, image: "sha256:abc", state: "running" }));
  const internal = own.map((item) => ({ ...labels[0], name: item.name, internal: item.name === "reader" ? "project-scan" : "", installMode: item.name === "renamed-install" ? "desktop" : "" }));
  const found = buildInventoryCandidates([], [], [...containers, ...own], [...labels, ...internal], []);
  expect(found).toHaveLength(1);
  expect(found[0].services).toHaveLength(3);
});

it("persists dismissals across scans, scopes them to the host, and restores them", async () => {
  const id = candidateIdentity({ sourcePath: "/Users/me/my-app/", composeProject: "my-app" });
  await setSuggestionHidden(1, id, true);
  expect((await dismissedSuggestions(1)).has(id)).toBe(true);
  expect((await dismissedSuggestions(2)).has(id)).toBe(false);
  const candidates = buildInventoryCandidates([], [], containers, labels, []);
  const hidden = await dismissedSuggestions(1);
  expect(candidates.filter((item) => !hidden.has(item.id))).toEqual([]);
  await setSuggestionHidden(1, id, false);
  expect((await dismissedSuggestions(1)).size).toBe(0);
});

it("keeps two environments from the same source directory distinct", () => {
  const other = { name: "stage-web", image: "web:2", state: "running" };
  const found = buildInventoryCandidates([], [], [...containers, other], [...labels, { ...labels[0], name: other.name, project: "my-app-stage" }], [{ sourcePath: "/Users/me/my-app", metadataJson: JSON.stringify({ composeProject: "my-app" }) }]);
  expect(found.map((item) => item.id)).toEqual(["compose:my-app-stage"]);
});
