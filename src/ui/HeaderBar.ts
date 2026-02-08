/**
 * Header Bar component.
 * Shows sidebar toggle, conversation title, model status pill, and settings button.
 */

export type ConnectionStatus = "connected" | "loading" | "error";

export class HeaderBar {
  private titleEl: HTMLElement;
  private dotEl: HTMLElement;
  private modelNameEl: HTMLElement;

  private onToggleSidebar: () => void;
  private onOpenSettings: () => void;

  constructor(opts: {
    onToggleSidebar: () => void;
    onOpenSettings: () => void;
  }) {
    this.onToggleSidebar = opts.onToggleSidebar;
    this.onOpenSettings = opts.onOpenSettings;

    this.titleEl = document.querySelector("#header-bar .header-title")!;
    this.dotEl = document.querySelector("#header-bar .status-dot")!;
    this.modelNameEl = document.querySelector("#header-bar .model-name")!;

    document.getElementById("toggle-sidebar-btn")!.addEventListener("click", this.onToggleSidebar);
    document.getElementById("settings-btn")!.addEventListener("click", this.onOpenSettings);
  }

  setTitle(title: string): void {
    this.titleEl.textContent = title;
  }

  setModel(name: string): void {
    this.modelNameEl.textContent = name;
  }

  setStatus(status: ConnectionStatus): void {
    this.dotEl.classList.remove("loading", "error");
    if (status === "loading") this.dotEl.classList.add("loading");
    if (status === "error") this.dotEl.classList.add("error");
  }
}
