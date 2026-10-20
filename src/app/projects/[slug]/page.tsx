import { ProjectGroupsPanel } from "@/components/ProjectGroupsPanel";
export default async function ProjectPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <div className="gc-page gc-page--wide"><ProjectGroupsPanel projectSlug={slug} /></div>;
}
