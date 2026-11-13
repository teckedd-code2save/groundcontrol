import { StrictMode, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import PublishInstanceStep from "./PublishInstanceStep";
let root: Root;
let container: HTMLDivElement;
const post = vi.fn();
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  post.mockReset();
  vi.stubGlobal("fetch", vi.fn(async (_url, options) => options?.method === "POST" ? post(options) : { ok: true, json: async () => ({ mode: "private", localDesktop: false }) }));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function click(label: string) {
  const button = [...container.querySelectorAll("button")].find((b) => b.textContent?.includes(label));
  expect(button).toBeTruthy(); await act(async () => button!.click());
}
it("describes Keep it private as verification, not publication", async () => {
  let finish!: (value: unknown) => void;
  post.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  await act(async () => root.render(<PublishInstanceStep onComplete={() => {}} />));
  await click("Keep it private"); await click("Keep private & verify");
  expect(JSON.parse(post.mock.calls[0][0].body)).toEqual({ action: "private" });
  expect(container.textContent).toContain("Verifying private access…");
  expect(container.textContent).not.toContain("Publishing & verifying…");
  await act(async () => finish({ ok: false, json: async () => ({ error: "Verification unavailable" }) }));
  expect(container.textContent).toContain("Verification unavailable");
  expect(container.textContent).toContain("Keep private & verify");
});


it("discloses temporary public URL limits at handoff and offers permanent setup without publishing", async () => {
  vi.stubGlobal("fetch", vi.fn(async (_url, options) => {
    if (options?.method === "POST") {
      post(options);
      return {ok: true, json: async () => ({verification: {ok: true, publicUrl: "https://temporary.example.test", checks: {}}})};
    }
    return {ok: true, json: async () => ({mode: "quick_tunnel", publicUrl: "https://temporary.example.test", localDesktop: false})};
  }));
  await act(async () => root.render(<PublishInstanceStep onComplete={() => {}} />));
  expect(container.textContent).toContain("Temporary public address:");
  expect(container.textContent).toContain("public HTTPS sign-in link, not a private-only address");
  expect(container.textContent).toContain("does not restart automatically after a server reboot");
  expect(container.textContent).toContain("Recreating it gives you a new URL");
  expect(container.textContent).toContain("do not support server-sent event streams");
  expect(container.querySelector('a[href="https://temporary.example.test"]')).not.toBeNull();
  expect(container.querySelector("#gc-publish-hostname")).toBeNull();
  await click("Use my own domain");
  expect(container.querySelector("#gc-publish-hostname")).not.toBeNull();
  expect(container.querySelector("#gc-cf-token")).toBeNull();
  expect(container.textContent).toContain("No Cloudflare account needed");
  expect(container.textContent).toContain("Use a domain you control.");
  await click("Connect through my Cloudflare account");
  expect(container.querySelector("#gc-cf-token")).not.toBeNull();
  expect(post.mock.calls.map(([options]) => JSON.parse(options.body).action)).toEqual(["verify"]);
});

it("does not attach temporary-link warnings to permanent public URLs", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({
    mode: "cloudflare", publicUrl: "https://gc.example.test", cloudflareConfigured: true,
  }) })));
  await act(async () => root.render(<PublishInstanceStep onComplete={() => {}} />));
  expect(container.textContent).not.toContain("Temporary public address:");
});


it("reloads the actual handoff URL after a partial retirement failure", async () => {
  let committed = false;
  vi.stubGlobal("fetch", vi.fn(async (_url, options) => {
    if (options?.method === "POST") {
      committed = true;
      return { ok: false, json: async () => ({ error: "New access is live; old connector cleanup needs inspection." }) };
    }
    return { ok: true, json: async () => ({ mode: "cloudflare", publicUrl: committed ? "https://gc.example.test" : "https://old.example.test", cloudflareConfigured: true }) };
  }));
  await act(async () => root.render(<PublishInstanceStep onComplete={() => {}} />));
  await click("Use my own domain");
  await click("Connect through my Cloudflare account");
  await click("Publish & verify");
  expect(container.querySelector('a[href="https://gc.example.test"]')).not.toBeNull();
  expect(container.querySelector('a[href="https://old.example.test"]')).toBeNull();
  expect(container.textContent).toContain("old connector cleanup needs inspection");
});


