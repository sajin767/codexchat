import { spawn } from "node:child_process";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const PUBLIC_DIR = path.join(PROJECT_ROOT, "public");
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "0.0.0.0";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function getLanAddresses() {
  const addresses = [];
  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const entry of interfaces || []) {
      if (entry.family === "IPv4" && !entry.internal) {
        addresses.push(entry.address);
      }
    }
  }
  return addresses;
}

class CodexBridge {
  constructor() {
    this.proc = null;
    this.buffer = "";
    this.nextRequestId = 1;
    this.pendingResponses = new Map();
    this.pendingApprovals = new Map();
    this.threadId = null;
    this.currentTurnId = null;
    this.turnActive = false;
    this.currentAssistantItemId = null;
    this.messages = [];
    this.events = new Set();
    this.status = {
      codexReady: false,
      appServer: "stopped",
      threadId: null,
      turnActive: false,
      cwd: PROJECT_ROOT,
      lastError: null,
      startedAt: null
    };
  }

  snapshot() {
    return {
      status: this.status,
      messages: this.messages,
      approvals: Array.from(this.pendingApprovals.values()).map((approval) => approval.public)
    };
  }

  addEventClient(res) {
    this.events.add(res);
    res.write(`event: snapshot\ndata: ${JSON.stringify(this.snapshot())}\n\n`);
    return () => this.events.delete(res);
  }

