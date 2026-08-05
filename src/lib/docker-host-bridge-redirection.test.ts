import { describe, expect, it } from "vitest";
import { buildDetachedBridgeCommand } from "./docker-host-bridge";

describe("detached host bridge log capture", () => {
  it("redirects the whole semicolon-separated redeploy script", () => {
    const command = buildDetachedBridgeCommand(
      "printf 'start\\n'; false; printf 'diagnostic\\n'",
      "/tmp/gc-redeploy-example.log",
      { append: true }
    );

    expect(command).toContain("{ export PATH=");
    expect(command).toContain("printf");
    expect(command).toContain("diagnostic");
    expect(command).toContain("; } >>");
    expect(command).toContain("/tmp/gc-redeploy-example.log");
    expect(command).toContain("2>&1");
  });
});
