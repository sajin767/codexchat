const state = {
  messages: [],
  approvals: [],
  status: null,
  chatOpen: false,
  activeProjectPath: "",
  explorerRootPath: "",
  sidebarOpen: false,
  browser: {
    homeRoot: null,
    currentPath: "",
    parentPath: null,
    entries: [],
    loading: false,
    error: null
  },
  tree: {
    "": {
      entries: [],
      expanded: true,
      loaded: false,
      loading: false,
      error: null
    }
  },
  openFileTabs: [],
  activeFilePath: "",
  attachmentMenuOpen: false,
  pendingUploadTarget: "browser",
  models: [],
  activeModel: ""
};

const appEl = document.querySelector("#app");
const messagesEl = document.querySelector("#messages");
const approvalsEl = document.querySelector("#approvals");
const workspaceShellEl = document.querySelector("#workspaceShell");
const chatShellEl = document.querySelector("#chatShell");
const emptyStateEl = document.querySelector("#emptyState");
const statusText = document.querySelector("#statusText");
const projectText = document.querySelector("#projectText");
const modelPillEl = document.querySelector("#modelPill");
const composer = document.querySelector("#composer");
const composerWrapEl = document.querySelector("#composerWrap");
const promptEl = document.querySelector("#prompt");
const sendButton = document.querySelector("#sendButton");
const stopButton = document.querySelector("#stopButton");
const modelButton = document.querySelector("#modelButton");
const sidebarButton = document.querySelector("#sidebarButton");
const sidebarBackdrop = document.querySelector("#sidebarBackdrop");
const browserPathEl = document.querySelector("#browserPath");
const browserEntriesEl = document.querySelector("#browserEntries");
const parentButton = document.querySelector("#parentButton");
const newFolderButton = document.querySelector("#newFolderButton");
const uploadButton = document.querySelector("#uploadButton");
const fileViewerEl = document.querySelector("#fileViewer");
const fileTabsEl = document.querySelector("#fileTabs");
const fileTitleEl = document.querySelector("#fileTitle");
const fileMetaEl = document.querySelector("#fileMeta");
const fileContentEl = document.querySelector("#fileContent");
const fileStatusEl = document.querySelector("#fileStatus");
const saveFileButton = document.querySelector("#saveFileButton");
const closeFileButton = document.querySelector("#closeFileButton");
const downloadFileButton = document.querySelector("#downloadFileButton");
const attachButton = document.querySelector("#attachButton");
const attachmentMenuEl = document.querySelector("#attachmentMenu");
const attachFileButton = document.querySelector("#attachFileButton");
const attachCameraButton = document.querySelector("#attachCameraButton");
const fileInput = document.querySelector("#fileInput");
const cameraInput = document.querySelector("#cameraInput");
const slashMenuEl = document.querySelector("#slashMenu");
const modelSheetEl = document.querySelector("#modelSheet");
const modelListEl = document.querySelector("#modelList");
const closeModelButton = document.querySelector("#closeModelButton");
const activeModelText = document.querySelector("#activeModelText");

const codexCommands = [
  { command: "/model", label: "Model", detail: "Choose the model for new Codex turns.", action: "model" },
  { command: "/review", label: "Review", detail: "Run Codex review on uncommitted changes.", action: "review" },
  { command: "/compact", label: "Compact", detail: "Ask Codex to compact the current conversation.", action: "compact" },
  { command: "/clear", label: "Clear", detail: "Reset this Codex session for the selected project.", action: "clear" },
  { command: "/status", label: "Status", detail: "Show current project, model, and session state.", action: "status" },
  { command: "/help", label: "Help", detail: "Show available Codex slash commands.", action: "help" }
];

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function setBusy(busy) {
  sendButton.disabled = busy;
  stopButton.disabled = !busy;
  promptEl.disabled = busy;
  attachButton.disabled = busy;
}

function isProjectListMode() {
  return !state.explorerRootPath;
}

function renderAppMode() {
  appEl.classList.toggle("chat-open", state.chatOpen);
  appEl.classList.toggle("has-project", state.chatOpen);
  appEl.classList.toggle("has-file-tabs", state.openFileTabs.length > 0);
  appEl.classList.toggle("sidebar-open", state.sidebarOpen);
  workspaceShellEl.hidden = !state.chatOpen;
  chatShellEl.hidden = !state.chatOpen;
  composerWrapEl.hidden = !state.chatOpen;
  emptyStateEl.hidden = state.chatOpen;
  sidebarBackdrop.hidden = !state.sidebarOpen || !state.chatOpen;
  sidebarButton.setAttribute("aria-expanded", state.sidebarOpen ? "true" : "false");
}

function displayPath(relativePath) {
  return relativePath ? `~/${relativePath}` : "~";
}

