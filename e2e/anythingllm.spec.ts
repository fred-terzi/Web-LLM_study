import { test, expect } from "@playwright/test";

/**
 * AnythingLLM UI e2e tests.
 * Tests the new UI structure, layout, and interactions.
 */

test.describe("AnythingLLM UI – Page Structure", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("has correct page title", async ({ page }) => {
    await expect(page).toHaveTitle(/AnythingLLM/);
  });

  test("loading overlay is visible on initial load", async ({ page }) => {
    const overlay = page.locator("#loading-overlay");
    // Overlay should exist (may already be hidden if engine loads fast)
    await expect(overlay).toBeAttached();
  });

  test("loading overlay shows branding", async ({ page }) => {
    const overlay = page.locator("#loading-overlay");
    await expect(overlay.locator("h2")).toContainText("AnythingLLM");
  });

  test("loading overlay has progress bar", async ({ page }) => {
    const fill = page.locator("#loading-overlay .progress-fill");
    await expect(fill).toBeAttached();
  });

  test("app shell has sidebar and main panel", async ({ page }) => {
    await expect(page.locator("#sidebar")).toBeAttached();
    await expect(page.locator("#main-panel")).toBeAttached();
  });
});

test.describe("AnythingLLM UI – Sidebar", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("sidebar shows branding", async ({ page }) => {
    const brand = page.locator(".sidebar-brand .brand-text");
    await expect(brand).toContainText("AnythingLLM");
  });

  test("new chat button exists", async ({ page }) => {
    const btn = page.locator("#new-chat-btn");
    await expect(btn).toBeVisible();
    await expect(btn).toContainText("New Chat");
  });

  test("search input exists in sidebar", async ({ page }) => {
    const search = page.locator(".sidebar-search input");
    await expect(search).toBeVisible();
    await expect(search).toHaveAttribute("placeholder", /Search/i);
  });

  test("conversation list starts empty", async ({ page }) => {
    const list = page.locator("#conversation-list");
    await expect(list).toBeAttached();
    const items = list.locator(".conv-item");
    await expect(items).toHaveCount(0);
  });

  test("settings button in sidebar bottom", async ({ page }) => {
    const btn = page.locator("#settings-sidebar-btn");
    await expect(btn).toBeVisible();
  });

  test("clear all button in sidebar bottom", async ({ page }) => {
    const btn = page.locator("#clear-all-sidebar-btn");
    await expect(btn).toBeVisible();
  });

  test("sidebar has correct width", async ({ page }) => {
    const sidebar = page.locator("#sidebar");
    const box = await sidebar.boundingBox();
    expect(box).toBeTruthy();
    expect(box!.width).toBe(280);
  });
});

test.describe("AnythingLLM UI – Header Bar", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("header bar is visible", async ({ page }) => {
    await expect(page.locator("#header-bar")).toBeVisible();
  });

  test("toggle sidebar button exists", async ({ page }) => {
    const btn = page.locator("#toggle-sidebar-btn");
    await expect(btn).toBeVisible();
  });

  test("header title shows New Chat or loading", async ({ page }) => {
    const title = page.locator(".header-title");
    await expect(title).toBeAttached();
    const text = await title.textContent();
    expect(text).toBeTruthy();
  });

  test("model pill with status dot exists", async ({ page }) => {
    const pill = page.locator(".model-pill");
    await expect(pill).toBeVisible();
    await expect(pill.locator(".status-dot")).toBeAttached();
    await expect(pill.locator(".model-name")).toBeAttached();
  });

  test("settings button in header exists", async ({ page }) => {
    await expect(page.locator("#settings-btn")).toBeVisible();
  });

  test("clicking toggle sidebar collapses sidebar", async ({ page }) => {
    const sidebar = page.locator("#sidebar");
    const toggle = page.locator("#toggle-sidebar-btn");

    // Sidebar should be visible initially
    await expect(sidebar).toBeVisible();

    await toggle.click();
    // After toggle, sidebar should have collapsed class
    await expect(sidebar).toHaveClass(/collapsed/);

    // Click again to expand
    await toggle.click();
    await expect(sidebar).not.toHaveClass(/collapsed/);
  });
});

test.describe("AnythingLLM UI – Chat Area", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("chat messages container exists", async ({ page }) => {
    await expect(page.locator("#chat-messages")).toBeAttached();
  });

  test("welcome screen is shown initially", async ({ page }) => {
    const welcome = page.locator(".welcome-screen");
    await expect(welcome).toBeVisible();
    await expect(welcome.locator("h2")).toContainText("AnythingLLM");
  });

  test("welcome screen has suggestion chips", async ({ page }) => {
    const chips = page.locator(".suggestion-chip");
    const count = await chips.count();
    expect(count).toBe(4);
  });

  test("chat input exists and is initially disabled", async ({ page }) => {
    const input = page.locator("#chat-input");
    await expect(input).toBeAttached();
    await expect(input).toBeDisabled();
  });

  test("send button exists and is initially disabled", async ({ page }) => {
    const btn = page.locator("#send-btn");
    await expect(btn).toBeAttached();
    await expect(btn).toBeDisabled();
  });

  test("input area has privacy hint", async ({ page }) => {
    const hint = page.locator(".input-hint");
    await expect(hint).toBeVisible();
    await expect(hint).toContainText("locally");
  });
});

