import { describe, expect, test } from "bun:test";
import { createCommentStack, loadNextCommentBatch } from "./comment-loader";
import type { HNItem } from "./hn-utils";

describe("comment-loader", () => {
  test("createCommentStack preserves top-level order", () => {
    const stack = createCommentStack([101, 102, 103]);
    expect(stack.pop()?.id).toBe(101);
    expect(stack.pop()?.id).toBe(102);
    expect(stack.pop()?.id).toBe(103);
  });

  test("loadNextCommentBatch performs DFS and skips non-comment/dead/deleted", async () => {
    const items = new Map<number, HNItem>([
      [1, { id: 1, type: "comment", kids: [10, 11] }],
      [2, { id: 2, type: "story" }],
      [3, { id: 3, type: "comment", kids: [30] }],
      [10, { id: 10, type: "comment" }],
      [11, { id: 11, type: "comment", dead: true }],
      [30, { id: 30, type: "comment" }],
    ]);

    const getItem = async (id: number): Promise<HNItem | null> => items.get(id) ?? null;

    const stack = createCommentStack([1, 2, 3]);

    const firstBatch = await loadNextCommentBatch(stack, 2, getItem);
    expect(firstBatch.map((entry) => `${entry.item.id}:${entry.depth}`)).toEqual(["1:0", "10:1"]);

    const secondBatch = await loadNextCommentBatch(stack, 10, getItem);
    expect(secondBatch.map((entry) => `${entry.item.id}:${entry.depth}`)).toEqual(["3:0", "30:1"]);
    expect(stack.length).toBe(0);
  });
});