function updateStatus(status) {
  state.status = status;
  state.activeModel = status?.activeModel || state.activeModel || "";
  state.activeProjectPath = status?.activeProjectPath ?? state.activeProjectPath;
  projectText.textContent = state.activeProjectPath
    ? `Project ${displayPath(state.activeProjectPath)}`
    : "Project not selected";
  renderModelSummary();

  const parts = [];
  if (status?.codexReady) parts.push("Codex ready");
  else parts.push(status?.appServer === "starting" ? "Starting Codex" : "Codex idle");
  if (status?.turnActive) parts.push("working");
  if (state.approvals.length) parts.push(`${state.approvals.length} approval pending`);
  if (status?.lastError) parts.push(status.lastError);
  statusText.textContent = parts.join(" · ");
  setBusy(Boolean(status?.turnActive || state.approvals.length));
  renderAppMode();
}

function escapeText(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  })[char]);
}

function svgIcon(name) {
  switch (name) {
    case "chevron-right":
      return `
        <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"></path>
        </svg>
      `;
    case "chevron-down":
      return `
        <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path d="M3.5 6 8 10.5 12.5 6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"></path>
        </svg>
      `;
    case "folder":
      return `
        <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path d="M2.5 4.25A1.25 1.25 0 0 1 3.75 3h2.1c.38 0 .74.17.98.46l.72.82c.24.28.59.45.96.45H12a1.5 1.5 0 0 1 1.5 1.5v4.5A1.25 1.25 0 0 1 12.25 11H3.75A1.25 1.25 0 0 1 2.5 9.75V4.25Z" fill="currentColor" opacity="0.16"></path>
          <path d="M2.5 5.5h11" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"></path>
          <path d="M3 3.75h3.12c.41 0 .79.18 1.05.49l.63.76c.26.31.64.49 1.05.49H13" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"></path>
          <path d="M2.5 5.5v4.25A1.25 1.25 0 0 0 3.75 11h8.5a1.25 1.25 0 0 0 1.25-1.25V5.5" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"></path>
        </svg>
      `;
    case "file":
      return `
        <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path d="M4.25 1.75h4.58c.33 0 .64.13.88.37l2.17 2.17c.24.24.37.55.37.88v8.08A1.25 1.25 0 0 1 11 14.5H4.25A1.25 1.25 0 0 1 3 13.25V3A1.25 1.25 0 0 1 4.25 1.75Z" fill="currentColor" opacity="0.16"></path>
          <path d="M8.25 1.9v2.85c0 .4.33.75.74.75h2.86" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"></path>
          <path d="M4.5 8h7M4.5 10.5h7" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"></path>
        </svg>
      `;
    case "target":
      return `
        <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <circle cx="8" cy="8" r="4.8" fill="none" stroke="currentColor" stroke-width="1.4"></circle>
          <circle cx="8" cy="8" r="1.6" fill="currentColor"></circle>
        </svg>
      `;
    case "check":
      return `
        <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path d="m3.5 8.5 3 3 6-6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"></path>
        </svg>
      `;
    default:
      return "";
  }
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function activeModelLabel() {
  const active = state.activeModel;
  if (!active) return "default";
  const match = state.models.find((model) => model.model === active || model.id === active);
  return match?.displayName || active;
}

function renderModelSummary() {
  const label = activeModelLabel();
  modelPillEl.textContent = `Model: ${label}`;
  activeModelText.textContent = state.activeModel ? `Using ${label}` : "Using default Codex model";
}

async function getJson(url) {
  const response = await fetch(url);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || response.statusText);
  return payload;
}

async function loadModels() {
  try {
    const payload = await getJson("/api/models");
    state.models = payload.models || [];
    state.activeModel = payload.activeModel || state.activeModel || "";
  } catch {
    state.models = [];
  }
  renderModelSummary();
  renderModelList();
}

async function postJson(url, body = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || response.statusText);
  return payload;
}

async function postFile(url, file) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": file.type || "application/octet-stream",
      "x-file-name": file.name
    },
    body: file
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || response.statusText);
  return payload;
}

function setBrowserError(message) {
  state.browser.error = message;
  renderBrowser();
}

function showLocalSystemMessage(text) {
  upsertMessage({
    id: `local_notice_${Date.now()}`,
    role: "system",
    kind: "notice",
    text,
    createdAt: new Date().toISOString()
  });
}

function getTreeNode(path = "") {
  if (!state.tree[path]) {
    state.tree[path] = {
      entries: [],
      expanded: false,
      loaded: false,
      loading: false,
      error: null
    };
  }
  return state.tree[path];
}