it("fresh onboarding verifies installer-created access without creating another tunnel", async () => {
  const complete = vi.fn();
  vi.stubGlobal("fetch", vi.fn(async (_url, options) => {
    if (options?.method === "POST") {
      post(options);
      return { ok: true, json: async () => ({ verification: { ok: true, checks: {}, publicUrl: "https://temporary.example.test" } }) };
    }
    return { ok: true, json: async () => ({ mode: "quick_tunnel", publicUrl: "https://temporary.example.test", lastVerification: null }) };
  }));
  await act(async () => root.render(<PublishInstanceStep onComplete={complete} />));
  expect(container.textContent).toContain("Give this server its own address");
  expect(container.textContent).not.toContain("Create temporary HTTPS");
  expect(container.textContent).not.toContain("No domain yet");
  expect(container.textContent).not.toContain("Keep it private");
  expect(JSON.parse(post.mock.calls[0][0].body)).toEqual({ action: "verify" });
  await click("Continue for now");
  expect(complete).toHaveBeenCalledOnce();
  await click("Use my own domain");
  expect((container.querySelector("#gc-publish-hostname") as HTMLInputElement).value).toBe("");
  expect(post).toHaveBeenCalledOnce();
});

it("retains the existing URL and recovery action when verification fails", async () => {
  vi.stubGlobal("fetch", vi.fn(async (_url, options) => options?.method === "POST"
    ? { ok: false, json: async () => ({ error: "Public access unavailable" }) }
    : { ok: true, json: async () => ({ mode: "quick_tunnel", publicUrl: "https://temporary.example.test", lastVerification: { ok: true, checks: {} } }) }));
  await act(async () => root.render(<PublishInstanceStep onComplete={() => {}} />));
  expect(container.textContent).toContain("Public access unavailable");
  expect([...container.querySelectorAll("button")].find(b => b.textContent?.includes("Continue for now"))?.disabled).toBe(true);
  expect(container.textContent).toContain("Retry access check");
  expect(container.querySelector('a[href="https://temporary.example.test"]')).not.toBeNull();
});


it("preserves permanent-domain selection and input when DNS setup needs a retry", async () => {
  vi.stubGlobal("fetch", vi.fn(async (_url, options) => options?.method === "POST"
    ? JSON.parse(options.body).action === "verify" ? { ok: true, json: async () => ({verification: {ok: true, publicUrl: "https://temporary.example.test", checks: {}}}) } : { ok: false, json: async () => ({ error: "DNS required", code: "DNS_REQUIRED", requiredRecord: { type: "A", name: "gc.example.test", content: "192.0.2.1" } }) }
    : { ok: true, json: async () => ({ mode: "quick_tunnel", publicUrl: "https://temporary.example.test" }) }));
  await act(async () => root.render(<PublishInstanceStep onComplete={() => {}} />));
  await click("Use my own domain");
  expect(container.textContent).toContain("Ports 80 and 443 must be reachable");
  expect(container.textContent).toContain("does not open them for you");
  const input = container.querySelector("#gc-publish-hostname") as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "gc.example.test");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click("Publish & verify");
  expect(container.textContent).toContain("DNS required");
  expect((container.querySelector("#gc-publish-hostname") as HTMLInputElement).value).toBe("gc.example.test");
  expect(container.textContent).toContain("Publish & verify");
  expect(container.textContent).not.toContain("Create temporary HTTPS");
  await click("Back to current access");
  expect(container.textContent).not.toContain("press Publish again");
  await click("Use my own domain");
  expect(container.textContent).toContain("press Publish again");
  expect((container.querySelector("#gc-publish-hostname") as HTMLInputElement).value).toBe("gc.example.test");
});

