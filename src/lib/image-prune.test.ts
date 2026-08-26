import { describe, expect, it } from "vitest";
import { planDockerCleanup, planRepositoryImagePrune } from "./image-prune";

const images = [
  { repository: "ghcr.io/acme/app", tag: "new", id: "new111", size: "100MB", createdAt: "2026-07-05 10:00:00 +0000 UTC" },
  { repository: "ghcr.io/acme/app", tag: "running", id: "run222", size: "100MB", createdAt: "2026-07-04 10:00:00 +0000 UTC" },
  { repository: "ghcr.io/acme/app", tag: "stopped", id: "stop333", size: "100MB", createdAt: "2026-07-03 10:00:00 +0000 UTC" },
  { repository: "ghcr.io/acme/app", tag: "old", id: "old444", size: "100MB", createdAt: "2026-07-02 10:00:00 +0000 UTC" },
];

describe("planRepositoryImagePrune", () => {
  it("keeps newest, protects running and stopped images by default, and removes only unreferenced older images", () => {
    const plan = planRepositoryImagePrune({
      repository: "ghcr.io/acme/app",
      images,
      usages: [
        { name: "app-web", imageRef: "ghcr.io/acme/app:running", imageId: "sha256:run222abcdef", state: "running" },
        { name: "app-old", imageRef: "ghcr.io/acme/app:stopped", imageId: "sha256:stop333abcdef", state: "exited" },
      ],
    });

    expect(plan.kept.map((image) => image.fullName)).toEqual(["ghcr.io/acme/app:new"]);
    expect(plan.protected.map((image) => image.fullName)).toEqual([
      "ghcr.io/acme/app:running",
      "ghcr.io/acme/app:stopped",
    ]);
    expect(plan.removable.map((image) => image.fullName)).toEqual(["ghcr.io/acme/app:old"]);
  });

  it("can include stopped images while still protecting running images", () => {
    const plan = planRepositoryImagePrune({
      repository: "ghcr.io/acme/app",
      images,
      includeStopped: true,
      usages: [
        { name: "app-web", imageRef: "ghcr.io/acme/app:running", imageId: "sha256:run222abcdef", state: "running" },
        { name: "app-old", imageRef: "ghcr.io/acme/app:stopped", imageId: "sha256:stop333abcdef", state: "exited" },
      ],
    });

    expect(plan.protected.map((image) => image.fullName)).toEqual(["ghcr.io/acme/app:running"]);
    expect(plan.removable.map((image) => image.fullName)).toEqual([
      "ghcr.io/acme/app:stopped",
      "ghcr.io/acme/app:old",
    ]);
  });
});

describe("planDockerCleanup", () => {
  it("protects running and stopped-container images, keeps newest repo images, and removes unused older images", () => {
    const plan = planDockerCleanup({
      images,
      usages: [
        { name: "app-web", imageRef: "ghcr.io/acme/app:running", imageId: "sha256:run222abcdef", state: "running" },
        { name: "app-old", imageRef: "ghcr.io/acme/app:stopped", imageId: "sha256:stop333abcdef", state: "stopped" },
      ],
      containers: [
        { name: "app-web", id: "abc", image: "ghcr.io/acme/app:running", state: "running" },
        { name: "app-old", id: "def", image: "ghcr.io/acme/app:stopped", state: "exited", composeProject: "app" },
      ],
      buildCacheReclaimable: "6.9GB (80%)",
    });

    expect(plan.images.kept.map((image) => image.fullName)).toEqual(["ghcr.io/acme/app:new"]);
    expect(plan.images.protected.map((image) => image.fullName)).toEqual([
      "ghcr.io/acme/app:running",
      "ghcr.io/acme/app:stopped",
    ]);
    expect(plan.images.removable.map((image) => image.fullName)).toEqual(["ghcr.io/acme/app:old"]);
    expect(plan.containers.protected.map((container) => container.name)).toEqual(["app-web", "app-old"]);
    expect(plan.containers.removable).toEqual([]);
    expect(plan.buildCache.reclaimable).toBe("6.9GB (80%)");
  });

  it("removes dangling unused images without keeping the newest dangling tag", () => {
    const plan = planDockerCleanup({
      images: [
        { repository: "<none>", tag: "<none>", id: "dangling111", size: "100MB", createdAt: "2026-07-05 10:00:00 +0000 UTC" },
        { repository: "<none>", tag: "<none>", id: "dangling222", size: "100MB", createdAt: "2026-07-04 10:00:00 +0000 UTC" },
      ],
      usages: [],
      containers: [],
    });

    expect(plan.images.kept).toEqual([]);
    expect(plan.images.removable.map((image) => image.fullName)).toEqual(["dangling111", "dangling222"]);
  });

  it("only removes stopped containers when explicitly selected", () => {
    const plan = planDockerCleanup({
      images: [],
      usages: [],
      containers: [
        { name: "api-1", id: "api", image: "ghcr.io/acme/api", state: "exited", composeProject: "app" },
        { name: "scratch", id: "scratch", image: "busybox", state: "created" },
      ],
      includeStoppedContainers: true,
    });

    expect(plan.containers.removable.map((container) => container.name)).toEqual(["api-1", "scratch"]);
  });
});
