/**
 * Main-thread engine client.
 *
 * Provides a factory to create a WebWorkerMLCEngine, helpers
 * for listing models and reloading, and a persistent sendMessage()
 * that stores conversations in IndexedDB.
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
import { ConversationDB, type ConversationRecord, type MessageRecord } from "./db";

export type { WebWorkerMLCEngine, InitProgressReport, ChatCompletionChunk };
export type { ChatCompletionMessageParam };
export type { ConversationRecord, MessageRecord };

let _engine: WebWorkerMLCEngine | null = null;
let _worker: Worker | null = null;
let _db: ConversationDB | null = null;
let _currentModelId: string | null = null;

/** Default max messages to keep in sliding window context. */
const DEFAULT_MAX_CONTEXT_MESSAGES = 50;

/**
 * Returns the list of all available prebuilt models.
 */
export function getAvailableModels(): ModelRecord[] {
  return prebuiltAppConfig.model_list;
}

/**
 * Get or create the shared ConversationDB instance.
 */
export async function getDB(): Promise<ConversationDB> {
  if (!_db) {
    _db = new ConversationDB();
    await _db.open();
  }
  return _db;
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
  _currentModelId = modelId;

  // Ensure DB is open
  await getDB();

  return engine;
}

/**
 * Get the current engine instance (null if not yet created).
 */
export function getEngine(): WebWorkerMLCEngine | null {
  return _engine;
}

/**
 * Get the currently loaded model ID.
 */
export function getCurrentModelId(): string | null {
  return _currentModelId;
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
  _currentModelId = modelId;
}

/**
 * Apply sliding window to message history.
 * Keeps the system message (if any) + last N message pairs.
 */
export function applySlidingWindow(
  messages: ChatCompletionMessageParam[],
  maxMessages: number = DEFAULT_MAX_CONTEXT_MESSAGES
): ChatCompletionMessageParam[] {
  if (messages.length <= maxMessages) {
    return messages;
  }

  const systemMessages = messages.filter((m) => m.role === "system");
  const nonSystemMessages = messages.filter((m) => m.role !== "system");

  // Keep the system messages + last N non-system messages
  const trimmed = nonSystemMessages.slice(-maxMessages);
  return [...systemMessages, ...trimmed];
}

/**
 * Send a message within a conversation, with full persistence.
 *
 * - If conversationId is null, creates a new conversation.
 * - Loads history from IndexedDB and applies sliding window.
 * - Saves user message immediately, saves assistant response after streaming completes.
 * - Yields chunks for real-time streaming.
 *
 * Returns { conversationId, stream } where stream is an AsyncIterable of chunks.
 */
export async function sendMessage(
  userContent: string,
  conversationId: string | null = null,
  options: {
    systemPrompt?: string;
    maxContextMessages?: number;
    temperature?: number;
    maxTokens?: number;
  } = {}
): Promise<{
  conversationId: string;
  stream: AsyncIterable<ChatCompletionChunk>;
}> {
  const engine = _engine;
  if (!engine) {
    throw new Error("Engine not initialized. Call createEngine() first.");
  }

  const db = await getDB();
  const modelId = _currentModelId ?? "unknown";

  // Create or get conversation
  let convId = conversationId;
  if (!convId) {
    const title = userContent.slice(0, 50) + (userContent.length > 50 ? "..." : "");
    const conv = await db.createConversation(title, modelId);
    convId = conv.id;
  }

  // Save user message immediately
  await db.saveMessage({
    conversationId: convId,
    role: "user",
    content: userContent,
    timestamp: Date.now(),
  });

  // Load conversation history from DB
  const storedMessages = await db.getMessages(convId);

  // Build messages array for the model
  const chatMessages: ChatCompletionMessageParam[] = [];

  if (options.systemPrompt) {
    chatMessages.push({ role: "system", content: options.systemPrompt });
  }

  for (const msg of storedMessages) {
    chatMessages.push({
      role: msg.role as "system" | "user" | "assistant",
      content: msg.content,
    });
  }

  // Apply sliding window
  const windowedMessages = applySlidingWindow(
    chatMessages,
    options.maxContextMessages ?? DEFAULT_MAX_CONTEXT_MESSAGES
  );

  // Create streaming completion
  const rawStream = await engine.chat.completions.create({
    messages: windowedMessages,
    stream: true,
    stream_options: { include_usage: true },
    temperature: options.temperature,
    max_tokens: options.maxTokens ?? 1024,
  });

  // Wrap the stream to accumulate the full response and save it after completion
  const finalConvId = convId;
  async function* persistedStream(): AsyncIterable<ChatCompletionChunk> {
    let fullContent = "";

    for await (const chunk of rawStream as AsyncIterable<ChatCompletionChunk>) {
      const delta = chunk.choices[0]?.delta?.content ?? "";
      fullContent += delta;
      yield chunk;
    }

    // Save assistant message after stream completes
    await db.saveMessage({
      conversationId: finalConvId,
      role: "assistant",
      content: fullContent,
      timestamp: Date.now(),
    });
  }

  return {
    conversationId: finalConvId,
    stream: persistedStream(),
  };
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
  _currentModelId = null;
  if (_db) {
    _db.close();
    _db = null;
  }
}
