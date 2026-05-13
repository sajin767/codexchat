const state = {
  messages: [],
  approvals: [],
  status: null
};

const messagesEl = document.querySelector("#messages");
const approvalsEl = document.querySelector("#approvals");
const statusText = document.querySelector("#statusText");
const composer = document.querySelector("#composer");
const promptEl = document.querySelector("#prompt");
const sendButton = document.querySelector("#sendButton");
const stopButton = document.querySelector("#stopButton");

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function setBusy(busy) {
  sendButton.disabled = busy;
  stopButton.disabled = !busy;
  promptEl.disabled = busy;
}

function updateStatus(status) {
  state.status = status;
  const parts = [];
  if (status?.codexReady) parts.push("Codex ready");
  else parts.push(status?.appServer === "starting" ? "Starting Codex" : "Codex idle");
  if (status?.turnActive) parts.push("working");
  if (state.approvals.length) parts.push(`${state.approvals.length} approval pending`);
  if (status?.lastError) parts.push(status.lastError);
  statusText.textContent = parts.join(" · ");
  setBusy(Boolean(status?.turnActive || state.approvals.length));
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

async function resolveApproval(id, decision, extra = {}) {
  await postJson(`/api/approval/${encodeURIComponent(id)}`, { decision, ...extra });
}

composer.addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = promptEl.value.trim();
  if (!message) return;
  promptEl.value = "";
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

function autosizePrompt() {
  promptEl.style.height = "auto";
  promptEl.style.height = `${Math.min(promptEl.scrollHeight, 160)}px`;
}

promptEl.addEventListener("input", autosizePrompt);

const events = new EventSource("/api/events");
events.addEventListener("snapshot", (event) => {
  const payload = JSON.parse(event.data);
  state.messages = payload.messages || [];
  state.approvals = payload.approvals || [];
  state.status = payload.status || {};
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
