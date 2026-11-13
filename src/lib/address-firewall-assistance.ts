import { execReadOnlyAddressProbe } from "./caddy-address-preflight";

export type AddressFirewallAssistance = {
  provider: "azure" | "aws" | "gcp" | "unknown";
  hostFirewalls: { name: "ufw" | "firewalld"; state: "active" | "inactive" | "unavailable"; detail: string }[];
  hostGuidance: string;
  providerGuidance: string;
};

async function inspect(command: string) {
  try { return await execReadOnlyAddressProbe(command, 5_000); }
  catch { return null; }
}

/** Read-only hints, never proof of public reachability or effective firewall policy. */
export async function inspectAddressFirewallAssistance(): Promise<AddressFirewallAssistance> {
  const [cloud, ufw, firewalld] = await Promise.all([
    inspect("if command -v cloud-id >/dev/null 2>&1; then cloud-id; else cat /sys/class/dmi/id/sys_vendor /sys/class/dmi/id/product_name 2>/dev/null; fi"),
    inspect("command -v ufw >/dev/null 2>&1 || exit 127; LC_ALL=C ufw status verbose"),
    inspect("command -v firewall-cmd >/dev/null 2>&1 || exit 127; LC_ALL=C firewall-cmd --state"),
  ]);
  // Return only a recognized provider, not raw host metadata or firewall rules.
  const identity = cloud?.code === 0 ? cloud.stdout.trim().toLowerCase() : "";
  const provider = identity === "azure" ? "azure"
    : identity === "aws" || /amazon ec2/.test(identity) ? "aws"
    : identity === "gce" || /google compute engine/.test(identity) ? "gcp" : "unknown";
  const ufwState = ufw?.code === 0 && /^Status: active$/m.test(ufw.stdout) ? "active"
    : ufw?.code === 0 && /^Status: inactive$/m.test(ufw.stdout) ? "inactive" : "unavailable";
  const firewalldState = firewalld?.code === 0 && firewalld.stdout.trim() === "running" ? "active"
    : firewalld?.stdout.trim() === "not running" ? "inactive" : "unavailable";
  return {
    provider,
    hostFirewalls: [
      { name: "ufw", state: ufwState, detail: ufwState === "active" ? "UFW is active. Review its inbound TCP 80/443 rules and rule order; this check does not establish effective access." : ufwState === "inactive" ? "UFW reports inactive; other host or cloud filters may still apply." : "UFW status could not be verified. It may be absent or require elevated read access." },
      { name: "firewalld", state: firewalldState, detail: firewalldState === "active" ? "firewalld is running. Review the active interface zones and their HTTP/HTTPS services or TCP 80/443 rules." : firewalldState === "inactive" ? "firewalld reports not running; other host or cloud filters may still apply." : "firewalld status could not be verified. It may be absent or require elevated read access." },
    ],
    hostGuidance: "On this server, review inbound TCP 80 and 443 in the active firewall. Preserve your existing SSH access rule and keep GroundControl port 3003 private. Do not disable the firewall. Ask for help reviewing the rules before approving any change; no host rule has been changed.",
    providerGuidance: provider === "azure"
      ? "Azure portal: open this VM → Networking / Network settings. Review inbound rules on both the network-interface and subnet Network Security Groups, including rule priority. Public HTTPS setup requires TCP 80 and 443 to reach this VM. Preserve SSH access; do not expose port 3003. GroundControl has not inspected or changed Azure rules."
      : provider === "aws"
        ? "AWS console: open this EC2 instance → Security. Review attached security-group inbound TCP 80/443 rules, subnet network ACLs and the public-IP route. Preserve SSH and keep port 3003 private. GroundControl has not inspected or changed AWS rules."
        : provider === "gcp"
          ? "Google Cloud console: open this VM's network interface and review applicable VPC ingress firewall rules and their target tags/service accounts for TCP 80/443. Preserve SSH and keep port 3003 private. GroundControl has not inspected or changed Google Cloud rules."
          : "Open your server provider's networking/firewall page and review inbound TCP 80/443 for this server and its subnet. Provider detection was inconclusive; no cloud rules were inspected or changed. Preserve SSH and keep port 3003 private.",
  };
}