it("blocks stale saved evidence until automatic current-address verification finishes, once in StrictMode", async () => {
  let finish!: (value: unknown) => void;
  post.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  vi.stubGlobal("fetch", vi.fn(async (_url, options) => options?.method === "POST"
    ? post(options)
    : { ok: true, json: async () => ({ mode: "quick_tunnel", publicUrl: "https://new.example.test", lastVerification: { ok: true, publicUrl: "https://old.example.test", checks: {} } }) }));
  const complete = vi.fn();
  await act(async () => root.render(<StrictMode><PublishInstanceStep onComplete={complete} /></StrictMode>));
  expect(post).toHaveBeenCalledOnce();
  await click("Continue for now"); expect(complete).not.toHaveBeenCalled();
  expect(container.textContent).not.toContain("Verify existing access");
  expect(container.textContent).not.toContain("Create temporary HTTPS");
  await act(async () => finish({ ok: true, json: async () => ({ verification: {ok: true, publicUrl: "https://old.example.test", checks: {}} }) }));
  expect(container.textContent).toContain("address changed");
  await click("Continue for now"); expect(complete).not.toHaveBeenCalled();
});

it("recovers interrupted checks without replacing tunnel and keeps permanent input on back", async () => {
  post.mockRejectedValueOnce(new Error("Connection interrupted")).mockResolvedValue({ok: true, json: async () => ({verification: {ok: true, publicUrl: "https://temporary.example.test", checks: {}}})});
  vi.stubGlobal("fetch", vi.fn(async (_url, options) => options?.method === "POST" ? post(options) : {ok: true, json: async () => ({mode: "quick_tunnel", publicUrl: "https://temporary.example.test"})}));
  const complete = vi.fn();
  await act(async () => root.render(<PublishInstanceStep onComplete={complete} />));
  await click("Retry access check");
  expect(post.mock.calls.map(([options]) => JSON.parse(options.body).action)).toEqual(["verify", "verify"]);
  expect(container.querySelector("details")?.open).toBe(false);
  await click("Use my own domain");
  expect(container.querySelector("#gc-cf-token")).toBeNull();
  const input = container.querySelector("#gc-publish-hostname") as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "gc.example.test");
    input.dispatchEvent(new Event("input", {bubbles: true}));
  });
  await click("Back to current access");
  await click("Use my own domain");
  expect((container.querySelector("#gc-publish-hostname") as HTMLInputElement).value).toBe("gc.example.test");
  await click("Continue for now"); expect(complete).toHaveBeenCalledOnce();
});

it("keeps desktop private-only and allows verified private continuation", async () => {
  const evidence = {ok: true, publicUrl: null, checks: {}};
  vi.stubGlobal("fetch", vi.fn(async (_url, options) => options?.method === "POST"
    ? {ok: true, json: async () => ({verification: evidence})}
    : {ok: true, json: async () => ({mode: "private", publicUrl: null, localDesktop: true, lastVerification: evidence})}));
  const complete = vi.fn();
  await act(async () => root.render(<PublishInstanceStep onComplete={complete} />));
  expect(container.textContent).not.toContain("Cloudflare account");
  expect(container.textContent).not.toContain("Create temporary HTTPS");
  await click("Keep private & verify");
  await click("Continue to server scan");
  expect(complete).toHaveBeenCalledOnce();
});

it("retains remote private-only access without automatically publishing", async () => {
  vi.stubGlobal("fetch", vi.fn(async (_url, options) => {
    if (options?.method === "POST") return post(options);
    return {ok: true, json: async () => ({mode: "private", publicUrl: null, localDesktop: false})};
  }));
  await act(async () => root.render(<PublishInstanceStep onComplete={() => {}} />));
  expect(post).not.toHaveBeenCalled();
  expect(container.textContent).toContain("Keep it private");
  expect(container.textContent).toContain("Keep private & verify");
  expect(container.querySelector("#gc-publish-hostname")).toBeNull();
  expect(container.textContent).toContain("Temporary HTTPS for setup");
});


