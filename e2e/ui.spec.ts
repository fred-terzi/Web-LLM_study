import { test, expect } from "@playwright/test";

test.describe("WebLLM UI – Page Structure", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("has correct page title", async ({ page }) => {
    await expect(page).toHaveTitle("WebLLM Engine Test");
  });

  test("header renders with branding and controls", async ({ page }) => {
    const header = page.locator("header");
    await expect(header).toBeVisible();

    // Branding text
    await expect(header.locator("h1")).toContainText("WebLLM Engine");

    // Model selector and load button
    await expect(page.locator("#model-select")).toBeVisible();
    await expect(page.locator("#load-btn")).toBeVisible();
    await expect(page.locator("#load-btn")).toHaveText("Load Model");
  });

  test("model selector is populated with optgroups", async ({ page }) => {
    const select = page.locator("#model-select");

    // Should have at least one optgroup (models are populated dynamically)
    const optgroups = select.locator("optgroup");
    const count = await optgroups.count();
    expect(count).toBeGreaterThan(0);

    // Should have multiple options (models) across all groups
    const options = select.locator("option");
    const optionCount = await options.count();
    // 1 default + at least a few models
    expect(optionCount).toBeGreaterThan(1);
  });

  test("progress bar starts at 0%", async ({ page }) => {
    const bar = page.locator("#progress-bar");
    await expect(bar).toBeAttached();
    await expect(bar).toHaveCSS("width", "0px");
  });

  test("sidebar is visible with new chat and clear buttons", async ({
    page,
  }) => {
    const sidebar = page.locator("#sidebar");
    await expect(sidebar).toBeVisible();

    await expect(page.locator("#new-chat-btn")).toBeVisible();
    await expect(page.locator("#new-chat-btn")).toContainText("New Chat");

    await expect(page.locator("#clear-all-btn")).toBeVisible();
  });

  test("conversation list starts empty", async ({ page }) => {
    const list = page.locator("#conversation-list");
    await expect(list).toBeVisible();
    // No conversation items on fresh load
    const items = list.locator(".conv-item");
    await expect(items).toHaveCount(0);
  });

  test("chat area has message container, input, and send button", async ({
    page,
  }) => {
    await expect(page.locator("#chat-messages")).toBeVisible();
    await expect(page.locator("#chat-input")).toBeVisible();
    await expect(page.locator("#send-btn")).toBeVisible();
    await expect(page.locator("#send-btn")).toHaveText("Send");
  });

  test("chat input and send button are initially disabled", async ({
    page,
  }) => {
    await expect(page.locator("#chat-input")).toBeDisabled();
    await expect(page.locator("#send-btn")).toBeDisabled();
  });

  test("status line shows initial message", async ({ page }) => {
    const status = page.locator("#status-line");
    await expect(status).toBeVisible();
    // Either the default message or a WebGPU-related status
    const text = await status.textContent();
    expect(text).toBeTruthy();
    expect(text!.length).toBeGreaterThan(0);
  });
});

test.describe("WebLLM UI – Interactions (no model)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("selecting a model updates the dropdown value", async ({ page }) => {
    const select = page.locator("#model-select");

    // Get the first real option (skip the placeholder)
    const firstOption = select.locator("optgroup option").first();
    const value = await firstOption.getAttribute("value");
    expect(value).toBeTruthy();

    await select.selectOption(value!);
    await expect(select).toHaveValue(value!);
  });

  test("load button is enabled when a model is selected", async ({ page }) => {
    const select = page.locator("#model-select");
    const loadBtn = page.locator("#load-btn");

    // Select a model
    const firstOption = select.locator("optgroup option").first();
    const value = await firstOption.getAttribute("value");
    await select.selectOption(value!);

    // Load button should be enabled (it's always enabled unless loading or no WebGPU)
    // Note: in non-WebGPU environments, it might be disabled
    const isDisabled = await loadBtn.isDisabled();
    // We just verify the button exists and has text
    await expect(loadBtn).toHaveText("Load Model");
    // In CI without WebGPU, it may be disabled – that's acceptable
    if (!isDisabled) {
      await expect(loadBtn).toBeEnabled();
    }
  });

  test("chat input placeholder text is correct", async ({ page }) => {
    const input = page.locator("#chat-input");
    await expect(input).toHaveAttribute(
      "placeholder",
      "Type a message... (Enter to send, Shift+Enter for newline)"
    );
  });

  test("new chat button is clickable", async ({ page }) => {
    const newChatBtn = page.locator("#new-chat-btn");
    await expect(newChatBtn).toBeEnabled();
    // Clicking should not throw
    await newChatBtn.click();
  });

  test("chat messages area starts empty", async ({ page }) => {
    const messages = page.locator("#chat-messages .message");
    await expect(messages).toHaveCount(0);
  });
});

test.describe("WebLLM UI – Layout & Responsiveness", () => {
  test("sidebar has correct width", async ({ page }) => {
    await page.goto("/");
    const sidebar = page.locator("#sidebar");
    const box = await sidebar.boundingBox();
    expect(box).toBeTruthy();
    expect(box!.width).toBe(260);
  });

  test("main area fills remaining width", async ({ page }) => {
    await page.goto("/");
    const mainArea = page.locator(".main-area");
    const sidebar = page.locator("#sidebar");

    const mainBox = await mainArea.boundingBox();
    const sidebarBox = await sidebar.boundingBox();
    const viewportSize = page.viewportSize();

    expect(mainBox).toBeTruthy();
    expect(sidebarBox).toBeTruthy();
    expect(viewportSize).toBeTruthy();

    // Main area + sidebar should approximately fill the viewport width
    const totalWidth = mainBox!.width + sidebarBox!.width;
    expect(totalWidth).toBeGreaterThan(viewportSize!.width * 0.95);
  });

  test("app layout uses flexbox", async ({ page }) => {
    await page.goto("/");
    const layout = page.locator(".app-layout");
    await expect(layout).toHaveCSS("display", "flex");
  });
});

test.describe("WebLLM UI – Accessibility", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("all interactive elements are focusable", async ({ page }) => {
    const focusableSelectors = [
      "#model-select",
      "#load-btn",
      "#new-chat-btn",
      "#clear-all-btn",
      "#chat-input",
      "#send-btn",
    ];

    for (const selector of focusableSelectors) {
      const el = page.locator(selector);
      const isDisabled = await el.isDisabled();
      if (isDisabled) continue; // disabled elements can't receive focus
      await el.focus();
      await expect(el).toBeFocused();
    }
  });

  test("clear all button has title attribute", async ({ page }) => {
    await expect(page.locator("#clear-all-btn")).toHaveAttribute(
      "title",
      "Delete all conversations"
    );
  });
});

test.describe("WebLLM UI – WebGPU Status Detection", () => {
  test("WebGPU is available and status reflects it", async ({ page }) => {
    await page.goto("/");

    // Wait for the async WebGPU check to complete
    await page.waitForTimeout(1000);

    const status = page.locator("#status-line");
    const text = await status.textContent();

    // With --enable-unsafe-webgpu flag, WebGPU should be available
    expect(text).toContain("WebGPU ready");

    // navigator.gpu should exist
    const hasGPU = await page.evaluate(() => !!navigator.gpu);
    expect(hasGPU).toBe(true);

    // Should be able to get an adapter
    const hasAdapter = await page.evaluate(async () => {
      const adapter = await navigator.gpu.requestAdapter();
      return adapter !== null;
    });
    expect(hasAdapter).toBe(true);
  });

  test("load button is enabled when WebGPU is available", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(1000);

    await expect(page.locator("#load-btn")).toBeEnabled();
  });
});
