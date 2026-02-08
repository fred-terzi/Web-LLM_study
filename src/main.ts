/**
 * Test UI bootstrap.
 * Model selector, progress bar, conversation sidebar, and chat interface.
 */
import {
  createEngine,
  getAvailableModels,
  reloadModel,
  getEngine,
  getDB,
  sendMessage,
  type InitProgressReport,
  type ConversationRecord,
} from "./engine";

// ── DOM References ──────────────────────────────────────────────────

const modelSelect = document.getElementById(
  "model-select"
) as HTMLSelectElement;
const loadBtn = document.getElementById("load-btn") as HTMLButtonElement;
const progressBar = document.getElementById("progress-bar") as HTMLDivElement;
const progressText = document.getElementById("progress-text") as HTMLDivElement;
const chatMessages = document.getElementById(
  "chat-messages"
) as HTMLDivElement;
const chatInput = document.getElementById("chat-input") as HTMLTextAreaElement;
const sendBtn = document.getElementById("send-btn") as HTMLButtonElement;
const statusLine = document.getElementById("status-line") as HTMLDivElement;
const newChatBtn = document.getElementById("new-chat-btn") as HTMLButtonElement;
const clearAllBtn = document.getElementById("clear-all-btn") as HTMLButtonElement;
const conversationList = document.getElementById(
  "conversation-list"
) as HTMLDivElement;

let currentModelId: string | null = null;
let currentConversationId: string | null = null;
let isGenerating = false;

// ── Populate Model Selector ─────────────────────────────────────────

function populateModels(): void {
  const models = getAvailableModels();

  // Group by size category
  const small = models.filter(
    (m) => m.low_resource_required && (m.vram_required_MB ?? Infinity) < 1000
  );
  const medium = models.filter(
    (m) => m.low_resource_required && (m.vram_required_MB ?? 0) >= 1000
  );
  const large = models.filter((m) => !m.low_resource_required);

  const addGroup = (label: string, items: typeof models) => {
    if (items.length === 0) return;
    const group = document.createElement("optgroup");
    group.label = label;
    items.forEach((m) => {
      const opt = document.createElement("option");
      opt.value = m.model_id;
      opt.textContent = `${m.model_id} (${m.vram_required_MB ?? "?"}MB)`;
      group.appendChild(opt);
    });
    modelSelect.appendChild(group);
  };

  addGroup("Small (<1GB VRAM)", small);
  addGroup("Medium (1-4GB VRAM)", medium);
  addGroup("Large (4GB+ VRAM)", large);

  // Default to smallest SmolLM if available
  const defaultModel = models.find((m) =>
    m.model_id.includes("SmolLM2-135M")
  );
  if (defaultModel) {
    modelSelect.value = defaultModel.model_id;
  }
}

// ── Progress Callback ───────────────────────────────────────────────

function onProgress(report: InitProgressReport): void {
  const pct = Math.round(report.progress * 100);
  progressBar.style.width = `${pct}%`;
  progressText.textContent = report.text;
  statusLine.textContent = `Loading: ${pct}% | ${report.timeElapsed.toFixed(1)}s elapsed`;
}

// ── Load Model ──────────────────────────────────────────────────────

async function handleLoadModel(): Promise<void> {
  const modelId = modelSelect.value;
  if (!modelId) return;

  loadBtn.disabled = true;
  loadBtn.textContent = "Loading...";
  progressBar.style.width = "0%";
  progressText.textContent = "Initializing...";

  try {
    if (currentModelId && getEngine()) {
      // Reload with new model
      await reloadModel(modelId, onProgress);
    } else {
      // First load
      await createEngine(modelId, onProgress);
    }

    currentModelId = modelId;
    statusLine.textContent = `Model loaded: ${modelId}`;
    sendBtn.disabled = false;
    chatInput.disabled = false;

    // Load conversation list after engine is ready
    await refreshConversationList();
  } catch (err) {
    statusLine.textContent = `Error: ${(err as Error).message}`;
    console.error("Model load error:", err);
  } finally {
    loadBtn.disabled = false;
    loadBtn.textContent = "Load Model";
  }
}

// ── Conversation Sidebar ────────────────────────────────────────────