function renderBrowser() {
  const rootPath = state.explorerRootPath || "";
  const root = getTreeNode(rootPath);
  browserPathEl.textContent = displayPath(rootPath);
  parentButton.disabled = isProjectListMode() || state.browser.loading;
  parentButton.textContent = "Projects";
  newFolderButton.disabled = state.browser.loading;
  uploadButton.disabled = state.browser.loading;
  browserEntriesEl.innerHTML = "";

  if (root.loading && !root.loaded) {
    browserEntriesEl.innerHTML = `<p class="empty-state">Loading ${isProjectListMode() ? "projects" : "workspace"}...</p>`;
    return;
  }

  if (root.error && !root.loaded) {
    browserEntriesEl.innerHTML = `<p class="empty-state danger-text">${escapeText(root.error)}</p>`;
    return;
  }

  if (!root.entries.length) {
    browserEntriesEl.innerHTML = `<p class="empty-state">${isProjectListMode() ? "No projects found." : "No files in this folder."}</p>`;
    return;
  }

  renderTreeEntries(rootPath, 0);
}

function renderTreeEntries(path, depth) {
  const node = getTreeNode(path);
  for (const entry of node.entries) {
    browserEntriesEl.append(renderTreeEntry(entry, depth));
    if (entry.type === "folder") {
      const child = getTreeNode(entry.path);
      if (child.expanded) {
        if (child.loading) {
          const loading = document.createElement("p");
          loading.className = "tree-note";
          loading.style.paddingLeft = `${Math.min((depth + 2) * 18, 96)}px`;
          loading.textContent = "Loading...";
          browserEntriesEl.append(loading);
        } else if (child.error) {
          const error = document.createElement("p");
          error.className = "tree-note danger-text";
          error.style.paddingLeft = `${Math.min((depth + 2) * 18, 96)}px`;
          error.textContent = child.error;
          browserEntriesEl.append(error);
        } else if (child.loaded && !child.entries.length) {
          const empty = document.createElement("p");
          empty.className = "tree-note";
          empty.style.paddingLeft = `${Math.min((depth + 2) * 18, 96)}px`;
          empty.textContent = "Empty folder";
          browserEntriesEl.append(empty);
        } else {
          renderTreeEntries(entry.path, depth + 1);
        }
      }
    }
  }
}

function renderTreeEntry(entry, depth) {
  const isActiveProject = entry.path === state.activeProjectPath;
  const isActiveFile = entry.type === "file" && entry.path === state.activeFilePath;
  const isProjectRow = isProjectListMode() && depth === 0 && entry.type === "folder";
  const row = document.createElement("div");
  row.className = `tree-row ${entry.type}${isActiveProject ? " selected" : ""}${isActiveFile ? " active-file" : ""}${isProjectRow ? " project-row" : ""}`;
  row.style.setProperty("--depth", String(depth));

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "tree-toggle";
  toggle.setAttribute("aria-label", entry.type === "folder"
    ? (getTreeNode(entry.path).expanded ? "Collapse folder" : "Expand folder")
    : "File");

  const main = document.createElement("button");
  main.type = "button";
  main.className = "tree-main";

  if (entry.type === "folder") {
    const node = getTreeNode(entry.path);
    toggle.innerHTML = svgIcon(node.expanded ? "chevron-down" : "chevron-right");
    toggle.title = node.expanded ? "Collapse folder" : "Expand folder";
    toggle.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleFolder(entry.path);
    });
    main.addEventListener("click", () => {
      if (isProjectRow) {
        openProject(entry.path);
      } else {
        toggleFolder(entry.path);
      }
    });
  } else {
    toggle.textContent = "";
    toggle.disabled = true;
    main.addEventListener("click", () => readFile(entry.path));
  }

  main.innerHTML = `
    <span class="tree-icon">${svgIcon(entry.type === "folder" ? "folder" : "file")}</span>
    <span class="tree-label">${escapeText(entry.name)}</span>
  `;

  if (entry.type !== "folder" && entry.type !== "file") {
    main.disabled = true;
  }

  row.append(toggle, main);

  if (entry.type === "folder") {
    const action = document.createElement("button");
    action.type = "button";
    action.className = "tree-action";
    action.title = isActiveProject ? "Active workspace" : "Use as workspace";
    action.disabled = isActiveProject;
    action.innerHTML = svgIcon(isActiveProject ? "check" : "target");
    action.addEventListener("click", (event) => {
      event.stopPropagation();
      if (!action.disabled) openProject(entry.path);
    });
    row.append(action);
  }

  row.classList.toggle("selected", isActiveProject);
  row.classList.toggle("active-file", isActiveFile);
  return row;
}

function activeFileTab() {
  return state.openFileTabs.find((tab) => tab.path === state.activeFilePath) || null;
}

function isFileTabDirty(tab) {
  return Boolean(tab?.previewable && !tab.loading && (tab.content || "") !== (tab.savedContent || ""));
}

function normalizeEditablePreview(preview) {
  if (!preview.previewable) return preview;
  return {
    ...preview,
    content: preview.content || "",
    savedContent: preview.content || "",
    saveState: "idle",
    saveMessage: ""
  };
}

function clearFileTabs() {
  state.openFileTabs = [];
  state.activeFilePath = "";
  renderFilePreview();
  renderBrowser();
}

