/**
 * Web Worker entry point for WebLLM engine.
 *
 * Instantiates WebWorkerMLCEngineHandler which auto-registers
 * a self.onmessage listener to handle the @mlc-ai/web-llm
 * message protocol (reload, chatCompletion, streaming, etc.).
 */
import { WebWorkerMLCEngineHandler } from "@mlc-ai/web-llm";

const handler = new WebWorkerMLCEngineHandler();

console.log("[WebLLM Worker] Handler initialized and listening for messages.");
