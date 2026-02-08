/**
 * Chat Area component.
 * Renders messages with Markdown, handles streaming, shows welcome screen.
 * All I/O goes through the OpenAI-compatible fetch router.
 */
import { renderMarkdown, attachCopyButtons } from "./markdown";
import type { MessageRecord } from "../db";

const SUGGESTIONS = [
  "Explain how WebGPU works in simple terms",
  "Write a Python function to sort a list",
  "What are the benefits of running LLMs locally?",
  "Help me debug a TypeScript error",
];

export class ChatArea {
  private messagesEl: HTMLElement;
  private inputEl: HTMLTextAreaElement;
  private sendBtn: HTMLButtonElement;
  private welcomeEl: HTMLElement | null = null;
  private statusBarLeft: HTMLElement;
  private statusBarRight: HTMLElement;

  private isGenerating = false;
  private currentConversationId: string | null = null;

  private onSend: (text: string) => void;
  private onSuggestionClick: (text: string) => void;

  constructor(opts: {
    onSend: (text: string) => void;
  }) {
    this.onSend = opts.onSend;
    this.onSuggestionClick = opts.onSend; // same handler

    this.messagesEl = document.getElementById("chat-messages")!;
    this.inputEl = document.getElementById("chat-input") as HTMLTextAreaElement;
    this.sendBtn = document.getElementById("send-btn") as HTMLButtonElement;
    this.statusBarLeft = document.querySelector(".status-left")! as HTMLElement;
    this.statusBarRight = document.querySelector(".status-right")! as HTMLElement;

    // Wire send
    this.sendBtn.addEventListener("click", () => this.handleSend());
    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.handleSend();
      }
    });

    // Auto-resize textarea
    this.inputEl.addEventListener("input", () => this.autoResize());

    this.showWelcome();
  }

  setConversationId(id: string | null): void {
    this.currentConversationId = id;
  }

  getConversationId(): string | null {
    return this.currentConversationId;
  }

  enable(): void {
    this.inputEl.disabled = false;
    this.sendBtn.disabled = false;
    this.inputEl.focus();
  }

  disable(): void {
    this.inputEl.disabled = true;
    this.sendBtn.disabled = true;
  }

  setGenerating(generating: boolean): void {
    this.isGenerating = generating;
    this.sendBtn.disabled = generating;
    if (generating) {
      this.sendBtn.innerHTML = "⏹";
    } else {
      this.sendBtn.innerHTML = "↑";
    }
  }

  /**
   * Show the welcome / empty state screen.
   */
  showWelcome(): void {
    this.messagesEl.innerHTML = "";

    const welcome = document.createElement("div");
    welcome.className = "welcome-screen";
    welcome.innerHTML = `
      <div class="welcome-icon">🧠</div>
      <h2>AnythingLLM</h2>
      <p>Your private AI assistant running entirely in the browser.<br>
         No data leaves your device — powered by WebLLM + WebGPU.</p>
      <div class="welcome-suggestions">
        ${SUGGESTIONS.map(
          (s) => `<button class="suggestion-chip">${s}</button>`
        ).join("")}
      </div>
    `;

    welcome.querySelectorAll(".suggestion-chip").forEach((btn, i) => {
      btn.addEventListener("click", () => {
        this.onSuggestionClick(SUGGESTIONS[i]);
      });
    });

    this.messagesEl.appendChild(welcome);
    this.welcomeEl = welcome;
  }

  /**
   * Clear welcome screen if visible.
   */
  private clearWelcome(): void {
    if (this.welcomeEl) {
      this.welcomeEl.remove();
      this.welcomeEl = null;
    }
  }

  /**
   * Load an existing conversation's messages.
   */
  loadMessages(messages: MessageRecord[]): void {
    this.clearWelcome();
    this.messagesEl.innerHTML = "";

    for (const msg of messages) {
      if (msg.role === "user" || msg.role === "assistant") {
        this.appendMessage(msg.role, msg.content);
      }
    }
  }

  /**
   * Clear the chat area and show welcome.
   */
  clear(): void {
    this.currentConversationId = null;
    this.showWelcome();
  }

  /**
   * Append a rendered message bubble.
   */
  appendMessage(role: "user" | "assistant", content: string): HTMLElement {
    this.clearWelcome();

    const row = document.createElement("div");
    row.className = `message-row ${role}`;

    const avatar = document.createElement("div");
    avatar.className = "message-avatar";
    avatar.textContent = role === "user" ? "👤" : "🤖";

    const body = document.createElement("div");
    body.className = "message-body";

    const contentEl = document.createElement("div");
    contentEl.className = "message-content";

    if (role === "assistant") {
      contentEl.innerHTML = renderMarkdown(content);
      attachCopyButtons(contentEl);
    } else {
      contentEl.textContent = content;
    }

    body.appendChild(contentEl);

    // Copy message action for assistant
    if (role === "assistant" && content) {
      const meta = document.createElement("div");
      meta.className = "message-meta";
      const copyBtn = document.createElement("button");
      copyBtn.className = "message-action-btn";
      copyBtn.innerHTML = "📋 Copy";
      copyBtn.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(content);
          copyBtn.innerHTML = "✓ Copied";
          setTimeout(() => (copyBtn.innerHTML = "📋 Copy"), 1500);
        } catch { /* ignore */ }
      });
      meta.appendChild(copyBtn);
      body.appendChild(meta);
    }

    row.appendChild(avatar);
    row.appendChild(body);
    this.messagesEl.appendChild(row);
    this.scrollToBottom();

    return contentEl;
  }

  /**
   * Show typing indicator and return a handle to update / remove it.
   */
  showTypingIndicator(): { el: HTMLElement; remove: () => void } {
    this.clearWelcome();

    const row = document.createElement("div");
    row.className = "message-row assistant";

    const avatar = document.createElement("div");
    avatar.className = "message-avatar";
    avatar.textContent = "🤖";

    const body = document.createElement("div");
    body.className = "message-body";

    const indicator = document.createElement("div");
    indicator.className = "typing-indicator";
    indicator.innerHTML = "<span></span><span></span><span></span>";

    body.appendChild(indicator);
    row.appendChild(avatar);
    row.appendChild(body);
    this.messagesEl.appendChild(row);
    this.scrollToBottom();

    return {
      el: body,
      remove: () => row.remove(),
    };
  }

  /**
   * Update the status bar.
   */
  setStatus(left: string, right?: string): void {
    this.statusBarLeft.textContent = left;
    if (right !== undefined) {
      this.statusBarRight.textContent = right;
    }
  }

  private handleSend(): void {
    if (this.isGenerating) return;
    const text = this.inputEl.value.trim();
    if (!text) return;

    this.inputEl.value = "";
    this.inputEl.style.height = "auto";
    this.onSend(text);
  }

  private autoResize(): void {
    this.inputEl.style.height = "auto";
    this.inputEl.style.height = Math.min(this.inputEl.scrollHeight, 160) + "px";
  }

  scrollToBottom(): void {
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }
}
