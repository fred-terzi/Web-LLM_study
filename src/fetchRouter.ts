/**
 * OpenAI-compatible fetch interceptor.
 *
 * Replaces globalThis.fetch with a wrapper that intercepts requests
 * matching OpenAI API patterns and routes them to the local
 * WebWorkerMLCEngine. Non-matching requests pass through to the
 * original fetch.
 */
import type { WebWorkerMLCEngine } from "@mlc-ai/web-llm";
import { prebuiltAppConfig } from "@mlc-ai/web-llm";

let _originalFetch: typeof globalThis.fetch | null = null;
let _engine: WebWorkerMLCEngine | null = null;

/**
 * Check if a URL should be intercepted.
 * Matches:
 *  - /v1/chat/completions
 *  - /v1/models
 *  - https://api.openai.com/v1/chat/completions
 *  - https://api.openai.com/v1/models
 */
function shouldIntercept(url: string): { match: boolean; route: string } {
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

  try {
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

    const { match, route } = shouldIntercept(url);

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