  broadcast(type, payload) {
    const event = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const res of this.events) {
      res.write(event);
    }
  }

  setStatus(patch) {
    this.status = {
      ...this.status,
      ...patch,
      threadId: this.threadId,
      turnActive: this.turnActive
    };
    this.broadcast("status", this.status);
  }

  appendMessage(message) {
    this.messages.push({
      id: makeId(message.role),
      createdAt: nowIso(),
      ...message
    });
    this.broadcast("message", this.messages[this.messages.length - 1]);
  }

  updateMessage(id, patch) {
    const msg = this.messages.find((message) => message.id === id);
    if (!msg) return;
    Object.assign(msg, patch);
    this.broadcast("message:update", msg);
  }

  async ensureStarted() {
    if (this.proc && !this.proc.killed && this.status.codexReady) return;
    if (this.proc && !this.proc.killed) return;

    this.status.startedAt = nowIso();
    this.status.lastError = null;
    this.setStatus({ appServer: "starting", codexReady: false });

    this.proc = spawn("codex", ["app-server"], {
      cwd: PROJECT_ROOT,
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env
    });

    this.proc.stdout.setEncoding("utf8");
    this.proc.stderr.setEncoding("utf8");

    this.proc.stdout.on("data", (chunk) => this.handleStdout(chunk));
    this.proc.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      this.appendMessage({
        role: "system",
        kind: "log",
        text: text.trim()
      });
    });

    this.proc.on("exit", (code, signal) => {
      const pending = Array.from(this.pendingResponses.values());
      this.pendingResponses.clear();
      for (const request of pending) {
        request.reject(new Error(`Codex app-server exited (${signal || code})`));
      }
      this.pendingApprovals.clear();
      this.threadId = null;
      this.currentTurnId = null;
      this.turnActive = false;
      this.currentAssistantItemId = null;
      this.proc = null;
      this.setStatus({
        appServer: "stopped",
        codexReady: false,
        lastError: signal ? `Codex app-server exited with ${signal}` : `Codex app-server exited with code ${code}`
      });
    });

    await this.request("initialize", {
      clientInfo: {
        name: "codexchat",
        title: "CodexChat Phone Bridge",
        version: "0.1.0"
      },
      capabilities: {
        experimentalApi: true
      }
    });

    this.setStatus({ appServer: "running", codexReady: true });
  }

  handleStdout(chunk) {
    this.buffer += chunk;
    let index = this.buffer.indexOf("\n");
    while (index !== -1) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (line) this.handleProtocolLine(line);
      index = this.buffer.indexOf("\n");
    }
  }

  handleProtocolLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      this.appendMessage({
        role: "system",
        kind: "error",
        text: `Could not parse Codex protocol line: ${line}`
      });
      return;
    }

    if (Object.hasOwn(message, "id") && !message.method) {
      const pending = this.pendingResponses.get(message.id);
      if (!pending) return;
      this.pendingResponses.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error.message || JSON.stringify(message.error)));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (message.method && Object.hasOwn(message, "id")) {
      this.handleServerRequest(message);
      return;
    }

    if (message.method) {
      this.handleNotification(message.method, message.params || {});
    }
  }

  request(method, params) {
    if (!this.proc || !this.proc.stdin.writable) {
      return Promise.reject(new Error("Codex app-server is not running"));
    }

    const id = this.nextRequestId++;
    const payload = { id, method, params };
    this.proc.stdin.write(`${JSON.stringify(payload)}\n`);

    return new Promise((resolve, reject) => {
      this.pendingResponses.set(id, { resolve, reject, method, startedAt: Date.now() });
    });
  }

  respond(id, result) {
    if (!this.proc || !this.proc.stdin.writable) return;
    this.proc.stdin.write(`${JSON.stringify({ id, result })}\n`);
  }

  respondError(id, message, code = -32000) {
    if (!this.proc || !this.proc.stdin.writable) return;
    this.proc.stdin.write(`${JSON.stringify({ id, error: { code, message } })}\n`);
  }

  async ensureThread() {
    await this.ensureStarted();
    if (this.threadId) return this.threadId;

    const result = await this.request("thread/start", {
      cwd: PROJECT_ROOT,
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      sandbox: "workspace-write",
      serviceName: "codexchat",
      ephemeral: true
    });

    this.threadId = result?.thread?.id;
    if (!this.threadId) {
      throw new Error("Codex did not return a thread id");
    }
    this.setStatus({ appServer: "running", codexReady: true });
    return this.threadId;
  }

  async sendUserMessage(text) {
    const message = text.trim();
    if (!message) throw new Error("Message cannot be empty");
    if (this.turnActive) throw new Error("Codex is already working");

    const threadId = await this.ensureThread();
    this.appendMessage({ role: "user", kind: "chat", text: message });
    this.turnActive = true;
    this.currentAssistantItemId = null;
    this.setStatus({ lastError: null });

    try {
      const result = await this.request("turn/start", {
        threadId,
        cwd: PROJECT_ROOT,
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        input: [
          {
            type: "text",
            text: message,
            text_elements: []
          }
        ]
      });
      this.currentTurnId = result?.turn?.id || this.currentTurnId;
    } catch (error) {
      this.turnActive = false;
      this.setStatus({ lastError: error.message });
      this.appendMessage({
        role: "system",
        kind: "error",
        text: error.message
      });
      throw error;
    }
  }

  async stopTurn() {
    if (!this.threadId || !this.turnActive || !this.currentTurnId) return;
    await this.request("turn/interrupt", {
      threadId: this.threadId,
      turnId: this.currentTurnId
    });
    this.turnActive = false;
    this.setStatus({});
  }

  handleNotification(method, params) {
    switch (method) {
      case "thread/started":
        this.threadId = params.thread?.id || this.threadId;
        this.setStatus({ appServer: "running", codexReady: true });
        break;
      case "turn/started":
        this.turnActive = true;
        this.currentTurnId = params.turn?.id || this.currentTurnId;
        this.setStatus({});
        break;
      case "turn/completed":
        this.turnActive = false;
        this.currentTurnId = null;
        this.currentAssistantItemId = null;
        this.pendingApprovals.clear();
        this.setStatus({});
        this.broadcast("approvals", []);
        break;
      case "item/agentMessage/delta":
        this.handleAgentDelta(params);
        break;
      case "item/started":
        this.handleItemStarted(params.item);
        break;
      case "item/completed":
        this.handleItemCompleted(params.item);
        break;
      case "item/commandExecution/outputDelta":
        this.broadcast("activity", {
          kind: "command-output",
          itemId: params.itemId,
          delta: params.delta
        });
        break;
      case "item/fileChange/patchUpdated":
        this.broadcast("activity", {
          kind: "file-change",
          itemId: params.itemId,
          changes: params.changes || []
        });
        break;
      case "error":
        this.setStatus({ lastError: params.message || JSON.stringify(params) });
        this.appendMessage({
          role: "system",
          kind: "error",
          text: params.message || JSON.stringify(params)
        });
        break;
      case "warning":
      case "configWarning":
        this.appendMessage({
          role: "system",
          kind: "warning",
          text: params.message || JSON.stringify(params)
        });
        break;
      default:
        break;
    }
  }

  handleAgentDelta(params) {
    let message = this.messages.find((item) => item.protocolItemId === params.itemId);
    if (!message) {
      message = {
        id: makeId("assistant"),
        role: "assistant",
        kind: "chat",
        text: "",
        protocolItemId: params.itemId,
        createdAt: nowIso()
      };
      this.messages.push(message);
      this.broadcast("message", message);
    }
    message.text += params.delta || "";
    this.broadcast("message:update", message);
  }

  handleItemStarted(item) {
    if (!item?.type) return;
    if (item.type === "commandExecution") {
      this.broadcast("activity", {
        kind: "command-started",
        itemId: item.id,
        command: item.command,
        cwd: item.cwd
      });
    } else if (item.type === "fileChange") {
      this.broadcast("activity", {
        kind: "file-change-started",
        itemId: item.id,
        changes: item.changes || []
      });
    }
  }

  handleItemCompleted(item) {
    if (!item?.type) return;
    if (item.type === "commandExecution") {
      this.broadcast("activity", {
        kind: "command-completed",
        itemId: item.id,
        command: item.command,
        exitCode: item.exitCode,
        durationMs: item.durationMs,
        output: item.aggregatedOutput
      });
    } else if (item.type === "fileChange") {
      this.broadcast("activity", {
        kind: "file-change-completed",
        itemId: item.id,
        status: item.status,
        changes: item.changes || []
      });
    }
  }

  handleServerRequest(message) {
    const publicApproval = this.toPublicApproval(message);
    if (!publicApproval) {
      this.respondError(message.id, `Unsupported Codex request: ${message.method}`);
      return;
    }

    this.pendingApprovals.set(publicApproval.id, {
      requestId: message.id,
      method: message.method,
      params: message.params || {},
      public: publicApproval
    });

    this.broadcast("approval", publicApproval);
    this.broadcast("approvals", Array.from(this.pendingApprovals.values()).map((approval) => approval.public));
  }

  toPublicApproval(message) {
    const params = message.params || {};
    const id = makeId("approval");
    const base = {
      id,
      method: message.method,
      createdAt: nowIso(),
      reason: params.reason || null,
      threadId: params.threadId || null,
      turnId: params.turnId || null,
      itemId: params.itemId || null
    };

    switch (message.method) {
      case "item/commandExecution/requestApproval":
        return {
          ...base,
          type: "command",
          title: "Command permission",
          details: {
            command: params.command || "",
            cwd: params.cwd || PROJECT_ROOT,
            network: params.networkApprovalContext || null,
            proposedCommandRule: params.proposedExecpolicyAmendment || null,
            proposedNetworkRules: params.proposedNetworkPolicyAmendments || null,
            actions: params.commandActions || []
          },
          actions: ["allow_once", "always", "deny", "cancel"]
        };
      case "item/fileChange/requestApproval":
        return {
          ...base,
          type: "file_change",
          title: "File change permission",
          details: {
            grantRoot: params.grantRoot || null
          },
          actions: ["allow_once", "always", "deny", "cancel"]
        };
      case "item/permissions/requestApproval":
        return {
          ...base,
          type: "permissions",
          title: "Permission request",
          details: {
            cwd: params.cwd || PROJECT_ROOT,
            permissions: params.permissions || null
          },
          actions: ["allow_once", "always", "deny", "cancel"]
        };
      case "item/tool/requestUserInput":
        return {
          ...base,
          type: "user_input",
          title: "Codex needs input",
          details: {
            questions: params.questions || []
          },
          actions: ["answer", "cancel"]
        };
      case "mcpServer/elicitation/request":
        return {
          ...base,
          type: "elicitation",
          title: "External tool request",
          details: params,
          actions: ["allow_once", "deny", "cancel"]
        };
      case "execCommandApproval":
        return {
          ...base,
          type: "command",
          title: "Command permission",
          details: {
            command: Array.isArray(params.command) ? params.command.join(" ") : "",
            cwd: params.cwd || PROJECT_ROOT,
            parsed: params.parsedCmd || []
          },
          actions: ["allow_once", "always", "deny", "cancel"]
        };
      case "applyPatchApproval":
        return {
          ...base,
          type: "file_change",
          title: "Patch permission",
          details: params,
          actions: ["allow_once", "always", "deny", "cancel"]
        };
      default:
        return null;
    }
  }

  async resolveApproval(id, payload) {
    const approval = this.pendingApprovals.get(id);
    if (!approval) throw new Error("Approval request is no longer pending");

    const decision = payload?.decision || "deny";
    this.pendingApprovals.delete(id);

    try {
      if (approval.method === "item/commandExecution/requestApproval") {
        this.respond(approval.requestId, { decision: mapCommandDecision(decision) });
      } else if (approval.method === "item/fileChange/requestApproval") {
        this.respond(approval.requestId, { decision: mapFileDecision(decision) });
      } else if (approval.method === "item/permissions/requestApproval") {
        if (decision === "deny" || decision === "cancel") {
          this.respondError(approval.requestId, "User denied the permission request");
        } else {
          this.respond(approval.requestId, {
            permissions: grantRequestedPermissions(approval.params.permissions),
            scope: decision === "always" ? "session" : "turn",
            strictAutoReview: false
          });
        }
      } else if (approval.method === "item/tool/requestUserInput") {
        if (decision === "cancel") {
          this.respondError(approval.requestId, "User canceled input request");
        } else {
          this.respond(approval.requestId, {
            answers: payload.answers || {}
          });
        }
      } else if (approval.method === "mcpServer/elicitation/request") {
        this.respond(approval.requestId, {
          action: decision === "allow_once" || decision === "always" ? "accept" : decision === "cancel" ? "cancel" : "decline",
          content: payload.content || null,
          _meta: null
        });
      } else if (approval.method === "execCommandApproval") {
        this.respond(approval.requestId, mapLegacyReviewDecision(decision));
      } else if (approval.method === "applyPatchApproval") {
        this.respond(approval.requestId, {
          decision: decision === "allow_once" ? "accept" : decision === "always" ? "acceptForSession" : decision === "cancel" ? "cancel" : "decline"
        });
      }
    } finally {
      this.broadcast("approval:resolved", { id, decision });
      this.broadcast("approvals", Array.from(this.pendingApprovals.values()).map((item) => item.public));
    }
  }
}

