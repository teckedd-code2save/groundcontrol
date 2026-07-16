import DeploymentDetail from "@/components/DeploymentDetail";

export default async function DeploymentDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <DeploymentDetail slug={slug} />;
}