const temporaryUrl = "https://temporary.example.test";
const serverUrl = "https://8.8.4.4.sslip.io";
const addressPlan = {
  hostname: "8.8.4.4.sslip.io", publicUrl: serverUrl, publicIpv4: "8.8.4.4", source: "sslip",
  stability: "This address stays the same while this public IP is assigned to you. If the IP changes, reconnect agents.",
  needs: [
    {code: "ports_unverified", blocking: false, detail: "Public inbound TCP ports 80 and 443 must reach this server. Outside reachability is not yet verified."},
    {code: "caddy_setup", blocking: false, detail: "Caddy is installed or configured only when you choose setup."},
  ],
  canPublish: true,
};
function evidence(publicUrl: string | null) { return {ok: true, publicUrl, checks: {}}; }
function response(data: unknown, ok = true) { return {ok, json: async () => data}; }
function installPreviewFetch(plan: unknown = addressPlan) {
  const fetcher = vi.fn(async (url, options) => {
    if (options?.method === "POST") {
      post(options);
      return response({verification: evidence(temporaryUrl)});
    }
    return response({mode: "quick_tunnel", publicUrl: temporaryUrl, ...(String(url).includes("generatedAddress=1") ? {generatedAddress: plan} : {})});
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
it("checks a free address lazily without publishing or asking for provider credentials", async () => {
  const fetcher = installPreviewFetch();
  await act(async () => root.render(<PublishInstanceStep onComplete={() => {}} />));
  expect(fetcher.mock.calls.some(([url]) => String(url).includes("generatedAddress=1"))).toBe(false);
  expect(container.textContent).not.toContain("not available yet");
  await click("Set up free server address");
  expect(fetcher.mock.calls.filter(([url]) => String(url).includes("generatedAddress=1"))).toHaveLength(1);
  expect(container.textContent).toContain(serverUrl);
  expect(container.textContent).toContain("not verified yet");
  expect(container.textContent).toContain("while this public IP is assigned");
  expect(container.textContent).toContain("does not open firewall ports");
  expect(container.textContent).toContain("installs or configures Caddy");
  expect(container.querySelector("#gc-cf-token")).toBeNull();
  expect(post.mock.calls.map(([options]) => JSON.parse(options.body))).toEqual([{action: "verify"}]);
  expect(container.querySelector(`a[href="${serverUrl}"]`)).toBeNull();
  expect(container.querySelector(`a[href="${temporaryUrl}"]`)).not.toBeNull();
});
it("blocks setup for a known proxy conflict and keeps alternatives available", async () => {
  installPreviewFetch({...addressPlan, canPublish: false, needs: [{code: "proxy_conflict", blocking: true, detail: "Nginx already uses ports 80 and 443. Configure the existing proxy or deliberately free the ports."}]});
  await act(async () => root.render(<PublishInstanceStep onComplete={() => {}} />));
  await click("Set up free server address");
  expect(container.textContent).toContain("Nginx already uses ports");
  expect([...container.querySelectorAll("button")].find(b => b.textContent === "Set up & verify address")?.disabled).toBe(true);
  await click("Set up & verify address");
  expect(post).toHaveBeenCalledOnce();
  await click("Use my own domain");
  expect(container.querySelector("#gc-publish-hostname")).not.toBeNull();
});
it("publishes only an explicit server_address action and waits for verified completion", async () => {
  let ready = false;
  let finish!: (value: unknown) => void;
  vi.stubGlobal("fetch", vi.fn(async (url, options) => {
    if (options?.method === "POST") {
      post(options);
      if (JSON.parse(options.body).action === "verify") return response({verification: evidence(temporaryUrl)});
      return new Promise(resolve => { finish = resolve; });
    }
    return response({mode: ready ? "caddy" : "quick_tunnel", publicUrl: ready ? serverUrl : temporaryUrl,
      canonicalUrl: ready ? serverUrl : null, aliases: [], ...(String(url).includes("generatedAddress=1") ? {generatedAddress: addressPlan} : {}),
      lastVerification: ready ? evidence(serverUrl) : null});
  }));
  const complete = vi.fn();
  await act(async () => root.render(<PublishInstanceStep onComplete={complete} />));
  await click("Set up free server address");
  const button = [...container.querySelectorAll("button")].find(b => b.textContent === "Set up & verify address")!;
  await act(async () => { button.click(); button.click(); });
  expect(post.mock.calls.map(([options]) => JSON.parse(options.body))).toEqual([{action: "verify"}, {action: "server_address"}]);
  expect(container.textContent).toContain("Setting up & verifying server address");
  expect([...container.querySelectorAll("button")].find(b => b.textContent === "Continue for now")?.disabled).toBe(true);
  expect(container.querySelector(`a[href="${serverUrl}"]`)).toBeNull();
  ready = true;
  await act(async () => finish(response({verification: evidence(serverUrl), canonicalUrl: serverUrl, aliases: []})));
  expect(container.querySelector(`a[href="${serverUrl}"]`)).not.toBeNull();
  expect(container.textContent).toContain("Primary address");
  expect(container.textContent).not.toContain("Set up free server address");
  await click("Continue to server scan");
  expect(complete).toHaveBeenCalledOnce();
});
it("shows a verified provider hostname preview without promising permanent ownership", async () => {
  installPreviewFetch({...addressPlan, source: "provider", hostname: "gc.provider.example", publicUrl: "https://gc.provider.example", stability: "Lifetime depends on the provider hostname and IP allocation."});
  await act(async () => root.render(<PublishInstanceStep onComplete={() => {}} />));
  await click("Set up free server address");
  expect(container.textContent).toContain("Cloud provider hostname");
  expect(container.textContent).toContain("Lifetime depends on the provider");
  expect(container.textContent).not.toContain("Shared sslip.io DNS");
});
it("recovers preview failures without losing the working temporary URL", async () => {
  let first = true;
  vi.stubGlobal("fetch", vi.fn(async (url, options) => {
    if (options?.method === "POST") return response({verification: evidence(temporaryUrl)});
    if (String(url).includes("generatedAddress=1")) {
      if (first) {first = false; return response({error: "Could not inspect server ports"}, false);}
      return response({generatedAddress: addressPlan});
    }
    return response({mode: "quick_tunnel", publicUrl: temporaryUrl});
  }));
  await act(async () => root.render(<PublishInstanceStep onComplete={() => {}} />));
  await click("Set up free server address");
  expect(container.textContent).toContain("Could not inspect server ports");
  expect(container.querySelector(`a[href="${temporaryUrl}"]`)).not.toBeNull();
  await click("Retry address check");
  expect(container.textContent).toContain(serverUrl);
});
it("ignores a late address preview after returning to current access", async () => {
  let finish!: (value: unknown) => void;
  vi.stubGlobal("fetch", vi.fn(async (url, options) => {
    if (options?.method === "POST") return response({verification: evidence(temporaryUrl)});
    if (String(url).includes("generatedAddress=1")) return new Promise(resolve => { finish = resolve; });
    return response({mode: "quick_tunnel", publicUrl: temporaryUrl});
  }));
  await act(async () => root.render(<PublishInstanceStep onComplete={() => {}} />));
  await click("Set up free server address");
  await click("Back to current access");
  await act(async () => finish(response({generatedAddress: addressPlan})));
  expect(container.textContent).not.toContain("Set up & verify address");
  expect(container.textContent).not.toContain(serverUrl);
  expect(container.textContent).toContain("Set up free server address");
});
it("presents custom domains as aliases without changing canonical identity", async () => {
  const alias = "https://gc.custom.example";
  vi.stubGlobal("fetch", vi.fn(async () => response({mode: "caddy", publicUrl: serverUrl, canonicalUrl: serverUrl, aliases: [alias], lastVerification: evidence(serverUrl)})));
  await act(async () => root.render(<PublishInstanceStep onComplete={() => {}} />));
  expect(container.querySelector(`a[href="${serverUrl}"]`)).not.toBeNull();
  expect(container.querySelector(`a[href="${alias}"]`)).not.toBeNull();
  await click("Use my own domain");
  expect(container.textContent).toContain("primary address and OAuth/MCP identity stay at");
  expect((container.querySelector("#gc-publish-hostname") as HTMLInputElement).value).toBe("");
});

it("does not call an unverified server-address response ready", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url, options) => {
    if (options?.method === "POST") return response({verification: JSON.parse(options.body).action === "verify" ? evidence(temporaryUrl) : {ok: false, publicUrl: serverUrl, checks: {}}});
    return response({mode: "quick_tunnel", publicUrl: temporaryUrl, ...(String(url).includes("generatedAddress=1") ? {generatedAddress: addressPlan} : {})});
  }));
  await act(async () => root.render(<PublishInstanceStep onComplete={() => {}} />));
  await click("Set up free server address");
  await click("Set up & verify address");
  expect(container.textContent).toContain("Some server-address setup checks need attention");
  expect(container.querySelector(`a[href="${serverUrl}"]`)).toBeNull();
  expect(container.querySelector(`a[href="${temporaryUrl}"]`)).not.toBeNull();
  expect(container.textContent).toContain("Set up & verify address");
});