function renderFileTabs() {
  fileTabsEl.innerHTML = "";
  for (const tab of state.openFileTabs) {
    const isActive = tab.path === state.activeFilePath;
    const isDirty = isFileTabDirty(tab);
    const tabButton = document.createElement("button");
    tabButton.type = "button";
    tabButton.className = `file-tab${isActive ? " active" : ""}${isDirty ? " dirty" : ""}`;
    tabButton.setAttribute("role", "tab");
    tabButton.setAttribute("aria-selected", isActive ? "true" : "false");
    tabButton.title = displayPath(tab.path);
    tabButton.addEventListener("click", () => {
      state.activeFilePath = tab.path;
      renderFilePreview();
      renderBrowser();
    });

    const label = document.createElement("span");
    label.textContent = `${isDirty ? "* " : ""}${tab.name || tab.path.split("/").pop() || "File"}`;

    const close = document.createElement("span");
    close.className = "file-tab-close";
    close.textContent = "x";
    close.setAttribute("aria-hidden", "true");

    tabButton.append(label, close);
    tabButton.addEventListener("mouseup", (event) => {
      if (event.button === 1) closeFileTab(tab.path);
    });
    close.addEventListener("click", (event) => {
      event.stopPropagation();
      closeFileTab(tab.path);
    });
    fileTabsEl.append(tabButton);
  }
}

function renderFilePreview() {
  const preview = activeFileTab();
  fileViewerEl.hidden = !state.openFileTabs.length;
  renderAppMode();
  renderFileTabs();
  if (!preview) {
    fileStatusEl.textContent = "";
    saveFileButton.disabled = true;
    downloadFileButton.disabled = true;
    return;
  }

  const dirty = isFileTabDirty(preview);
  const editable = Boolean(preview.previewable && !preview.loading);
  fileTitleEl.textContent = preview.name || preview.path || "File";
  fileMetaEl.textContent = [
    displayPath(preview.path),
    formatBytes(preview.size),
    preview.loading ? "Loading" : preview.previewable ? dirty ? "Editable · Unsaved" : "Editable" : preview.reason || "Not previewable"
  ].filter(Boolean).join(" · ");
  if (preview.loading) {
    fileContentEl.value = "Loading preview...";
  } else {
    fileContentEl.value = preview.previewable ? preview.content || "" : preview.reason || "This file cannot be edited.";
  }
  fileContentEl.disabled = !editable;
  fileContentEl.readOnly = !editable;
  fileStatusEl.textContent = preview.saveState === "saving" ? "Saving..." : preview.saveMessage || (dirty ? "Unsaved" : "");
  saveFileButton.disabled = !editable || !dirty || preview.saveState === "saving";
  downloadFileButton.disabled = !preview.path || preview.loading;
}

function closeFileTab(path) {
  const index = state.openFileTabs.findIndex((tab) => tab.path === path);
  if (index === -1) return;
  if (isFileTabDirty(state.openFileTabs[index]) && !window.confirm("Close this file without saving changes?")) {
    return;
  }

  const wasActive = state.activeFilePath === path;
  state.openFileTabs.splice(index, 1);
  if (wasActive) {
    const nextTab = state.openFileTabs[index] || state.openFileTabs[index - 1] || null;
    state.activeFilePath = nextTab?.path || "";
  }
  renderFilePreview();
  renderBrowser();
}

function updateActiveFileContent(value) {
  const preview = activeFileTab();
  if (!preview?.previewable || preview.loading) return;
  preview.content = value;
  preview.saveState = "idle";
  preview.saveMessage = "";
  const dirty = isFileTabDirty(preview);
  fileMetaEl.textContent = [
    displayPath(preview.path),
    formatBytes(preview.size),
    dirty ? "Editable · Unsaved" : "Editable"
  ].filter(Boolean).join(" · ");
  fileStatusEl.textContent = dirty ? "Unsaved" : "";
  saveFileButton.disabled = !dirty;
  renderFileTabs();
}

async function saveActiveFile() {
  const preview = activeFileTab();
  if (!preview?.previewable || preview.loading || !isFileTabDirty(preview)) return;

  preview.saveState = "saving";
  preview.saveMessage = "";
  renderFilePreview();
  try {
    const saved = normalizeEditablePreview(await postJson("/api/fs/write", {
      path: preview.path,
      content: preview.content || ""
    }));
    const index = state.openFileTabs.findIndex((tab) => tab.path === preview.path);
    if (index !== -1) {
      state.openFileTabs[index] = saved;
      state.activeFilePath = saved.path;
    }
    await loadFolder(state.browser.currentPath, { expand: true, select: true });
  } catch (error) {
    const current = activeFileTab();
    if (current) {
      current.saveState = "idle";
      current.saveMessage = error.message;
    }
  }
  renderFilePreview();
  renderBrowser();
}

