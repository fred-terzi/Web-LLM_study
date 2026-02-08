/**
 * Web Worker entry point for WebLLM engine.
 *
 * Instantiates WebWorkerMLCEngineHandler (which internally creates an
 * MLCEngine and wires up initProgressCallback to postMessage), then
 * connects self.onmessage so the handler receives reload/chat/etc.
 * messages from the main-thread WebWorkerMLCEngine client.
 */
import { WebWorkerMLCEngineHandler } from "@mlc-ai/web-llm";

const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (msg: MessageEvent) => {
  handler.onmessage(msg);
};

console.log("[WebLLM Worker] Handler initialized and listening for messages.");
