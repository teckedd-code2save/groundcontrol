const { createServer } = require("node:http");
const { randomUUID, createHash, createDecipheriv } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFile } = require("node:child_process");
const { promisify } = require("node:util");
const next = require("next");
const { Server } = require("socket.io");
const { PrismaClient } = require("@prisma/client");
const jwt = require("jsonwebtoken");
const cookie = require("cookie");
const { Client: SshClient } = require("ssh2");
const { startAgentOperationWorker } = require("./scripts/agent-operation-worker.cjs");

const execFileAsync = promisify(execFile);
const prisma = new PrismaClient();

const dev = process.env.NODE_ENV !== "production";
const port = Number.parseInt(process.env.PORT || "3000", 10);
const hostname = process.env.HOSTNAME || "0.0.0.0";
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

const BRIDGE_IMAGE = "groundcontrol-host-bridge:latest";
const MAX_INPUT_CHUNK = 64 * 1024;
const MAX_SESSIONS_PER_USER = 4;
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const ACCESS_RECHECK_MS = 60 * 1000;
const activeSessionsByUser = new Map();

function shQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function boundedInt(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function parseTargetId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("A valid terminal target is required.");
  return id;
}

function normalizeCwd(value) {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || value.length > 1024 || /[\r\n\0]/.test(value)) {
    throw new Error("Invalid terminal working directory.");
  }
  if (!value.startsWith("/")) throw new Error("Terminal working directory must be absolute.");
  return value;
}

function shellCommand(cwd) {
  const start = cwd
    ? `cd ${shQuote(cwd)} 2>/dev/null || cd "$HOME" 2>/dev/null || cd /`
    : 'cd "$HOME" 2>/dev/null || cd /';
  return [
    start,
    'export TERM="xterm-256color"',
    'export COLORTERM="truecolor"',
    'if command -v bash >/dev/null 2>&1; then exec bash -li; fi',
    'if command -v zsh >/dev/null 2>&1; then exec zsh -l; fi',
    'exec sh -i',
  ].join("; ");
}

function getJwtSecret() {
  const value = process.env.JWT_SECRET;
  if (!value) throw new Error("JWT_SECRET environment variable is required");
  return value;
}

async function authenticateSocket(socket) {
  const cookies = cookie.parse(socket.request.headers.cookie || "");
  const token = cookies.gc_token;
  if (!token) throw new Error("Unauthorized");
  const decoded = jwt.verify(token, getJwtSecret());
  if (!decoded || typeof decoded !== "object" || !Number.isSafeInteger(decoded.id)) {
    throw new Error("Unauthorized");
  }
  const user = await prisma.user.findUnique({
    where: { id: decoded.id },
    select: { id: true, username: true, role: true, forcePasswordChange: true },
  });
  if (!user || user.role !== "admin" || user.forcePasswordChange) {
    throw new Error("Administrator access is required for the terminal");
  }
  return user;
}

function sameOriginRequest(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const forwarded = String(req.headers["x-forwarded-host"] || "").split(",")[0].trim();
    const host = forwarded || String(req.headers.host || "").trim();
    return Boolean(host) && new URL(origin).host === host;
  } catch {
    return false;
  }
}

function deriveKeyFromString(value) {
  const trimmed = String(value || "").trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return Buffer.from(trimmed, "hex");
  if (/^[A-Za-z0-9+/]{43}=$/.test(trimmed)) {
    const buf = Buffer.from(trimmed, "base64");
    if (buf.length === 32) return buf;
  }
  return createHash("sha256").update(trimmed, "utf8").digest();
}

function loadEncryptionKey() {
  const env = process.env.GROUNDCONTROL_SECRET;
  if (env && env.trim()) return deriveKeyFromString(env);
  const keyFile = path.join(process.cwd(), "prisma", ".groundcontrol-key");
  if (!fs.existsSync(keyFile)) return null;
  return deriveKeyFromString(fs.readFileSync(keyFile, "utf8"));
}

function decryptMaybe(value) {
  if (!value || typeof value !== "string" || !value.startsWith("enc:v1:")) return value || undefined;
  const key = loadEncryptionKey();
  if (!key) throw new Error("GroundControl encryption key is unavailable");
  const raw = Buffer.from(value.slice("enc:v1:".length), "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const data = raw.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

async function ensureBridgeImage() {
  try {
    await execFileAsync("docker", ["image", "inspect", BRIDGE_IMAGE], { timeout: 10000 });
    return;
  } catch {}

  const dockerfile = "FROM alpine:3.19\nRUN apk add --no-cache util-linux\nENTRYPOINT [\"/usr/bin/nsenter\"]\n";
  await new Promise((resolve, reject) => {
    const child = spawn("docker", ["build", "-t", BRIDGE_IMAGE, "-"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || "Could not build the GroundControl host bridge"));
    });
    child.stdin.end(dockerfile);
  });
}

function emitOutput(socket, chunk) {
  if (!chunk) return;
  socket.emit("terminal:output", Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk));
}

