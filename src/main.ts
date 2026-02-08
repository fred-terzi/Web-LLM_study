/**
 * Test UI bootstrap.
 * Model selector, progress bar, and chat interface.
 */
import {
  createEngine,
  getAvailableModels,
  reloadModel,
  getEngine,
  type InitProgressReport,
  type ChatCompletionChunk,
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

let currentModelId: string | null = null;
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
  } catch (err) {
    statusLine.textContent = `Error: ${(err as Error).message}`;
    console.error("Model load error:", err);
  } finally {
    loadBtn.disabled = false;
    loadBtn.textContent = "Load Model";
  }
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
    const messages: Array<{ role: string; content: string }> = [
      { role: "system", content: "You are a helpful assistant." },
    ];

    // Gather existing messages from DOM for context
    const domMessages = chatMessages.querySelectorAll(".message");
    domMessages.forEach((el) => {
      const role = el.classList.contains("user") ? "user" : "assistant";
      const content = el.textContent ?? "";
      if (content) {
        messages.push({ role, content });
      }
    });

    const chunks = await engine.chat.completions.create({
      messages: messages as any,
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: 512,
    });

    let fullText = "";
    for await (const chunk of chunks as AsyncIterable<ChatCompletionChunk>) {
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

// ── Init ────────────────────────────────────────────────────────────

populateModels();
sendBtn.disabled = true;
chatInput.disabled = true;
statusLine.textContent = "Select a model and click Load to begin.";
