/**
 * AnythingLLM UI — main application entry point.
 *
 * Auto-connects to the WebLLM engine on startup (no manual "Load Model" step).
 * All chat I/O goes through the OpenAI-compatible fetch router to prove
 * the "drop-in for any OpenAI UI" architecture.
 *
 * Default model: SmolLM2-1.7B-Instruct-q4f16_1-MLC (under 2B, ~1 GB VRAM).
 */
import "./ui/styles.css";

import { createEngine, getEngine, getDB, reloadModel, getCurrentModelId, getAvailableModels } from "./engine";
import { installFetchRouter } from "./fetchRouter";
import { LoadingOverlay } from "./ui/LoadingOverlay";
import { HeaderBar } from "./ui/HeaderBar";
import { Sidebar } from "./ui/Sidebar";
import { ChatArea } from "./ui/ChatArea";
import { SettingsModal, type SettingsValues } from "./ui/SettingsModal";
import { renderMarkdown, attachCopyButtons } from "./ui/markdown";
import type { ConversationRecord, MessageRecord } from "./db";

// ── Configuration ───────────────────────────────────────────────────

const DEFAULT_MODEL = "SmolLM2-360M-Instruct-q4f32_1-MLC";

let settings: SettingsValues = {
  modelId: DEFAULT_MODEL,
  temperature: 0.7,
  maxTokens: 1024,
  systemPrompt: "You are a helpful assistant.",
};

// ── Component instances ─────────────────────────────────────────────

let overlay: LoadingOverlay;
let header: HeaderBar;
let sidebar: Sidebar;
let chatArea: ChatArea;
let settingsModal: SettingsModal;

// ── State ───────────────────────────────────────────────────────────

let isGenerating = false;

// ── Initialization ──────────────────────────────────────────────────

async function boot(): Promise<void> {
  // Check WebGPU availability first
  const gpuOk = await checkWebGPU();

  // Instantiate UI components
  overlay = new LoadingOverlay();
  header = new HeaderBar({
    onToggleSidebar: () => sidebar.toggle(),
    onOpenSettings: () => settingsModal.open(),
  });
  sidebar = new Sidebar({
    onSelect: handleSelectConversation,
    onDelete: handleDeleteConversation,
    onNewChat: handleNewChat,
    onClearAll: handleClearAll,
    onOpenSettings: () => settingsModal.open(),
  });
  chatArea = new ChatArea({
    onSend: handleSendMessage,
  });
  settingsModal = new SettingsModal({
    currentModelId: settings.modelId,
    onSave: handleSettingsSave,
    onClearAll: handleClearAll,
  });

  // Disable input until engine is ready
  chatArea.disable();

  if (!gpuOk) {
    overlay.setSubtitle("WebGPU is not available in this browser. Please use Chrome 113+ or Edge 113+.");
    overlay.update(0, "⚠ WebGPU not supported");
    chatArea.setStatus("⚠ WebGPU not available");
    return;
  }

  // Auto-load the engine
  await loadEngine(settings.modelId);
}

// ── WebGPU Detection ────────────────────────────────────────────────

async function checkWebGPU(): Promise<boolean> {
  const nav = navigator as any;
  if (!nav.gpu) return false;
  try {
    const adapter = await nav.gpu.requestAdapter();
    return adapter !== null;
  } catch {
    return false;
  }
}

// ── Engine Loading ──────────────────────────────────────────────────

async function loadEngine(modelId: string): Promise<void> {
  overlay.show();
  header.setStatus("loading");
  header.setModel(modelId);
  chatArea.setStatus("Loading model...");

  try {
    const engine = await createEngine(modelId, (report) => {
      overlay.update(report.progress, report.text);
    });

    // Install fetch router so all OpenAI-style fetches hit local engine
    installFetchRouter(engine);

    settings.modelId = modelId;
    settingsModal.setModelId(modelId);
    header.setModel(modelId);
    header.setStatus("connected");
    header.setTitle("New Chat");
    chatArea.setStatus(`Model: ${modelId}`, "Ready");
    chatArea.enable();

    // Load conversation list
    await refreshConversationList();

    overlay.hide();
  } catch (err) {
    header.setStatus("error");
    overlay.update(0, `Error: ${(err as Error).message}`);
    chatArea.setStatus(`Error loading model: ${(err as Error).message}`);
    console.error("[app] Engine load error:", err);
  }
}

// ── Chat I/O (via fetch router) ─────────────────────────────────────

