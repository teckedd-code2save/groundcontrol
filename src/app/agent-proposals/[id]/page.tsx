import { AgentProposalReview } from "@/components/AgentProposalReview";

export default async function AgentProposalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AgentProposalReview proposalId={id} />;
}
