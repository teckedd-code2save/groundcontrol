/**
 * Terraform HCL generator for GroundControl infrastructure stacks.
 *
 * Produces provider-specific, modular Terraform configuration with outputs
 * that the runner can parse (`server_ip`, `cloudrun_url`, `dns_record`, etc.).
 */

export interface HclOptions {
  /** Provider key; validated against supported providers. */
  provider: TerraformProvider | string;
  name: string;
  config?: Record<string, unknown>;
}

export type TerraformProvider = "hetzner" | "aws" | "gcp" | "azure";

export interface HetznerStackConfig {
  name: string;
  serverType: string;
  location: string;
  image: string;
  cloudflareZoneId?: string;
  subdomain?: string;
  sshPublicKey?: string;
  installK3s?: boolean;
}

export interface GcpStackConfig {
  projectId: string;
  region: string;
  serviceName: string;
  image: string;
  enableCloudSql?: boolean;
  dbTier?: string;
}

export interface AwsStackConfig {
  region: string;
  instanceType: string;
  keyName?: string;
  cloudflareZoneId?: string;
  subdomain?: string;
  ami?: string;
}

export interface AzureStackConfig {
  region: string;
  size: string;
}

export interface SuggestedStack {
  provider: TerraformProvider;
  config: HetznerStackConfig | GcpStackConfig | AwsStackConfig | AzureStackConfig;
}

const INDENT = "  ";

/** Sentinel for raw HCL expressions that must not be quoted. */
class HclRaw {
  constructor(public readonly expr: string) {}
}

export function raw(expr: string): HclRaw {
  return new HclRaw(expr);
}

export function isRaw(value: unknown): value is HclRaw {
  return value instanceof HclRaw;
}

/** Produce a literal HCL interpolation reference (e.g. `${var.name}`). */
export function ref(name: string): string {
  return "${" + name + "}";
}

/** Escape a value for use inside an HCL double-quoted string. */
export function escapeHclString(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}

/** Render a JS value into HCL syntax. Raw expressions are emitted verbatim. */
export function renderHclValue(value: unknown): string {
  if (isRaw(value)) return value.expr;
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") {
    if (value.includes("\n")) {
      return `<<EOF\n${value}\nEOF`;
    }
    return `"${escapeHclString(value)}"`;
  }
  if (Array.isArray(value)) {
    return `[${value.map(renderHclValue).join(", ")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${k} = ${renderHclValue(v)}`)
      .join(", ");
    return `{ ${entries} }`;
  }
  return `"${String(value)}"`;
}

function renderBody(body: Record<string, unknown>, depth = 1): string {
  const pad = INDENT.repeat(depth);
  const lines: string[] = [];
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined) continue;
    if (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      !isRaw(value)
    ) {
      lines.push(`${pad}${key} {`);
      lines.push(renderBody(value as Record<string, unknown>, depth + 1));
      lines.push(`${pad}}`);
    } else {
      lines.push(`${pad}${key} = ${renderHclValue(value)}`);
    }
  }
  return lines.join("\n");
}

function block(type: string, name: string, body: Record<string, unknown>): string;
function block(type: string, label1: string, label2: string, body: Record<string, unknown>): string;
function block(
  type: string,
  label1: string,
  label2OrBody: string | Record<string, unknown>,
  body?: Record<string, unknown>
): string {
  if (typeof label2OrBody === "string" && body !== undefined) {
    return [`${type} "${label1}" "${label2OrBody}" {`, renderBody(body), "}"].join("\n");
  }
  return [`${type} "${label1}" {`, renderBody(label2OrBody as Record<string, unknown>), "}"].join("\n");
}

function requiredProvidersBlock(
  providers: Record<string, { source: string; version: string }>
): string {
  const lines: string[] = ["terraform {"];
  lines.push(`${INDENT}required_providers {`);
  for (const [name, meta] of Object.entries(providers)) {
    lines.push(`${INDENT}${INDENT}${name} = {`);
    lines.push(`${INDENT}${INDENT}${INDENT}source  = "${meta.source}"`);
    lines.push(`${INDENT}${INDENT}${INDENT}version = "${meta.version}"`);
    lines.push(`${INDENT}${INDENT}}`);
  }
  lines.push(`${INDENT}}`);
  lines.push("}");
  return lines.join("\n");
}

