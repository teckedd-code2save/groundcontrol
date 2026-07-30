import { describe, expect, it } from "vitest";
import {
  composeProjectCandidates,
  requestedComposePathForCandidate,
} from "./redeploy-target";

describe("redeploy target resolution", () => {
  it("tries live or server-side evidence before a stale browser path", () => {
    expect(composeProjectCandidates({
      projectPath: "/opt/agent-flow/RentAWeekend",
      projectSlug: "rentaweekend",
      source: "labels",
    }, "/opt/github-com-teckedd-code2save-company-site-git")).toEqual([
      {
        projectPath: "/opt/agent-flow/RentAWeekend",
        projectSlug: "rentaweekend",
        source: "labels",
      },
      {
        projectPath: "/opt/github-com-teckedd-code2save-company-site-git",
        projectSlug: "rentaweekend",
        source: "request",
      },
    ]);
  });

  it("does not duplicate an identical requested path", () => {
    expect(composeProjectCandidates({
      projectPath: "/opt/app/",
      projectSlug: "app",
      source: "config",
    }, "/opt/app")).toHaveLength(1);
  });

  it("only carries an explicit Compose file into its owning folder", () => {
    expect(requestedComposePathForCandidate(
      "/opt/agent-flow/RentAWeekend/docker-compose.yml",
      "/opt/agent-flow/RentAWeekend"
    )).toBe("/opt/agent-flow/RentAWeekend/docker-compose.yml");
    expect(requestedComposePathForCandidate(
      "/opt/old/docker-compose.yml",
      "/opt/agent-flow/RentAWeekend"
    )).toBeUndefined();
  });
});
