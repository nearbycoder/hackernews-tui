import type { FeedKey } from "../app/constants";
import type { HNItem } from "./hn-utils";

const HN_API_BASE = "https://hacker-news.firebaseio.com/v0";

const itemCache = new Map<number, HNItem | null | Promise<HNItem | null>>();

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url}`);
  }
  return (await response.json()) as T;
}

export async function getFeedIds(feed: FeedKey, cacheBust?: number): Promise<number[]> {
  const suffix = cacheBust === undefined ? "" : `?t=${cacheBust}`;
  return fetchJson<number[]>(`${HN_API_BASE}/${feed}.json${suffix}`);
}

export async function getItemCached(id: number): Promise<HNItem | null> {
  const cached = itemCache.get(id);
  if (cached !== undefined) {
    if (typeof (cached as Promise<HNItem | null>).then === "function") {
      return cached as Promise<HNItem | null>;
    }
    return cached as HNItem | null;
  }

  const pending = fetchJson<HNItem | null>(`${HN_API_BASE}/item/${id}.json`)
    .then((item) => {
      itemCache.set(id, item);
      return item;
    })
    .catch(() => {
      itemCache.set(id, null);
      return null;
    });

  itemCache.set(id, pending);
  return pending;
}

export async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  if (values.length === 0) {
    return [];
  }

  const results = new Array<R>(values.length);
  let index = 0;

  const worker = async () => {
    while (true) {
      const next = index;
      index += 1;
      if (next >= values.length) {
        return;
      }
      results[next] = await mapper(values[next] as T);
    }
  };

  const workerCount = Math.max(1, Math.min(concurrency, values.length));
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}
