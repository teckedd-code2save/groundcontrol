import { describe, expect, it } from "vitest";
import { discoverContracts } from "./discover";

describe("discoverContracts", () => {
  it("merges source routes and snapshot seeds without probing", async () => {
    const result = await discoverContracts({
      component: "api",
      baseUrl: "https://example.com/",
      sourceFiles: [
        {
          path: "src/app.ts",
          content: `
import express from 'express';
import authRoutes from './routes/auth';
const app = express();
app.get('/health', (_req, res) => res.json({}));
app.use('/api/auth', authRoutes);
`,
        },
        {
          path: "src/routes/auth.ts",
          content: `
const router = Router();
router.post('/otp/send', () => {});
export default router;
`,
        },
      ],
      seedPaths: ["/health", "/api/auth/otp/send", "/status"],
      probe: false,
    });

    expect(result.sourceRoutesFound).toBe(2);
    expect(result.probed).toBe(0);
    const paths = result.drafts.map((draft) => `${draft.method} ${draft.path}`).sort();
    expect(paths).toEqual([
      "GET /health",
      "GET /status",
      "POST /api/auth/otp/send",
    ]);
    expect(result.drafts.every((draft) => draft.status === "draft")).toBe(true);
    expect(result.drafts.some((draft) => draft.source === "source")).toBe(true);
    expect(result.drafts.some((draft) => draft.source === "snapshot")).toBe(true);
  });

  it("deduplicates against existing active checks", async () => {
    const result = await discoverContracts({
      component: "api",
      baseUrl: "https://example.com",
      sourceFiles: [
        {
          path: "src/app.ts",
          content: `const app = express(); app.get('/health', () => {});`,
        },
      ],
      existingChecks: [{ method: "GET", path: "/health" }],
      probe: false,
    });
    expect(result.drafts).toHaveLength(0);
  });
});