function renderModelList() {
  modelListEl.innerHTML = "";
  const models = state.models.length ? state.models : [
    {
      id: "",
      model: "",
      displayName: "Default",
      description: "Use the model from your Codex configuration.",
      isDefault: true
    }
  ];

  const defaultButton = document.createElement("button");
  defaultButton.type = "button";
  defaultButton.className = `model-row ${state.activeModel ? "" : "selected"}`;
  defaultButton.innerHTML = `
    <span>
      <strong>Default</strong>
      <small>Use the model from your Codex configuration.</small>
    </span>
    <em>${state.activeModel ? "" : "Selected"}</em>
  `;
  defaultButton.addEventListener("click", () => selectModel(""));
  modelListEl.append(defaultButton);

  for (const model of models) {
    if (!model.model) continue;
    const selected = model.model === state.activeModel || model.id === state.activeModel;
    const button = document.createElement("button");
    button.type = "button";
    button.className = `model-row ${selected ? "selected" : ""}`;
    button.innerHTML = `
      <span>
        <strong>${escapeText(model.displayName || model.model)}</strong>
        <small>${escapeText(model.description || model.model)}</small>
      </span>
      <em>${selected ? "Selected" : ""}</em>
    `;
    button.addEventListener("click", () => selectModel(model.model || model.id));
    modelListEl.append(button);
  }
}

function openModelSheet() {
  modelSheetEl.hidden = false;
  renderModelSummary();
  renderModelList();
}

function closeModelSheet() {
  modelSheetEl.hidden = true;
}

async function selectModel(model) {
  try {
    const payload = await postJson("/api/model", { model });
    state.activeModel = payload.activeModel || "";
    updateStatus(payload.codex || state.status || {});
    renderModelList();
    closeModelSheet();
    if (state.chatOpen) {
      showLocalSystemMessage(`Model set to ${activeModelLabel()}.`);
    }
  } catch (error) {
    showLocalSystemMessage(`Model selection failed: ${error.message}`);
  }
}

async function loadFolder(path = "", options = {}) {
  const { expand = true, select = true } = options;
  const node = getTreeNode(path);
  state.browser.loading = true;
  state.browser.error = null;
  node.loading = true;
  node.error = null;
  if (expand) node.expanded = true;
  renderBrowser();
  try {
    const payload = await getJson(`/api/fs/list?path=${encodeURIComponent(path)}`);
    state.browser = {
      ...state.browser,
      homeRoot: payload.homeRoot,
      entries: select ? payload.entries || [] : state.browser.entries,
      currentPath: select ? payload.currentPath || "" : state.browser.currentPath,
      parentPath: select ? payload.parentPath : state.browser.parentPath,
      loading: false,
      error: null
    };
    node.entries = payload.entries || [];
    node.loaded = true;
    node.loading = false;
    node.error = null;
    if (select) {
      state.browser.currentPath = payload.currentPath || "";
      state.browser.parentPath = payload.parentPath;
    }
  } catch (error) {
    state.browser.loading = false;
    state.browser.error = error.message;
    node.loading = false;
    node.error = error.message;
  }
  renderBrowser();
}

async function openProject(path) {
  try {
    const payload = await postJson("/api/project/select", { path, reset: true });
    const activePath = payload.activeProjectPath || path;
    state.activeProjectPath = activePath;
    state.explorerRootPath = activePath;
    state.sidebarOpen = false;
    state.messages = [];
    state.approvals = [];
    state.chatOpen = true;
    renderAppMode();
    renderMessages();
    renderApprovals();
    clearFileTabs();
    updateStatus(payload.codex || state.status || {});
    await loadFolder(activePath, { expand: true, select: true });
    await loadModels();
    promptEl.focus();
  } catch (error) {
    setBrowserError(error.message);
    renderAppMode();
  }
}

async function showProjectList() {
  state.explorerRootPath = "";
  state.browser.currentPath = "";
  state.browser.parentPath = null;
  clearFileTabs();
  renderBrowser();
  await loadFolder("", { expand: true, select: true });
}

async function toggleFolder(path) {
  const node = getTreeNode(path);
  node.expanded = !node.expanded;
  renderBrowser();
  if (node.expanded && !node.loaded && !node.loading) {
    await loadFolder(path, { expand: true, select: false });
  }
}

async function readFile(path) {
  const existing = state.openFileTabs.find((tab) => tab.path === path);
  if (existing) {
    state.activeFilePath = path;
    state.sidebarOpen = false;
    renderFilePreview();
    renderBrowser();
    return;
  }

  const loadingTab = {
    name: path.split("/").pop() || "File",
    path,
    size: null,
    previewable: false,
    reason: null,
    loading: true
  };
  state.openFileTabs.push(loadingTab);
  state.activeFilePath = path;
  state.sidebarOpen = false;
  renderFilePreview();
  renderBrowser();

  try {
    const preview = normalizeEditablePreview(await getJson(`/api/fs/read?path=${encodeURIComponent(path)}`));
    const index = state.openFileTabs.findIndex((tab) => tab.path === path);
    if (index !== -1) {
      state.openFileTabs[index] = preview;
    }
  } catch (error) {
    const fallback = {
      name: path.split("/").pop(),
      path,
      size: null,
      previewable: false,
      reason: error.message,
      saveState: "idle",
      saveMessage: ""
    };
    const index = state.openFileTabs.findIndex((tab) => tab.path === path);
    if (index === -1) state.openFileTabs.push(fallback);
    else state.openFileTabs[index] = fallback;
  }
  renderFilePreview();
}

