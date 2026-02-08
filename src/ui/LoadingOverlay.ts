/**
 * Loading Overlay component.
 * Full-screen overlay shown during initial model download + load.
 */

export class LoadingOverlay {
  private el: HTMLElement;
  private fill: HTMLElement;
  private label: HTMLElement;
  private subtitle: HTMLElement;

  constructor() {
    this.el = document.getElementById("loading-overlay")!;
    this.fill = this.el.querySelector(".progress-fill")! as HTMLElement;
    this.label = this.el.querySelector(".progress-label")! as HTMLElement;
    this.subtitle = this.el.querySelector(".loading-subtitle")! as HTMLElement;
  }

  show(): void {
    this.el.classList.remove("hidden");
    this.fill.style.width = "0%";
    this.label.textContent = "Initializing...";
  }

  /**
   * Update progress (0–1) and status text.
   */
  update(progress: number, text: string): void {
    this.fill.style.width = `${Math.round(progress * 100)}%`;
    this.label.textContent = text;
  }

  hide(): void {
    this.el.classList.add("hidden");
  }

  setSubtitle(text: string): void {
    this.subtitle.textContent = text;
  }
}
