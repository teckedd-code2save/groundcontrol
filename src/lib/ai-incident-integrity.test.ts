import { describe, expect, it } from "vitest";
import { classifyToolOutput } from "./ai-memory";
import { applyExactSourceEdits } from "./source-repair";
import { getOpenAIToolSchemas } from "./ai-agent";

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

  it("returns to runtime investigation when the proposed source change already exists", () => {
    expect(() => applyExactSourceEdits("API_UPSTREAM=http://api:4000\n", [{
      find: "API_UPSTREAM=http://api:3000",
      replace: "API_UPSTREAM=http://api:4000",
    }])).toThrow(/already present.*runtime investigation/i);
  });

  it("requires evidence-first Compose diagnosis and non-empty source edits", () => {
    const schemas = getOpenAIToolSchemas();
    expect(schemas.some((tool) => tool.function.name === "investigate_compose_failure")).toBe(true);
    const repair = schemas.find((tool) => tool.function.name === "prepare_source_fix_in_daytona");
    const parameters = repair?.function.parameters as {
      properties?: {
        edits?: {
          minItems?: number;
          maxItems?: number;
          items?: { properties?: { find?: { minLength?: number } } };
        };
      };
    };
    expect(parameters.properties?.edits?.minItems).toBe(1);
    expect(parameters.properties?.edits?.maxItems).toBe(8);
    expect(parameters.properties?.edits?.items?.properties?.find?.minLength).toBe(1);
  });
});
