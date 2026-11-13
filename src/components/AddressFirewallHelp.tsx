"use client";

import { useState } from "react";
import { Copy } from "lucide-react";

export type AddressFirewallAssistance = {
  provider: "azure" | "aws" | "gcp" | "unknown";
  hostFirewalls: { name: "ufw" | "firewalld"; state: "active" | "inactive" | "unavailable"; detail: string }[];
  hostGuidance: string;
  providerGuidance: string;
};

type Provider = AddressFirewallAssistance["provider"];
const providerNames: Record<Provider, string> = {azure: "Azure", aws: "AWS", gcp: "Google Cloud", unknown: "Other provider / self-hosted"};

export default function AddressFirewallHelp({ assistance, hostname, publicIpv4 }: {
  assistance?: AddressFirewallAssistance;
  hostname: string;
  publicIpv4: string;
}) {
  const [guide, setGuide] = useState<Provider>(assistance?.provider || "unknown");
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const reviewRequest = [
    `Please review network access for GroundControl at ${hostname} (public IPv4 ${publicIpv4}).`,
    "Start read-only: identify the actual server, host firewall, provider/router rules and any shared network scope. Check inbound TCP 80 and 443 and existing SSH access.",
    "Propose only the necessary web-access changes. Public web ingress exposes the authenticated dashboard sign-in and HTTPS certificate endpoint to the Internet.",
    "Before changing anything, show the exact target resources, source/destination ranges, ports, rule priority and rollback, then ask for my explicit approval. This request is not approval to modify rules.",
    "Preserve existing SSH access and keep GroundControl port 3003 private. Do not disable/reset a firewall, remove existing rules or widen access to other servers.",
    ...(guide === "azure" ? ["For Azure, inspect both NIC and subnet NSGs and effective rules. Scope any proposed rule to this VM's private IP, not its public IP, and check higher-priority denies before selecting an unused priority."] : []),
    "Preserve existing access, including temporary access if enabled. After approved changes, recheck requirements and verify the new HTTPS address before retiring the fallback.",
  ].join("\n\n");

  async function copyReviewRequest() {
    setCopied(false);
    setCopyError(false);
    try {
      await navigator.clipboard.writeText(reviewRequest);
      setCopied(true);
    } catch {
      setCopyError(true);
    }
  }

  return (
    <section className="space-y-3 border border-border p-4" aria-label="Network access assistance">
      <div>
        <h3 className="text-sm font-medium">Review network access</h3>
        <p className="mt-1 text-xs leading-relaxed text-muted">These checks are read-only. Host status does not prove Internet reachability, and no provider firewall rules have been inspected or changed.</p>
      </div>
      <dl className="space-y-1 text-xs">
        <div className="flex flex-wrap gap-x-2"><dt className="text-muted">Provider hint:</dt><dd>{assistance?.provider && assistance.provider !== "unknown" ? `${providerNames[assistance.provider]} detected; confirm the actual server` : "Not identified; choose the guide that fits your server"}</dd></div>
        {assistance?.hostFirewalls.map(firewall => <div key={firewall.name} className="flex flex-wrap gap-x-2"><dt className="text-muted">{firewall.name}:</dt><dd>{firewall.state === "unavailable" ? "Status not verified" : firewall.state}</dd></div>)}
      </dl>
      <p className="text-xs leading-relaxed text-muted">Review inbound TCP <strong className="font-medium text-foreground">80 and 443</strong> on this server and any cloud, VPS or router firewall. Preserve SSH and keep port 3003 private. Do not disable a firewall to make setup work.</p>

      <details className="text-xs leading-relaxed">
        <summary className="cursor-pointer font-medium">Firewall steps and approval</summary>
        <div className="mt-3 space-y-4">
          <div>
            <h4 className="font-medium">1. Check the host firewall</h4>
            <p className="mt-1 text-muted">Have the server operator inspect the active firewall and existing rules before proposing changes. An inactive or unavailable UFW/firewalld result does not rule out nftables, iptables or another filter.</p>
            {assistance?.hostFirewalls.map(firewall => <p key={firewall.name} className="mt-2 text-muted">{firewall.detail}</p>)}
            {assistance?.hostGuidance && <p className="mt-2 text-muted">{assistance.hostGuidance}</p>}
            <p className="mt-2 text-muted">Read-only examples, when the tool is installed and you have permission:</p>
            <pre className="mt-2 overflow-x-auto border border-border p-3 font-mono text-[11px]">{`sudo ufw status verbose\nsudo firewall-cmd --get-active-zones`}</pre>
            <p className="mt-2 text-muted">These inspect state; they do not open ports. Do not enable, reset or disable a firewall as part of this check.</p>
          </div>
          <div>
            <h4 className="font-medium">2. Review the provider or network firewall</h4>
            <label htmlFor="gc-firewall-guide" className="mt-2 block text-muted">Choose a guide. This does not connect to an account.</label>
            <select id="gc-firewall-guide" className="gc-field mt-1 w-full" value={guide} onChange={event => { setGuide(event.target.value as Provider); setCopied(false); setCopyError(false); }}>
              {Object.entries(providerNames).map(([value, name]) => <option key={value} value={value}>{name}</option>)}
            </select>
            <ProviderGuide provider={guide} />
          </div>
          <div>
            <h4 className="font-medium">3. Approve exact changes, then verify</h4>
            <p className="mt-1 text-muted">Before an operator or assistant changes rules, review the exact server, affected resources, source/destination, TCP ports, priority and rollback. Public web ingress is a security change; give explicit approval only for that plan. Preserve existing access, including a temporary link if enabled, until the new address works.</p>
            <p className="mt-2 text-muted">After any approved changes, choose Recheck network &amp; requirements, then Set up &amp; verify address. GroundControl checks the public URL from the server. Open the address from another network/device to verify Internet access; local firewall status alone cannot prove reachability.</p>
          </div>
        </div>
      </details>
      <div className="space-y-2 border-t border-border pt-3">
        <button type="button" onClick={() => void copyReviewRequest()} className="gc-button gc-button-quiet"><Copy className="h-3 w-3" />Copy review request</button>
        <p className="text-xs text-muted">Copy this request to your operator or assistant. Nothing is sent, approved or changed here.</p>
        {copied && <p role="status" className="text-xs text-success">Review request copied. No firewall change was approved or made.</p>}
        {copyError && <p role="alert" className="text-xs text-warning">Clipboard unavailable. Select and copy the request below.</p>}
        <details open={copyError || undefined} className="text-xs">
          <summary className="cursor-pointer">Read the review request</summary>
          <textarea aria-label="Firewall review request" readOnly value={reviewRequest} rows={9} className="gc-field mt-2 w-full text-xs" />
        </details>
      </div>
    </section>
  );
}