async function refreshConversationList(): Promise<void> {
  try {
    const db = await getDB();
    const conversations = await db.listConversations();
    renderConversationList(conversations);
  } catch (err) {
    console.error("Failed to load conversations:", err);
  }
}

function renderConversationList(conversations: ConversationRecord[]): void {
  conversationList.innerHTML = "";

  for (const conv of conversations) {
    const item = document.createElement("div");
    item.className = `conv-item${conv.id === currentConversationId ? " active" : ""}`;
    item.dataset.id = conv.id;

    const title = document.createElement("span");
    title.className = "conv-title";
    title.textContent = conv.title;
    item.appendChild(title);

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "conv-delete";
    deleteBtn.textContent = "✕";
    deleteBtn.title = "Delete conversation";
    deleteBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await handleDeleteConversation(conv.id);
    });
    item.appendChild(deleteBtn);

    item.addEventListener("click", () => handleSelectConversation(conv.id));
    conversationList.appendChild(item);
  }
}

async function handleSelectConversation(id: string): Promise<void> {
  currentConversationId = id;

  // Refresh sidebar to update active state
  await refreshConversationList();

  // Load messages
  const db = await getDB();
  const messages = await db.getMessages(id);

  chatMessages.innerHTML = "";
  for (const msg of messages) {
    if (msg.role === "user" || msg.role === "assistant") {
      appendMessage(msg.role, msg.content);
    }
  }
}

async function handleDeleteConversation(id: string): Promise<void> {
  const db = await getDB();
  await db.deleteConversation(id);

  if (currentConversationId === id) {
    currentConversationId = null;
    chatMessages.innerHTML = "";
  }

  await refreshConversationList();
}

async function handleNewChat(): Promise<void> {
  currentConversationId = null;
  chatMessages.innerHTML = "";
  await refreshConversationList();
}

async function handleClearAll(): Promise<void> {
  if (!confirm("Delete all conversations?")) return;
  const db = await getDB();
  await db.clearAll();
  currentConversationId = null;
  chatMessages.innerHTML = "";
  await refreshConversationList();
}

// ── Chat ────────────────────────────────────────────────────────────

function appendMessage(role: "user" | "assistant", content: string): HTMLDivElement {
  const bubble = document.createElement("div");
  bubble.className = `message ${role}`;
  bubble.textContent = content;
  chatMessages.appendChild(bubble);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return bubble;
}

async function handleSend(): Promise<void> {
  const engine = getEngine();
  if (!engine || isGenerating) return;

  const userText = chatInput.value.trim();
  if (!userText) return;

  chatInput.value = "";
  appendMessage("user", userText);

  isGenerating = true;
  sendBtn.disabled = true;

  const assistantBubble = appendMessage("assistant", "");

  try {
    const { conversationId, stream } = await sendMessage(
      userText,
      currentConversationId,
      {
        systemPrompt: "You are a helpful assistant.",
        maxTokens: 512,
      }
    );

    // Update current conversation id (may have been created)
    currentConversationId = conversationId;

    let fullText = "";
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content ?? "";
      fullText += delta;
      assistantBubble.textContent = fullText;
      chatMessages.scrollTop = chatMessages.scrollHeight;

      if (chunk.usage) {
        const tps =
          chunk.usage.completion_tokens /
          ((chunk.usage as any).extra?.decode_time_s ?? 1);
        statusLine.textContent = `${currentModelId} | ${chunk.usage.completion_tokens} tokens | ${tps.toFixed(1)} tok/s`;
      }
    }

    // Refresh sidebar to show new/updated conversation
    await refreshConversationList();
  } catch (err) {
    assistantBubble.textContent = `Error: ${(err as Error).message}`;
    console.error("Chat error:", err);
  } finally {
    isGenerating = false;
    sendBtn.disabled = false;
  }
}

// ── Event Listeners ─────────────────────────────────────────────────

loadBtn.addEventListener("click", handleLoadModel);
sendBtn.addEventListener("click", handleSend);
chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
});
newChatBtn.addEventListener("click", handleNewChat);
clearAllBtn.addEventListener("click", handleClearAll);

// ── Init ────────────────────────────────────────────────────────────

populateModels();
sendBtn.disabled = true;
chatInput.disabled = true;
statusLine.textContent = "Select a model and click Load to begin.";
