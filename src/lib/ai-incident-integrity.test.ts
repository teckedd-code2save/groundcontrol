import { describe, expect, it } from "vitest";
import { classifyToolOutput } from "./ai-memory";
import { applyExactSourceEdits } from "./source-repair";

describe("AI incident integrity", () => {
  it("does not display failed tools as successful", () => {
    expect(classifyToolOutput("ERROR: Daytona validation failed")).toBe("error");
    expect(classifyToolOutput("[exit 1] compose config is invalid")).toBe("error");
    expect(classifyToolOutput('{"status":"failed","detail":"sandbox failed"}')).toBe("error");
    expect(classifyToolOutput('{"candidateValidated":false}')).toBe("error");
    expect(classifyToolOutput('{"status":"completed","candidateValidated":true}')).toBe("done");
    expect(classifyToolOutput("container-name")).toBe("done");
  });

  it("builds a minimal candidate only from exact unique source text", () => {
    const source = [
      "services:",
      "  web:",
      "    environment:",
      "      API_URL: http://api:3000",
      "",
    ].join("\n");
    expect(applyExactSourceEdits(source, [{
      find: "API_URL: http://api:3000",
      replace: "API_URL: http://api:4000",
    }])).toContain("API_URL: http://api:4000");
  });

  it("refuses missing or ambiguous edits instead of inventing a patch", () => {
    expect(() => applyExactSourceEdits("PORT=3000\nPORT=3000\n", [{
      find: "PORT=3000",
      replace: "PORT=4000",
    }])).toThrow(/ambiguous/i);
    expect(() => applyExactSourceEdits("PORT=3000\n", [{
      find: "PORT=4000",
      replace: "PORT=5000",
    }])).toThrow(/does not match/i);
  });
});
