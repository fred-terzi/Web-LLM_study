# Plan: Web-LLM Web Worker with OpenAI Fetch Router & Persistent Conversations

An in-browser LLM runtime powered by `@mlc-ai/web-llm` running entirely in a **web worker**. Works on all WebGPU-capable browsers including iOS Safari 18+. Three deliverables, each building on the last.

---

## Deliverable 1 — Web Worker Engine + Test UI

A robust web worker that loads any available `@mlc-ai/web-llm` model and streams chat completions, plus a minimal test UI to drive it.

### Files

- `src/worker.ts` — web worker entry point
- `src/engine.ts` — main-thread engine client (thin wrapper around `CreateWebWorkerMLCEngine`)
- `src/main.ts` — test UI bootstrap
- `index.html` — test UI shell

### Steps

1. **Scaffold the project** — `npm init`, install `@mlc-ai/web-llm`, Vite, and TypeScript. Configure `vite.config.ts` for web worker bundling with `{ type: "module" }`.

2. **Web worker (`worker.ts`)** — Import and instantiate `WebWorkerMLCEngineHandler` from `@mlc-ai/web-llm`. This auto-registers a `self.onmessage` listener. The handler creates an internal `MLCEngine` instance. No other code needed — the handler speaks `@mlc-ai/web-llm`'s built-in message protocol for `reload`, `chatCompletion`, `chatCompletionStreamInit`, `chatCompletionStreamNextChunk`, etc.

3. **Engine client (`engine.ts`)** — Export a factory function:
   ```ts
   createEngine(modelId: string, onProgress: InitProgressCallback): Promise<WebWorkerMLCEngine>
   ```
   Internally: spawns the worker via `new Worker(new URL("./worker.ts", import.meta.url), { type: "module" })`, then calls `CreateWebWorkerMLCEngine(worker, modelId, { initProgressCallback: onProgress, appConfig: { useIndexedDBCache: true } })`. Also export helpers:
   - `getAvailableModels()` — returns `prebuiltAppConfig.model_list`.
   - `reloadModel(engine, modelId, onProgress)` — calls `engine.reload(modelId)` to swap models without re-creating the worker.

4. **Test UI (`index.html` + `main.ts`)** — A single-page test harness:
   - **Model selector**: dropdown populated from `prebuiltAppConfig.model_list`, grouped by size. A "Load" button triggers `createEngine()` or `reloadModel()`.
   - **Progress bar**: bound to `initProgressCallback`, shows download %, caching status, and load time.
   - **Chat area**: a scrollable message list + text input. On submit, calls `engine.chat.completions.create({ messages, stream: true })` and appends tokens to the assistant bubble as they arrive.
   - **Status line**: shows current model ID, VRAM usage, and tokens/sec from `chunk.usage`.

### Done when

- Can pick any model from the dropdown, watch it load with progress, send a message, and see streamed token-by-token output.
- Works on Chrome, Safari (macOS + iOS 18+), and Firefox (once WebGPU ships).
- Model weights are cached in IndexedDB; second load is near-instant.

---

## Deliverable 2 — OpenAI-Compatible Fetch Router

A client-side fetch interceptor that lets any UI built for the OpenAI API (e.g., Chatbot UI, Open WebUI) talk to the web worker engine instead.

### Files

- `src/fetchRouter.ts` — fetch interceptor
- `src/engine.ts` — updated to expose a singleton engine reference

### Steps

1. **Fetch router (`fetchRouter.ts`)** — Saves a reference to `globalThis.fetch`, then replaces it with a wrapper function. The wrapper inspects each request URL:
   - If it matches `/v1/chat/completions` **or** `https://api.openai.com/v1/chat/completions` → intercept.
   - If it matches `/v1/models` → intercept.
   - Otherwise → pass through to the original `fetch`.

2. **Chat completions interceptor** — For intercepted `POST /v1/chat/completions`:
   - Parse the JSON body.
   - Call `engine.chat.completions.create(body)` on the web worker engine.
   - **Non-streaming** (`stream` absent or `false`): await the result, return `new Response(JSON.stringify(result), { status: 200, headers: { "Content-Type": "application/json" } })`.
   - **Streaming** (`stream: true`): create a `ReadableStream`. In its `start(controller)`, iterate `for await (const chunk of asyncIterable)`, encode each as `data: ${JSON.stringify(chunk)}\n\n`, enqueue, then enqueue `data: [DONE]\n\n` and close. Return `new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } })`.

3. **Models interceptor** — For intercepted `GET /v1/models`:
   - Return a JSON response shaped like OpenAI's `GET /v1/models` endpoint: `{ object: "list", data: [ { id, object: "model", owned_by: "webllm" } ... ] }`.

4. **Installation API** — Export:
   ```ts
   installFetchRouter(engine: WebWorkerMLCEngine): void
   uninstallFetchRouter(): void
   ```
   `installFetchRouter` stashes the original fetch and installs the wrapper. `uninstallFetchRouter` restores the original. The test UI calls `installFetchRouter` after the engine is ready.

5. **Integration test** — Add a button to the test UI: "Test as OpenAI client". On click, fire a standard `fetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { "Authorization": "Bearer fake-key", "Content-Type": "application/json" }, body: JSON.stringify({ model: "gpt-4", messages: [...], stream: true }) })` and display the streamed SSE output — proving the router works transparently.

### Done when

- A `fetch` call shaped exactly like an OpenAI API request returns a valid streamed or non-streamed response from the local web worker engine.
- The `model` field in the request body is ignored (the currently-loaded model is used) or optionally triggers a `reloadModel` if it maps to a known web-llm model ID.
- `Authorization` headers are silently ignored.
- Calling `uninstallFetchRouter()` restores normal fetch behavior.

