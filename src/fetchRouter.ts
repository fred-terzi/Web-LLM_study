/**
 * OpenAI-compatible fetch interceptor.
 *
 * Replaces globalThis.fetch with a wrapper that intercepts requests
 * matching OpenAI API patterns and routes them to the local
 * WebWorkerMLCEngine. Non-matching requests pass through to the
 * original fetch.
 *
 * Phase 3 additions: conversation management endpoints.
 */
import type { WebWorkerMLCEngine } from "@mlc-ai/web-llm";
import { prebuiltAppConfig } from "@mlc-ai/web-llm";
import { getDB, sendMessage, getCurrentModelId } from "./engine";

let _originalFetch: typeof globalThis.fetch | null = null;
let _engine: WebWorkerMLCEngine | null = null;

/**
 * Check if a URL should be intercepted.
 * Matches:
 *  - /v1/chat/completions
 *  - /v1/models
 *  - /v1/conversations (and sub-paths)
 *  - https://api.openai.com/v1/...
 */
export function shouldIntercept(url: string): { match: boolean; route: string; params?: Record<string, string> } {
  try {
    const parsed = new URL(url, globalThis.location?.origin ?? "http://localhost");
    const path = parsed.pathname;

    if (
      path === "/v1/chat/completions" ||
      path.endsWith("/v1/chat/completions")
    ) {
      return { match: true, route: "chat-completions" };
    }
    if (path === "/v1/models" || path.endsWith("/v1/models")) {
      return { match: true, route: "models" };
    }

    // /v1/conversations/:id/messages
    const msgMatch = path.match(/\/v1\/conversations\/([^/]+)\/messages$/);
    if (msgMatch) {
      return { match: true, route: "conversation-messages", params: { id: msgMatch[1] } };
    }

    // /v1/conversations/:id
    const convIdMatch = path.match(/\/v1\/conversations\/([^/]+)$/);
    if (convIdMatch) {
      return { match: true, route: "conversation-detail", params: { id: convIdMatch[1] } };
    }

    // /v1/conversations
    if (path === "/v1/conversations" || path.endsWith("/v1/conversations")) {
      return { match: true, route: "conversations" };
    }

    return { match: false, route: "" };
  } catch {
    return { match: false, route: "" };
  }
}

/**
 * Handle GET /v1/models — return available models in OpenAI format.
 */
