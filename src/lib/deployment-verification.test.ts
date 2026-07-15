import { describe, expect, it } from "vitest";
import { deploymentVerificationStatus, parsePublicEndpointCheck } from "./deployment-verification";

describe("public deployment verification", () => {
  it("does not report success for NXDOMAIN or an unreachable route", () => {
    const check = parsePublicEndpointCheck("7848.groundcontrol.run", "curl: (6) Could not resolve host\n000|");
    expect(check.reachable).toBe(false);
    expect(deploymentVerificationStatus([check.domain], null, [check])).toMatchObject({
      status: "degraded",
      publicVerified: false,
    });
  });

  it("accepts a responding public endpoint, including protected routes", () => {
    const check = parsePublicEndpointCheck("app.example.com", "403|203.0.113.4");
    expect(check).toMatchObject({ httpStatus: 403, reachable: true });
    expect(deploymentVerificationStatus([check.domain], [{ name: check.domain }], [check])).toMatchObject({
      status: "success",
      publicVerified: true,
    });
  });

  it("surfaces DNS provisioning errors even if a stale endpoint responds", () => {
    const check = parsePublicEndpointCheck("app.example.com", "200|203.0.113.4");
    expect(deploymentVerificationStatus([check.domain], { error: "zone not connected" }, [check])).toMatchObject({
      status: "degraded",
      publicVerified: false,
      error: "zone not connected",
    });
  });
});