function variableBlock(
  name: string,
  type: string,
  defaultValue?: unknown,
  sensitive = false
): string {
  const lines = [`variable "${name}" {`, `${INDENT}type = ${type}`];
  if (defaultValue !== undefined) {
    lines.push(`${INDENT}default = ${renderHclValue(defaultValue)}`);
  }
  if (sensitive) {
    lines.push(`${INDENT}sensitive = true`);
  }
  lines.push("}");
  return lines.join("\n");
}

function outputBlock(name: string, value: string, description?: string): string {
  const lines = [`output "${name}" {`, `${INDENT}value = ${value}`];
  if (description) {
    lines.push(`${INDENT}description = "${escapeHclString(description)}"`);
  }
  lines.push("}");
  return lines.join("\n");
}

/** Build a cloud-init user-data script for bootstrapping a VPS. */
export function generateCloudInitUserData(options: {
  installDocker?: boolean;
  installK3s?: boolean;
}): string {
  const { installDocker = true, installK3s = false } = options;
  const runcmd: string[] = [];
  if (installDocker) {
    runcmd.push("systemctl enable --now docker || true");
    runcmd.push("usermod -aG docker root || true");
  }
  if (installK3s) {
    runcmd.push(
      'curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="server" sh -'
    );
    runcmd.push("mkdir -p /root/.kube && cp /etc/rancher/k3s/k3s.yaml /root/.kube/config || true");
  }
  runcmd.push('echo "groundcontrol bootstrap complete"');

  const lines = ["#cloud-config", "package_update: true"];
  if (installDocker) {
    lines.push("packages:", `${INDENT}- docker.io`, `${INDENT}- docker-compose-plugin`, `${INDENT}- curl`);
  }
  if (runcmd.length > 0) {
    lines.push("runcmd:");
    for (const cmd of runcmd) {
      lines.push(`${INDENT}- ${cmd}`);
    }
  }
  return lines.join("\n");
}

/** Generate HCL for a Hetzner VPS + optional Cloudflare DNS + cloud-init bootstrap. */
export function generateHetznerStack(config: HetznerStackConfig): string {
  const {
    name,
    serverType,
    location,
    image,
    cloudflareZoneId,
    subdomain,
    sshPublicKey,
    installK3s,
  } = config;

  const userData = generateCloudInitUserData({ installDocker: true, installK3s });

  const parts: string[] = [];
  parts.push(
    requiredProvidersBlock({
      hcloud: { source: "hetznercloud/hcloud", version: "~> 1.49" },
      cloudflare: { source: "cloudflare/cloudflare", version: "~> 4.0" },
    })
  );

  parts.push(variableBlock("hcloud_token", "string", undefined, true));
  parts.push(variableBlock("cloudflare_api_token", "string", "", true));
  parts.push(variableBlock("name", "string", name));
  parts.push(variableBlock("server_type", "string", serverType));
  parts.push(variableBlock("location", "string", location));
  parts.push(variableBlock("image", "string", image));
  parts.push(variableBlock("ssh_public_key", "string", sshPublicKey ?? ""));
  parts.push(variableBlock("cloudflare_zone_id", "string", cloudflareZoneId ?? ""));
  parts.push(variableBlock("subdomain", "string", subdomain ?? ""));
  parts.push(variableBlock("install_k3s", "bool", installK3s ?? false));

  parts.push(block("provider", "hcloud", { token: raw("var.hcloud_token") }));
  parts.push(
    block("provider", "cloudflare", { api_token: raw("var.cloudflare_api_token") })
  );

  parts.push(
    block("resource", "hcloud_ssh_key", "gc", {
      name: raw('"${var.name}-key"'),
      public_key: raw("var.ssh_public_key"),
    })
  );

  parts.push(`resource "hcloud_server" "gc" {
${INDENT}name        = ${ref("var.name")}
${INDENT}server_type = ${ref("var.server_type")}
${INDENT}image       = ${ref("var.image")}
${INDENT}location    = ${ref("var.location")}
${INDENT}ssh_keys    = [hcloud_ssh_key.gc.id]
${INDENT}user_data   = base64encode(<<EOF
${userData}
EOF
${INDENT})
${INDENT}labels = {
${INDENT}${INDENT}managed_by = "groundcontrol"
${INDENT}}
}`);

  parts.push(
    block("data", "cloudflare_zone", "gc", {
      count: raw('var.cloudflare_zone_id != "" ? 1 : 0'),
      zone_id: raw("var.cloudflare_zone_id"),
    })
  );

  parts.push(
    block("resource", "cloudflare_record", "gc", {
      count: raw('var.cloudflare_zone_id != "" && var.subdomain != "" ? 1 : 0'),
      zone_id: raw("var.cloudflare_zone_id"),
      name: raw("var.subdomain"),
      type: "A",
      value: raw("hcloud_server.gc.ipv4_address"),
      proxied: true,
    })
  );

  parts.push(
    outputBlock(
      "server_ip",
      "hcloud_server.gc.ipv4_address",
      "Public IPv4 of the Hetzner server"
    )
  );
  parts.push(outputBlock("server_id", "hcloud_server.gc.id", "Hetzner server ID"));
  parts.push(
    outputBlock(
      "dns_record",
      'length(cloudflare_record.gc) > 0 ? "${var.subdomain}.${data.cloudflare_zone.gc[0].name}" : ""',
      "FQDN of the Cloudflare DNS record"
    )
  );
  parts.push(
    outputBlock(
      "ssh_command",
      '"ssh root@${hcloud_server.gc.ipv4_address}"',
      "SSH command to connect to the server"
    )
  );

  return parts.join("\n\n");
}

