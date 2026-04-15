// Live-UI message body renderer — issue #20.
import { describe, it, expect } from "vitest";
import { renderMessageBody } from "@/lib/rendering/messageBody";
import { makeMessage } from "@/lib/persistence/messages";

describe("renderMessageBody", () => {
  it("renders assistant content as markdown HTML", () => {
    const m = makeMessage({
      conversationId: "c_1",
      role: "assistant",
      content: "**bold** and `code`",
      index: 1,
    });
    const r = renderMessageBody(m);
    expect(r.kind).toBe("html");
    if (r.kind !== "html") return;
    expect(r.html).toContain("<strong>bold</strong>");
    expect(r.html).toContain("<code>code</code>");
  });

  it("renders fenced code blocks", () => {
    const m = makeMessage({
      conversationId: "c_1",
      role: "assistant",
      content: "```ts\nlet x = 1;\n```",
      index: 1,
    });
    const r = renderMessageBody(m);
    expect(r.kind).toBe("html");
    if (r.kind !== "html") return;
    expect(r.html).toContain("<pre><code");
    expect(r.html).toContain("language-ts");
    expect(r.html).toContain("let x = 1;");
  });

  it("user messages stay as plain text (so typed asterisks survive)", () => {
    const m = makeMessage({
      conversationId: "c_1",
      role: "user",
      content: "**not bold**",
      index: 0,
    });
    const r = renderMessageBody(m);
    expect(r.kind).toBe("text");
    if (r.kind !== "text") return;
    expect(r.text).toBe("**not bold**");
  });

  it("assistant rows with errorMessage are text (caller renders the error)", () => {
    const m = makeMessage({
      conversationId: "c_1",
      role: "assistant",
      content: "",
      index: 1,
      errorMessage: "rate limited",
    });
    const r = renderMessageBody(m);
    expect(r.kind).toBe("text");
  });
});
