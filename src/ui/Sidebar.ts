/**
 * Sidebar component.
 * Renders conversation list grouped by date, search filter, new chat, settings.
 */
import type { ConversationRecord } from "../db";

export class Sidebar {
  private el: HTMLElement;
  private listEl: HTMLElement;
  private searchInput: HTMLInputElement;
  private conversations: ConversationRecord[] = [];
  private activeId: string | null = null;
  private filterText = "";

  private onSelect: (id: string) => void;
  private onDelete: (id: string) => void;
  private onNewChat: () => void;
  private onClearAll: () => void;
  private onOpenSettings: () => void;

  constructor(opts: {
    onSelect: (id: string) => void;
    onDelete: (id: string) => void;
    onNewChat: () => void;
    onClearAll: () => void;
    onOpenSettings: () => void;
  }) {
    this.onSelect = opts.onSelect;
    this.onDelete = opts.onDelete;
    this.onNewChat = opts.onNewChat;
    this.onClearAll = opts.onClearAll;
    this.onOpenSettings = opts.onOpenSettings;

    this.el = document.getElementById("sidebar")!;
    this.listEl = document.getElementById("conversation-list")!;
    this.searchInput = this.el.querySelector(".sidebar-search input") as HTMLInputElement;

    // Wire buttons
    document.getElementById("new-chat-btn")!.addEventListener("click", this.onNewChat);
    document.getElementById("clear-all-sidebar-btn")!.addEventListener("click", this.onClearAll);
    document.getElementById("settings-sidebar-btn")!.addEventListener("click", this.onOpenSettings);

    // Search filter
    this.searchInput.addEventListener("input", () => {
      this.filterText = this.searchInput.value.toLowerCase();
      this.render();
    });
  }

  toggle(): void {
    this.el.classList.toggle("collapsed");
  }

  collapse(): void {
    this.el.classList.add("collapsed");
  }

  expand(): void {
    this.el.classList.remove("collapsed");
  }

  get isCollapsed(): boolean {
    return this.el.classList.contains("collapsed");
  }

  setActive(id: string | null): void {
    this.activeId = id;
    this.render();
  }

  update(conversations: ConversationRecord[]): void {
    this.conversations = conversations;
    this.render();
  }

  private render(): void {
    this.listEl.innerHTML = "";

    let filtered = this.conversations;
    if (this.filterText) {
      filtered = filtered.filter((c) =>
        c.title.toLowerCase().includes(this.filterText)
      );
    }

    // Group by date
    const now = Date.now();
    const dayMs = 86_400_000;
    const todayStart = new Date().setHours(0, 0, 0, 0);
    const weekAgo = todayStart - 7 * dayMs;

    const groups: { label: string; items: ConversationRecord[] }[] = [
      { label: "Today", items: [] },
      { label: "Previous 7 Days", items: [] },
      { label: "Older", items: [] },
    ];

    for (const c of filtered) {
      if (c.updatedAt >= todayStart) {
        groups[0].items.push(c);
      } else if (c.updatedAt >= weekAgo) {
        groups[1].items.push(c);
      } else {
        groups[2].items.push(c);
      }
    }

    for (const group of groups) {
      if (group.items.length === 0) continue;

      const header = document.createElement("div");
      header.className = "conv-date-group";
      header.textContent = group.label;
      this.listEl.appendChild(header);

      for (const conv of group.items) {
        const item = document.createElement("div");
        item.className = `conv-item${conv.id === this.activeId ? " active" : ""}`;
        item.dataset.id = conv.id;

        item.innerHTML = `
          <span class="conv-icon">💬</span>
          <span class="conv-title">${this.escapeHtml(conv.title)}</span>
          <button class="conv-delete" title="Delete">🗑</button>
        `;

        item.addEventListener("click", (e) => {
          const target = e.target as HTMLElement;
          if (target.closest(".conv-delete")) return;
          this.onSelect(conv.id);
        });

        item.querySelector(".conv-delete")!.addEventListener("click", (e) => {
          e.stopPropagation();
          this.onDelete(conv.id);
        });

        this.listEl.appendChild(item);
      }
    }
  }

  private escapeHtml(s: string): string {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }
}