async function createFolderInCurrentFolder() {
  const name = window.prompt("Folder name");
  if (!name) return;
  try {
    const payload = await postJson("/api/fs/mkdir", {
      path: state.browser.currentPath,
      name
    });
    state.browser = {
      ...state.browser,
      ...payload.folder,
      loading: false,
      error: null
    };
    const node = getTreeNode(state.browser.currentPath);
    node.entries = payload.folder.entries || [];
    node.loaded = true;
    node.loading = false;
    node.error = null;
    node.expanded = true;
    renderBrowser();
  } catch (error) {
    setBrowserError(error.message);
  }
}

async function uploadFilesToPath(files, targetPath) {
  const list = Array.from(files || []);
  if (!list.length) return;
  const uploadPath = targetPath ?? state.browser.currentPath;

  try {
    for (const file of list) {
      await postFile(`/api/fs/upload?path=${encodeURIComponent(uploadPath)}&name=${encodeURIComponent(file.name)}`, file);
    }
    if (uploadPath === state.browser.currentPath) {
      await loadFolder(uploadPath, { expand: true, select: true });
    } else {
      await loadFolder(uploadPath, { expand: true, select: false });
    }
    showLocalSystemMessage(`Uploaded ${list.length} file${list.length === 1 ? "" : "s"} to ${displayPath(uploadPath)}.`);
  } catch (error) {
    setBrowserError(error.message);
  }
}

function uploadFilesToCurrentFolder(files) {
  return uploadFilesToPath(files, state.browser.currentPath);
}

function uploadFilesToActiveProject(files) {
  return uploadFilesToPath(files, state.activeProjectPath || state.browser.currentPath);
}

function downloadPreviewedFile() {
  const preview = activeFileTab();
  if (!preview?.path || preview.loading) return;
  window.location.href = `/api/fs/download?path=${encodeURIComponent(preview.path)}`;
}

fileContentEl.addEventListener("input", () => {
  updateActiveFileContent(fileContentEl.value);
});

function setAttachmentMenu(open) {
  state.attachmentMenuOpen = open;
  attachmentMenuEl.hidden = !open;
  attachButton.setAttribute("aria-expanded", open ? "true" : "false");
}

function renderSlashSuggestions() {
  const value = promptEl.value;
  const slashMatch = value.match(/^\/[a-zA-Z-]*(?:\s.*)?$/);
  if (!slashMatch) {
    slashMenuEl.hidden = true;
    slashMenuEl.innerHTML = "";
    return;
  }

  const commandPart = value.split(/\s+/, 1)[0] || "/";
  const matches = codexCommands.filter((item) => item.command.startsWith(commandPart));
  if (!matches.length) {
    slashMenuEl.hidden = true;
    slashMenuEl.innerHTML = "";
    return;
  }

  slashMenuEl.innerHTML = "";
  for (const item of matches) {
    const button = document.createElement("button");
    button.type = "button";
    button.innerHTML = `
      <strong><span>${escapeText(item.command)}</span> ${escapeText(item.label)}</strong>
      <small>${escapeText(item.detail)}</small>
    `;
    button.addEventListener("click", () => {
      promptEl.value = item.command === "/model" || item.command === "/status" || item.command === "/help" || item.command === "/clear" || item.command === "/compact"
        ? item.command
        : `${item.command} `;
      slashMenuEl.hidden = true;
      slashMenuEl.innerHTML = "";
      autosizePrompt();
      promptEl.focus();
    });
    slashMenuEl.append(button);
  }
  slashMenuEl.hidden = false;
}

function closeSlashMenu() {
  slashMenuEl.hidden = true;
  slashMenuEl.innerHTML = "";
}

function codexCommandHelpText() {
  return codexCommands.map((item) => `${item.command} - ${item.detail}`).join("\n");
}

function currentStatusText() {
  const status = state.status || {};
  return [
    `Project: ${displayPath(status.activeProjectPath || "")}`,
    `Model: ${activeModelLabel()}`,
    `Codex: ${status.codexReady ? "ready" : status.appServer === "starting" ? "starting" : "idle"}`,
    `Turn: ${status.turnActive ? "working" : "idle"}`
  ].join("\n");
}