function handleModels(): Response {
  const models = prebuiltAppConfig.model_list.map((m) => ({
    id: m.model_id,
    object: "model" as const,
    created: Math.floor(Date.now() / 1000),
    owned_by: "webllm",
    permission: [],
    root: m.model_id,
    parent: null,
  }));

  return new Response(
    JSON.stringify({ object: "list", data: models }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
}

/**
 * Handle POST /v1/chat/completions — route to local engine.
 * Supports both streaming and non-streaming.
 * Phase 3: if `conversation_id` is present in body, uses sendMessage() for persistence.
 */
async function handleChatCompletions(request: Request): Promise<Response> {
  if (!_engine) {
    return new Response(
      JSON.stringify({
        error: {
          message: "WebLLM engine not initialized. Load a model first.",
          type: "server_error",
          code: "engine_not_ready",
        },
      }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return new Response(
      JSON.stringify({
        error: {
          message: "Invalid JSON in request body.",
          type: "invalid_request_error",
        },
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const isStreaming = body.stream === true;
  const conversationId: string | null = body.conversation_id ?? null;

  try {
    // If conversation_id is provided (or requested), use sendMessage for persistence
    if (conversationId !== null || body.persist === true) {
      return await handlePersistentCompletion(body, conversationId, isStreaming);
    }

    if (isStreaming) {
      return handleStreamingCompletion(body);
    } else {
      return await handleNonStreamingCompletion(body);
    }
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: {
          message: (err as Error).message,
          type: "server_error",
        },
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

/**
 * Handle a persistent completion — uses sendMessage() from engine.ts
 * to store the conversation in IndexedDB.
 */
async function handlePersistentCompletion(
  body: any,
  conversationId: string | null,
  isStreaming: boolean
): Promise<Response> {
  // Extract the last user message from the messages array
  const userMessages = (body.messages ?? []).filter(
    (m: any) => m.role === "user"
  );
  const lastUserMessage = userMessages[userMessages.length - 1];

  if (!lastUserMessage) {
    return new Response(
      JSON.stringify({
        error: {
          message: "No user message found in messages array.",
          type: "invalid_request_error",
        },
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Extract system prompt if present
  const systemMessage = (body.messages ?? []).find(
    (m: any) => m.role === "system"
  );

  const { conversationId: convId, stream } = await sendMessage(
    lastUserMessage.content,
    conversationId,
    {
      systemPrompt: systemMessage?.content,
      temperature: body.temperature,
      maxTokens: body.max_tokens ?? body.max_completion_tokens,
    }
  );

  if (isStreaming) {
    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            // Inject conversation_id into the chunk
            const augmented = { ...chunk, conversation_id: convId };
            const data = `data: ${JSON.stringify(augmented)}\n\n`;
            controller.enqueue(encoder.encode(data));
          }
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        } catch (err) {
          const errorData = `data: ${JSON.stringify({
            error: { message: (err as Error).message, type: "server_error" },
          })}\n\n`;
          controller.enqueue(encoder.encode(errorData));
          controller.close();
        }
      },
    });

    return new Response(readable, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } else {
    // Non-streaming: consume the entire stream
    let fullContent = "";
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content ?? "";
      fullContent += delta;
    }

    return new Response(
      JSON.stringify({
        id: `chatcmpl-${crypto.randomUUID()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: getCurrentModelId() ?? "webllm",
        conversation_id: convId,
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: fullContent },
            finish_reason: "stop",
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }
}

/**
 * Non-streaming chat completion.
 */
async function handleNonStreamingCompletion(body: any): Promise<Response> {
  const result = await _engine!.chat.completions.create({
    messages: body.messages,
    temperature: body.temperature,
    top_p: body.top_p,
    max_tokens: body.max_tokens ?? body.max_completion_tokens,
    frequency_penalty: body.frequency_penalty,
    presence_penalty: body.presence_penalty,
    stop: body.stop,
    n: body.n,
    stream: false,
  });

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Streaming chat completion — returns SSE text/event-stream.
 */
function handleStreamingCompletion(body: any): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const chunks = await _engine!.chat.completions.create({
          messages: body.messages,
          temperature: body.temperature,
          top_p: body.top_p,
          max_tokens: body.max_tokens ?? body.max_completion_tokens,
          frequency_penalty: body.frequency_penalty,
          presence_penalty: body.presence_penalty,
          stop: body.stop,
          n: body.n,
          stream: true,
          stream_options: body.stream_options,
        });

        for await (const chunk of chunks as AsyncIterable<any>) {
          const data = `data: ${JSON.stringify(chunk)}\n\n`;
          controller.enqueue(encoder.encode(data));
        }

        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (err) {
        const errorData = `data: ${JSON.stringify({
          error: { message: (err as Error).message, type: "server_error" },
        })}\n\n`;
        controller.enqueue(encoder.encode(errorData));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

/**
 * Handle /v1/conversations — list (GET) or create (POST).
 */
async function handleConversations(request: Request): Promise<Response> {
  const db = await getDB();
  const method = request.method?.toUpperCase() ?? "GET";

  if (method === "GET") {
    const conversations = await db.listConversations();
    return new Response(
      JSON.stringify({ object: "list", data: conversations }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  if (method === "POST") {
    let body: any;
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const title = body.title ?? "New Conversation";
    const modelId = body.model_id ?? getCurrentModelId() ?? "unknown";
    const conv = await db.createConversation(title, modelId);
    return new Response(JSON.stringify(conv), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(
    JSON.stringify({ error: { message: "Method not allowed" } }),
    { status: 405, headers: { "Content-Type": "application/json" } }
  );
}

/**
 * Handle /v1/conversations/:id — get (GET), update (PATCH), delete (DELETE).
 */
async function handleConversationDetail(
  request: Request,
  id: string
): Promise<Response> {
  const db = await getDB();
  const method = request.method?.toUpperCase() ?? "GET";

  if (method === "GET") {
    const conv = await db.getConversation(id);
    if (!conv) {
      return new Response(
        JSON.stringify({ error: { message: "Conversation not found" } }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response(JSON.stringify(conv), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (method === "PATCH" || method === "PUT") {
    let body: any;
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    try {
      await db.updateConversation(id, {
        title: body.title,
        modelId: body.model_id,
        updatedAt: Date.now(),
      });
      const updated = await db.getConversation(id);
      return new Response(JSON.stringify(updated), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      return new Response(
        JSON.stringify({ error: { message: (err as Error).message } }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }
  }

  if (method === "DELETE") {
    try {
      await db.deleteConversation(id);
      return new Response(
        JSON.stringify({ deleted: true, id }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    } catch (err) {
      return new Response(
        JSON.stringify({ error: { message: (err as Error).message } }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  }

  return new Response(
    JSON.stringify({ error: { message: "Method not allowed" } }),
    { status: 405, headers: { "Content-Type": "application/json" } }
  );
}

/**
 * Handle /v1/conversations/:id/messages — list messages for a conversation.
 */
async function handleConversationMessages(
  request: Request,
  conversationId: string
): Promise<Response> {
  const db = await getDB();
  const method = request.method?.toUpperCase() ?? "GET";

  if (method === "GET") {
    const conv = await db.getConversation(conversationId);
    if (!conv) {
      return new Response(
        JSON.stringify({ error: { message: "Conversation not found" } }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }
    const messages = await db.getMessages(conversationId);
    return new Response(
      JSON.stringify({ object: "list", data: messages, conversation_id: conversationId }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  return new Response(
    JSON.stringify({ error: { message: "Method not allowed" } }),
    { status: 405, headers: { "Content-Type": "application/json" } }
  );
}

/**
 * Install the fetch router. Replaces globalThis.fetch with an intercepting wrapper.
 * Call this after the engine is loaded and ready.
 */
export function installFetchRouter(engine: WebWorkerMLCEngine): void {
  if (_originalFetch) {
    // Already installed — just update the engine reference
    _engine = engine;
    return;
  }

  _originalFetch = globalThis.fetch;
  _engine = engine;

  globalThis.fetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input instanceof Request
            ? input.url
            : String(input);

    const { match, route, params } = shouldIntercept(url);

    if (!match) {
      return _originalFetch!(input, init);
    }

    switch (route) {
      case "models":
        return handleModels();
      case "chat-completions": {
        // Build a Request object for the handler.
        // For relative URLs (no origin), construct with a base so Node tests work.
        let request: Request;
        if (input instanceof Request) {
          request = input;
        } else {
          try {
            request = new Request(url, init);
          } catch {
            // Relative URL — add a dummy base for Request construction
            request = new Request(new URL(url, "http://localhost").toString(), init);
          }
        }
        return handleChatCompletions(request);
      }
      case "conversations": {
        let request: Request;
        if (input instanceof Request) {
          request = input;
        } else {
          try {
            request = new Request(url, init);
          } catch {
            request = new Request(new URL(url, "http://localhost").toString(), init);
          }
        }
        return handleConversations(request);
      }
      case "conversation-detail": {
        let request: Request;
        if (input instanceof Request) {
          request = input;
        } else {
          try {
            request = new Request(url, init);
          } catch {
            request = new Request(new URL(url, "http://localhost").toString(), init);
          }
        }
        return handleConversationDetail(request, params!.id);
      }
      case "conversation-messages": {
        let request: Request;
        if (input instanceof Request) {
          request = input;
        } else {
          try {
            request = new Request(url, init);
          } catch {
            request = new Request(new URL(url, "http://localhost").toString(), init);
          }
        }
        return handleConversationMessages(request, params!.id);
      }
      default:
        return _originalFetch!(input, init);
    }
  }) as typeof globalThis.fetch;
}

/**
 * Uninstall the fetch router. Restores the original globalThis.fetch.
 */
export function uninstallFetchRouter(): void {
  if (_originalFetch) {
    globalThis.fetch = _originalFetch;
    _originalFetch = null;
  }
  _engine = null;
}

/**
 * Check whether the fetch router is currently installed.
 */
export function isFetchRouterInstalled(): boolean {
  return _originalFetch !== null;
}
