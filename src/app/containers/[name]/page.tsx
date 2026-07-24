import ContainerDetailView from "@/components/ContainerDetailView";

export default async function ContainerDetailPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = await params;
  return <ContainerDetailView name={decodeURIComponent(name)} />;
}