async function runCodexCommand(rawMessage) {
  const [command, ...rest] = rawMessage.trim().split(/\s+/);
  const args = rest.join(" ").trim();

  closeSlashMenu();
  promptEl.value = "";
  autosizePrompt();

  try {
    switch (command) {
      case "/model":
        openModelSheet();
        return;
      case "/review":
        await postJson("/api/codex/review", { instructions: args });
        return;
      case "/compact":
        await postJson("/api/codex/compact");
        return;
      case "/clear": {
        const payload = await postJson("/api/codex/clear");
        state.messages = [];
        state.approvals = [];
        renderMessages();
        renderApprovals();
        updateStatus(payload.codex || state.status || {});
        showLocalSystemMessage("Codex session cleared.");
        return;
      }
      case "/status":
        showLocalSystemMessage(currentStatusText());
        return;
      case "/help":
        showLocalSystemMessage(codexCommandHelpText());
        return;
      default:
        showLocalSystemMessage(`Unknown Codex command: ${command}`);
    }
  } catch (error) {
    upsertMessage({
      id: `local_error_${Date.now()}`,
      role: "system",
      kind: "error",
      text: error.message,
      createdAt: new Date().toISOString()
    });
  }
}

function renderMessages() {
  messagesEl.innerHTML = "";
  for (const message of state.messages) {
    const row = document.createElement("article");
    row.className = `message ${message.role}`;
    row.dataset.id = message.id;
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = message.text || "";
    row.append(bubble);
    messagesEl.append(row);
  }
  scrollToBottom();
}

function upsertMessage(message) {
  const index = state.messages.findIndex((item) => item.id === message.id);
  if (index === -1) state.messages.push(message);
  else state.messages[index] = message;
  renderMessages();
}

function approvalDetails(approval) {
  const details = approval.details || {};
  if (approval.type === "command") {
    return [
      details.command ? `$ ${details.command}` : "",
      details.cwd ? `cwd: ${details.cwd}` : "",
      details.network ? `network: ${JSON.stringify(details.network, null, 2)}` : "",
      details.proposedNetworkRules ? `network rules: ${JSON.stringify(details.proposedNetworkRules, null, 2)}` : ""
    ].filter(Boolean).join("\n");
  }
  if (approval.type === "file_change") {
    return JSON.stringify(details, null, 2);
  }
  if (approval.type === "permissions") {
    return JSON.stringify(details.permissions || details, null, 2);
  }
  if (approval.type === "user_input") {
    return (details.questions || []).map((question) => {
      const options = (question.options || []).map((option) => option.label || option.value || JSON.stringify(option)).join(", ");
      return `${question.header || question.id}: ${question.question}${options ? `\nOptions: ${options}` : ""}`;
    }).join("\n\n");
  }
  return JSON.stringify(details, null, 2);
}

function renderApprovals() {
  approvalsEl.innerHTML = "";
  for (const approval of state.approvals) {
    const card = document.createElement("article");
    card.className = "approval-card";
    card.innerHTML = `
      <h2>${escapeText(approval.title || "Approval request")}</h2>
      ${approval.reason ? `<p>${escapeText(approval.reason)}</p>` : ""}
      <pre>${escapeText(approvalDetails(approval))}</pre>
      <div class="approval-actions"></div>
    `;

    const actions = card.querySelector(".approval-actions");
    if (approval.type === "user_input") {
      const questions = approval.details?.questions || [];
      for (const question of questions) {
        const select = document.createElement("select");
        select.dataset.questionId = question.id;
        select.className = "full";
        if (question.options?.length) {
          for (const option of question.options) {
            const opt = document.createElement("option");
            opt.value = option.label || option.value || option.description || "";
            opt.textContent = option.label || option.value || option.description || "Option";
            select.append(opt);
          }
        } else {
          const opt = document.createElement("option");
          opt.value = "";
          opt.textContent = "No options supplied";
          select.append(opt);
        }
        actions.append(select);
      }
      actions.append(actionButton("Answer", "allow_once", "full", () => {
        const answers = {};
        for (const select of actions.querySelectorAll("select")) {
          answers[select.dataset.questionId] = { answers: [select.value] };
        }
        resolveApproval(approval.id, "answer", { answers });
      }));
      actions.append(actionButton("Cancel", "cancel", "danger full", () => resolveApproval(approval.id, "cancel")));
    } else {
      actions.append(actionButton("Allow Once", "allow_once", "", () => resolveApproval(approval.id, "allow_once")));
      if (approval.actions?.includes("always")) {
        actions.append(actionButton("Always", "always", "secondary", () => resolveApproval(approval.id, "always")));
      }
      actions.append(actionButton("Deny", "deny", "danger", () => resolveApproval(approval.id, "deny")));
      if (approval.actions?.includes("cancel")) {
        actions.append(actionButton("Cancel", "cancel", "secondary full", () => resolveApproval(approval.id, "cancel")));
      }
    }

    approvalsEl.append(card);
  }
  updateStatus(state.status || {});
}

function actionButton(label, decision, className, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.dataset.decision = decision;
  if (className) button.className = className;
  button.addEventListener("click", onClick);
  return button;
}

