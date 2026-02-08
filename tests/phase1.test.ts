/**
 * Phase 1 Tests: Engine module unit tests.
 *
 * These tests verify the parts of the engine module that don't require
 * WebGPU: model listing, module exports, model record structure.
 * WebGPU-dependent tests (actual model loading, chat) must be run
 * manually in a browser with the test UI.
 */
import { describe, it, expect } from "vitest";
import { prebuiltAppConfig } from "@mlc-ai/web-llm";

describe("Phase 1: Model Listing", () => {
  it("should have a non-empty model list in prebuiltAppConfig", () => {
    expect(prebuiltAppConfig.model_list).toBeDefined();
    expect(Array.isArray(prebuiltAppConfig.model_list)).toBe(true);
    expect(prebuiltAppConfig.model_list.length).toBeGreaterThan(0);
  });

  it("each model record should have required fields", () => {
    for (const model of prebuiltAppConfig.model_list.slice(0, 10)) {
      expect(model.model_id).toBeDefined();
      expect(typeof model.model_id).toBe("string");
      expect(model.model_id.length).toBeGreaterThan(0);

      expect(model.model).toBeDefined();
      expect(typeof model.model).toBe("string");

      expect(model.model_lib).toBeDefined();
      expect(typeof model.model_lib).toBe("string");
    }
  });

  it("should contain SmolLM2 models", () => {
    const smolModels = prebuiltAppConfig.model_list.filter((m) =>
      m.model_id.includes("SmolLM2")
    );
    expect(smolModels.length).toBeGreaterThan(0);
  });

  it("SmolLM2 models should be marked as low resource", () => {
    const smolModels = prebuiltAppConfig.model_list.filter((m) =>
      m.model_id.includes("SmolLM2")
    );
    for (const model of smolModels) {
      expect(model.low_resource_required).toBe(true);
    }
  });

  it("should have VRAM info for models", () => {
    const withVram = prebuiltAppConfig.model_list.filter(
      (m) => m.vram_required_MB !== undefined
    );
    expect(withVram.length).toBeGreaterThan(0);
  });
});

describe("Phase 1: Engine Module Exports", () => {
  it("should export getAvailableModels function", async () => {
    const mod = await import("../src/engine");
    expect(typeof mod.getAvailableModels).toBe("function");
  });

  it("should export createEngine function", async () => {
    const mod = await import("../src/engine");
    expect(typeof mod.createEngine).toBe("function");
  });

  it("should export reloadModel function", async () => {
    const mod = await import("../src/engine");
    expect(typeof mod.reloadModel).toBe("function");
  });

  it("should export getEngine function", async () => {
    const mod = await import("../src/engine");
    expect(typeof mod.getEngine).toBe("function");
  });

  it("should export destroyEngine function", async () => {
    const mod = await import("../src/engine");
    expect(typeof mod.destroyEngine).toBe("function");
  });

  it("getAvailableModels should return model list", async () => {
    const { getAvailableModels } = await import("../src/engine");
    const models = getAvailableModels();
    expect(Array.isArray(models)).toBe(true);
    expect(models.length).toBeGreaterThan(0);
    expect(models[0].model_id).toBeDefined();
  });

  it("getEngine should return null before initialization", async () => {
    const { getEngine } = await import("../src/engine");
    expect(getEngine()).toBeNull();
  });
});

describe("Phase 1: Model Categorization", () => {
  it("should categorize models by VRAM into small/medium/large", () => {
    const models = prebuiltAppConfig.model_list;

    const small = models.filter(
      (m) =>
        m.low_resource_required && (m.vram_required_MB ?? Infinity) < 1000
    );
    const medium = models.filter(
      (m) =>
        m.low_resource_required && (m.vram_required_MB ?? 0) >= 1000
    );
    const large = models.filter((m) => !m.low_resource_required);

    // We should have at least some models in each category
    expect(small.length).toBeGreaterThan(0);
    // Total should equal original
    expect(small.length + medium.length + large.length).toBe(models.length);
  });

  it("smallest SmolLM2 model should need <500MB VRAM", () => {
    const smallest = prebuiltAppConfig.model_list.find(
      (m) => m.model_id === "SmolLM2-135M-Instruct-q0f16-MLC"
    );
    if (smallest) {
      expect(smallest.vram_required_MB).toBeDefined();
      expect(smallest.vram_required_MB!).toBeLessThan(500);
    }
  });
});

describe("Phase 1: Worker File", () => {
  it("worker source file should exist and be importable structure", async () => {
    // Verify the worker file can be read (won't execute without Worker API)
    const fs = await import("fs");
    const path = await import("path");
    const workerPath = path.resolve(__dirname, "../src/worker.ts");
    const content = fs.readFileSync(workerPath, "utf-8");

    expect(content).toContain("WebWorkerMLCEngineHandler");
    expect(content).toContain("@mlc-ai/web-llm");
  });
});

describe("Phase 1: HTML Test UI", () => {
  it("index.html should exist and have required elements", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const htmlPath = path.resolve(__dirname, "../index.html");
    const content = fs.readFileSync(htmlPath, "utf-8");

    // Required DOM elements (AnythingLLM UI)
    expect(content).toContain('id="loading-overlay"');
    expect(content).toContain('id="chat-messages"');
    expect(content).toContain('id="chat-input"');
    expect(content).toContain('id="send-btn"');
    expect(content).toContain('id="header-bar"');
    expect(content).toContain('id="sidebar"');

    // Should load app.ts
    expect(content).toContain('src="/src/app.ts"');
  });
});