it.each(["caddy", "cloudflare"])("can verify a legacy %s address with no saved evidence without republishing", async (mode) => {
  let first = true;
  const current = "https://existing.example.test";
  vi.stubGlobal("fetch", vi.fn(async (_url, options) => {
    if (options?.method === "POST") {
      post(options);
      if (first) {first = false; return response({error: "Check interrupted"}, false);}
      return response({verification: evidence(current)});
    }
    return response({mode, publicUrl: current, lastVerification: null});
  }));
  const complete = vi.fn();
  await act(async () => root.render(<PublishInstanceStep onComplete={complete} />));
  await click("Continue to server scan"); expect(complete).not.toHaveBeenCalled();
  expect(container.textContent).toContain("Verify your current address");
  expect(container.textContent).not.toContain("Keep this primary address for your agents");
  await click("Verify existing access");
  expect(container.textContent).toContain("Check interrupted");
  await click("Verify existing access");
  expect(post.mock.calls.map(([options]) => JSON.parse(options.body))).toEqual([{action: "verify"}, {action: "verify"}]);
  await click("Continue to server scan"); expect(complete).toHaveBeenCalledOnce();
});

it("preserves the chosen custom-domain method when returning from current access", async () => {
  installPreviewFetch();
  await act(async () => root.render(<PublishInstanceStep onComplete={() => {}} />));
  await click("Use my own domain");
  await click("Connect through my Cloudflare account");
  expect(container.querySelector("#gc-cf-token")).not.toBeNull();
  await click("Back to current access");
  await click("Use my own domain");
  expect(container.querySelector("#gc-cf-token")).not.toBeNull();
  expect(post.mock.calls.map(([options]) => JSON.parse(options.body))).toEqual([{action: "verify"}]);
});
it("adds a custom alias while keeping the canonical management link and verified continuation", async () => {
  const alias = "https://gc.custom.example";
  let connected = false;
  vi.stubGlobal("fetch", vi.fn(async (_url, options) => {
    if (options?.method === "POST") {
      post(options); connected = true;
      return response({canonicalUrl: serverUrl, aliasUrl: alias, aliases: [alias], verification: evidence(serverUrl), aliasVerification: evidence(alias)});
    }
    return response({mode: "caddy", publicUrl: serverUrl, canonicalUrl: serverUrl, aliases: connected ? [alias] : [], lastVerification: evidence(serverUrl)});
  }));
  const complete = vi.fn();
  await act(async () => root.render(<PublishInstanceStep onComplete={complete} />));
  await click("Use my own domain");
  const input = container.querySelector("#gc-publish-hostname") as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "gc.custom.example");
    input.dispatchEvent(new Event("input", {bubbles: true}));
  });
  await click("Publish & verify");
  expect(post.mock.calls.map(([options]) => JSON.parse(options.body))).toEqual([{action: "caddy", hostname: "gc.custom.example"}]);
  expect(container.querySelector(`a[href="${serverUrl}"]`)).not.toBeNull();
  expect(container.querySelector(`a[href="${alias}"]`)).not.toBeNull();
  expect(container.textContent).toContain("Primary address");
  await click("Continue to server scan"); expect(complete).toHaveBeenCalledOnce();
});

