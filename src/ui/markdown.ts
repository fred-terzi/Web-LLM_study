/**
 * Markdown rendering utility.
 * Converts markdown to sanitized HTML using marked + DOMPurify.
 */
import { marked } from "marked";
import DOMPurify from "dompurify";

// Configure marked for code blocks with copy buttons
marked.setOptions({
  breaks: true,
  gfm: true,
});

/**
 * Render markdown string to sanitized HTML.
 */
export function renderMarkdown(md: string): string {
  const raw = marked.parse(md, { async: false }) as string;
  const clean = DOMPurify.sanitize(raw, {
    ADD_ATTR: ["class"],
  });
  return clean;
}

/**
 * Attach copy-code-block buttons to all <pre> blocks inside a container.
 */
export function attachCopyButtons(container: HTMLElement): void {
  const pres = container.querySelectorAll("pre");
  pres.forEach((pre) => {
    if (pre.querySelector(".copy-code-btn")) return; // already has one

    const btn = document.createElement("button");
    btn.className = "copy-code-btn";
    btn.textContent = "Copy";
    btn.addEventListener("click", async () => {
      const code = pre.querySelector("code");
      const text = code ? code.textContent ?? "" : pre.textContent ?? "";
      try {
        await navigator.clipboard.writeText(text);
        btn.textContent = "Copied!";
        setTimeout(() => (btn.textContent = "Copy"), 1500);
      } catch {
        btn.textContent = "Failed";
        setTimeout(() => (btn.textContent = "Copy"), 1500);
      }
    });

    // pre needs relative positioning for the absolute button
    pre.style.position = "relative";
    pre.appendChild(btn);
  });
}
