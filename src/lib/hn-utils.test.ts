import { describe, expect, test } from "bun:test";
import {
  classifyStory,
  cycleValue,
  decodeHtmlEntities,
  formatRelativeTime,
  getErrorMessage,
  htmlToText,
  toSingleLine,
  truncate,
} from "./hn-utils";

describe("hn-utils", () => {
  test("truncate returns original when under limit", () => {
    expect(truncate("hello", 10)).toBe("hello");
  });

  test("truncate adds ellipsis when over limit", () => {
    expect(truncate("abcdefghij", 7)).toBe("abcd...");
  });

  test("toSingleLine strips newlines and tabs", () => {
    expect(toSingleLine("foo\nbar\t baz")).toBe("foo bar baz");
  });

  test("decodeHtmlEntities decodes named and numeric entities", () => {
    expect(decodeHtmlEntities("Tom &amp; Jerry &#39;ok&#39; &lt;3")).toBe("Tom & Jerry 'ok' <3");
  });

  test("htmlToText strips tags and keeps structure", () => {
    const input = "<p>Hello &amp; welcome</p><li>one</li><li>two</li><br/>done";
    expect(htmlToText(input)).toBe("Hello & welcome\n- one\n- two\ndone");
  });

  test("formatRelativeTime uses provided now timestamp", () => {
    const nowMs = 1_700_000_000_000;
    const nowSeconds = Math.floor(nowMs / 1000);
    expect(formatRelativeTime(nowSeconds - 30, nowMs)).toBe("30s ago");
    expect(formatRelativeTime(nowSeconds - 3600, nowMs)).toBe("1h ago");
  });

  test("classifyStory detects ask/show/job", () => {
    expect(classifyStory({ id: 1, title: "Ask HN: something", type: "story" })).toBe("ask");
    expect(classifyStory({ id: 2, title: "Show HN: app", type: "story" })).toBe("show");
    expect(classifyStory({ id: 3, title: "job", type: "job" })).toBe("job");
    expect(classifyStory({ id: 4, title: "Normal story", type: "story" })).toBe("story");
  });

  test("cycleValue rotates and wraps", () => {
    const values = ["a", "b", "c"] as const;
    expect(cycleValue(values, "a")).toBe("b");
    expect(cycleValue(values, "c")).toBe("a");
  });

  test("getErrorMessage handles unknown values", () => {
    expect(getErrorMessage(new Error("boom"))).toBe("boom");
    expect(getErrorMessage("x")).toBe("Unknown error");
  });
});