it("shows a retained public fallback after reload with operator-assisted cleanup and agent reconnect guidance", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => response({mode: "caddy", publicUrl: serverUrl, canonicalUrl: serverUrl, aliases: [], retainedBootstrapUrl: temporaryUrl, lastVerification: evidence(serverUrl)})));
  await act(async () => root.render(<PublishInstanceStep onComplete={() => {}} />));
  expect(container.textContent).toContain("Temporary public fallback retained");
  await act(async () => root.unmount());
  root = createRoot(container);
  await act(async () => root.render(<PublishInstanceStep onComplete={() => {}} />));
  expect(container.textContent).toContain("have an operator inspect and remove the fallback");
  expect(container.textContent).toContain("It is not private");
  expect(container.textContent).toContain("Reconnect any agents that used the temporary address");
  expect(container.querySelector(`a[href="${temporaryUrl}"]`)).not.toBeNull();
  expect(container.querySelector(`a[href="${serverUrl}"]`)).not.toBeNull();
  expect([...container.querySelectorAll("button")].some(b => /remove|cleanup/i.test(b.textContent || ""))).toBe(false);
});
it("never renders a claim path, query or token from retained fallback status", async () => {
  const retainedBootstrapUrl = `${temporaryUrl}/claim?secret=fixture-query#token=gc_claim_fixture_secret`;
  vi.stubGlobal("fetch", vi.fn(async () => response({mode: "caddy", publicUrl: serverUrl, canonicalUrl: serverUrl, retainedBootstrapUrl, lastVerification: evidence(serverUrl)})));
  await act(async () => root.render(<PublishInstanceStep onComplete={() => {}} />));
  expect(container.querySelector(`a[href="${temporaryUrl}"]`)).not.toBeNull();
  expect(container.innerHTML).not.toContain("fixture-query");
  expect(container.innerHTML).not.toContain("gc_claim_fixture_secret");
  expect(container.innerHTML).not.toContain("/claim");
});
it.each(["http://temporary.example.test", "javascript:alert(1)", "https://user:fixture-secret@temporary.example.test"])("does not link an unsafe retained fallback: %s", async (retainedBootstrapUrl) => {
  vi.stubGlobal("fetch", vi.fn(async () => response({mode: "caddy", publicUrl: serverUrl, canonicalUrl: serverUrl, retainedBootstrapUrl, lastVerification: evidence(serverUrl)})));
  await act(async () => root.render(<PublishInstanceStep onComplete={() => {}} />));
  expect(container.innerHTML).not.toContain(retainedBootstrapUrl);
  expect(container.innerHTML).not.toContain("fixture-secret");
  expect(container.querySelectorAll("a")).toHaveLength(1);
  expect(container.textContent).toContain("Temporary public fallback retained");
});
it("does not imply a retained fallback exists after cleanup or on an unrelated alias", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => response({mode: "caddy", publicUrl: serverUrl, canonicalUrl: serverUrl, retainedBootstrapUrl: null, aliases: ["https://gc.custom.example"], lastVerification: evidence(serverUrl)})));
  await act(async () => root.render(<PublishInstanceStep onComplete={() => {}} />));
  expect(container.textContent).not.toContain("Temporary public fallback retained");
  expect(container.textContent).not.toContain("Reconnect any agents");
  expect(container.textContent).toContain("Keep this primary address for your agents");
});