async function resolveApproval(id, decision, extra = {}) {
  await postJson(`/api/approval/${encodeURIComponent(id)}`, { decision, ...extra });
}

composer.addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = promptEl.value.trim();
  if (!message) return;
  if (message.startsWith("/")) {
    await runCodexCommand(message);
    return;
  }
  promptEl.value = "";
  closeSlashMenu();
  autosizePrompt();
  try {
    await postJson("/api/message", { message });
  } catch (error) {
    upsertMessage({
      id: `local_error_${Date.now()}`,
      role: "system",
      kind: "error",
      text: error.message,
      createdAt: new Date().toISOString()
    });
  }
});

stopButton.addEventListener("click", async () => {
  await postJson("/api/stop").catch((error) => {
    upsertMessage({
      id: `local_error_${Date.now()}`,
      role: "system",
      kind: "error",
      text: error.message,
      createdAt: new Date().toISOString()
    });
  });
});

parentButton.addEventListener("click", () => {
  showProjectList();
});

newFolderButton.addEventListener("click", createFolderInCurrentFolder);

uploadButton.addEventListener("click", () => {
  state.pendingUploadTarget = "browser";
  fileInput.click();
});

modelButton.addEventListener("click", openModelSheet);

sidebarButton.addEventListener("click", () => {
  state.sidebarOpen = !state.sidebarOpen;
  renderAppMode();
});

sidebarBackdrop.addEventListener("click", () => {
  state.sidebarOpen = false;
  renderAppMode();
});

closeModelButton.addEventListener("click", closeModelSheet);

modelSheetEl.addEventListener("click", (event) => {
  if (event.target.classList.contains("model-sheet-backdrop")) {
    closeModelSheet();
  }
});

closeFileButton.addEventListener("click", () => {
  if (state.activeFilePath) closeFileTab(state.activeFilePath);
});

saveFileButton.addEventListener("click", saveActiveFile);

downloadFileButton.addEventListener("click", downloadPreviewedFile);

attachButton.addEventListener("click", () => {
  setAttachmentMenu(!state.attachmentMenuOpen);
});

attachFileButton.addEventListener("click", () => {
  setAttachmentMenu(false);
  state.pendingUploadTarget = "project";
  fileInput.click();
});

attachCameraButton.addEventListener("click", () => {
  setAttachmentMenu(false);
  state.pendingUploadTarget = "project";
  cameraInput.click();
});

fileInput.addEventListener("change", async () => {
  if (state.pendingUploadTarget === "project") {
    await uploadFilesToActiveProject(fileInput.files);
  } else {
    await uploadFilesToCurrentFolder(fileInput.files);
  }
  state.pendingUploadTarget = "browser";
  fileInput.value = "";
});

cameraInput.addEventListener("change", async () => {
  await uploadFilesToActiveProject(cameraInput.files);
  state.pendingUploadTarget = "browser";
  cameraInput.value = "";
});

function autosizePrompt() {
  promptEl.style.height = "auto";
  promptEl.style.height = `${Math.min(promptEl.scrollHeight, 160)}px`;
}

promptEl.addEventListener("input", () => {
  autosizePrompt();
  renderSlashSuggestions();
});

promptEl.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeSlashMenu();
    setAttachmentMenu(false);
    closeModelSheet();
    state.sidebarOpen = false;
    renderAppMode();
  }
});

document.addEventListener("click", (event) => {
  if (!attachmentMenuEl.contains(event.target) && event.target !== attachButton) {
    setAttachmentMenu(false);
  }
});

const events = new EventSource("/api/events");
events.addEventListener("snapshot", (event) => {
  const payload = JSON.parse(event.data);
  state.messages = payload.messages || [];
  state.approvals = payload.approvals || [];
  state.status = payload.status || {};
  state.activeModel = state.status.activeModel || state.activeModel || "";
  renderMessages();
  renderApprovals();
  updateStatus(state.status);
});
events.addEventListener("message", (event) => upsertMessage(JSON.parse(event.data)));
events.addEventListener("message:update", (event) => upsertMessage(JSON.parse(event.data)));
events.addEventListener("approval", (event) => {
  const approval = JSON.parse(event.data);
  if (!state.approvals.some((item) => item.id === approval.id)) {
    state.approvals.push(approval);
    renderApprovals();
  }
});
events.addEventListener("approvals", (event) => {
  state.approvals = JSON.parse(event.data);
  renderApprovals();
});
events.addEventListener("approval:resolved", (event) => {
  const payload = JSON.parse(event.data);
  state.approvals = state.approvals.filter((approval) => approval.id !== payload.id);
  renderApprovals();
});
events.addEventListener("status", (event) => updateStatus(JSON.parse(event.data)));
events.addEventListener("activity", () => {});
events.addEventListener("error", () => {
  statusText.textContent = "Connection lost. Refresh when the Mac server is running.";
});

renderAppMode();
renderBrowser();
renderFilePreview();
loadModels();
loadFolder();
