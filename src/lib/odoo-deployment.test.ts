import { describe, expect, it } from "vitest";
import { createOdooDeploymentPlan, validateOdooIntent } from "./odoo-deployment";

describe("Odoo deployment planning", () => {
  it("turns a Ghana business intent into deterministic template inputs", () => {
    const plan = createOdooDeploymentPlan({
      name: "Kwame's Pharmacy",
      domain: "ERP.KWAMESPHARMACY.COM",
      modules: ["sales", "inventory", "invoicing", "inventory"],
      country: "GH",
    });

    expect(plan.templateId).toBe("vps-caddy-odoo-community");
    expect(plan.intent.domain).toBe("erp.kwamespharmacy.com");
    expect(plan.intent.modules).toEqual(["sales", "inventory", "invoicing"]);
    expect(plan.templateInputs).toMatchObject({
      app_slug: "kwame-s-pharmacy",
      db_name: "kwame_s_pharmacy",
      odoo_image: "odoo:19.0",
      postgres_image: "postgres:15",
      odoo_host_port: "13069",
      backup_interval_seconds: "86400",
      backup_retention_days: "7",
    });
    expect(plan.steps.some((step) => step.approval === "required")).toBe(true);
    expect(plan.acceptanceChecks).toContain("Every requested business module is installed.");
    expect(plan.warnings).toContain("The deployment is not marked recoverable until a disposable restore test succeeds.");
  });

  it("rejects unsafe or unsupported intent before producing a plan", () => {
    const errors = validateOdooIntent({
      name: "",
      domain: "localhost",
      modules: ["accounting"] as never,
      country: "GH",
      hostPort: 80,
      backupRetentionDays: 0,
      odooImage: "odoo",
      postgresImage: "postgres",
    });

    expect(errors).toContain("Business name must contain between 1 and 80 characters.");
    expect(errors).toContain("Domain must be a valid public hostname.");
    expect(errors).toContain("Unsupported Odoo module(s): accounting.");
    expect(errors).toContain("Host port must be an integer between 1024 and 65535.");
    expect(errors).toContain("Backup retention must be between 1 and 90 days.");
    expect(errors).toContain("Odoo image must include an explicit tag.");
    expect(errors).toContain("PostgreSQL image must include an explicit tag.");
  });

  it("requires at least one module", () => {
    const errors = validateOdooIntent({
      name: "Retail ERP",
      domain: "erp.example.com",
      modules: [],
      country: "GH",
    });

    expect(errors).toContain("Select at least one supported Odoo business module.");
  });
});
