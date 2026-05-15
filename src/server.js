import { spawn } from "node:child_process";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, "..");
const PUBLIC_DIR = path.join(APP_ROOT, "public");
const HOME_ROOT = path.resolve(process.env.CODEXCHAT_HOME || os.homedir());
const HOME_REAL_ROOT = await fs.realpath(HOME_ROOT);
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "0.0.0.0";
const FILE_PREVIEW_LIMIT = Number(process.env.CODEXCHAT_FILE_PREVIEW_LIMIT || 1024 * 1024);
const UPLOAD_LIMIT = Number(process.env.CODEXCHAT_UPLOAD_LIMIT || 50 * 1024 * 1024);
const CODEX_HOME = path.resolve(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"));
const DEFAULT_MODELS = [
  {
    id: "gpt-5.5",
    model: "gpt-5.5",
    displayName: "GPT-5.5",
    description: "Frontier model for complex coding, research, and real-world work.",
    isDefault: true
  },
  {
    id: "gpt-5.4",
    model: "gpt-5.4",
    displayName: "GPT-5.4",
    description: "Strong model for everyday coding.",
    isDefault: false
  },
  {
    id: "gpt-5.4-mini",
    model: "gpt-5.4-mini",
    displayName: "GPT-5.4 Mini",
    description: "Small, fast, and cost-efficient model for simpler coding tasks.",
    isDefault: false
  },
  {
    id: "gpt-5.3-codex",
    model: "gpt-5.3-codex",
    displayName: "GPT-5.3 Codex",
    description: "Coding-optimized model.",
    isDefault: false
  },
  {
    id: "gpt-5.2",
    model: "gpt-5.2",
    displayName: "GPT-5.2",
    description: "Optimized for professional work and long-running agents.",
    isDefault: false
  }
];

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

function toApiPath(filePath) {
  return filePath.split(path.sep).filter(Boolean).join("/");
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolveHomePath(inputPath = "") {
  const requested = String(inputPath || "");
  if (requested.includes("\0")) {
    throw new Error("Invalid path");
  }
  if (path.isAbsolute(requested)) {
    throw new Error("Absolute paths are not allowed");
  }

  const normalized = path.normalize(requested);
  if (normalized === ".." || normalized.startsWith(`..${path.sep}`)) {
    throw new Error("Path escapes the configured home");
  }

  const absolutePath = path.resolve(HOME_ROOT, normalized === "." ? "" : normalized);
  if (!isInside(HOME_ROOT, absolutePath)) {
    throw new Error("Path escapes the configured home");
  }

  return {
    absolutePath,
    relativePath: toApiPath(path.relative(HOME_ROOT, absolutePath))
  };
}

async function ensureRealPathInsideHome(absolutePath) {
  const realPath = await fs.realpath(absolutePath);
  if (!isInside(HOME_REAL_ROOT, realPath)) {
    throw new Error("Path escapes the configured home");
  }
  return realPath;
}

function getParentPath(relativePath) {
  if (!relativePath) return null;
  const parent = path.dirname(relativePath);
  return parent === "." ? "" : toApiPath(parent);
}

function safeChildName(inputName) {
  const name = String(inputName || "").trim();
  if (!name) throw new Error("Name is required");
  if (name.includes("\0") || name.includes("/") || name.includes("\\")) {
    throw new Error("Name cannot contain path separators");
  }
  if (name === "." || name === "..") {
    throw new Error("Name is not allowed");
  }
  return name;
}

function isLikelyText(buffer) {
  if (!buffer.length) return true;
  let suspicious = 0;
  for (const byte of buffer) {
    if (byte === 0) return false;
    if (byte < 7 || (byte > 13 && byte < 32)) suspicious += 1;
  }
  return suspicious / buffer.length < 0.08;
}

function fileMetadata(relativePath, stats, previewable, reason = null) {
  return {
    name: path.basename(relativePath) || path.basename(HOME_ROOT),
    path: relativePath,
    type: stats.isDirectory() ? "folder" : stats.isFile() ? "file" : "other",
    size: stats.size,
    modifiedAt: stats.mtime.toISOString(),
    previewable,
    reason
  };
}

async function listHomeFolder(inputPath) {
  const resolved = resolveHomePath(inputPath);
  const realPath = await ensureRealPathInsideHome(resolved.absolutePath);
  const folderStats = await fs.stat(realPath);
  if (!folderStats.isDirectory()) throw new Error("Path is not a folder");

  const dirents = await fs.readdir(resolved.absolutePath, { withFileTypes: true });
  const entries = [];

  for (const dirent of dirents) {
    const absolutePath = path.join(resolved.absolutePath, dirent.name);
    let stats;
    let realEntryPath;
    try {
      stats = await fs.stat(absolutePath);
      realEntryPath = await fs.realpath(absolutePath);
    } catch {
      continue;
    }

    const entryRelativePath = toApiPath(path.relative(HOME_ROOT, absolutePath));
    const outsideHome = !isInside(HOME_REAL_ROOT, realEntryPath);
    const type = stats.isDirectory() ? "folder" : stats.isFile() ? "file" : "other";
    const previewable = type === "file" && !outsideHome && stats.size <= FILE_PREVIEW_LIMIT;
    entries.push({
      name: dirent.name,
      path: entryRelativePath,
      type: outsideHome ? "other" : type,
      size: stats.size,
      modifiedAt: stats.mtime.toISOString(),
      previewable,
      reason: outsideHome ? "Outside configured home" : stats.size > FILE_PREVIEW_LIMIT ? "File is too large to preview" : null
    });
  }

  entries.sort((a, b) => {
    if (a.type !== b.type) {
      if (a.type === "folder") return -1;
      if (b.type === "folder") return 1;
    }
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });

  return {
    homeRoot: HOME_ROOT,
    currentPath: resolved.relativePath,
    parentPath: getParentPath(resolved.relativePath),
    entries
  };
}

async function readHomeFile(inputPath) {
  const resolved = resolveHomePath(inputPath);
  const realPath = await ensureRealPathInsideHome(resolved.absolutePath);
  const stats = await fs.stat(realPath);
  if (!stats.isFile()) throw new Error("Path is not a file");

  if (stats.size > FILE_PREVIEW_LIMIT) {
    return fileMetadata(resolved.relativePath, stats, false, "File is too large to preview");
  }

  const file = await fs.readFile(realPath);
  if (!isLikelyText(file.subarray(0, Math.min(file.length, 4096)))) {
    return fileMetadata(resolved.relativePath, stats, false, "Binary file is not previewable");
  }

  return {
    ...fileMetadata(resolved.relativePath, stats, true),
    content: file.toString("utf8")
  };
}

async function writeHomeFile(inputPath, content) {
  const resolved = resolveHomePath(inputPath);
  const realPath = await ensureRealPathInsideHome(resolved.absolutePath);
  const stats = await fs.stat(realPath);
  if (!stats.isFile()) throw new Error("Path is not a file");
  if (stats.size > FILE_PREVIEW_LIMIT) {
    throw new Error("File is too large to edit");
  }

  const current = await fs.readFile(realPath);
  if (!isLikelyText(current.subarray(0, Math.min(current.length, 4096)))) {
    throw new Error("Binary file is not editable");
  }

  const text = String(content ?? "");
  const data = Buffer.from(text, "utf8");
  if (data.length > FILE_PREVIEW_LIMIT) {
    throw new Error(`Content exceeds ${formatBytes(FILE_PREVIEW_LIMIT)} edit limit`);
  }

  await fs.writeFile(realPath, data);
  return readHomeFile(resolved.relativePath);
}

async function resolveProjectFolder(inputPath) {
  const resolved = resolveHomePath(inputPath);
  const realPath = await ensureRealPathInsideHome(resolved.absolutePath);
  const stats = await fs.stat(realPath);
  if (!stats.isDirectory()) throw new Error("Project path must be a folder");
  return realPath;
}

async function resolveWritableFolder(inputPath) {
  const resolved = resolveHomePath(inputPath);
  const realPath = await ensureRealPathInsideHome(resolved.absolutePath);
  const stats = await fs.stat(realPath);
  if (!stats.isDirectory()) throw new Error("Path is not a folder");
  return resolved;
}

async function createHomeFolder(inputPath, inputName) {
  const folder = await resolveWritableFolder(inputPath);
  const name = safeChildName(inputName);
  const absolutePath = path.join(folder.absolutePath, name);
  if (!isInside(HOME_ROOT, absolutePath)) {
    throw new Error("Path escapes the configured home");
  }
  await fs.mkdir(absolutePath);
  const stats = await fs.stat(absolutePath);
  const relativePath = toApiPath(path.relative(HOME_ROOT, absolutePath));
  return fileMetadata(relativePath, stats, false);
}

async function uniqueChildPath(folder, inputName) {
  const name = safeChildName(inputName);
  const parsed = path.parse(name);

  for (let index = 0; index < 1000; index += 1) {
    const candidateName = index === 0 ? name : `${parsed.name}-${index}${parsed.ext}`;
    const absolutePath = path.join(folder.absolutePath, candidateName);
    if (!isInside(HOME_ROOT, absolutePath)) {
      throw new Error("Path escapes the configured home");
    }
    try {
      await fs.lstat(absolutePath);
    } catch (error) {
      if (error?.code === "ENOENT") {
        return absolutePath;
      }
      throw error;
    }
  }

  throw new Error("Could not choose a unique filename");
}

async function uploadHomeFile(inputPath, inputName, req) {
  const folder = await resolveWritableFolder(inputPath);
  const absolutePath = await uniqueChildPath(folder, inputName);
  const body = await readRawBody(req, UPLOAD_LIMIT);
  await fs.writeFile(absolutePath, body, { flag: "wx" });
  const stats = await fs.stat(absolutePath);
  const relativePath = toApiPath(path.relative(HOME_ROOT, absolutePath));
  return fileMetadata(relativePath, stats, stats.size <= FILE_PREVIEW_LIMIT);
}

async function downloadHomeFile(inputPath) {
  const resolved = resolveHomePath(inputPath);
  const realPath = await ensureRealPathInsideHome(resolved.absolutePath);
  const stats = await fs.stat(realPath);
  if (!stats.isFile()) throw new Error("Path is not a file");
  return {
    absolutePath: realPath,
    name: path.basename(resolved.relativePath),
    stats
  };
}

async function readCachedModels() {
  try {
    const raw = await fs.readFile(path.join(CODEX_HOME, "models_cache.json"), "utf8");
    const cache = JSON.parse(raw);
    const models = (cache.models || [])
      .filter((model) => !model.hidden && model.slug !== "codex-auto-review")
      .map((model) => ({
        id: model.id || model.slug || model.model,
        model: model.model || model.slug || model.id,
        displayName: model.displayName || model.display_name || model.name || model.slug || model.model,
        description: model.description || "",
        isDefault: Boolean(model.isDefault)
      }))
      .filter((model) => model.id && model.model);
    return models.length ? models : DEFAULT_MODELS;
  } catch {
    return DEFAULT_MODELS;
  }
}

class CodexBridge {
  constructor(activeProjectRoot) {
    this.activeProjectRoot = activeProjectRoot;
    this.activeModel = process.env.CODEXCHAT_MODEL || "";
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
      cwd: this.activeProjectRoot,
      activeProjectPath: this.activeProjectPath(),
      activeModel: this.activeModel,
      lastError: null,
      startedAt: null
    };
  }

  activeProjectPath() {
    return toApiPath(path.relative(HOME_ROOT, this.activeProjectRoot));
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
      turnActive: this.turnActive,
      cwd: this.activeProjectRoot,
      activeProjectPath: this.activeProjectPath(),
      activeModel: this.activeModel
    };
    this.broadcast("status", this.status);
  }

  resetSession(reason = "Codex session reset") {
    const pending = Array.from(this.pendingResponses.values());
    this.pendingResponses.clear();
    for (const request of pending) {
      request.reject(new Error(reason));
    }

    this.pendingApprovals.clear();
    this.threadId = null;
    this.currentTurnId = null;
    this.turnActive = false;
    this.currentAssistantItemId = null;
    this.messages = [];

    const proc = this.proc;
    this.proc = null;
    if (proc && !proc.killed) {
      proc.kill("SIGTERM");
    }

    this.setStatus({
      appServer: "stopped",
      codexReady: false,
      lastError: null,
      startedAt: null
    });
    this.broadcast("approvals", []);
    this.broadcast("snapshot", this.snapshot());
  }

  setActiveProjectRoot(projectRoot, options = {}) {
    const forceReset = Boolean(options.forceReset);
    if (projectRoot === this.activeProjectRoot) {
      if (forceReset) {
        this.resetSession("Project reopened");
        return;
      }
      this.setStatus({ lastError: null });
      return;
    }
    this.activeProjectRoot = projectRoot;
    this.resetSession("Project switched");
  }

  setActiveModel(model) {
    const nextModel = String(model || "").trim();
    if (nextModel === this.activeModel) {
      this.setStatus({ lastError: null });
      return;
    }
    this.activeModel = nextModel;
    this.setStatus({ lastError: null });
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
      cwd: this.activeProjectRoot,
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env
    });
    const proc = this.proc;

    proc.stdout.setEncoding("utf8");
    proc.stderr.setEncoding("utf8");

    proc.stdout.on("data", (chunk) => this.handleStdout(chunk));
    proc.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      this.appendMessage({
        role: "system",
        kind: "log",
        text: text.trim()
      });
    });

    proc.on("exit", (code, signal) => {
      if (this.proc !== proc) return;
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

    const params = {
      cwd: this.activeProjectRoot,
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      sandbox: "workspace-write",
      serviceName: "codexchat",
      ephemeral: true
    };
    if (this.activeModel) params.model = this.activeModel;

    const result = await this.request("thread/start", params);

    this.threadId = result?.thread?.id;
    if (!this.threadId) {
      throw new Error("Codex did not return a thread id");
    }
    if (result?.model) this.activeModel = result.model;
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
      const params = {
        threadId,
        cwd: this.activeProjectRoot,
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        input: [
          {
            type: "text",
            text: message,
            text_elements: []
          }
        ]
      };
      if (this.activeModel) params.model = this.activeModel;

      const result = await this.request("turn/start", params);
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

  async startReview(instructions = "") {
    if (this.turnActive) throw new Error("Codex is already working");
    const threadId = await this.ensureThread();
    const cleanInstructions = String(instructions || "").trim();
    this.appendMessage({
      role: "user",
      kind: "command",
      text: cleanInstructions ? `/review ${cleanInstructions}` : "/review"
    });
    this.turnActive = true;
    this.currentAssistantItemId = null;
    this.setStatus({ lastError: null });

    try {
      const result = await this.request("review/start", {
        threadId,
        delivery: "inline",
        target: cleanInstructions
          ? { type: "custom", instructions: cleanInstructions }
          : { type: "uncommittedChanges" }
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

  async compactThread() {
    if (this.turnActive) throw new Error("Codex is already working");
    const threadId = await this.ensureThread();
    this.appendMessage({
      role: "user",
      kind: "command",
      text: "/compact"
    });
    this.setStatus({ lastError: null });
    await this.request("thread/compact/start", { threadId });
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
            cwd: params.cwd || this.activeProjectRoot,
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
            cwd: params.cwd || this.activeProjectRoot,
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
            cwd: params.cwd || this.activeProjectRoot,
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

async function readRawBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) {
      throw new Error(`Upload exceeds ${formatBytes(limit)} limit`);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${Math.round(bytes / 1024 / 1024)} MB`;
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

function contentDispositionFilename(name) {
  const fallback = name.replace(/["\\\r\n]/g, "_") || "download";
  return `attachment; filename="${fallback}"`;
}

async function sendDownload(res, inputPath) {
  const file = await downloadHomeFile(inputPath);
  const data = await fs.readFile(file.absolutePath);
  res.writeHead(200, {
    "content-type": "application/octet-stream",
    "content-length": file.stats.size,
    "content-disposition": contentDispositionFilename(file.name),
    "cache-control": "no-store"
  });
  res.end(data);
}

async function serveStatic(res, urlPath) {
  const cleanPath = urlPath === "/" ? "/index.html" : decodeURIComponent(urlPath);
  const filePath = path.normalize(path.join(PUBLIC_DIR, cleanPath));
  if (!isInside(PUBLIC_DIR, filePath)) {
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

const bridge = new CodexBridge(HOME_REAL_ROOT);

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
        appRoot: APP_ROOT,
        homeRoot: HOME_ROOT,
        activeProjectRoot: bridge.activeProjectRoot,
        activeProjectPath: bridge.activeProjectPath(),
        codex: bridge.status,
        lanUrls: getLanAddresses().map((address) => `http://${address}:${PORT}`)
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/fs/list") {
      sendJson(res, 200, await listHomeFolder(url.searchParams.get("path") || ""));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/fs/read") {
      sendJson(res, 200, await readHomeFile(url.searchParams.get("path") || ""));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/fs/write") {
      const body = await readBody(req);
      sendJson(res, 200, await writeHomeFile(body.path || "", body.content || ""));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/fs/download") {
      await sendDownload(res, url.searchParams.get("path") || "");
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/fs/mkdir") {
      const body = await readBody(req);
      const entry = await createHomeFolder(body.path || "", body.name || "");
      sendJson(res, 201, {
        ok: true,
        entry,
        folder: await listHomeFolder(body.path || "")
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/fs/upload") {
      const name = url.searchParams.get("name") || req.headers["x-file-name"] || "";
      const entry = await uploadHomeFile(url.searchParams.get("path") || "", name, req);
      sendJson(res, 201, {
        ok: true,
        entry,
        folder: await listHomeFolder(url.searchParams.get("path") || "")
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/session") {
      sendJson(res, 200, bridge.snapshot());
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/models") {
      let models;
      if (bridge.proc && !bridge.proc.killed && bridge.status.codexReady) {
        try {
          const result = await bridge.request("model/list", { includeHidden: false });
          models = result?.data;
        } catch {
          models = null;
        }
      }
      sendJson(res, 200, {
        models: Array.isArray(models) && models.length ? models : await readCachedModels(),
        activeModel: bridge.activeModel
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/model") {
      sendJson(res, 200, { activeModel: bridge.activeModel });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/model") {
      const body = await readBody(req);
      bridge.setActiveModel(body.model || "");
      sendJson(res, 200, {
        ok: true,
        activeModel: bridge.activeModel,
        codex: bridge.status
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/project/select") {
      sendJson(res, 200, {
        ok: true,
        activeProjectRoot: bridge.activeProjectRoot,
        activeProjectPath: bridge.activeProjectPath(),
        codex: bridge.status
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/project/select") {
      const body = await readBody(req);
      const projectRoot = await resolveProjectFolder(body.path || "");
      bridge.setActiveProjectRoot(projectRoot, { forceReset: Boolean(body.reset) });
      sendJson(res, 200, {
        ok: true,
        activeProjectRoot: bridge.activeProjectRoot,
        activeProjectPath: bridge.activeProjectPath(),
        codex: bridge.status
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/message") {
      const body = await readBody(req);
      await bridge.sendUserMessage(body.message || "");
      sendJson(res, 202, { ok: true });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/codex/review") {
      const body = await readBody(req);
      await bridge.startReview(body.instructions || "");
      sendJson(res, 202, { ok: true });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/codex/compact") {
      await bridge.compactThread();
      sendJson(res, 202, { ok: true });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/codex/clear") {
      bridge.resetSession("Codex session cleared");
      sendJson(res, 202, { ok: true, codex: bridge.status });
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
      bridge.resetSession("Codex session restarted");
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
  console.log(`CodexChat browsing home: ${HOME_ROOT}`);
  console.log(`CodexChat active project: ${bridge.activeProjectRoot}`);
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
