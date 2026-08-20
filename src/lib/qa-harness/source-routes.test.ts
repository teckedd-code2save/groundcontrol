import { describe, expect, it } from "vitest";
import { scanSourceRoutes } from "./source-routes";

function keys(routes: Array<{ method: string; path: string }>): string[] {
  return routes.map((route) => `${route.method} ${route.path}`).sort();
}

describe("scanSourceRoutes", () => {
  it("discovers Express mounts, router routes, and direct app routes", () => {
    const files = [
      {
        path: "src/app.ts",
        content: `
import express from 'express';
import authRoutes from './routes/auth';
import bookingRoutes from './routes/bookings';
const app = express();
app.use(express.json());
app.get('/health', (_req, res) => res.json({ ok: true }));
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/bookings', bookingRoutes);
`,
      },
      {
        path: "src/routes/auth.ts",
        content: `
import { Router } from 'express';
import { authenticate } from '@/middleware/auth';
const router = Router();
router.post('/otp/send', asyncHandler(async (req, res) => {}));
router.get('/me', authenticate, asyncHandler(async (req, res) => {}));
export default router;
`,
      },
      {
        path: "src/routes/bookings.ts",
        content: `
import { Router } from 'express';
const router = Router();
router.get('/', asyncHandler(async (_req, res) => {}));
router.get('/:id', asyncHandler(async (req, res) => {}));
router.post('/', authenticate, asyncHandler(async (req, res) => {}));
export default router;
`,
      },
    ];

    const routes = scanSourceRoutes(files);
    expect(keys(routes)).toEqual([
      "GET /api/auth/me",
      "GET /api/bookings",
      "GET /api/bookings/:id",
      "GET /health",
      "POST /api/auth/otp/send",
      "POST /api/bookings",
    ]);

    const me = routes.find((route) => route.path === "/api/auth/me");
    expect(me?.auth).toBe(true);
    const otp = routes.find((route) => route.path === "/api/auth/otp/send");
    expect(otp?.auth).toBe(false);
    expect(otp?.mountPrefix).toBe("/api/auth");
  });

  it("discovers Next.js App Router handlers", () => {
    const files = [
      {
        path: "app/api/users/route.ts",
        content: `
export async function GET() { return Response.json({}); }
export async function POST() { return Response.json({}); }
`,
      },
    ];

    const routes = scanSourceRoutes(files);
    expect(keys(routes)).toEqual(["GET /api/users", "POST /api/users"]);
  });

  it("emits generic router routes even without a detected mount", () => {
    const files = [
      {
        path: "routes/health.ts",
        content: `
const router = Router();
router.get('/ready', () => {});
export default router;
`,
      },
    ];
    const routes = scanSourceRoutes(files);
    expect(keys(routes)).toEqual(["GET /ready"]);
  });
});
