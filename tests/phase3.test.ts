/**
 * Phase 3 Tests: IndexedDB persistence, conversation management,
 * sliding window, sendMessage flow, and fetch router conversation endpoints.
 *
 * Uses fake-indexeddb to provide a real IndexedDB implementation in Node.js.
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";
import "fake-indexeddb/auto";

// ─── ConversationDB Direct Tests ────────────────────────────────────

describe("Phase 3: ConversationDB", () => {
  let ConversationDB: typeof import("../src/db").ConversationDB;
  let db: InstanceType<typeof ConversationDB>;

  beforeAll(async () => {
    const mod = await import("../src/db");
    ConversationDB = mod.ConversationDB;
  });

  beforeEach(async () => {
    db = new ConversationDB();
    await db.open();
    await db.clearAll();
  });

  afterEach(() => {
    db.close();
  });

  it("should create and retrieve a conversation", async () => {
    const conv = await db.createConversation("Test Chat", "test-model");
    expect(conv.id).toBeDefined();
    expect(conv.title).toBe("Test Chat");
    expect(conv.modelId).toBe("test-model");
    expect(conv.createdAt).toBeGreaterThan(0);
    expect(conv.updatedAt).toBe(conv.createdAt);

    const retrieved = await db.getConversation(conv.id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.title).toBe("Test Chat");
  });

  it("should list conversations sorted by updatedAt desc", async () => {
    const c1 = await db.createConversation("First", "model-a");
    // Ensure different timestamps
    await new Promise((r) => setTimeout(r, 10));
    const c2 = await db.createConversation("Second", "model-b");
    await new Promise((r) => setTimeout(r, 10));
    const c3 = await db.createConversation("Third", "model-c");

    const list = await db.listConversations();
    expect(list.length).toBe(3);
    // Most recent first
    expect(list[0].title).toBe("Third");
    expect(list[1].title).toBe("Second");
    expect(list[2].title).toBe("First");
  });

  it("should update a conversation title", async () => {
    const conv = await db.createConversation("Original", "model");
    await db.updateConversation(conv.id, { title: "Updated Title" });
    const updated = await db.getConversation(conv.id);
    expect(updated!.title).toBe("Updated Title");
  });

  it("should delete a conversation and its messages", async () => {
    const conv = await db.createConversation("ToDelete", "model");
    await db.saveMessage({
      conversationId: conv.id,
      role: "user",
      content: "Hello",
      timestamp: Date.now(),
    });
    await db.saveMessage({
      conversationId: conv.id,
      role: "assistant",
      content: "Hi there",
      timestamp: Date.now(),
    });

    expect(await db.getMessageCount(conv.id)).toBe(2);

    await db.deleteConversation(conv.id);

    expect(await db.getConversation(conv.id)).toBeUndefined();
    expect(await db.getMessageCount(conv.id)).toBe(0);
  });

  it("should save and retrieve messages in timestamp order", async () => {
    const conv = await db.createConversation("Chat", "model");

    await db.saveMessage({
      conversationId: conv.id,
      role: "user",
      content: "Hello",
      timestamp: 1000,
    });
    await db.saveMessage({
      conversationId: conv.id,
      role: "assistant",
      content: "Hi",
      timestamp: 2000,
    });
    await db.saveMessage({
      conversationId: conv.id,
      role: "user",
      content: "How are you?",
      timestamp: 3000,
    });

    const messages = await db.getMessages(conv.id);
    expect(messages.length).toBe(3);
    expect(messages[0].content).toBe("Hello");
    expect(messages[1].content).toBe("Hi");
    expect(messages[2].content).toBe("How are you?");
  });

  it("should auto-generate message IDs", async () => {
    const conv = await db.createConversation("Chat", "model");
    const msg = await db.saveMessage({
      conversationId: conv.id,
      role: "user",
      content: "Test",
      timestamp: Date.now(),
    });
    expect(msg.id).toBeDefined();
    expect(typeof msg.id).toBe("string");
    expect(msg.id.length).toBeGreaterThan(0);
  });

  it("should update conversation updatedAt when saving a message", async () => {
    const conv = await db.createConversation("Chat", "model");
    const originalUpdatedAt = conv.updatedAt;

    await new Promise((r) => setTimeout(r, 10));

    await db.saveMessage({
      conversationId: conv.id,
      role: "user",
      content: "Hello",
      timestamp: Date.now(),
    });

    const updated = await db.getConversation(conv.id);
    expect(updated!.updatedAt).toBeGreaterThan(originalUpdatedAt);
  });

  it("should return correct message count", async () => {
    const conv = await db.createConversation("Chat", "model");
    expect(await db.getMessageCount(conv.id)).toBe(0);

    await db.saveMessage({
      conversationId: conv.id,
      role: "user",
      content: "1",
      timestamp: 1000,
    });
    expect(await db.getMessageCount(conv.id)).toBe(1);

    await db.saveMessage({
      conversationId: conv.id,
      role: "assistant",
      content: "2",
      timestamp: 2000,
    });
    expect(await db.getMessageCount(conv.id)).toBe(2);
  });

  it("should isolate messages between conversations", async () => {
    const c1 = await db.createConversation("Conv1", "model");
    const c2 = await db.createConversation("Conv2", "model");

    await db.saveMessage({ conversationId: c1.id, role: "user", content: "A", timestamp: 1000 });
    await db.saveMessage({ conversationId: c1.id, role: "user", content: "B", timestamp: 2000 });
    await db.saveMessage({ conversationId: c2.id, role: "user", content: "X", timestamp: 3000 });

    expect(await db.getMessageCount(c1.id)).toBe(2);
    expect(await db.getMessageCount(c2.id)).toBe(1);

    const msgs1 = await db.getMessages(c1.id);
    expect(msgs1.map((m) => m.content)).toEqual(["A", "B"]);

    const msgs2 = await db.getMessages(c2.id);
    expect(msgs2.map((m) => m.content)).toEqual(["X"]);
  });

  it("should clear all data", async () => {
    await db.createConversation("C1", "model");
    await db.createConversation("C2", "model");

    await db.clearAll();

    const list = await db.listConversations();
    expect(list.length).toBe(0);
  });

  it("should throw when updating non-existent conversation", async () => {
    await expect(
      db.updateConversation("non-existent-id", { title: "Nope" })
    ).rejects.toThrow("not found");
  });

  it("should return undefined for non-existent conversation", async () => {
    const result = await db.getConversation("does-not-exist");
    expect(result).toBeUndefined();
  });
});

// ─── Sliding Window Tests ───────────────────────────────────────────

describe("Phase 3: Sliding Window", () => {
  it("should pass through messages under the limit", async () => {
    const { applySlidingWindow } = await import("../src/engine");
    const messages = [
      { role: "user" as const, content: "Hello" },
      { role: "assistant" as const, content: "Hi" },
    ];
    const result = applySlidingWindow(messages, 50);
    expect(result).toEqual(messages);
  });

  it("should trim messages over the limit", async () => {
    const { applySlidingWindow } = await import("../src/engine");
    const messages = Array.from({ length: 10 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `Message ${i}`,
    }));

    const result = applySlidingWindow(messages, 4);
    expect(result.length).toBe(4);
    // Should keep the last 4
    expect(result[0].content).toBe("Message 6");
    expect(result[3].content).toBe("Message 9");
  });

  it("should preserve system messages when trimming", async () => {
    const { applySlidingWindow } = await import("../src/engine");
    const messages = [
      { role: "system" as const, content: "You are helpful." },
      ...Array.from({ length: 10 }, (_, i) => ({
        role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
        content: `Msg ${i}`,
      })),
    ];

    const result = applySlidingWindow(messages, 4);
    // System message + last 4 non-system
    expect(result.length).toBe(5);
    expect(result[0].role).toBe("system");
    expect(result[0].content).toBe("You are helpful.");
    expect(result[1].content).toBe("Msg 6");
    expect(result[4].content).toBe("Msg 9");
  });

  it("should not drop system messages even with maxMessages=1", async () => {
    const { applySlidingWindow } = await import("../src/engine");
    const messages = [
      { role: "system" as const, content: "System prompt" },
      { role: "user" as const, content: "1" },
      { role: "assistant" as const, content: "2" },
      { role: "user" as const, content: "3" },
    ];

    const result = applySlidingWindow(messages, 1);
    expect(result.length).toBe(2); // system + last 1
    expect(result[0].role).toBe("system");
    expect(result[1].content).toBe("3");
  });
});

// ─── Engine Module Phase 3 Exports ──────────────────────────────────

describe("Phase 3: Engine Exports", () => {
  it("should export sendMessage function", async () => {
    const mod = await import("../src/engine");
    expect(typeof mod.sendMessage).toBe("function");
  });

  it("should export getDB function", async () => {
    const mod = await import("../src/engine");
    expect(typeof mod.getDB).toBe("function");
  });

  it("should export getCurrentModelId function", async () => {
    const mod = await import("../src/engine");
    expect(typeof mod.getCurrentModelId).toBe("function");
  });

  it("should export applySlidingWindow function", async () => {
    const mod = await import("../src/engine");
    expect(typeof mod.applySlidingWindow).toBe("function");
  });

  it("should export ConversationRecord type (via re-export)", async () => {
    // This is a type-only export, so we just check the module doesn't error
    const mod = await import("../src/engine");
    expect(mod).toBeDefined();
  });

  it("sendMessage should throw when engine not initialized", async () => {
    const { sendMessage } = await import("../src/engine");
    await expect(sendMessage("hello")).rejects.toThrow("Engine not initialized");
  });
});

// ─── Fetch Router Conversation Endpoints ────────────────────────────

describe("Phase 3: Fetch Router URL Matching (conversations)", () => {
  let shouldIntercept: any;

  beforeAll(async () => {
    const mod = await import("../src/fetchRouter");
    shouldIntercept = mod.shouldIntercept;
  });

  it("should match /v1/conversations", () => {
    const result = shouldIntercept("/v1/conversations");
    expect(result.match).toBe(true);
    expect(result.route).toBe("conversations");
  });

  it("should match /v1/conversations/:id", () => {
    const result = shouldIntercept("/v1/conversations/abc-123");
    expect(result.match).toBe(true);
    expect(result.route).toBe("conversation-detail");
    expect(result.params?.id).toBe("abc-123");
  });

  it("should match /v1/conversations/:id/messages", () => {
    const result = shouldIntercept("/v1/conversations/abc-123/messages");
    expect(result.match).toBe(true);
    expect(result.route).toBe("conversation-messages");
    expect(result.params?.id).toBe("abc-123");
  });

  it("should still match /v1/chat/completions", () => {
    const result = shouldIntercept("/v1/chat/completions");
    expect(result.match).toBe(true);
    expect(result.route).toBe("chat-completions");
  });

  it("should still match /v1/models", () => {
    const result = shouldIntercept("/v1/models");
    expect(result.match).toBe(true);
    expect(result.route).toBe("models");
  });

  it("should not match unrelated paths", () => {
    const result = shouldIntercept("/v1/embeddings");
    expect(result.match).toBe(false);
  });
});

describe("Phase 3: Fetch Router Conversation CRUD", () => {
  let installFetchRouter: any;
  let uninstallFetchRouter: any;
  const originalGlobalFetch = globalThis.fetch;

  beforeEach(async () => {
    const mod = await import("../src/fetchRouter");
    installFetchRouter = mod.installFetchRouter;
    uninstallFetchRouter = mod.uninstallFetchRouter;

    const mockOriginalFetch = vi.fn().mockResolvedValue(new Response("passthrough"));
    globalThis.fetch = mockOriginalFetch;

    // Install with a mock engine
    installFetchRouter({} as any);
  });

  afterEach(() => {
    uninstallFetchRouter();
    globalThis.fetch = originalGlobalFetch;
  });

  it("should create a conversation via POST /v1/conversations", async () => {
    const response = await globalThis.fetch("/v1/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Test Conv", model_id: "test-model" }),
    });

    expect(response.status).toBe(201);
    const data = await response.json();
    expect(data.id).toBeDefined();
    expect(data.title).toBe("Test Conv");
    expect(data.modelId).toBe("test-model");
  });

  it("should list conversations via GET /v1/conversations", async () => {
    // Create a couple first
    await globalThis.fetch("/v1/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Conv A" }),
    });
    await globalThis.fetch("/v1/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Conv B" }),
    });

    const response = await globalThis.fetch("/v1/conversations");
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.object).toBe("list");
    expect(data.data.length).toBeGreaterThanOrEqual(2);
  });

  it("should get a single conversation via GET /v1/conversations/:id", async () => {
    const createResp = await globalThis.fetch("/v1/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Detail Test" }),
    });
    const created = await createResp.json();

    const response = await globalThis.fetch(`/v1/conversations/${created.id}`);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.id).toBe(created.id);
    expect(data.title).toBe("Detail Test");
  });

  it("should return 404 for non-existent conversation", async () => {
    const response = await globalThis.fetch("/v1/conversations/non-existent");
    expect(response.status).toBe(404);
  });

  it("should delete a conversation via DELETE /v1/conversations/:id", async () => {
    const createResp = await globalThis.fetch("/v1/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "To Delete" }),
    });
    const created = await createResp.json();

    const delResp = await globalThis.fetch(`/v1/conversations/${created.id}`, {
      method: "DELETE",
    });
    expect(delResp.status).toBe(200);
    const delData = await delResp.json();
    expect(delData.deleted).toBe(true);

    // Verify it's gone
    const getResp = await globalThis.fetch(`/v1/conversations/${created.id}`);
    expect(getResp.status).toBe(404);
  });

  it("should update a conversation via PATCH /v1/conversations/:id", async () => {
    const createResp = await globalThis.fetch("/v1/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Before" }),
    });
    const created = await createResp.json();

    const patchResp = await globalThis.fetch(`/v1/conversations/${created.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "After" }),
    });
    expect(patchResp.status).toBe(200);
    const updated = await patchResp.json();
    expect(updated.title).toBe("After");
  });
});

// ─── Source File Structure ──────────────────────────────────────────

describe("Phase 3: Source File Structure", () => {
  it("db.ts should exist with all required exports", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const filePath = path.resolve(__dirname, "../src/db.ts");
    const content = fs.readFileSync(filePath, "utf-8");

    expect(content).toContain("ConversationDB");
    expect(content).toContain("ConversationRecord");
    expect(content).toContain("MessageRecord");
    expect(content).toContain("createConversation");
    expect(content).toContain("listConversations");
    expect(content).toContain("getConversation");
    expect(content).toContain("updateConversation");
    expect(content).toContain("deleteConversation");
    expect(content).toContain("saveMessage");
    expect(content).toContain("getMessages");
    expect(content).toContain("getMessageCount");
    expect(content).toContain("clearAll");
    expect(content).toContain("indexedDB");
  });

  it("engine.ts should have Phase 3 functions", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const filePath = path.resolve(__dirname, "../src/engine.ts");
    const content = fs.readFileSync(filePath, "utf-8");

    expect(content).toContain("sendMessage");
    expect(content).toContain("applySlidingWindow");
    expect(content).toContain("getDB");
    expect(content).toContain("getCurrentModelId");
    expect(content).toContain("ConversationDB");
    expect(content).toContain("persistedStream");
  });

  it("fetchRouter.ts should have conversation endpoints", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const filePath = path.resolve(__dirname, "../src/fetchRouter.ts");
    const content = fs.readFileSync(filePath, "utf-8");

    expect(content).toContain("handleConversations");
    expect(content).toContain("handleConversationDetail");
    expect(content).toContain("handleConversationMessages");
    expect(content).toContain("conversation-messages");
    expect(content).toContain("conversation-detail");
    expect(content).toContain("conversation_id");
    expect(content).toContain("handlePersistentCompletion");
  });

  it("index.html should have conversation sidebar elements", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const filePath = path.resolve(__dirname, "../index.html");
    const content = fs.readFileSync(filePath, "utf-8");

    expect(content).toContain('id="sidebar"');
    expect(content).toContain('id="new-chat-btn"');
    expect(content).toContain('id="conversation-list"');
    expect(content).toContain('id="settings-backdrop"');
  });

  it("app.ts should use fetch router and manage conversations", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const filePath = path.resolve(__dirname, "../src/app.ts");
    const content = fs.readFileSync(filePath, "utf-8");

    expect(content).toContain("installFetchRouter");
    expect(content).toContain("handleSendMessage");
    expect(content).toContain("refreshConversationList");
    expect(content).toContain("handleSelectConversation");
    expect(content).toContain("handleDeleteConversation");
    expect(content).toContain("handleNewChat");
    expect(content).toContain("handleClearAll");
    expect(content).toContain("getDB");
  });
});
