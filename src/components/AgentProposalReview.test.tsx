import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentProposalReview } from "./AgentProposalReview";
vi.mock("./AgentProposalConfiguration", () => ({ AgentProposalConfiguration: () => <div>Candidate configuration</div> }));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
const context = { proposal: { id: "proposal1", contentHash: "abc", status: "pending", expiresAt: "2026-11-15", input: { repositoryUrl: "https://github.com/example/app", revision: "a".repeat(40), composePath: "compose.yml", workloadName: "app", serverId: 1 } }, servers: [{ id: 1, name: "Test server" }] };
const review = { reviewId: "review1", reviewHash: "hash", expiresAt: "2026-11-14T15:00:00Z", sourceCompose: "services:\n  web:\n    image: example", plan: { readyForOwnerReview: true, blockers: [], limitations: ["Not a sandbox."], deploymentPath: "/srv/groundcontrol/deployments/proposal-test", services: ["web"] }, host: { id: 1, name: "Test server" }, notice: "Review only" };
let node: HTMLDivElement, root: Root;
const fetchMock = vi.fn();
const response = (data: unknown, ok = true) => ({ ok, json: async () => data });
async function mount() { await act(async () => { root.render(<AgentProposalReview proposalId="proposal1" />); }); }
async function click(text: string) {
  const button = [...node.querySelectorAll("button")].find(item => item.textContent?.includes(text));
  expect(button).toBeTruthy();
  await act(async () => button!.click());
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset();
  node = document.createElement("div"); document.body.appendChild(node); root = createRoot(node);
});
afterEach(async () => { await act(async () => root.unmount()); node.remove(); vi.unstubAllGlobals(); });
describe("owner proposal review", () => {
  it("shows pinned source and never auto-accepts", async () => {
    fetchMock.mockResolvedValueOnce(response(context)); await mount();
    expect(node.textContent).toContain("a".repeat(40));
    expect(node.textContent).toContain("Enrollment does not run");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("requires review and an explicit confirmation, then describes pending enrollment truthfully", async () => {
    fetchMock.mockResolvedValueOnce(response(context)).mockResolvedValueOnce(response(review)).mockResolvedValueOnce(response({ deploymentId: 42, status: "pending", requiresResourceConsent: true }));
    await mount(); await click("Fetch pinned");
    const payload = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(payload.contentHash).toBe("abc"); expect(payload.appAccess).toEqual({ mode: "loopback", hostPort: 8080 });
    const enroll = [...node.querySelectorAll("button")].find(button => button.textContent === "Enroll this deployment")!;
    expect(enroll.disabled).toBe(true);
    const confirm = [...node.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].at(-1)!;
    await act(async () => confirm.click()); await click("Enroll this deployment");
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ reviewId: "review1", reviewHash: "hash" });
    expect(node.textContent).toContain("Enrolled, not launched"); expect(node.textContent).toContain("#42");
    expect(node.textContent).toContain("No public URL");
  });
  it("keeps blocked reviews non-accepting and surfaces next action", async () => {
    fetchMock.mockResolvedValueOnce(response(context)).mockResolvedValueOnce(response({ ...review, plan: { ...review.plan, readyForOwnerReview: false, blockers: [{ field: "services.web.privileged", message: "Remove privileged mode." }] } }));
    await mount(); await click("Fetch pinned");
    expect(node.textContent).toContain("Remove privileged mode.");
    const confirm = [...node.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].at(-1)!;
    await act(async () => confirm.click());
    expect([...node.querySelectorAll("button")].find(button => button.textContent === "Enroll this deployment")!.disabled).toBe(true);
    await click("Edit choices"); expect(node.textContent).not.toContain("Enroll this deployment");
  });
  it("restores an accepted outcome without claiming a completed launch is pending", async () => {
    fetchMock.mockResolvedValueOnce(response({ ...context, proposal: { ...context.proposal, status: "accepted", deploymentId: 42, launchStatus: "success" } }));
    await mount();
    expect(node.textContent).toContain("First launch: success");
    expect(node.textContent).not.toContain("Enrolled, not launched");
    expect(node.textContent).not.toContain("Fetch pinned configuration");
  });
  it("surfaces unavailable proposals without offering acceptance", async () => {
    fetchMock.mockResolvedValueOnce(response({ error: "Proposal expired. Request a new proposal." }, false)); await mount();
    expect(node.querySelector('[role="alert"]')?.textContent).toContain("expired");
    expect(node.querySelectorAll("button")).toHaveLength(0);
  });
});
