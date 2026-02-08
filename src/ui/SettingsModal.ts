/**
 * Settings Modal component.
 * Allows changing model, temperature, max tokens, system prompt, and clearing data.
 */
import { prebuiltAppConfig, type ModelRecord } from "@mlc-ai/web-llm";

export interface SettingsValues {
  modelId: string;
  temperature: number;
  maxTokens: number;
  systemPrompt: string;
}

export class SettingsModal {
  private backdrop: HTMLElement;
  private modelSelect: HTMLSelectElement;
  private tempSlider: HTMLInputElement;
  private tempValue: HTMLElement;
  private maxTokensSlider: HTMLInputElement;
  private maxTokensValue: HTMLElement;
  private systemPromptEl: HTMLTextAreaElement;

  private currentModelId: string;
  private onSave: (values: SettingsValues) => void;
  private onClearAll: () => void;

  constructor(opts: {
    currentModelId: string;
    onSave: (values: SettingsValues) => void;
    onClearAll: () => void;
  }) {
    this.currentModelId = opts.currentModelId;
    this.onSave = opts.onSave;
    this.onClearAll = opts.onClearAll;

    this.backdrop = document.getElementById("settings-backdrop")!;
    this.modelSelect = document.getElementById("settings-model-select") as HTMLSelectElement;
    this.tempSlider = document.getElementById("settings-temperature") as HTMLInputElement;
    this.tempValue = document.getElementById("settings-temp-value")!;
    this.maxTokensSlider = document.getElementById("settings-max-tokens") as HTMLInputElement;
    this.maxTokensValue = document.getElementById("settings-max-tokens-value")!;
    this.systemPromptEl = document.getElementById("settings-system-prompt") as HTMLTextAreaElement;

    // Populate model selector
    this.populateModels();

    // Wire events
    this.backdrop.addEventListener("click", (e) => {
      if (e.target === this.backdrop) this.close();
    });

    document.getElementById("settings-close-btn")!.addEventListener("click", () => this.close());

    this.tempSlider.addEventListener("input", () => {
      this.tempValue.textContent = this.tempSlider.value;
    });

    this.maxTokensSlider.addEventListener("input", () => {
      this.maxTokensValue.textContent = this.maxTokensSlider.value;
    });

    document.getElementById("settings-save-btn")!.addEventListener("click", () => {
      this.onSave(this.getValues());
      this.close();
    });

    document.getElementById("settings-clear-all-btn")!.addEventListener("click", () => {
      if (confirm("Delete ALL conversations and cached data? This cannot be undone.")) {
        this.onClearAll();
        this.close();
      }
    });
  }

  private populateModels(): void {
    this.modelSelect.innerHTML = "";
    const models = prebuiltAppConfig.model_list;

    const small = models.filter(
      (m) => m.low_resource_required && (m.vram_required_MB ?? Infinity) < 1000
    );
    const medium = models.filter(
      (m) => m.low_resource_required && (m.vram_required_MB ?? 0) >= 1000
    );
    const large = models.filter((m) => !m.low_resource_required);

    const addGroup = (label: string, items: ModelRecord[]) => {
      if (items.length === 0) return;
      const group = document.createElement("optgroup");
      group.label = label;
      items.forEach((m) => {
        const opt = document.createElement("option");
        opt.value = m.model_id;
        opt.textContent = `${m.model_id} (${m.vram_required_MB ?? "?"}MB)`;
        group.appendChild(opt);
      });
      this.modelSelect.appendChild(group);
    };

    addGroup("Small (<1GB VRAM)", small);
    addGroup("Medium (1-4GB VRAM)", medium);
    addGroup("Large (4GB+ VRAM)", large);

    this.modelSelect.value = this.currentModelId;
  }

  open(): void {
    this.modelSelect.value = this.currentModelId;
    this.backdrop.classList.add("open");
  }

  close(): void {
    this.backdrop.classList.remove("open");
  }

  setModelId(modelId: string): void {
    this.currentModelId = modelId;
    this.modelSelect.value = modelId;
  }

  getValues(): SettingsValues {
    return {
      modelId: this.modelSelect.value,
      temperature: parseFloat(this.tempSlider.value),
      maxTokens: parseInt(this.maxTokensSlider.value, 10),
      systemPrompt: this.systemPromptEl.value.trim(),
    };
  }
}
