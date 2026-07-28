import DeploymentDetail from "@/components/DeploymentDetail";

export default async function DeploymentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { slug } = await params;
  const { tab } = await searchParams;
  return <DeploymentDetail slug={slug} initialTab={tab} />;
}