async function createLocalTerminal(socket, ctx) {
  await ensureBridgeImage();
  const name = `gc-term-${ctx.user.id}-${randomUUID().slice(0, 8)}`;
  const args = [
    "run", "--rm", "-i", "-t",
    "--privileged",
    "--pid=host",
    "--name", name,
    "--env", "TERM=xterm-256color",
    BRIDGE_IMAGE,
    "-t", "1", "-m", "-u", "-i", "-n", "-p", "--",
    "sh", "-lc", shellCommand(ctx.cwd),
  ];
  const dockerCommand = ["docker", ...args].map(shQuote).join(" ");
  const child = spawn("script", ["-q", "-e", "-f", "-c", dockerCommand, "/dev/null"], {
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
  });
  let closed = false;
  child.stdout.on("data", (chunk) => emitOutput(socket, chunk));
  child.stderr.on("data", (chunk) => emitOutput(socket, chunk));
  child.once("error", (error) => {
    if (!closed) socket.emit("terminal:error", { message: error.message });
  });
  child.once("close", (code, signal) => {
    if (!closed) socket.emit("terminal:exit", { code: code ?? null, signal: signal || null });
  });

  return {
    type: "local",
    write(data) {
      if (!closed && child.stdin.writable) child.stdin.write(data);
    },
    async resize(cols, rows) {
      if (closed) return;
      try {
        await execFileAsync("docker", [
          "container", "resize",
          "--height", String(rows),
          "--width", String(cols),
          name,
        ], { timeout: 5000 });
      } catch {}
    },
    async close() {
      if (closed) return;
      closed = true;
      try { child.stdin.end(); } catch {}
      try { child.kill("SIGTERM"); } catch {}
      try {
        await execFileAsync("docker", ["rm", "-f", name], { timeout: 5000 });
      } catch {}
    },
  };
}

async function createRemoteTerminal(socket, ctx) {
  const ssh = new SshClient();
  const privateKey = decryptMaybe(ctx.vps.privateKey);
  const password = decryptMaybe(ctx.vps.password);
  const config = {
    host: ctx.vps.host,
    port: ctx.vps.port,
    username: ctx.vps.username,
    readyTimeout: 20000,
    keepaliveInterval: 15000,
    keepaliveCountMax: 3,
  };
  if (ctx.vps.authType === "key" && privateKey) config.privateKey = privateKey;
  else if (password) config.password = password;
  else if (privateKey) config.privateKey = privateKey;
  else throw new Error("No SSH credential is available for this terminal target");

  await new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    ssh.once("error", onError);
    ssh.once("ready", () => {
      ssh.off("error", onError);
      resolve();
    });
    ssh.connect(config);
  });

  const stream = await new Promise((resolve, reject) => {
    ssh.exec(shellCommand(ctx.cwd), {
      pty: {
        term: "xterm-256color",
        cols: ctx.cols,
        rows: ctx.rows,
        width: 0,
        height: 0,
      },
    }, (error, channel) => {
      if (error) reject(error);
      else resolve(channel);
    });
  });

  let closed = false;
  stream.on("data", (chunk) => emitOutput(socket, chunk));
  if (stream.stderr) stream.stderr.on("data", (chunk) => emitOutput(socket, chunk));
  stream.once("close", (code, signal) => {
    if (!closed) socket.emit("terminal:exit", { code: code ?? null, signal: signal || null });
    try { ssh.end(); } catch {}
  });
  ssh.on("error", (error) => {
    if (!closed) socket.emit("terminal:error", { message: error.message });
  });

  return {
    type: "ssh",
    write(data) {
      if (!closed && stream.writable) stream.write(data);
    },
    async resize(cols, rows) {
      if (closed || typeof stream.setWindow !== "function") return;
      stream.setWindow(rows, cols, 0, 0);
    },
    async close() {
      if (closed) return;
      closed = true;
      try { stream.end(); } catch {}
      try { stream.close(); } catch {}
      try { ssh.end(); } catch {}
    },
  };
}

function incrementSessions(userId) {
  const current = activeSessionsByUser.get(userId) || 0;
  if (current >= MAX_SESSIONS_PER_USER) throw new Error("Too many active terminal sessions");
  activeSessionsByUser.set(userId, current + 1);
}

function decrementSessions(userId) {
  const current = activeSessionsByUser.get(userId) || 0;
  if (current <= 1) activeSessionsByUser.delete(userId);
  else activeSessionsByUser.set(userId, current - 1);
}

async function audit(socket, action, metadata) {
  const user = socket.data.user;
  if (!user) return;
  try {
    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action,
        ip: String(socket.handshake.address || ""),
        userAgent: String(socket.request.headers["user-agent"] || "").slice(0, 500),
        metadata: JSON.stringify(metadata || {}).slice(0, 4000),
      },
    });
  } catch (error) {
    console.warn("[terminal] audit write failed:", error instanceof Error ? error.message : String(error));
  }
}

