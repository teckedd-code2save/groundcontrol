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
