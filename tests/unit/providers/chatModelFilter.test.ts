// #68 — Filter model picker to chat-capable models only.
import { describe, it, expect } from "vitest";
import { isChatModel } from "@/lib/providers/models";

describe("isChatModel (#68)", () => {
  describe("OpenAI", () => {
    it.each(["gpt-4o", "gpt-4o-mini", "o1-preview", "o3-mini", "chatgpt-4o-latest"])(
      "accepts %s",
      (id) => expect(isChatModel("openai", id)).toBe(true),
    );
    it.each([
      "dall-e-3",
      "whisper-1",
      "tts-1",
      "tts-1-hd",
      "text-embedding-3-small",
      "text-embedding-ada-002",
      "babbage-002",
      "davinci-002",
    ])("rejects %s", (id) => expect(isChatModel("openai", id)).toBe(false));
  });

  describe("Anthropic", () => {
    it.each(["claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"])(
      "accepts %s",
      (id) => expect(isChatModel("claude", id)).toBe(true),
    );
  });

  describe("Gemini", () => {
    it("accepts gemini-2.5-pro", () => {
      expect(isChatModel("gemini", "gemini-2.5-pro")).toBe(true);
    });
    it("rejects text-embedding-004", () => {
      expect(isChatModel("gemini", "text-embedding-004")).toBe(false);
    });
  });

  describe("Mistral", () => {
    it("accepts mistral-large-latest", () => {
      expect(isChatModel("mistral", "mistral-large-latest")).toBe(true);
    });
    it("rejects mistral-embed", () => {
      expect(isChatModel("mistral", "mistral-embed")).toBe(false);
    });
  });

  describe("Apertus", () => {
    it("accepts swiss-ai/Apertus-70B-Instruct-2509", () => {
      expect(isChatModel("apertus", "swiss-ai/Apertus-70B-Instruct-2509")).toBe(true);
    });
    it("rejects text-embedding-3-small", () => {
      expect(isChatModel("apertus", "text-embedding-3-small")).toBe(false);
    });
  });
});