/** Generate HCL for a GCP Cloud Run service + optional Cloud SQL. */
export function generateGcpStack(config: GcpStackConfig): string {
  const { projectId, region, serviceName, image, enableCloudSql, dbTier } = config;

  const parts: string[] = [];
  parts.push(
    requiredProvidersBlock({
      google: { source: "hashicorp/google", version: "~> 5.0" },
    })
  );

  parts.push(variableBlock("project_id", "string", projectId));
  parts.push(variableBlock("region", "string", region));
  parts.push(variableBlock("service_name", "string", serviceName));
  parts.push(variableBlock("image", "string", image));
  parts.push(variableBlock("enable_cloud_sql", "bool", enableCloudSql ?? false));
  parts.push(variableBlock("db_tier", "string", dbTier ?? "db-f1-micro"));

  parts.push(
    block("provider", "google", {
      project: raw("var.project_id"),
      region: raw("var.region"),
    })
  );

  parts.push(`resource "google_cloud_run_v2_service" "gc" {
${INDENT}name     = ${ref("var.service_name")}
${INDENT}location = ${ref("var.region")}
${INDENT}template {
${INDENT}${INDENT}containers {
${INDENT}${INDENT}${INDENT}image = ${ref("var.image")}
${INDENT}${INDENT}}
${INDENT}}
}`);

  parts.push(
    block("resource", "google_sql_database_instance", "gc", {
      count: raw("var.enable_cloud_sql ? 1 : 0"),
      name: raw('"${var.service_name}-db"'),
      database_version: "POSTGRES_15",
      region: raw("var.region"),
      settings: {
        tier: raw("var.db_tier"),
      },
    })
  );

  parts.push(`resource "google_cloud_run_v2_service_iam_member" "public" {
${INDENT}location = google_cloud_run_v2_service.gc.location
${INDENT}service  = google_cloud_run_v2_service.gc.name
${INDENT}role     = "roles/run.invoker"
${INDENT}member   = "allUsers"
}`);

  parts.push(
    outputBlock("cloudrun_url", "google_cloud_run_v2_service.gc.uri", "Cloud Run service URL")
  );
  parts.push(
    outputBlock("service_name", "google_cloud_run_v2_service.gc.name", "Cloud Run service name")
  );
  parts.push(
    outputBlock(
      "db_connection_name",
      "length(google_sql_database_instance.gc) > 0 ? google_sql_database_instance.gc[0].connection_name : \"\"",
      "Cloud SQL connection name"
    )
  );

  return parts.join("\n\n");
}

