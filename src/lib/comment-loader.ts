import type { HNItem } from "./hn-utils";

export interface CommentStackNode {
  id: number;
  depth: number;
}

export interface FlatComment {
  item: HNItem;
  depth: number;
}

export function createCommentStack(rootKids?: number[]): CommentStackNode[] {
  const stack: CommentStackNode[] = [];
  const kids = rootKids ?? [];
  for (let i = kids.length - 1; i >= 0; i -= 1) {
    stack.push({ id: kids[i] as number, depth: 0 });
  }
  return stack;
}

export async function loadNextCommentBatch(
  stack: CommentStackNode[],
  batchSize: number,
  getItem: (id: number) => Promise<HNItem | null>,
): Promise<FlatComment[]> {
  const loaded: FlatComment[] = [];

  while (stack.length > 0 && loaded.length < batchSize) {
    const current = stack.pop() as CommentStackNode;
    const item = await getItem(current.id);
    if (!item || item.type !== "comment" || item.deleted || item.dead) {
      continue;
    }

    loaded.push({ item, depth: current.depth });

    const kids = item.kids ?? [];
    for (let i = kids.length - 1; i >= 0; i -= 1) {
      stack.push({ id: kids[i] as number, depth: current.depth + 1 });
    }
  }

  return loaded;
}
