export const ODOO_TEMPLATE_ID = "vps-caddy-odoo-community" as const;

export const ODOO_BUSINESS_MODULES = [
  "crm",
  "sales",
  "inventory",
  "invoicing",
  "purchase",
  "project",
  "website",
  "ecommerce",
] as const;

export type OdooBusinessModule = typeof ODOO_BUSINESS_MODULES[number];

export interface OdooDeploymentIntent {
  name: string;
  domain: string;
  modules: OdooBusinessModule[];
  country: "GH";
  hostPort?: number;
  backupIntervalHours?: number;
  backupRetentionDays?: number;
  odooImage?: string;
  postgresImage?: string;
}

export interface OdooPlanStep {
  id: string;
  title: string;
  customerOutcome: string;
  approval: "none" | "required";
  verification: string;
  rollback: string;
}

export interface OdooDeploymentPlan {
  templateId: typeof ODOO_TEMPLATE_ID;
  intent: Required<Omit<OdooDeploymentIntent, "modules">> & { modules: OdooBusinessModule[] };
  templateInputs: Record<string, string>;
  steps: OdooPlanStep[];
  acceptanceChecks: string[];
  warnings: string[];
}

const DOMAIN_PATTERN = /^(?=.{4,253}$)(?!-)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const IMAGE_PATTERN = /^[a-z0-9][a-z0-9./_-]*(?::[a-zA-Z0-9][a-zA-Z0-9._-]*)$/;

export function validateOdooIntent(intent: OdooDeploymentIntent): string[] {
  const errors: string[] = [];
  const name = intent.name.trim();
  const domain = intent.domain.trim().toLowerCase();
  const modules = [...new Set(intent.modules)];
  const unsupportedModules = modules.filter((module) => !ODOO_BUSINESS_MODULES.includes(module));
  const hostPort = intent.hostPort ?? 13069;
  const backupIntervalHours = intent.backupIntervalHours ?? 24;
  const backupRetentionDays = intent.backupRetentionDays ?? 7;
  const odooImage = intent.odooImage ?? "odoo:19.0";
  const postgresImage = intent.postgresImage ?? "postgres:15";

  if (!name || name.length > 80) errors.push("Business name must contain between 1 and 80 characters.");
  if (!DOMAIN_PATTERN.test(domain)) errors.push("Domain must be a valid public hostname.");
  if (modules.length === 0) errors.push("Select at least one supported Odoo business module.");
  if (unsupportedModules.length > 0) {
    errors.push(`Unsupported Odoo module(s): ${unsupportedModules.join(", ")}.`);
  }
  if (intent.country !== "GH") errors.push("The first Odoo deployment path currently supports Ghana only.");
  if (!Number.isInteger(hostPort) || hostPort < 1024 || hostPort > 65535) {
    errors.push("Host port must be an integer between 1024 and 65535.");
  }
  if (!Number.isInteger(backupIntervalHours) || backupIntervalHours < 1 || backupIntervalHours > 168) {
    errors.push("Backup interval must be between 1 and 168 hours.");
  }
  if (!Number.isInteger(backupRetentionDays) || backupRetentionDays < 1 || backupRetentionDays > 90) {
    errors.push("Backup retention must be between 1 and 90 days.");
  }
  if (!IMAGE_PATTERN.test(odooImage)) errors.push("Odoo image must include an explicit tag.");
  if (!IMAGE_PATTERN.test(postgresImage)) errors.push("PostgreSQL image must include an explicit tag.");

  return errors;
}

export function createOdooDeploymentPlan(intent: OdooDeploymentIntent): OdooDeploymentPlan {
  const errors = validateOdooIntent(intent);
  if (errors.length) throw new Error(errors.join(" "));

  const normalized = {
    name: intent.name.trim(),
    domain: intent.domain.trim().toLowerCase(),
    modules: [...new Set(intent.modules)],
    country: intent.country,
    hostPort: intent.hostPort ?? 13069,
    backupIntervalHours: intent.backupIntervalHours ?? 24,
    backupRetentionDays: intent.backupRetentionDays ?? 7,
    odooImage: intent.odooImage ?? "odoo:19.0",
    postgresImage: intent.postgresImage ?? "postgres:15",
  };
  const slug = slugify(normalized.name);

  return {
    templateId: ODOO_TEMPLATE_ID,
    intent: normalized,
    templateInputs: {
      app_slug: slug,
      domain: normalized.domain,
      odoo_image: normalized.odooImage,
      postgres_image: normalized.postgresImage,
      odoo_host_port: String(normalized.hostPort),
      db_user: "odoo",
      db_name: slug.replace(/-/g, "_"),
      backup_interval_seconds: String(normalized.backupIntervalHours * 60 * 60),
      backup_retention_days: String(normalized.backupRetentionDays),
    },
    steps: [
      {
        id: "validate-capacity",
        title: "Validate host capacity and port availability",
        customerOutcome: "The business system has enough capacity and does not displace an existing service.",
        approval: "none",
        verification: `Host port ${normalized.hostPort} is free and the active VPS meets the Odoo baseline.`,
        rollback: "No mutation occurs during validation.",
      },
      {
        id: "deploy-stack",
        title: "Create the Odoo and PostgreSQL stack",
        customerOutcome: "A persistent Odoo business system is running on the selected VPS.",
        approval: "required",
        verification: "Odoo and PostgreSQL health checks pass and named volumes are attached.",
        rollback: "Stop the new stack and remove its Caddy route without deleting persistent volumes.",
      },
      {
        id: "publish-domain",
        title: "Publish the HTTPS domain",
        customerOutcome: `Operators can securely reach Odoo at https://${normalized.domain}.`,
        approval: "required",
        verification: "The public HTTPS route returns the Odoo login page.",
        rollback: "Restore the previous Caddy revision and DNS record.",
      },
      {
        id: "initialize-business",
        title: "Initialize the Ghana business workspace",
        customerOutcome: `The ${normalized.modules.join(", ")} capabilities are ready for configuration.`,
        approval: "required",
        verification: "The database is initialized and every requested module is installed.",
        rollback: "Restore the pre-initialization archive or remove the unaccepted database.",
      },
      {
        id: "verify-recovery",
        title: "Verify recovery artifacts",
        customerOutcome: "The first recovery point contains both database and filestore data.",
        approval: "none",
        verification: "Paired SQL and filestore archives exist and are non-empty.",
        rollback: "No production mutation occurs during archive inspection.",
      },
    ],
    acceptanceChecks: [
      "PostgreSQL is healthy.",
      "Odoo is healthy and its login page responds through HTTPS.",
      "Database and filestore volumes survive container recreation.",
      "Every requested business module is installed.",
      "A paired database and filestore recovery archive exists.",
      "GroundControl records the deployment identity and public verification evidence.",
    ],
    warnings: [
      "Local recovery archives are not off-host disaster recovery.",
      "The deployment is not marked recoverable until a disposable restore test succeeds.",
      "Ghana tax, payroll and payment behaviour is not enabled until the relevant integration modules pass separate acceptance tests.",
    ],
  };
}

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "odoo";
}