it("rechecks network read-only and removes stale diagnosis on error while retaining temporary access", async () => {
  let checks = 0;
  const fetcher = vi.fn(async (url, options) => {
    if (options?.method === "POST") {post(options); return response({verification: evidence(temporaryUrl)});}
    if (String(url).includes("generatedAddress=1")) {
      if (++checks > 1) return response({error: "Network inspection unavailable"}, false);
      return response({generatedAddress: {...addressPlan, firewallAssistance: {provider: "azure", hostFirewalls: [{name: "ufw", state: "active", detail: "Old firewall observation"}], hostGuidance: "Inspect first", providerGuidance: "Review NSG"}}});
    }
    return response({mode: "quick_tunnel", publicUrl: temporaryUrl});
  });
  vi.stubGlobal("fetch", fetcher);
  await act(async () => root.render(<PublishInstanceStep onComplete={() => {}} />));
  await click("Set up free server address");
  expect(container.textContent).toContain("Old firewall observation");
  await click("Recheck network");
  expect(checks).toBe(2);
  expect(container.textContent).toContain("Network inspection unavailable");
  expect(container.textContent).not.toContain("Old firewall observation");
  expect(container.querySelector(`a[href="${temporaryUrl}"]`)).not.toBeNull();
  expect(post.mock.calls.map(([options]) => JSON.parse(options.body))).toEqual([{action: "verify"}]);
});