function mapCommandDecision(decision) {
  if (decision === "allow_once") return "accept";
  if (decision === "always") return "acceptForSession";
  if (decision === "cancel") return "cancel";
  return "decline";
}

function mapFileDecision(decision) {
  if (decision === "allow_once") return "accept";
  if (decision === "always") return "acceptForSession";
  if (decision === "cancel") return "cancel";
  return "decline";
}

function mapLegacyReviewDecision(decision) {
  if (decision === "allow_once") return "approved";
  if (decision === "always") return "approved_for_session";
  if (decision === "cancel") return "abort";
  return "denied";
}

function grantRequestedPermissions(permissions) {
  const grant = {};
  if (permissions?.network) grant.network = permissions.network;
  if (permissions?.fileSystem) grant.fileSystem = permissions.fileSystem;
  return grant;
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function sendError(res, status, error) {
  sendJson(res, status, { error: error instanceof Error ? error.message : String(error) });
}

async function serveStatic(res, urlPath) {
  const cleanPath = urlPath === "/" ? "/index.html" : decodeURIComponent(urlPath);
  const filePath = path.normalize(path.join(PUBLIC_DIR, cleanPath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }

  try {
    const data = await fs.readFile(filePath);
    res.writeHead(200, {
      "content-type": MIME_TYPES[path.extname(filePath)] || "application/octet-stream",
      "cache-control": "no-store"
    });
    res.end(data);
  } catch {
    sendJson(res, 404, { error: "Not found" });
  }
}

const bridge = new CodexBridge();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  try {
    if (req.method === "GET" && url.pathname === "/api/events") {
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
        connection: "keep-alive",
        "x-accel-buffering": "no"
      });
      res.write(": connected\n\n");
      const remove = bridge.addEventClient(res);
      req.on("close", remove);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/health") {
      sendJson(res, 200, {
        ok: true,
        cwd: PROJECT_ROOT,
        codex: bridge.status,
        lanUrls: getLanAddresses().map((address) => `http://${address}:${PORT}`)
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/session") {
      sendJson(res, 200, bridge.snapshot());
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/message") {
      const body = await readBody(req);
      await bridge.sendUserMessage(body.message || "");
      sendJson(res, 202, { ok: true });
      return;
    }

    if (req.method === "POST" && url.pathname.startsWith("/api/approval/")) {
      const id = decodeURIComponent(url.pathname.slice("/api/approval/".length));
      const body = await readBody(req);
      await bridge.resolveApproval(id, body);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/stop") {
      await bridge.stopTurn();
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/restart-codex") {
      if (bridge.proc && !bridge.proc.killed) bridge.proc.kill("SIGTERM");
      sendJson(res, 202, { ok: true });
      return;
    }

    if (req.method === "GET") {
      await serveStatic(res, url.pathname);
      return;
    }

    sendJson(res, 405, { error: "Method not allowed" });
  } catch (error) {
    sendError(res, 400, error);
  }
});

server.listen(PORT, HOST, () => {
  const lanUrls = getLanAddresses().map((address) => `http://${address}:${PORT}`);
  console.log(`CodexChat running for this project: ${PROJECT_ROOT}`);
  console.log(`Mac:   http://localhost:${PORT}`);
  if (lanUrls.length) {
    for (const url of lanUrls) console.log(`Phone: ${url}`);
  } else {
    console.log("Phone: no LAN IPv4 address found; check Wi-Fi.");
  }
});

process.on("SIGINT", () => {
  if (bridge.proc && !bridge.proc.killed) bridge.proc.kill("SIGTERM");
  server.close(() => process.exit(0));
});
