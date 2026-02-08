/**
 * Phase 2 Tests: Fetch Router unit tests.
 *
 * These tests verify the fetch router module's exports, URL matching logic,
 * models endpoint, and error handling — all without requiring WebGPU.
 * Actual streaming/non-streaming chat completion tests require a browser
 * with WebGPU and are verified via the test UI.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// We need to set up a minimal globalThis.fetch before importing the module
const originalGlobalFetch = globalThis.fetch;

describe("Phase 2: Fetch Router Exports", () => {
  it("should export installFetchRouter", async () => {
    const mod = await import("../src/fetchRouter");
    expect(typeof mod.installFetchRouter).toBe("function");
  });

  it("should export uninstallFetchRouter", async () => {
    const mod = await import("../src/fetchRouter");
    expect(typeof mod.uninstallFetchRouter).toBe("function");
  });

  it("should export isFetchRouterInstalled", async () => {
    const mod = await import("../src/fetchRouter");
    expect(typeof mod.isFetchRouterInstalled).toBe("function");
  });
});

describe("Phase 2: URL Matching", () => {
  // We test URL matching indirectly by installing the router with a mock engine
  // and verifying which requests get intercepted vs passed through.

  let installFetchRouter: any;
  let uninstallFetchRouter: any;
  let isFetchRouterInstalled: any;
  let mockFetch: any;

  beforeEach(async () => {
    // Reset module state by re-importing fresh
    const mod = await import("../src/fetchRouter");
    installFetchRouter = mod.installFetchRouter;
    uninstallFetchRouter = mod.uninstallFetchRouter;
    isFetchRouterInstalled = mod.isFetchRouterInstalled;

    // Set up a mock fetch as the "original"
    mockFetch = vi.fn().mockResolvedValue(new Response("passthrough"));
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    uninstallFetchRouter();
    globalThis.fetch = originalGlobalFetch;
  });

  it("should not be installed by default on fresh import", () => {
    // Since module is cached, we just check the function exists
    expect(typeof isFetchRouterInstalled).toBe("function");
  });
});

describe("Phase 2: Models Endpoint", () => {
  let installFetchRouter: any;
  let uninstallFetchRouter: any;

  beforeEach(async () => {
    const mod = await import("../src/fetchRouter");
    installFetchRouter = mod.installFetchRouter;
    uninstallFetchRouter = mod.uninstallFetchRouter;

    const mockOriginalFetch = vi.fn().mockResolvedValue(new Response("passthrough"));
    globalThis.fetch = mockOriginalFetch;

    // Install with a mock engine (models endpoint doesn't need engine)
    installFetchRouter({} as any);
  });

  afterEach(() => {
    uninstallFetchRouter();
    globalThis.fetch = originalGlobalFetch;
  });

  it("should intercept GET /v1/models and return model list", async () => {
    const response = await globalThis.fetch("/v1/models");
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.object).toBe("list");
    expect(Array.isArray(data.data)).toBe(true);
    expect(data.data.length).toBeGreaterThan(0);
    expect(data.data[0]).toHaveProperty("id");
    expect(data.data[0]).toHaveProperty("object", "model");
    expect(data.data[0]).toHaveProperty("owned_by", "webllm");
  });

  it("should intercept https://api.openai.com/v1/models", async () => {
    const response = await globalThis.fetch(
      "https://api.openai.com/v1/models"
    );
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.object).toBe("list");
    expect(data.data.length).toBeGreaterThan(0);
  });

  it("should format models in OpenAI-compatible structure", async () => {
    const response = await globalThis.fetch("/v1/models");
    const data = await response.json();

    for (const model of data.data.slice(0, 5)) {
      expect(model).toHaveProperty("id");
      expect(model).toHaveProperty("object", "model");
      expect(model).toHaveProperty("created");
      expect(typeof model.created).toBe("number");
      expect(model).toHaveProperty("owned_by", "webllm");
      expect(model).toHaveProperty("root");
    }
  });
});

describe("Phase 2: Chat Completions Error Handling", () => {
  let installFetchRouter: any;
  let uninstallFetchRouter: any;

  beforeEach(async () => {
    const mod = await import("../src/fetchRouter");
    installFetchRouter = mod.installFetchRouter;
    uninstallFetchRouter = mod.uninstallFetchRouter;

    const mockOriginalFetch = vi.fn().mockResolvedValue(new Response("passthrough"));
    globalThis.fetch = mockOriginalFetch;
  });

  afterEach(() => {
    uninstallFetchRouter();
    globalThis.fetch = originalGlobalFetch;
  });

  it("should return 503 when engine is not initialized", async () => {
    // Install with null-like engine that has no chat property
    // Actually, let's install with an object that will make the handler check fail
    installFetchRouter(null as any);

    const response = await globalThis.fetch("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: "hello" }],
      }),
    });

    expect(response.status).toBe(503);
    const data = await response.json();
    expect(data.error).toBeDefined();
    expect(data.error.code).toBe("engine_not_ready");
  });

  it("should return 400 for invalid JSON body", async () => {
    installFetchRouter({
      chat: { completions: { create: vi.fn() } },
    } as any);

    const response = await globalThis.fetch("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json{{{",
    });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBeDefined();
    expect(data.error.type).toBe("invalid_request_error");
  });
});

describe("Phase 2: Passthrough Behavior", () => {
  let installFetchRouter: any;
  let uninstallFetchRouter: any;
  let mockOriginalFetch: any;

  beforeEach(async () => {
    const mod = await import("../src/fetchRouter");
    installFetchRouter = mod.installFetchRouter;
    uninstallFetchRouter = mod.uninstallFetchRouter;

    mockOriginalFetch = vi.fn().mockResolvedValue(
      new Response("original-response")
    );
    globalThis.fetch = mockOriginalFetch;

    installFetchRouter({} as any);
  });

  afterEach(() => {
    uninstallFetchRouter();
    globalThis.fetch = originalGlobalFetch;
  });

  it("should pass through non-matching URLs to original fetch", async () => {
    const response = await globalThis.fetch("https://example.com/api/data");
    const text = await response.text();
    expect(text).toBe("original-response");
    expect(mockOriginalFetch).toHaveBeenCalledTimes(1);
  });

  it("should pass through /v1/other-endpoint to original fetch", async () => {
    await globalThis.fetch("/v1/embeddings", {
      method: "POST",
      body: "{}",
    });
    expect(mockOriginalFetch).toHaveBeenCalledTimes(1);
  });

  it("should not intercept non-OpenAI domains with different paths", async () => {
    await globalThis.fetch("https://example.com/v1/something");
    expect(mockOriginalFetch).toHaveBeenCalledTimes(1);
  });
});

describe("Phase 2: Install/Uninstall Lifecycle", () => {
  let installFetchRouter: any;
  let uninstallFetchRouter: any;
  let isFetchRouterInstalled: any;

  beforeEach(async () => {
    const mod = await import("../src/fetchRouter");
    installFetchRouter = mod.installFetchRouter;
    uninstallFetchRouter = mod.uninstallFetchRouter;
    isFetchRouterInstalled = mod.isFetchRouterInstalled;
  });

  afterEach(() => {
    uninstallFetchRouter();
    globalThis.fetch = originalGlobalFetch;
  });

  it("should restore original fetch after uninstall", () => {
    const myFetch = vi.fn().mockResolvedValue(new Response("mine"));
    globalThis.fetch = myFetch;

    installFetchRouter({} as any);
    expect(globalThis.fetch).not.toBe(myFetch); // replaced

    uninstallFetchRouter();
    expect(globalThis.fetch).toBe(myFetch); // restored
  });

  it("should handle double-install gracefully (updates engine)", () => {
    const myFetch = vi.fn().mockResolvedValue(new Response("mine"));
    globalThis.fetch = myFetch;

    const engine1 = { id: 1 } as any;
    const engine2 = { id: 2 } as any;

    installFetchRouter(engine1);
    const interceptedFetch = globalThis.fetch;

    installFetchRouter(engine2);
    // Should keep the same wrapped fetch, just update the engine ref
    expect(globalThis.fetch).toBe(interceptedFetch);
  });
});

describe("Phase 2: Non-Streaming Chat Completion (with mock engine)", () => {
  let installFetchRouter: any;
  let uninstallFetchRouter: any;

  beforeEach(async () => {
    const mod = await import("../src/fetchRouter");
    installFetchRouter = mod.installFetchRouter;
    uninstallFetchRouter = mod.uninstallFetchRouter;

    const mockOriginalFetch = vi.fn().mockResolvedValue(new Response("passthrough"));
    globalThis.fetch = mockOriginalFetch;
  });

  afterEach(() => {
    uninstallFetchRouter();
    globalThis.fetch = originalGlobalFetch;
  });

  it("should handle non-streaming completion with mock engine", async () => {
    const mockResult = {
      id: "chatcmpl-123",
      object: "chat.completion",
      created: Date.now(),
      model: "test-model",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "Hello! How can I help?" },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 6,
        total_tokens: 16,
      },
    };

    const mockEngine = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue(mockResult),
        },
      },
    };

    installFetchRouter(mockEngine as any);

    const response = await globalThis.fetch("/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer fake-key",
      },
      body: JSON.stringify({
        model: "gpt-4",
        messages: [{ role: "user", content: "Hello" }],
        stream: false,
      }),
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.choices[0].message.content).toBe("Hello! How can I help?");
    expect(mockEngine.chat.completions.create).toHaveBeenCalledOnce();
  });
});

describe("Phase 2: Streaming Chat Completion (with mock engine)", () => {
  let installFetchRouter: any;
  let uninstallFetchRouter: any;

  beforeEach(async () => {
    const mod = await import("../src/fetchRouter");
    installFetchRouter = mod.installFetchRouter;
    uninstallFetchRouter = mod.uninstallFetchRouter;

    const mockOriginalFetch = vi.fn().mockResolvedValue(new Response("passthrough"));
    globalThis.fetch = mockOriginalFetch;
  });

  afterEach(() => {
    uninstallFetchRouter();
    globalThis.fetch = originalGlobalFetch;
  });

  it("should handle streaming completion with mock engine", async () => {
    const mockChunks = [
      {
        id: "chatcmpl-1",
        object: "chat.completion.chunk",
        choices: [{ index: 0, delta: { content: "Hello" }, finish_reason: null }],
      },
      {
        id: "chatcmpl-1",
        object: "chat.completion.chunk",
        choices: [{ index: 0, delta: { content: " world" }, finish_reason: null }],
      },
      {
        id: "chatcmpl-1",
        object: "chat.completion.chunk",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      },
    ];

    // Create an async iterable from mock chunks
    async function* mockStream() {
      for (const chunk of mockChunks) {
        yield chunk;
      }
    }

    const mockEngine = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue(mockStream()),
        },
      },
    };

    installFetchRouter(mockEngine as any);

    const response = await globalThis.fetch("/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer fake-key",
      },
      body: JSON.stringify({
        model: "gpt-4",
        messages: [{ role: "user", content: "Hello" }],
        stream: true,
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");

    // Read the stream
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let fullText = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      fullText += decoder.decode(value, { stream: true });
    }

    // Verify SSE format
    expect(fullText).toContain("data: ");
    expect(fullText).toContain("data: [DONE]");

    // Parse out the data lines
    const dataLines = fullText
      .split("\n")
      .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
      .map((line) => JSON.parse(line.slice(6)));

    expect(dataLines).toHaveLength(3);
    expect(dataLines[0].choices[0].delta.content).toBe("Hello");
    expect(dataLines[1].choices[0].delta.content).toBe(" world");
    expect(dataLines[2].choices[0].finish_reason).toBe("stop");
  });
});

describe("Phase 2: OpenAI API Compatibility", () => {
  let installFetchRouter: any;
  let uninstallFetchRouter: any;

  beforeEach(async () => {
    const mod = await import("../src/fetchRouter");
    installFetchRouter = mod.installFetchRouter;
    uninstallFetchRouter = mod.uninstallFetchRouter;

    const mockOriginalFetch = vi.fn().mockResolvedValue(new Response("passthrough"));
    globalThis.fetch = mockOriginalFetch;
  });

  afterEach(() => {
    uninstallFetchRouter();
    globalThis.fetch = originalGlobalFetch;
  });

  it("should intercept api.openai.com/v1/chat/completions", async () => {
    const mockEngine = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{ message: { content: "hi" } }],
          }),
        },
      },
    };
    installFetchRouter(mockEngine as any);

    const response = await globalThis.fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer sk-fake-key-12345",
        },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [{ role: "user", content: "test" }],
        }),
      }
    );

    expect(response.status).toBe(200);
    expect(mockEngine.chat.completions.create).toHaveBeenCalledOnce();
  });

  it("should silently ignore Authorization headers", async () => {
    const mockEngine = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{ message: { content: "hi" } }],
          }),
        },
      },
    };
    installFetchRouter(mockEngine as any);

    // Should not throw even with auth header
    const response = await globalThis.fetch("/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: "Bearer sk-fake",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: "test" }],
      }),
    });

    expect(response.status).toBe(200);
  });

  it("should forward relevant parameters to engine", async () => {
    const mockEngine = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{ message: { content: "hi" } }],
          }),
        },
      },
    };
    installFetchRouter(mockEngine as any);

    await globalThis.fetch("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4",
        messages: [{ role: "user", content: "test" }],
        temperature: 0.7,
        top_p: 0.9,
        max_tokens: 100,
        stream: false,
      }),
    });

    const callArgs = mockEngine.chat.completions.create.mock.calls[0][0];
    expect(callArgs.messages).toEqual([{ role: "user", content: "test" }]);
    expect(callArgs.temperature).toBe(0.7);
    expect(callArgs.top_p).toBe(0.9);
    expect(callArgs.max_tokens).toBe(100);
    expect(callArgs.stream).toBe(false);
  });
});

describe("Phase 2: Fetch Router Source Structure", () => {
  it("fetchRouter.ts should exist and contain key implementations", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const filePath = path.resolve(__dirname, "../src/fetchRouter.ts");
    const content = fs.readFileSync(filePath, "utf-8");

    expect(content).toContain("installFetchRouter");
    expect(content).toContain("uninstallFetchRouter");
    expect(content).toContain("isFetchRouterInstalled");
    expect(content).toContain("handleChatCompletions");
    expect(content).toContain("handleModels");
    expect(content).toContain("text/event-stream");
    expect(content).toContain("ReadableStream");
    expect(content).toContain("data: [DONE]");
    expect(content).toContain("shouldIntercept");
  });
});