async function handleSendMessage(text: string): Promise<void> {
  if (isGenerating || !getEngine()) return;

  isGenerating = true;
  chatArea.setGenerating(true);

  // Show user message
  chatArea.appendMessage("user", text);

  // Show typing indicator
  const typing = chatArea.showTypingIndicator();

  try {
    // Build the request through the OpenAI-compatible fetch router
    const messages: Array<{ role: string; content: string }> = [];

    if (settings.systemPrompt) {
      messages.push({ role: "system", content: settings.systemPrompt });
    }
    messages.push({ role: "user", content: text });

    const body: Record<string, any> = {
      model: settings.modelId,
      messages,
      stream: true,
      temperature: settings.temperature,
      max_tokens: settings.maxTokens,
      persist: true,
      stream_options: { include_usage: true },
    };

    // If we have an active conversation, pass its ID
    const convId = chatArea.getConversationId();
    if (convId) {
      body.conversation_id = convId;
    }

    const response = await fetch("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    // Remove typing indicator
    typing.remove();

    if (!response.ok) {
      const errData = await response.json().catch(() => ({ error: { message: "Unknown error" } }));
      throw new Error(errData.error?.message ?? `HTTP ${response.status}`);
    }

    // Stream SSE response
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let fullText = "";
    let contentEl: HTMLElement | null = null;
    let newConvId: string | null = null;

    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? ""; // keep incomplete line

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;

        const payload = trimmed.slice(6);
        if (payload === "[DONE]") continue;

        try {
          const chunk = JSON.parse(payload);

          // Capture conversation_id from first chunk
          if (chunk.conversation_id && !newConvId) {
            newConvId = chunk.conversation_id;
            chatArea.setConversationId(newConvId);
          }

          const delta = chunk.choices?.[0]?.delta?.content ?? "";
          fullText += delta;

          // Create or update the assistant message element
          if (!contentEl) {
            contentEl = chatArea.appendMessage("assistant", "");
          }

          // Render markdown incrementally
          contentEl.innerHTML = renderMarkdown(fullText);
          chatArea.scrollToBottom();

          // Update status with tokens/s if available
          if (chunk.usage) {
            const tps = chunk.usage.completion_tokens /
              ((chunk.usage as any).extra?.decode_time_s ?? 1);
            chatArea.setStatus(
              `Model: ${settings.modelId}`,
              `${chunk.usage.completion_tokens} tokens | ${tps.toFixed(1)} tok/s`
            );
          }
        } catch {
          // skip malformed chunks
        }
      }
    }

    // Final markdown render + copy buttons
    if (contentEl) {
      contentEl.innerHTML = renderMarkdown(fullText);
      attachCopyButtons(contentEl);
    }

    // Update header with conversation title
    if (newConvId) {
      header.setTitle(text.slice(0, 50) + (text.length > 50 ? "..." : ""));
    }

    // Refresh sidebar
    await refreshConversationList();
  } catch (err) {
    typing.remove();
    chatArea.appendMessage("assistant", `❌ Error: ${(err as Error).message}`);
    console.error("[app] Send error:", err);
  } finally {
    isGenerating = false;
    chatArea.setGenerating(false);
  }
}

// ── Conversation Management (via fetch router) ──────────────────────

async function refreshConversationList(): Promise<void> {
  try {
    const res = await fetch("/v1/conversations");
    const data = await res.json();
    const conversations: ConversationRecord[] = data.data ?? [];
    sidebar.update(conversations);
    sidebar.setActive(chatArea.getConversationId());
  } catch (err) {
    console.error("[app] Failed to load conversations:", err);
  }
}

async function handleSelectConversation(id: string): Promise<void> {
  chatArea.setConversationId(id);
  sidebar.setActive(id);

  try {
    // Load messages via fetch router
    const res = await fetch(`/v1/conversations/${id}/messages`);
    const data = await res.json();
    const messages: MessageRecord[] = data.data ?? [];
    chatArea.loadMessages(messages);

    // Update header title
    const convRes = await fetch(`/v1/conversations/${id}`);
    const conv: ConversationRecord = await convRes.json();
    header.setTitle(conv.title);
  } catch (err) {
    console.error("[app] Failed to load conversation:", err);
  }
}

async function handleDeleteConversation(id: string): Promise<void> {
  try {
    await fetch(`/v1/conversations/${id}`, { method: "DELETE" });

    if (chatArea.getConversationId() === id) {
      chatArea.clear();
      header.setTitle("New Chat");
    }

    await refreshConversationList();
  } catch (err) {
    console.error("[app] Failed to delete conversation:", err);
  }
}

function handleNewChat(): void {
  chatArea.clear();
  header.setTitle("New Chat");
  sidebar.setActive(null);
}

async function handleClearAll(): Promise<void> {
  try {
    const db = await getDB();
    await db.clearAll();
    chatArea.clear();
    header.setTitle("New Chat");
    await refreshConversationList();
  } catch (err) {
    console.error("[app] Failed to clear all:", err);
  }
}

// ── Settings ────────────────────────────────────────────────────────

async function handleSettingsSave(values: SettingsValues): Promise<void> {
  const modelChanged = values.modelId !== settings.modelId;
  settings = values;

  if (modelChanged) {
    // Reload engine with new model
    overlay.show();
    header.setStatus("loading");
    chatArea.setStatus("Switching model...");

    try {
      await reloadModel(values.modelId, (report) => {
        overlay.update(report.progress, report.text);
      });

      header.setModel(values.modelId);
      header.setStatus("connected");
      chatArea.setStatus(`Model: ${values.modelId}`, "Ready");
      overlay.hide();
    } catch (err) {
      header.setStatus("error");
      overlay.update(0, `Error: ${(err as Error).message}`);
      console.error("[app] Model reload error:", err);
    }
  }
}

// ── Start ───────────────────────────────────────────────────────────

boot().catch((err) => {
  console.error("[app] Boot error:", err);
});