function ProviderGuide({provider}: {provider: Provider}) {
  if (provider === "azure") return <div className="mt-3 space-y-2 text-muted">
    <p>Azure portal → Virtual machines → your VM → Networking → Network settings. Open the network interface and its Effective security rules. Review both NIC and subnet Network Security Groups (NSGs); either can block access.</p>
    <p>Only after approval, add the necessary inbound rule in the applicable NSG(s). Use this as a reviewed template, not an instruction to override existing policy:</p>
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border border-border p-3">
      <dt>Source</dt><dd>Service Tag: Internet (public web access)</dd>
      <dt>Source ports</dt><dd>*</dd>
      <dt>Destination</dt><dd>This VM’s private IPv4 /32, not its public IP</dd>
      <dt>Ports / protocol</dt><dd>80, 443 / TCP</dd>
      <dt>Action</dt><dd>Allow</dd>
      <dt>Priority</dt><dd>Unused value 100–4096, after reviewing higher-priority denies; lower numbers run first</dd>
      <dt>Name</dt><dd>A unique name such as gc-web</dd>
    </dl>
    <p>Do not widen a shared NSG to other VMs or override an intentional deny. Preserve SSH. If permitted, use NSG → Inbound security rules → Add; inspect effective rules again afterward.</p>
    <p><a className="underline hover:text-accent" href="https://learn.microsoft.com/en-us/azure/virtual-network/manage-network-security-group" target="_blank" rel="noreferrer">Azure rule fields</a> · <a className="underline hover:text-accent" href="https://learn.microsoft.com/en-us/azure/virtual-network/diagnose-network-traffic-filter-problem" target="_blank" rel="noreferrer">Effective-rule diagnosis</a></p>
  </div>;
  if (provider === "aws") return <div className="mt-3 space-y-2 text-muted">
    <p>EC2 → Instances → your instance → Security. Inspect attached security-group inbound rules, subnet network ACLs and the public-IP route. A group can apply to several instances.</p>
    <p>For public web access, the proposal may include inbound TCP 80 and 443 from the Internet. Review the exact source and attached instances before approval; do not widen SSH or port 3003. A subnet ACL also needs the matching return path.</p>
    <a className="underline hover:text-accent" href="https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/changing-security-group.html" target="_blank" rel="noreferrer">AWS security-group guide</a>
  </div>;
  if (provider === "gcp") return <div className="mt-3 space-y-2 text-muted">
    <p>Open the VM’s network interface and the applicable VPC ingress firewall rules in Firewall policies. Inspect priorities and target tags/service accounts; the target must not unintentionally include other VMs.</p>
    <p>Review any proposed inbound TCP 80/443 source and target before approval. Preserve SSH and keep port 3003 private; GroundControl has not connected to or changed your Google Cloud project.</p>
    <a className="underline hover:text-accent" href="https://docs.cloud.google.com/firewall/docs/using-firewalls" target="_blank" rel="noreferrer">Google Cloud firewall guide</a>
  </div>;
  return <div className="mt-3 space-y-2 text-muted">
    <p>In your VPS or cloud control panel, locate the firewall/security group for this server and its network or subnet. On your own hardware, review the router/gateway and any NAT forwarding too.</p>
    <p>Identify what actually handles inbound TCP 80/443 before proposing a change. If you do not control that network, ask its operator for a scoped plan. No cloud account access or provider rule inspection is assumed.</p>
  </div>;
}