---

## Deliverable 3 — IndexedDB Persistent Conversations

Persist all prompt/response pairs into IndexedDB, support multiple named conversations, and replay history into new sessions.

### Files

- `src/db.ts` — `ConversationDB` class
- `src/engine.ts` — updated to wire persistence into chat completions
- `src/main.ts` — updated test UI with conversation management

### Schema

```ts
interface ConversationRecord {
  id: string;           // crypto.randomUUID()
  title: string;        // derived from first user message
  modelId: string;      // model used
  createdAt: number;    // Date.now()
  updatedAt: number;    // Date.now(), updated on each new message
}

interface MessageRecord {
  id: string;           // crypto.randomUUID()
  conversationId: string;
  role: "system" | "user" | "assistant";
  content: string;
  timestamp: number;
}
```

### Steps

1. **ConversationDB (`db.ts`)** — Opens `"webllm-conversations"` (version 1) with two object stores:
   - `conversations` — keyPath `"id"`, index on `"updatedAt"`.
   - `messages` — keyPath `"id"`, index on `"conversationId"`, index on `["conversationId", "timestamp"]` (compound, for ordered retrieval).
   
   Methods:
   - `open(): Promise<void>` — opens/upgrades the DB.
   - `createConversation(title, modelId): Promise<ConversationRecord>` — inserts a new record.
   - `listConversations(): Promise<ConversationRecord[]>` — returns all, sorted by `updatedAt` desc.
   - `getConversation(id): Promise<ConversationRecord | undefined>`.
   - `updateConversation(id, fields): Promise<void>` — partial update (title, updatedAt).
   - `deleteConversation(id): Promise<void>` — deletes the conversation and all its messages.
   - `saveMessage(msg: Omit<MessageRecord, "id">): Promise<MessageRecord>` — generates UUID, inserts, updates parent conversation's `updatedAt`.
   - `getMessages(conversationId): Promise<MessageRecord[]>` — returns all messages for a conversation, ordered by `timestamp` asc.
   - `clearAll(): Promise<void>` — nukes all data (for testing).

2. **Wire into chat completions (`engine.ts`)** — Add a wrapper function:
   ```ts
   sendMessage(engine, db, conversationId | null, userContent): AsyncIterable<ChatCompletionChunk>
   ```
   - If `conversationId` is null, create a new conversation (title = first 50 chars of `userContent`).
   - Load existing messages for the conversation from `db.getMessages()`.
   - Apply a sliding-window: keep system message + last N messages fitting within the model's context window.
   - Save the user message to DB immediately.
   - Call `engine.chat.completions.create({ messages, stream: true })`.
   - Accumulate the full assistant response as chunks stream.
   - After the stream ends, save the complete assistant message to DB.
   - Yield each chunk through so the caller still gets real-time streaming.

3. **Wire into fetch router (`fetchRouter.ts`)** — Update the chat completions interceptor:
   - Read `conversation_id` from the request body (optional extension field).
   - Route through `sendMessage()` instead of calling `engine.chat.completions.create()` directly.
   - Include `conversation_id` in the response body/chunks so the caller can track it.
   - Add interceptors for conversation management endpoints:
     - `GET /v1/conversations` → `db.listConversations()`
     - `POST /v1/conversations` → `db.createConversation()`
     - `GET /v1/conversations/:id/messages` → `db.getMessages(id)`
     - `DELETE /v1/conversations/:id` → `db.deleteConversation(id)`

4. **Update test UI** — Add a sidebar:
   - **Conversation list**: fetched from `db.listConversations()`. Click to load. "New chat" button.
   - **Delete**: swipe or button per conversation.
   - **Auto-title**: conversations are titled from the first user message, editable inline.
   - On page reload, the sidebar repopulates from IndexedDB. Selecting a conversation loads its message history and displays it. New messages append to the selected conversation.

### Done when

- Messages survive page reloads — reload the page, pick a conversation from the sidebar, see full history.
- Multiple conversations are independently tracked with correct message ordering.
- Deleting a conversation removes it and all its messages.
- The fetch router's `/v1/chat/completions` interceptor automatically persists messages.
- Conversation history is fed back into the model as context when continuing a conversation.
- Sliding-window prevents context overflow on long conversations.

---

## Project Structure

```
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
└── src/
    ├── worker.ts          # Web worker — WebWorkerMLCEngineHandler
    ├── engine.ts          # Main-thread engine client + sendMessage()
    ├── fetchRouter.ts     # OpenAI-compatible fetch interceptor
    ├── db.ts              # ConversationDB (IndexedDB)
    └── main.ts            # Test UI bootstrap
```

## Technical Notes

- **iOS compatibility**: Web workers support WebGPU on iOS Safari 18+. No service worker needed. Model weights cached in IndexedDB via `AppConfig.useIndexedDBCache: true` (Cache API is unreliable on iOS).
- **No keep-alive needed**: Web workers live for the page lifetime — no heartbeat mechanism required unlike service workers.
- **Context window management**: Sliding-window keeps system message + last N message pairs fitting within `context_window_size - max_tokens`. Configurable via a `maxContextMessages` parameter.
- **Model size on mobile**: Filter `prebuiltAppConfig.model_list` by `low_resource_required` and `vram_required_MB` to surface only viable models on constrained devices.
6. **Offline support** — Once model weights are cached in IndexedDB, the system should work fully offline (no network required). The service worker can serve the app shell from cache; the web worker path works offline by default since it doesn't depend on network intercepting.