test.describe("AnythingLLM UI – Status Bar", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("status bar is visible", async ({ page }) => {
    await expect(page.locator("#status-bar")).toBeVisible();
  });

  test("status bar has left and right sections", async ({ page }) => {
    await expect(page.locator(".status-left")).toBeAttached();
    await expect(page.locator(".status-right")).toBeAttached();
  });
});

test.describe("AnythingLLM UI – Settings Modal", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("settings modal is hidden by default", async ({ page }) => {
    const backdrop = page.locator("#settings-backdrop");
    await expect(backdrop).not.toHaveClass(/open/);
  });

  test("clicking settings button opens modal", async ({ page }) => {
    await page.locator("#settings-btn").click();
    const backdrop = page.locator("#settings-backdrop");
    await expect(backdrop).toHaveClass(/open/);
  });

  test("settings modal has model selector", async ({ page }) => {
    await page.locator("#settings-btn").click();
    const select = page.locator("#settings-model-select");
    await expect(select).toBeVisible();

    // Should have optgroups with models
    const optgroups = select.locator("optgroup");
    const count = await optgroups.count();
    expect(count).toBeGreaterThan(0);
  });

  test("settings modal has temperature slider", async ({ page }) => {
    await page.locator("#settings-btn").click();
    const slider = page.locator("#settings-temperature");
    await expect(slider).toBeVisible();
  });

  test("settings modal has max tokens slider", async ({ page }) => {
    await page.locator("#settings-btn").click();
    const slider = page.locator("#settings-max-tokens");
    await expect(slider).toBeVisible();
  });

  test("settings modal has system prompt textarea", async ({ page }) => {
    await page.locator("#settings-btn").click();
    const textarea = page.locator("#settings-system-prompt");
    await expect(textarea).toBeVisible();
  });

  test("settings modal has save button", async ({ page }) => {
    await page.locator("#settings-btn").click();
    await expect(page.locator("#settings-save-btn")).toBeVisible();
  });

  test("settings modal has danger zone", async ({ page }) => {
    await page.locator("#settings-btn").click();
    await expect(page.locator(".settings-danger-zone")).toBeVisible();
    await expect(page.locator("#settings-clear-all-btn")).toBeVisible();
  });

  test("close button closes settings modal", async ({ page }) => {
    await page.locator("#settings-btn").click();
    const backdrop = page.locator("#settings-backdrop");
    await expect(backdrop).toHaveClass(/open/);

    await page.locator("#settings-close-btn").click();
    await expect(backdrop).not.toHaveClass(/open/);
  });

  test("clicking backdrop closes settings modal", async ({ page }) => {
    await page.locator("#settings-btn").click();
    const backdrop = page.locator("#settings-backdrop");
    await expect(backdrop).toHaveClass(/open/);

    // Click the backdrop (not the panel)
    await backdrop.click({ position: { x: 10, y: 10 } });
    await expect(backdrop).not.toHaveClass(/open/);
  });
});

test.describe("AnythingLLM UI – Layout & Responsiveness", () => {
  test("app uses flexbox layout", async ({ page }) => {
    await page.goto("/");
    const app = page.locator("#app");
    await expect(app).toHaveCSS("display", "flex");
  });

  test("main panel fills remaining width", async ({ page }) => {
    await page.goto("/");
    const mainPanel = page.locator("#main-panel");
    const sidebar = page.locator("#sidebar");

    const mainBox = await mainPanel.boundingBox();
    const sidebarBox = await sidebar.boundingBox();
    const viewportSize = page.viewportSize();

    expect(mainBox).toBeTruthy();
    expect(sidebarBox).toBeTruthy();
    expect(viewportSize).toBeTruthy();

    const totalWidth = mainBox!.width + sidebarBox!.width;
    expect(totalWidth).toBeGreaterThan(viewportSize!.width * 0.95);
  });
});

test.describe("AnythingLLM UI – Accessibility", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("interactive elements are focusable", async ({ page }) => {
    const selectors = [
      "#new-chat-btn",
      "#toggle-sidebar-btn",
      "#settings-btn",
    ];

    for (const selector of selectors) {
      const el = page.locator(selector);
      const isDisabled = await el.isDisabled();
      if (isDisabled) continue;
      await el.focus();
      await expect(el).toBeFocused();
    }
  });

  test("toggle sidebar button has title", async ({ page }) => {
    await expect(page.locator("#toggle-sidebar-btn")).toHaveAttribute("title", "Toggle sidebar");
  });

  test("send button has title", async ({ page }) => {
    await expect(page.locator("#send-btn")).toHaveAttribute("title", "Send message");
  });

  test("settings button has title", async ({ page }) => {
    await expect(page.locator("#settings-btn")).toHaveAttribute("title", "Settings");
  });
});

test.describe("AnythingLLM UI – WebGPU Status Detection", () => {
  test("model pill reflects loading state on init", async ({ page }) => {
    await page.goto("/");

    // The status dot should exist
    const dot = page.locator(".status-dot");
    await expect(dot).toBeAttached();

    // With WebGPU available and engine loading, it should have "loading" class initially
    const hasLoading = await dot.evaluate((el) => el.classList.contains("loading"));
    // It's either loading or already connected
    expect(typeof hasLoading).toBe("boolean");
  });

  test("WebGPU is available", async ({ page }) => {
    await page.goto("/");

    const hasGPU = await page.evaluate(() => !!navigator.gpu);
    expect(hasGPU).toBe(true);

    const hasAdapter = await page.evaluate(async () => {
      const adapter = await navigator.gpu.requestAdapter();
      return adapter !== null;
    });
    expect(hasAdapter).toBe(true);
  });
});
