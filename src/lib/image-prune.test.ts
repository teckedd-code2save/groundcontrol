import { describe, expect, it } from "vitest";
import { planRepositoryImagePrune } from "./image-prune";

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
