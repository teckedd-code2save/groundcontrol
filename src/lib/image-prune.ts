export interface DockerImageForPrune {
  repository: string;
  tag: string;
  id: string;
  size?: string;
  createdAt: string;
}

export interface ContainerImageUsage {
  name: string;
  imageRef: string;
  imageId: string;
  state: string;
  composeProject?: string;
  composeService?: string;
}

export interface PlannedPruneImage extends DockerImageForPrune {
  fullName: string;
  reason: string;
  containers: ContainerImageUsage[];
}

export interface ImagePrunePlan {
  repository: string;
  kept: PlannedPruneImage[];
  protected: PlannedPruneImage[];
  removable: PlannedPruneImage[];
}

export interface ContainerForCleanup {
  name: string;
  id: string;
  image: string;
  state: string;
  status?: string;
  composeProject?: string;
  composeService?: string;
}

export interface PlannedCleanupContainer extends ContainerForCleanup {
  reason: string;
}

export interface DockerCleanupPlan {
  images: {
    kept: PlannedPruneImage[];
    protected: PlannedPruneImage[];
    removable: PlannedPruneImage[];
  };
  containers: {
    protected: PlannedCleanupContainer[];
    removable: PlannedCleanupContainer[];
  };
  buildCache: {
    enabled: boolean;
    reclaimable?: string;
    reason: string;
  };
}

function imageFullName(image: DockerImageForPrune): string {
  return image.tag && image.tag !== "<none>" ? `${image.repository}:${image.tag}` : image.id;
}

function imageMatchesUsage(image: DockerImageForPrune, usage: ContainerImageUsage): boolean {
  const imageId = image.id.replace(/^sha256:/, "");
  const usageId = usage.imageId.replace(/^sha256:/, "");
  return (
    usage.imageRef === imageFullName(image) ||
    usage.imageRef === image.repository ||
    usageId === imageId ||
    usageId.startsWith(imageId) ||
    imageId.startsWith(usageId)
  );
}

function toPlanned(image: DockerImageForPrune, reason: string, usages: ContainerImageUsage[]): PlannedPruneImage {
  return {
    ...image,
    fullName: imageFullName(image),
    reason,
    containers: usages,
  };
}

export function planRepositoryImagePrune(input: {
  repository: string;
  images: DockerImageForPrune[];
  usages: ContainerImageUsage[];
  includeStopped?: boolean;
}): ImagePrunePlan {
  const repoImages = input.images
    .filter((image) => image.repository === input.repository)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const newest = repoImages[0];
  const kept: PlannedPruneImage[] = [];
  const protectedImages: PlannedPruneImage[] = [];
  const removable: PlannedPruneImage[] = [];
  const keptIds = new Set<string>();

  if (newest) {
    kept.push(toPlanned(newest, "Newest image is kept", []));
    keptIds.add(newest.id);
  }

  for (const image of repoImages) {
    if (keptIds.has(image.id)) continue;
    const usages = input.usages.filter((usage) => imageMatchesUsage(image, usage));
    const runningUsages = usages.filter((usage) => usage.state === "running");
    const stoppedUsages = usages.filter((usage) => usage.state !== "running");

    if (runningUsages.length > 0) {
      protectedImages.push(toPlanned(image, "Used by a running container", usages));
      continue;
    }

    if (!input.includeStopped && stoppedUsages.length > 0) {
      protectedImages.push(toPlanned(image, "Used by a stopped container", usages));
      continue;
    }

    removable.push(toPlanned(image, "Older unreferenced image", usages));
  }

  return { repository: input.repository, kept, protected: protectedImages, removable };
}

export function planDockerCleanup(input: {
  images: DockerImageForPrune[];
  usages: ContainerImageUsage[];
  containers: ContainerForCleanup[];
  includeStoppedContainerImages?: boolean;
  includeStoppedContainers?: boolean;
  buildCacheReclaimable?: string;
}): DockerCleanupPlan {
  const grouped = new Map<string, DockerImageForPrune[]>();
  for (const image of input.images) {
    const key = image.repository || "<none>";
    grouped.set(key, [...(grouped.get(key) || []), image]);
  }

  const kept: PlannedPruneImage[] = [];
  const protectedImages: PlannedPruneImage[] = [];
  const removable: PlannedPruneImage[] = [];

  for (const [repository, repoImages] of grouped.entries()) {
    const plan = planRepositoryImagePrune({
      repository,
      images: repoImages,
      usages: input.usages,
      includeStopped: input.includeStoppedContainerImages,
    });

    if (repository === "<none>") {
      for (const image of plan.kept) {
        const usages = input.usages.filter((usage) => imageMatchesUsage(image, usage));
        if (usages.length > 0) {
          protectedImages.push({ ...image, reason: "Dangling image is still used by a container", containers: usages });
        } else {
          removable.push({ ...image, reason: "Unused dangling image" });
        }
      }
    } else {
      kept.push(...plan.kept);
    }
    protectedImages.push(...plan.protected);
    removable.push(...plan.removable);
  }

  const protectedContainers: PlannedCleanupContainer[] = [];
  const removableContainers: PlannedCleanupContainer[] = [];
  for (const container of input.containers) {
    if (container.state === "running") {
      protectedContainers.push({ ...container, reason: "Container is running" });
      continue;
    }
    if (container.composeProject && !input.includeStoppedContainers) {
      protectedContainers.push({ ...container, reason: "Stopped Compose service is protected by default" });
      continue;
    }
    if (!input.includeStoppedContainers) {
      protectedContainers.push({ ...container, reason: "Stopped container is protected by default" });
      continue;
    }
    removableContainers.push({ ...container, reason: "Stopped container selected for cleanup" });
  }

  return {
    images: { kept, protected: protectedImages, removable },
    containers: { protected: protectedContainers, removable: removableContainers },
    buildCache: {
      enabled: true,
      reclaimable: input.buildCacheReclaimable,
      reason: "Build cache is not attached to running containers; cleaning it frees deploy workspace",
    },
  };
}