/** Generate basic HCL for an AWS EC2 instance with a security group. */
export function generateAwsStack(config: AwsStackConfig): string {
  const { region, instanceType, keyName, cloudflareZoneId, subdomain, ami } = config;

  const userData = generateCloudInitUserData({ installDocker: true });

  const parts: string[] = [];
  parts.push(
    requiredProvidersBlock({
      aws: { source: "hashicorp/aws", version: "~> 5.0" },
      cloudflare: { source: "cloudflare/cloudflare", version: "~> 4.0" },
    })
  );

  parts.push(variableBlock("aws_region", "string", region));
  parts.push(variableBlock("instance_type", "string", instanceType));
  parts.push(variableBlock("key_name", "string", keyName ?? ""));
  parts.push(variableBlock("ami", "string", ami ?? ""));
  parts.push(variableBlock("cloudflare_zone_id", "string", cloudflareZoneId ?? ""));
  parts.push(variableBlock("subdomain", "string", subdomain ?? ""));
  parts.push(variableBlock("cloudflare_api_token", "string", "", true));

  parts.push(block("provider", "aws", { region: raw("var.aws_region") }));
  parts.push(
    block("provider", "cloudflare", { api_token: raw("var.cloudflare_api_token") })
  );

  parts.push(`data "aws_ami" "ubuntu" {
${INDENT}most_recent = true
${INDENT}owners      = ["099720109477"]
${INDENT}filter {
${INDENT}${INDENT}name = "ubuntu/images/hvm-ssd/ubuntu-22_04-amd64-server-*"
${INDENT}}
}`);

  parts.push(`resource "aws_security_group" "gc" {
${INDENT}name_prefix = ${ref("var.subdomain")} != "" ? "${ref("var.subdomain")}-" : "gc-"
${INDENT}description = "GroundControl managed security group"

${INDENT}ingress {
${INDENT}${INDENT}from_port   = 22
${INDENT}${INDENT}to_port     = 22
${INDENT}${INDENT}protocol    = "tcp"
${INDENT}${INDENT}cidr_blocks = ["0.0.0.0/0"]
${INDENT}}
${INDENT}ingress {
${INDENT}${INDENT}from_port   = 80
${INDENT}${INDENT}to_port     = 80
${INDENT}${INDENT}protocol    = "tcp"
${INDENT}${INDENT}cidr_blocks = ["0.0.0.0/0"]
${INDENT}}
${INDENT}ingress {
${INDENT}${INDENT}from_port   = 443
${INDENT}${INDENT}to_port     = 443
${INDENT}${INDENT}protocol    = "tcp"
${INDENT}${INDENT}cidr_blocks = ["0.0.0.0/0"]
${INDENT}}

${INDENT}egress {
${INDENT}${INDENT}from_port   = 0
${INDENT}${INDENT}to_port     = 0
${INDENT}${INDENT}protocol    = "-1"
${INDENT}${INDENT}cidr_blocks = ["0.0.0.0/0"]
${INDENT}}
}`);

  parts.push(`resource "aws_instance" "gc" {
${INDENT}ami                    = ${ref("var.ami")} != "" ? ${ref("var.ami")} : data.aws_ami.ubuntu.id
${INDENT}instance_type          = ${ref("var.instance_type")}
${INDENT}key_name               = ${ref("var.key_name")} != "" ? ${ref("var.key_name")} : null
${INDENT}vpc_security_group_ids = [aws_security_group.gc.id]
${INDENT}user_data              = base64encode(<<EOF
${userData}
EOF
${INDENT})
${INDENT}tags = {
${INDENT}${INDENT}managed_by = "groundcontrol"
${INDENT}}
}`);

  parts.push(
    block("data", "cloudflare_zone", "gc", {
      count: raw('var.cloudflare_zone_id != "" ? 1 : 0'),
      zone_id: raw("var.cloudflare_zone_id"),
    })
  );

  parts.push(
    block("resource", "cloudflare_record", "gc", {
      count: raw('var.cloudflare_zone_id != "" && var.subdomain != "" ? 1 : 0'),
      zone_id: raw("var.cloudflare_zone_id"),
      name: raw("var.subdomain"),
      type: "A",
      value: raw("aws_instance.gc.public_ip"),
      proxied: true,
    })
  );

  parts.push(
    outputBlock("server_ip", "aws_instance.gc.public_ip", "Public IPv4 of the EC2 instance")
  );
  parts.push(outputBlock("instance_id", "aws_instance.gc.id", "EC2 instance ID"));
  parts.push(
    outputBlock(
      "dns_record",
      'length(cloudflare_record.gc) > 0 ? "${var.subdomain}.${data.cloudflare_zone.gc[0].name}" : ""',
      "FQDN of the Cloudflare DNS record"
    )
  );

  return parts.join("\n\n");
}

