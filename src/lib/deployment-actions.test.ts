import { describe, expect, it } from "vitest";
import { lifecycleActionLabel, resolveLifecycleScope } from "./deployment-actions";

describe("deployment lifecycle actions", () => {
  it("targets the whole deployment when no services are selected", () => {
    expect(resolveLifecycleScope("Urbanize", [])).toEqual({
      label: "whole deployment",
      targetName: "Urbanize",
    });
  });

  it("targets selected services when present", () => {
    expect(resolveLifecycleScope("Urbanize", ["api", "worker"])).toEqual({
      services: ["api", "worker"],
      label: "2 selected services",
      targetName: "Urbanize · api, worker",
    });
  });

  it("uses clean labels for lifecycle actions", () => {
    expect(lifecycleActionLabel("start")).toBe("Start");
    expect(lifecycleActionLabel("stop")).toBe("Stop");
    expect(lifecycleActionLabel("restart")).toBe("Restart");
  });
});