function installTerminalSockets(io) {
  io.use(async (socket, nextMiddleware) => {
    try {
      socket.data.user = await authenticateSocket(socket);
      nextMiddleware();
    } catch (error) {
      nextMiddleware(new Error(error instanceof Error ? error.message : "Unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    let backend = null;
    let sessionCounted = false;
    let idleTimer = null;
    let accessTimer = null;
    let closing = false;

    const resetIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        socket.emit("terminal:error", { message: "Terminal session closed after 30 minutes of inactivity." });
        void closeSession("idle_timeout");
      }, IDLE_TIMEOUT_MS);
    };

    const closeSession = async (reason = "closed") => {
      if (closing) return;
      closing = true;
      if (idleTimer) clearTimeout(idleTimer);
      if (accessTimer) clearInterval(accessTimer);
      const active = backend;
      backend = null;
      if (active) {
        try { await active.close(); } catch {}
      }
      if (sessionCounted) {
        decrementSessions(socket.data.user.id);
        sessionCounted = false;
      }
      if (socket.data.vpsId) {
        await audit(socket, "terminal_session_close", {
          vpsId: socket.data.vpsId,
          reason,
        });
      }
      closing = false;
    };

    socket.on("terminal:start", async (payload = {}, acknowledge = () => {}) => {
      try {
        await closeSession("restart");
        const user = await authenticateSocket(socket);
        socket.data.user = user;
        const vpsId = parseTargetId(payload.vpsId);
        const vps = await prisma.vpsConfig.findUnique({ where: { id: vpsId } });
        if (!vps) throw new Error("The selected terminal target no longer exists");
        const cwd = normalizeCwd(payload.cwd);
        const cols = boundedInt(payload.cols, 100, 20, 400);
        const rows = boundedInt(payload.rows, 30, 5, 200);

        incrementSessions(user.id);
        sessionCounted = true;
        socket.data.vpsId = vps.id;
        backend = vps.isLocal
          ? await createLocalTerminal(socket, { user, vps, cwd, cols, rows })
          : await createRemoteTerminal(socket, { user, vps, cwd, cols, rows });
        await backend.resize(cols, rows);

        resetIdle();
        accessTimer = setInterval(async () => {
          try {
            const current = await prisma.user.findUnique({
              where: { id: user.id },
              select: { role: true, forcePasswordChange: true },
            });
            if (!current || current.role !== "admin" || current.forcePasswordChange) {
              socket.emit("terminal:error", { message: "Terminal access was revoked." });
              await closeSession("access_revoked");
            }
          } catch {
            socket.emit("terminal:error", { message: "Could not revalidate terminal access." });
            await closeSession("access_check_failed");
          }
        }, ACCESS_RECHECK_MS);

        await audit(socket, "terminal_session_open", {
          vpsId: vps.id,
          host: vps.host,
          mode: vps.isLocal ? "local_host_pty" : "ssh_pty",
          cwd: cwd || "home",
        });

        socket.emit("terminal:ready", {
          vpsId: vps.id,
          host: vps.host,
          mode: vps.isLocal ? "local" : "ssh",
          cwd: cwd || null,
        });
        acknowledge({ ok: true });
      } catch (error) {
        if (sessionCounted && !backend) {
          decrementSessions(socket.data.user.id);
          sessionCounted = false;
        }
        const message = error instanceof Error ? error.message : String(error);
        socket.emit("terminal:error", { message });
        acknowledge({ ok: false, error: message });
      }
    });

    socket.on("terminal:input", (data) => {
      if (!backend || typeof data !== "string" || Buffer.byteLength(data, "utf8") > MAX_INPUT_CHUNK) return;
      resetIdle();
      backend.write(data);
    });

    socket.on("terminal:resize", (size = {}) => {
      if (!backend) return;
      const cols = boundedInt(size.cols, 100, 20, 400);
      const rows = boundedInt(size.rows, 30, 5, 200);
      void backend.resize(cols, rows);
    });

    socket.on("terminal:close", () => void closeSession("client_close"));
    socket.on("disconnect", () => void closeSession("disconnect"));
  });
}

async function main() {
  await app.prepare();
  const httpServer = createServer((req, res) => handle(req, res));
  const io = new Server(httpServer, {
    path: "/socket.io",
    serveClient: false,
    transports: ["websocket"],
    maxHttpBufferSize: MAX_INPUT_CHUNK,
    allowRequest: (req, callback) => callback(null, sameOriginRequest(req)),
  });
  installTerminalSockets(io);

  let stopAgentWorker = async () => {};
  httpServer.listen(port, hostname, () => {
    console.log(`> GroundControl ready on http://${hostname}:${port}`);
    stopAgentWorker = startAgentOperationWorker({
      prisma,
      port,
      jwtSecret: getJwtSecret(),
    });
  });

  const shutdown = async (signal) => {
    console.log(`[server] ${signal} received, closing...`);
    io.close();
    await stopAgentWorker().catch(() => {});
    httpServer.close(async () => {
      await prisma.$disconnect();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
}

main().catch(async (error) => {
  console.error("[server] fatal:", error);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
