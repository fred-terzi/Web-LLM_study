# Plan: Web-LLM Service Worker with OpenAI Proxy & Persistent Memory

Build an in-browser LLM runtime powered by `@mlc-ai/web-llm` that works across **all platforms including iOS**. On supported browsers (Chrome 124+ desktop/Android) it runs as a **service worker** that intercepts OpenAI-shaped fetch requests transparently. On iOS/Safari and other browsers lacking service-worker WebGPU support, it falls back to a **web worker** with an identical `postMessage`-based API and a thin client-side fetch wrapper that routes requests to the worker. Both runtimes stream token-by-token responses, store model weights in IndexedDB via `AppConfig.useIndexedDBCache`, and persist all conversations in a shared IndexedDB database for cross-session recall.

## Steps

1. **Scaffold the project** — Initialize an npm project with `@mlc-ai/web-llm`, Vite (with `{ type: "module" }` worker support), and TypeScript. Create five entry points:
   - `src/sw.ts` — service worker (Chrome/Android path)
   - `src/worker.ts` — web worker (iOS/Safari fallback path)
   - `src/handler.ts` — shared request handler used by both workers
   - `src/db.ts` — IndexedDB persistence layer (conversations + messages)
   - `src/main.ts` — client bootstrap with runtime detection

2. **Runtime detection & engine factory (`main.ts`)** — On startup, detect the available runtime:
   - **Service worker path**: Check `'serviceWorker' in navigator` AND that WebGPU is available in the SW context (feature-detect via `navigator.gpu` — on iOS/Safari this will be absent or the SW won't support WebGPU). If supported, register `sw.ts`, then call `CreateServiceWorkerMLCEngine(modelId, { initProgressCallback, appConfig: { useIndexedDBCache: true } })`. After init, all `fetch("/v1/...")` calls are transparently intercepted — no wrapper needed.
   - **Web worker fallback**: If the service worker path is unavailable (iOS, Safari, older browsers), instantiate the web worker via `CreateWebWorkerMLCEngine(new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }), modelId, { initProgressCallback, appConfig: { useIndexedDBCache: true } })`. Then monkey-patch or wrap `globalThis.fetch` with a thin client-side router (`fetchRouter.ts`) that intercepts `/v1/...` URLs and forwards them as structured `postMessage` calls to the `WebWorkerMLCEngine`, re-assembling the responses into `Response` objects (including `ReadableStream` for SSE) so consuming UI code sees no difference.
   - Export a single `getEngine(): Promise<MLCEngineInterface>` that the UI imports — it returns whichever engine was created.

3. **Shared request handler (`handler.ts`)** — Extract all request-handling logic into a runtime-agnostic module that both `sw.ts` and `worker.ts` import:
   - `handleChatCompletion(engine, body, db)` — calls `engine.chat.completions.create()`, streams or returns the result, and persists messages to `ConversationDB`.
   - `handleListModels()` — returns `prebuiltAppConfig.model_list` filtered by device capabilities.
   - `handleLoadModel(engine, modelId, onProgress)` — calls `engine.reload(modelId)` and streams `InitProgressReport` as SSE.
   - `handleConversations(db, method, params)` — CRUD operations on conversations.
   - `handleConversationMessages(db, conversationId)` — returns full message history for context replay.
   This ensures both runtimes behave identically.

4. **Implement the service worker (`sw.ts`)** — Instantiate `ServiceWorkerMLCEngineHandler` on `activate`. Add a `fetch` event listener that intercepts:
   - `POST /v1/chat/completions` (or requests to `api.openai.com/v1/chat/completions`) → delegates to `handleChatCompletion`. Returns a JSON `Response` or a streaming SSE `ReadableStream` (`text/event-stream`) depending on `body.stream`.
   - `GET /v1/models` → delegates to `handleListModels`.
   - `POST /v1/models/load` → delegates to `handleLoadModel`, streams progress as SSE.
   - `GET|POST|DELETE /v1/conversations/**` → delegates to `handleConversations` / `handleConversationMessages`.
   All other requests pass through to the network via `fetch(event.request)`.

5. **Implement the web worker (`worker.ts`)** — Instantiate `WebWorkerMLCEngineHandler` which auto-listens for `postMessage`. Additionally, listen for custom message kinds (`{ kind: "llm-request", route, method, body }`) and delegate to the same shared `handler.ts` functions. Post results back via `postMessage` with matching `uuid`. For streaming, post sequential chunk messages that the client-side `fetchRouter` re-assembles into a `ReadableStream`.

6. **Client-side fetch router (`fetchRouter.ts`, web worker mode only)** — A thin wrapper that intercepts `fetch` calls matching `/v1/...` patterns:
   - Serializes the request into a `postMessage` to the web worker.
   - For non-streaming: awaits a single response message, wraps it in `new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } })`.
   - For streaming (`body.stream === true`): creates a `ReadableStream`, enqueues each chunk message as `data: ${JSON.stringify(chunk)}\n\n`, and closes on `[DONE]`. Returns `new Response(stream, { headers: { "Content-Type": "text/event-stream" } })`.
   - Installed by overriding `globalThis.fetch` with a wrapper: if the URL matches, route to worker; otherwise call the original `fetch`.

7. **Build the IndexedDB persistence layer (`db.ts`)** — Create a `ConversationDB` class that opens a `"webllm-conversations"` database with two object stores: `conversations` (keyed by UUID, indexed on `updatedAt`) and `messages` (keyed by UUID, indexed on `conversationId` + `timestamp`). Expose methods: `createConversation`, `listConversations`, `getMessages(conversationId)`, `saveMessage`, `deleteConversation`, and `updateConversation`. This module is imported by both `sw.ts` and `worker.ts` — IndexedDB is accessible from both contexts. Model weights are cached separately via `@mlc-ai/web-llm`'s built-in IndexedDB cache (`AppConfig.useIndexedDBCache: true`), which works on all platforms including iOS Safari.

8. **Wire persistence into the chat completion handler** — Inside `handleChatCompletion`, after inference completes (streaming fully consumed or non-streaming returned), save both the user's prompt message(s) and the assembled assistant response as `MessageRecord` entries via `ConversationDB.saveMessage()`. Use a `x-conversation-id` header or `conversation_id` body field to associate messages with a conversation; if absent, auto-create a new `ConversationRecord` with a title derived from the first user message.

9. **Add model management & conversation recall routes** — Both runtimes expose the same logical endpoints:
   - `GET /v1/models` → available models + which are cached (via `hasModelInCache`).
   - `POST /v1/models/load` → `{ model_id }` → reloads engine, streams progress.
   - `GET /v1/conversations` → list all conversations, sorted by `updatedAt` desc.
   - `POST /v1/conversations` → create a new conversation.
   - `GET /v1/conversations/:id/messages` → return full message history for context replay.
   - `DELETE /v1/conversations/:id` → delete conversation and its messages.

## Further Considerations

1. **iOS WebGPU support** — iOS Safari 18+ (released Sep 2024) supports WebGPU on the main thread and in web workers, but does **not** support WebGPU inside service workers. The web worker fallback handles this. Ensure `AppConfig.useIndexedDBCache` is set to `true` since the Cache API behaves differently on iOS; IndexedDB is the reliable cross-platform storage for model weights.
2. **Keep-alive strategy** — Service workers die after ~30s idle; WebLLM sends heartbeats every 10s by default. Web workers persist for the lifetime of the page and don't need heartbeats. The client bootstrap should detect `oncontrollerchange` events and re-init the service worker engine if the SW restarts. In web worker mode, losing the worker (e.g., page reload) simply means re-creating it — cached weights in IndexedDB make reload fast.
3. **Conversation context window** — When replaying history from IndexedDB into the `messages` array, long conversations will exceed the model's context window. Implement a sliding-window strategy: keep the system message, the first user message (for context), and the last N message pairs that fit within `context_window_size - max_tokens`. Expose this as a configurable parameter.
4. **Unified API surface** — The `fetchRouter` (web worker mode) must produce `Response` objects byte-identical to what the service worker's `FetchEvent.respondWith()` returns. Both paths should share the same `handler.ts` logic. Integration tests should verify that a UI consuming `/v1/chat/completions` gets identical behavior regardless of runtime.
5. **Model size constraints on mobile** — iOS devices have limited memory. Filter `prebuiltAppConfig.model_list` by `vram_required_MB` and `low_resource_required` to only surface models that are viable on the current device. The `GET /v1/models` endpoint should include a `compatible` boolean per model.
6. **Offline support** — Once model weights are cached in IndexedDB, the system should work fully offline (no network required). The service worker can serve the app shell from cache; the web worker path works offline by default since it doesn't depend on network intercepting.
