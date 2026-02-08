/**
 * ConversationDB — IndexedDB persistence layer for conversations and messages.
 *
 * Works in both main thread and web worker contexts.
 * Model weights are cached separately by @mlc-ai/web-llm's built-in IndexedDB cache.
 */

export interface ConversationRecord {
  id: string;
  title: string;
  modelId: string;
  createdAt: number;
  updatedAt: number;
}

export interface MessageRecord {
  id: string;
  conversationId: string;
  role: "system" | "user" | "assistant";
  content: string;
  timestamp: number;
}

const DB_NAME = "webllm-conversations";
const DB_VERSION = 1;
const CONVERSATIONS_STORE = "conversations";
const MESSAGES_STORE = "messages";

export class ConversationDB {
  private db: IDBDatabase | null = null;

  /**
   * Open (or create/upgrade) the database.
   */
  async open(): Promise<void> {
    if (this.db) return;

    return new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        if (!db.objectStoreNames.contains(CONVERSATIONS_STORE)) {
          const convStore = db.createObjectStore(CONVERSATIONS_STORE, {
            keyPath: "id",
          });
          convStore.createIndex("updatedAt", "updatedAt", { unique: false });
        }

        if (!db.objectStoreNames.contains(MESSAGES_STORE)) {
          const msgStore = db.createObjectStore(MESSAGES_STORE, {
            keyPath: "id",
          });
          msgStore.createIndex("conversationId", "conversationId", {
            unique: false,
          });
          msgStore.createIndex("convTimestamp", ["conversationId", "timestamp"], {
            unique: false,
          });
        }
      };

      request.onsuccess = (event) => {
        this.db = (event.target as IDBOpenDBRequest).result;
        resolve();
      };

      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Ensure the database is open before performing operations.
   */
  private ensureOpen(): IDBDatabase {
    if (!this.db) {
      throw new Error("Database not open. Call open() first.");
    }
    return this.db;
  }

  /**
   * Create a new conversation.
   */
  async createConversation(
    title: string,
    modelId: string
  ): Promise<ConversationRecord> {
    const db = this.ensureOpen();
    const now = Date.now();
    const record: ConversationRecord = {
      id: crypto.randomUUID(),
      title,
      modelId,
      createdAt: now,
      updatedAt: now,
    };

    return new Promise((resolve, reject) => {
      const tx = db.transaction(CONVERSATIONS_STORE, "readwrite");
      const store = tx.objectStore(CONVERSATIONS_STORE);
      const req = store.add(record);
      req.onsuccess = () => resolve(record);
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * List all conversations, sorted by updatedAt descending (most recent first).
   */
  async listConversations(): Promise<ConversationRecord[]> {
    const db = this.ensureOpen();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(CONVERSATIONS_STORE, "readonly");
      const store = tx.objectStore(CONVERSATIONS_STORE);
      const index = store.index("updatedAt");
      const req = index.openCursor(null, "prev");
      const results: ConversationRecord[] = [];

      req.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor) {
          results.push(cursor.value);
          cursor.continue();
        } else {
          resolve(results);
        }
      };

      req.onerror = () => reject(req.error);
    });
  }

  /**
   * Get a single conversation by ID.
   */
  async getConversation(id: string): Promise<ConversationRecord | undefined> {
    const db = this.ensureOpen();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(CONVERSATIONS_STORE, "readonly");
      const store = tx.objectStore(CONVERSATIONS_STORE);
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result ?? undefined);
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * Update a conversation's fields (partial update).
   */
  async updateConversation(
    id: string,
    fields: Partial<Pick<ConversationRecord, "title" | "updatedAt" | "modelId">>
  ): Promise<void> {
    const db = this.ensureOpen();
    const existing = await this.getConversation(id);
    if (!existing) {
      throw new Error(`Conversation ${id} not found`);
    }

    const updated = { ...existing, ...fields };

    return new Promise((resolve, reject) => {
      const tx = db.transaction(CONVERSATIONS_STORE, "readwrite");
      const store = tx.objectStore(CONVERSATIONS_STORE);
      const req = store.put(updated);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * Delete a conversation and all its messages.
   */
  async deleteConversation(id: string): Promise<void> {
    const db = this.ensureOpen();

    // First delete all messages for this conversation
    const messages = await this.getMessages(id);

    return new Promise((resolve, reject) => {
      const tx = db.transaction(
        [CONVERSATIONS_STORE, MESSAGES_STORE],
        "readwrite"
      );
      const convStore = tx.objectStore(CONVERSATIONS_STORE);
      const msgStore = tx.objectStore(MESSAGES_STORE);

      convStore.delete(id);
      for (const msg of messages) {
        msgStore.delete(msg.id);
      }

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Save a message. Auto-generates an ID and updates the parent conversation's updatedAt.
   */
  async saveMessage(
    msg: Omit<MessageRecord, "id">
  ): Promise<MessageRecord> {
    const db = this.ensureOpen();
    const record: MessageRecord = {
      ...msg,
      id: crypto.randomUUID(),
    };

    return new Promise((resolve, reject) => {
      const tx = db.transaction(
        [MESSAGES_STORE, CONVERSATIONS_STORE],
        "readwrite"
      );
      const msgStore = tx.objectStore(MESSAGES_STORE);
      const convStore = tx.objectStore(CONVERSATIONS_STORE);

      msgStore.add(record);

      // Update conversation's updatedAt
      const getReq = convStore.get(msg.conversationId);
      getReq.onsuccess = () => {
        const conv = getReq.result;
        if (conv) {
          conv.updatedAt = msg.timestamp;
          convStore.put(conv);
        }
      };

      tx.oncomplete = () => resolve(record);
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Get all messages for a conversation, ordered by timestamp ascending.
   */
  async getMessages(conversationId: string): Promise<MessageRecord[]> {
    const db = this.ensureOpen();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(MESSAGES_STORE, "readonly");
      const store = tx.objectStore(MESSAGES_STORE);
      const index = store.index("convTimestamp");

      // Use a key range on the compound index [conversationId, timestamp]
      const range = IDBKeyRange.bound(
        [conversationId, 0],
        [conversationId, Number.MAX_SAFE_INTEGER]
      );

      const req = index.openCursor(range);
      const results: MessageRecord[] = [];

      req.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor) {
          results.push(cursor.value);
          cursor.continue();
        } else {
          resolve(results);
        }
      };

      req.onerror = () => reject(req.error);
    });
  }

  /**
   * Get the message count for a conversation.
   */
  async getMessageCount(conversationId: string): Promise<number> {
    const db = this.ensureOpen();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(MESSAGES_STORE, "readonly");
      const store = tx.objectStore(MESSAGES_STORE);
      const index = store.index("convTimestamp");

      const range = IDBKeyRange.bound(
        [conversationId, 0],
        [conversationId, Number.MAX_SAFE_INTEGER]
      );

      const req = index.count(range);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * Clear all data (for testing/reset).
   */
  async clearAll(): Promise<void> {
    const db = this.ensureOpen();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(
        [CONVERSATIONS_STORE, MESSAGES_STORE],
        "readwrite"
      );
      tx.objectStore(CONVERSATIONS_STORE).clear();
      tx.objectStore(MESSAGES_STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Close the database connection.
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
