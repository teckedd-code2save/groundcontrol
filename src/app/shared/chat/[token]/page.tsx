import { notFound } from "next/navigation";
import { resolveAiThreadShare } from "@/lib/ai-share";

export const dynamic = "force-dynamic";

export default async function SharedChatPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const snapshot = await resolveAiThreadShare(token);
  if (!snapshot) notFound();

  return (
    <main className="min-h-screen bg-background px-4 py-10 text-foreground md:px-8">
      <div className="mx-auto max-w-3xl">
        <header className="mb-8 border-b border-border pb-6">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">GroundControl incident record</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight md:text-3xl">{snapshot.title}</h1>
          <p className="mt-2 text-xs text-muted">
            Read-only snapshot · tool inputs and outputs excluded · created {new Date(snapshot.createdAt).toLocaleString()}
          </p>
        </header>
        <div className="space-y-4">
          {snapshot.messages.map((message, index) => (
            <section
              key={`${message.createdAt}-${index}`}
              className={`rounded-md border px-4 py-4 ${
                message.role === "user"
                  ? "ml-auto max-w-[88%] border-accent/30 bg-accent/10"
                  : "mr-auto max-w-[94%] border-border bg-card"
              }`}
            >
              <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
                {message.role === "user" ? "Operator" : "GroundControl"}
              </p>
              <div className="whitespace-pre-wrap text-sm leading-6">{message.content}</div>
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}