/** Placeholder HCL for an Azure VM deployment. */
export function generateAzureStack(config: AzureStackConfig): string {
  const { region, size } = config;

  const parts: string[] = [];
  parts.push(
    requiredProvidersBlock({
      azurerm: { source: "hashicorp/azurerm", version: "~> 3.0" },
    })
  );

  parts.push(variableBlock("location", "string", region));
  parts.push(variableBlock("vm_size", "string", size));
  parts.push(variableBlock("admin_username", "string", "groundcontrol"));

  parts.push(block("provider", "azurerm", { features: {} }));

  parts.push(
    block("resource", "azurerm_resource_group", "gc", {
      name: "gc-resources",
      location: raw("var.location"),
    })
  );

  parts.push(`resource "azurerm_virtual_machine" "gc" {
${INDENT}name                  = "gc-vm"
${INDENT}location              = azurerm_resource_group.gc.location
${INDENT}resource_group_name   = azurerm_resource_group.gc.name
${INDENT}vm_size               = ${ref("var.vm_size")}
${INDENT}network_interface_ids = []

${INDENT}storage_os_disk {
${INDENT}${INDENT}name              = "gc-osdisk"
${INDENT}${INDENT}caching           = "ReadWrite"
${INDENT}${INDENT}create_option     = "FromImage"
${INDENT}${INDENT}managed_disk_type = "Standard_LRS"
${INDENT}}

${INDENT}os_profile {
${INDENT}${INDENT}computer_name  = "gcvm"
${INDENT}${INDENT}admin_username = ${ref("var.admin_username")}
${INDENT}}

${INDENT}os_profile_linux_config {
${INDENT}${INDENT}disable_password_authentication = true
${INDENT}${INDENT}ssh_keys                        = []
${INDENT}}
}`);

  parts.push(outputBlock("vm_id", "azurerm_virtual_machine.gc.id", "Azure VM resource ID"));
  parts.push(
    outputBlock("resource_group", "azurerm_resource_group.gc.name", "Resource group name")
  );

  return parts.join("\n\n");
}

/** Dispatch to the correct provider-specific generator. */
export function generateHcl(options: HclOptions): string {
  const { provider, name, config = {} } = options;

  switch (provider) {
    case "hetzner": {
      const cfg: HetznerStackConfig = {
        name,
        serverType: String(config.serverType ?? "cx22"),
        location: String(config.location ?? "nbg1"),
        image: String(config.image ?? "ubuntu-22.04"),
        cloudflareZoneId: config.cloudflareZoneId ? String(config.cloudflareZoneId) : undefined,
        subdomain: config.subdomain ? String(config.subdomain) : undefined,
        sshPublicKey: config.sshPublicKey ? String(config.sshPublicKey) : undefined,
        installK3s: config.installK3s === true,
      };
      return generateHetznerStack(cfg);
    }
    case "gcp": {
      const cfg: GcpStackConfig = {
        projectId: String(config.projectId ?? ""),
        region: String(config.region ?? "us-central1"),
        serviceName: String(config.serviceName ?? name),
        image: String(config.image ?? "us-docker.pkg.dev/cloudrun/container/hello"),
        enableCloudSql: config.enableCloudSql === true,
        dbTier: config.dbTier ? String(config.dbTier) : undefined,
      };
      return generateGcpStack(cfg);
    }
    case "aws": {
      const cfg: AwsStackConfig = {
        region: String(config.region ?? "us-east-1"),
        instanceType: String(config.instanceType ?? "t3.micro"),
        keyName: config.keyName ? String(config.keyName) : undefined,
        cloudflareZoneId: config.cloudflareZoneId ? String(config.cloudflareZoneId) : undefined,
        subdomain: config.subdomain ? String(config.subdomain) : undefined,
        ami: config.ami ? String(config.ami) : undefined,
      };
      return generateAwsStack(cfg);
    }
    case "azure": {
      const cfg: AzureStackConfig = {
        region: String(config.region ?? "East US"),
        size: String(config.size ?? "Standard_B1s"),
      };
      return generateAzureStack(cfg);
    }
    default:
      throw new Error(`Unsupported Terraform provider: ${provider}`);
  }
}

/** Recommend a Terraform stack for a given project/target pair. */
export function suggestStack({
  projectSlug,
  targetType,
}: {
  projectSlug: string;
  targetType: string;
}): SuggestedStack {
  switch (targetType) {
    case "cloudrun":
      return {
        provider: "gcp",
        config: {
          projectId: "",
          region: "us-central1",
          serviceName: projectSlug,
          image: "us-docker.pkg.dev/cloudrun/container/hello",
          enableCloudSql: false,
        },
      };
    case "k3s":
      return {
        provider: "hetzner",
        config: {
          name: projectSlug,
          serverType: "cx32",
          location: "nbg1",
          image: "ubuntu-22.04",
          installK3s: true,
        },
      };
    case "compose":
    case "docker-compose":
      return {
        provider: "hetzner",
        config: {
          name: projectSlug,
          serverType: "cx22",
          location: "nbg1",
          image: "ubuntu-22.04",
          installK3s: false,
        },
      };
    case "static":
    default:
      return {
        provider: "hetzner",
        config: {
          name: projectSlug,
          serverType: "cx22",
          location: "nbg1",
          image: "ubuntu-22.04",
          installK3s: false,
        },
      };
  }
}
