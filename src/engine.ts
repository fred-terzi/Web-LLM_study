/**
 * Main-thread engine client.
 *
 * Provides a factory to create a WebWorkerMLCEngine and helpers
 * for listing models and reloading.
 */
import {
  CreateWebWorkerMLCEngine,
  type WebWorkerMLCEngine,
  type InitProgressCallback,
  type InitProgressReport,
  type ChatCompletionMessageParam,
  type ChatCompletionChunk,
  prebuiltAppConfig,
  type ModelRecord,
} from "@mlc-ai/web-llm";

export type { WebWorkerMLCEngine, InitProgressReport, ChatCompletionChunk };
export type { ChatCompletionMessageParam };

let _engine: WebWorkerMLCEngine | null = null;
let _worker: Worker | null = null;

/**
 * Returns the list of all available prebuilt models.
 */
export function getAvailableModels(): ModelRecord[] {
  return prebuiltAppConfig.model_list;
}

/**
 * Creates (or returns existing) web worker and WebWorkerMLCEngine.
 * Loads the specified model with progress streaming.
 */
export async function createEngine(
  modelId: string,
  onProgress?: InitProgressCallback
): Promise<WebWorkerMLCEngine> {
  // Reuse existing worker if we have one
  if (!_worker) {
    _worker = new Worker(new URL("./worker.ts", import.meta.url), {
      type: "module",
    });
  }

  const engine = await CreateWebWorkerMLCEngine(_worker, modelId, {
    initProgressCallback: onProgress,
    appConfig: {
      ...prebuiltAppConfig,
      useIndexedDBCache: true,
    },
  });

  _engine = engine;
  return engine;
}

/**
 * Get the current engine instance (null if not yet created).
 */
export function getEngine(): WebWorkerMLCEngine | null {
  return _engine;
}

/**
 * Reload the engine with a different model.
 * Reuses the existing worker.
 */
export async function reloadModel(
  modelId: string,
  onProgress?: InitProgressCallback
): Promise<void> {
  if (!_engine) {
    throw new Error("Engine not initialized. Call createEngine() first.");
  }
  _engine.setInitProgressCallback(onProgress ?? (() => {}));
  await _engine.reload(modelId);
}

/**
 * Terminate the worker and clean up.
 */
export function destroyEngine(): void {
  if (_worker) {
    _worker.terminate();
    _worker = null;
  }
  _engine = null;
}
