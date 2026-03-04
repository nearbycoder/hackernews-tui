import { createCliRenderer, type ScrollBoxRenderable } from "@opentui/core";
import { createRoot, useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react";
import { spawn } from "node:child_process";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const HN_API_BASE = "https://hacker-news.firebaseio.com/v0";
const STORY_FETCH_STEP = 120;
const STORY_FETCH_CONCURRENCY = 16;
const COMMENT_INITIAL_BATCH = 40;
const COMMENT_BATCH_SIZE = 30;
const COMMENT_NEAR_BOTTOM_THRESHOLD = 4;

const FEED_OPTIONS = [
  { value: "topstories", label: "Top" },
  { value: "newstories", label: "New" },
  { value: "beststories", label: "Best" },
  { value: "askstories", label: "Ask" },
  { value: "showstories", label: "Show" },
  { value: "jobstories", label: "Jobs" },
] as const;

const SORT_OPTIONS = ["rank", "newest", "points", "comments"] as const;
const SORT_LABELS: Record<(typeof SORT_OPTIONS)[number], string> = {
  rank: "Rank",
  newest: "Newest",
  points: "Points",
  comments: "Comments",
};

const TYPE_FILTER_OPTIONS = ["all", "story", "ask", "show", "job"] as const;
const TYPE_FILTER_LABELS: Record<(typeof TYPE_FILTER_OPTIONS)[number], string> = {
  all: "All",
  story: "Stories",
  ask: "Ask",
  show: "Show",
  job: "Jobs",
};

const SCORE_FILTER_OPTIONS = [0, 10, 50, 100, 250] as const;

const COMPACT_NUMBER = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

const UI = {
  appBackground: "#111722",
  panelBackground: "#16202d",
  border: "#9aa8be",
  text: "#f4f7ff",
  muted: "#cad2df",
  accent: "#8dd6ff",
  accentWarm: "#ffd58a",
  success: "#b4ef8b",
  link: "#9fc4ff",
  listBackground: "#141d2a",
  listFocusedBackground: "#1b2738",
  listSelectedBackground: "#355984",
  listSelectedText: "#fff6cc",
  inputBackground: "#0f1622",
  inputText: "#f4f7ff",
  inputPlaceholder: "#98a8be",
  danger: "#ff879a",
};

type FeedKey = (typeof FEED_OPTIONS)[number]["value"];
type SortMode = (typeof SORT_OPTIONS)[number];
type StoryClass = (typeof TYPE_FILTER_OPTIONS)[number];
type FocusZone = "list" | "detail" | "search";

interface HNItem {
  id: number;
  deleted?: boolean;
  type?: "job" | "story" | "comment" | "poll" | "pollopt";
  by?: string;
  time?: number;
  text?: string;
  dead?: boolean;
  parent?: number;
  poll?: number;
  kids?: number[];
  url?: string;
  score?: number;
  title?: string;
  parts?: number[];
  descendants?: number;
}

interface FlatComment {
  item: HNItem;
  depth: number;
}

interface CommentCursorState {
  storyId: number;
  stack: Array<{ id: number; depth: number }>;
}

const itemCache = new Map<number, HNItem | null | Promise<HNItem | null>>();

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Unknown error";
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  if (maxLength <= 3) {
    return value.slice(0, maxLength);
  }
  return `${value.slice(0, maxLength - 3)}...`;
}

function toSingleLine(value: string): string {
  return value
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (_, rawEntity: string) => {
    if (rawEntity.startsWith("#x") || rawEntity.startsWith("#X")) {
      const codePoint = Number.parseInt(rawEntity.slice(2), 16);
      if (Number.isFinite(codePoint)) {
        return String.fromCodePoint(codePoint);
      }
      return `&${rawEntity};`;
    }

    if (rawEntity.startsWith("#")) {
      const codePoint = Number.parseInt(rawEntity.slice(1), 10);
      if (Number.isFinite(codePoint)) {
        return String.fromCodePoint(codePoint);
      }
      return `&${rawEntity};`;
    }

    switch (rawEntity) {
      case "amp":
        return "&";
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "quot":
        return '"';
      case "apos":
      case "rsquo":
      case "lsquo":
      case "#39":
      case "#x27":
        return "'";
      case "nbsp":
        return " ";
      default:
        return `&${rawEntity};`;
    }
  });
}

function htmlToText(input?: string): string {
  if (!input) {
    return "";
  }

  const withBreaks = input
    .replace(/<p>/gi, "\n\n")
    .replace(/<\/p>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li>/gi, "\n- ")
    .replace(/<\/li>/gi, "");

  const withoutTags = withBreaks.replace(/<[^>]+>/g, "");
  return decodeHtmlEntities(withoutTags)
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function formatRelativeTime(unixSeconds?: number): string {
  if (!unixSeconds) {
    return "unknown time";
  }

  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - unixSeconds);
  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  if (days < 30) {
    return `${days}d ago`;
  }
  const months = Math.floor(days / 30);
  if (months < 12) {
    return `${months}mo ago`;
  }
  const years = Math.floor(months / 12);
  return `${years}y ago`;
}

function compact(value?: number): string {
  return COMPACT_NUMBER.format(value ?? 0);
}

function classifyStory(item: HNItem): Exclude<StoryClass, "all"> {
  if (item.type === "job") {
    return "job";
  }

  const title = (item.title ?? "").toLowerCase();
  if (title.startsWith("ask hn")) {
    return "ask";
  }
  if (title.startsWith("show hn")) {
    return "show";
  }
  return "story";
}

function cycleValue<T>(values: readonly T[], current: T): T {
  const currentIndex = values.findIndex((value) => value === current);
  if (currentIndex < 0) {
    return values[0] as T;
  }
  const nextIndex = (currentIndex + 1) % values.length;
  return values[nextIndex] as T;
}

function openExternalUrl(url: string): void {
  const platform = process.platform;
  if (platform === "darwin") {
    const child = spawn("open", [url], { detached: true, stdio: "ignore" });
    child.unref();
    return;
  }
  if (platform === "win32") {
    const child = spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" });
    child.unref();
    return;
  }
  const child = spawn("xdg-open", [url], { detached: true, stdio: "ignore" });
  child.unref();
}

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

async function getFeedIds(feed: FeedKey): Promise<number[]> {
  return fetchJson<number[]>(`${HN_API_BASE}/${feed}.json`);
}

async function getItemCached(id: number): Promise<HNItem | null> {
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

async function mapWithConcurrency<T, R>(
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

function App() {
  const tuiRenderer = useRenderer();
  const { width: terminalWidth } = useTerminalDimensions();
  const storyListRef = useRef<ScrollBoxRenderable>(null);
  const detailScrollRef = useRef<ScrollBoxRenderable>(null);
  const isQuittingRef = useRef(false);
  const commentCursorRef = useRef<CommentCursorState | null>(null);
  const commentLoadInFlightRef = useRef(false);
  const [feed, setFeed] = useState<FeedKey>("topstories");
  const [refreshTick, setRefreshTick] = useState(0);
  const [storyLimit, setStoryLimit] = useState(STORY_FETCH_STEP);
  const [feedIds, setFeedIds] = useState<number[]>([]);
  const [stories, setStories] = useState<HNItem[]>([]);
  const [selectedStoryIndex, setSelectedStoryIndex] = useState(0);

  const [feedLoading, setFeedLoading] = useState(false);
  const [storyLoading, setStoryLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("rank");
  const [storyClass, setStoryClass] = useState<StoryClass>("all");
  const [minScore, setMinScore] = useState<(typeof SCORE_FILTER_OPTIONS)[number]>(0);
  const [focusZone, setFocusZone] = useState<FocusZone>("list");

  const [detailItem, setDetailItem] = useState<HNItem | null>(null);
  const [detailComments, setDetailComments] = useState<FlatComment[]>([]);
  const [hasMoreComments, setHasMoreComments] = useState(false);
  const [loadingMoreComments, setLoadingMoreComments] = useState(false);

  useEffect(() => {
    let cancelled = false;

    setFeedLoading(true);
    setStoryLoading(false);
    setDetailLoading(false);
    setErrorMessage(null);
    setFeedIds([]);
    setStories([]);
    setStoryLimit(STORY_FETCH_STEP);
    setSelectedStoryIndex(0);
    setDetailItem(null);
    setDetailComments([]);
    setHasMoreComments(false);
    setLoadingMoreComments(false);
    commentCursorRef.current = null;
    commentLoadInFlightRef.current = false;

    void (async () => {
      try {
        const ids = await getFeedIds(feed);
        if (cancelled) {
          return;
        }
        setFeedIds(ids);
      } catch (error) {
        if (cancelled) {
          return;
        }
        setErrorMessage(`Failed to load feed IDs: ${getErrorMessage(error)}`);
      } finally {
        if (!cancelled) {
          setFeedLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [feed, refreshTick]);

  useEffect(() => {
    if (feedIds.length === 0) {
      return;
    }

    let cancelled = false;
    const idsToLoad = feedIds.slice(0, storyLimit);

    setStoryLoading(true);
    setErrorMessage(null);

    void (async () => {
      try {
        const items = await mapWithConcurrency(idsToLoad, STORY_FETCH_CONCURRENCY, getItemCached);
        if (cancelled) {
          return;
        }

        const filtered = items.filter((item): item is HNItem => {
          if (!item) {
            return false;
          }
          return item.type === "story" || item.type === "job" || item.type === "poll";
        });

        setStories(filtered);
      } catch (error) {
        if (cancelled) {
          return;
        }
        setErrorMessage(`Failed to load stories: ${getErrorMessage(error)}`);
      } finally {
        if (!cancelled) {
          setStoryLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [feedIds, storyLimit]);

  const feedOrder = useMemo(() => {
    const order = new Map<number, number>();
    feedIds.forEach((id, index) => {
      order.set(id, index);
    });
    return order;
  }, [feedIds]);

  const normalizedSearch = searchQuery.trim().toLowerCase();
  const filteredStories = useMemo(() => {
    const matches = stories.filter((story) => {
      if ((story.score ?? 0) < minScore) {
        return false;
      }
      if (storyClass !== "all" && classifyStory(story) !== storyClass) {
        return false;
      }
      if (!normalizedSearch) {
        return true;
      }

      const haystack = [
        story.title ?? "",
        story.by ?? "",
        story.url ?? "",
        htmlToText(story.text),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalizedSearch);
    });

    const sorted = [...matches];
    sorted.sort((a, b) => {
      switch (sortMode) {
        case "newest":
          return (b.time ?? 0) - (a.time ?? 0);
        case "points":
          return (b.score ?? 0) - (a.score ?? 0);
        case "comments":
          return (b.descendants ?? 0) - (a.descendants ?? 0);
        case "rank":
        default:
          return (feedOrder.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (feedOrder.get(b.id) ?? Number.MAX_SAFE_INTEGER);
      }
    });
    return sorted;
  }, [stories, minScore, storyClass, normalizedSearch, sortMode, feedOrder]);

  useEffect(() => {
    if (filteredStories.length === 0 && selectedStoryIndex !== 0) {
      setSelectedStoryIndex(0);
      return;
    }

    if (filteredStories.length > 0 && selectedStoryIndex >= filteredStories.length) {
      setSelectedStoryIndex(filteredStories.length - 1);
    }
  }, [filteredStories.length, selectedStoryIndex]);

  const selectedStory = filteredStories[selectedStoryIndex] ?? null;
  const selectedStoryId = selectedStory?.id ?? null;

  useEffect(() => {
    let cancelled = false;

    if (!selectedStoryId) {
      setDetailLoading(false);
      setDetailItem(null);
      setDetailComments([]);
      return;
    }

    // Keep detail pane in sync with highlighted story immediately.
    setDetailItem(selectedStory);
    setDetailComments([]);
    setDetailLoading(true);
    setErrorMessage(null);

    void (async () => {
      try {
        const item = await getItemCached(selectedStoryId);
        if (!item) {
          throw new Error(`Story ${selectedStoryId} not found`);
        }
        const comments = await loadCommentTree(item.kids, COMMENT_NODE_LIMIT);
        if (cancelled) {
          return;
        }
        setDetailItem(item);
        setDetailComments(comments);
      } catch (error) {
        if (cancelled) {
          return;
        }
        setDetailItem(selectedStory ?? null);
        setDetailComments([]);
        setErrorMessage(`Failed to load post details: ${getErrorMessage(error)}`);
      } finally {
        if (!cancelled) {
          setDetailLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedStoryId, selectedStory]);

  const activeFeedIndex = FEED_OPTIONS.findIndex((entry) => entry.value === feed);
  const activeFeedLabel = FEED_OPTIONS[activeFeedIndex >= 0 ? activeFeedIndex : 0]?.label ?? "Top";
  const loadedStoriesCount = stories.length;
  const targetLoadedCount = Math.min(storyLimit, feedIds.length);
  const filteredCount = filteredStories.length;
  const commentsTruncated = detailComments.length >= COMMENT_NODE_LIMIT;
  const statusText = feedLoading
    ? "Loading feed IDs..."
    : storyLoading
      ? `Loading stories ${loadedStoriesCount}/${targetLoadedCount}...`
      : detailLoading
        ? "Loading post details..."
        : "Ready";
  const headerLine = truncate(
    `HN | Feed[${activeFeedIndex + 1 || 1}/6]:${activeFeedLabel} | Sort:${SORT_LABELS[sortMode]} | Type:${TYPE_FILTER_LABELS[storyClass]} | Min:${minScore}+ | Focus:${focusZone} | Stories:${filteredCount}/${loadedStoriesCount}/${feedIds.length} | ${statusText}`,
    Math.max(40, terminalWidth - 12),
  );
  const footerLine1 = truncate(
    "Navigate: Tab focus | / search | j/k or arrows move | Enter/L details | h back | Mouse wheel scroll | click selects",
    Math.max(40, terminalWidth - 8),
  );
  const footerLine2 = truncate(
    "Actions: 1-6 feed | s sort | t type | p min points | n load more | r refresh | o open URL | i open HN | q quit",
    Math.max(40, terminalWidth - 8),
  );
  const maxVisibleRank = useMemo(() => {
    if (filteredStories.length === 0) {
      return 1;
    }
    return filteredStories.reduce((max, story, index) => {
      const rank = (feedOrder.get(story.id) ?? index) + 1;
      return Math.max(max, rank);
    }, 1);
  }, [filteredStories, feedOrder]);
  const rankColumnWidth = Math.max(2, String(maxVisibleRank).length);
  const rowPrefixWidth = rankColumnWidth + 3;

  const quitApp = () => {
    if (isQuittingRef.current) {
      return;
    }
    isQuittingRef.current = true;

    try {
      tuiRenderer.destroy();
    } finally {
      setTimeout(() => {
        process.exit(0);
      }, 20);
    }
  };

  useEffect(() => {
    const list = storyListRef.current;
    if (!list || filteredStories.length === 0) {
      return;
    }

    const viewportHeight = Math.max(1, list.viewport.height);
    const currentTop = Math.max(0, Math.floor(list.scrollTop));

    if (selectedStoryIndex < currentTop) {
      list.scrollTop = selectedStoryIndex;
      return;
    }

    if (selectedStoryIndex >= currentTop + viewportHeight) {
      list.scrollTop = selectedStoryIndex - viewportHeight + 1;
    }
  }, [selectedStoryIndex, filteredStories.length, terminalWidth]);

  useKeyboard((key) => {
    const keyName = key.name.toLowerCase();

    if (keyName === "q" || (key.ctrl && keyName === "c")) {
      quitApp();
      return;
    }

    if (key.name === "tab") {
      const order: FocusZone[] = ["list", "detail", "search"];
      const currentIndex = order.findIndex((zone) => zone === focusZone);
      const nextIndex = (currentIndex + 1) % order.length;
      setFocusZone(order[nextIndex] ?? "list");
      key.preventDefault();
      return;
    }

    if (focusZone === "search") {
      if (key.name === "escape" || key.name === "return" || key.name === "down") {
        setFocusZone("list");
      }
      return;
    }

    if (key.name === "escape") {
      setFocusZone("list");
      return;
    }

    if (key.name === "/" || key.name === "slash") {
      setFocusZone("search");
      key.preventDefault();
      return;
    }

    const numeric = Number.parseInt(key.name, 10);
    if (!Number.isNaN(numeric) && numeric >= 1 && numeric <= FEED_OPTIONS.length) {
      const nextFeed = FEED_OPTIONS[numeric - 1]?.value;
      if (nextFeed && nextFeed !== feed) {
        setFeed(nextFeed);
      }
      return;
    }

    if (key.name === "s") {
      setSortMode((current) => cycleValue(SORT_OPTIONS, current));
      return;
    }

    if (key.name === "t") {
      setStoryClass((current) => cycleValue(TYPE_FILTER_OPTIONS, current));
      return;
    }

    if (key.name === "p") {
      setMinScore((current) => cycleValue(SCORE_FILTER_OPTIONS, current));
      return;
    }

    if (key.name === "n") {
      setStoryLimit((current) => {
        if (feedIds.length === 0) {
          return current;
        }
        return Math.min(current + STORY_FETCH_STEP, feedIds.length);
      });
      return;
    }

    if (key.name === "r") {
      setRefreshTick((current) => current + 1);
      return;
    }

    if (key.name === "o" && selectedStory) {
      openExternalUrl(selectedStory.url ?? `https://news.ycombinator.com/item?id=${selectedStory.id}`);
      return;
    }

    if (key.name === "i" && selectedStory) {
      openExternalUrl(`https://news.ycombinator.com/item?id=${selectedStory.id}`);
      return;
    }

    if (focusZone === "list") {
      if (key.name === "j" || key.name === "down") {
        setSelectedStoryIndex((current) => Math.min(current + 1, Math.max(filteredStories.length - 1, 0)));
        key.preventDefault();
        return;
      }
      if (key.name === "k" || key.name === "up") {
        setSelectedStoryIndex((current) => Math.max(current - 1, 0));
        key.preventDefault();
        return;
      }
      if (key.name === "return" || key.name === "right" || key.name === "l") {
        setFocusZone("detail");
      }
      return;
    }

    if (focusZone === "detail") {
      if (key.name === "left" || key.name === "h") {
        setFocusZone("list");
      }
    }
  });

  const postBodyText = htmlToText(detailItem?.text);
  const postBodyLines = postBodyText ? postBodyText.split("\n") : [];
  const discussionUrl = detailItem ? `https://news.ycombinator.com/item?id=${detailItem.id}` : "";

  return (
    <box flexDirection="column" flexGrow={1} padding={1} backgroundColor={UI.appBackground}>
      <box
        border
        borderColor={UI.border}
        backgroundColor={UI.panelBackground}
        paddingX={1}
        height={3}
        marginBottom={1}
      >
        <text fg={UI.muted}>{headerLine}</text>
      </box>

      <box
        title="Search (press '/' to focus, Enter/Esc to leave)"
        border
        borderColor={UI.border}
        backgroundColor={UI.panelBackground}
        marginBottom={1}
        minHeight={3}
      >
        <input
          value={searchQuery}
          placeholder="Search loaded stories: title, author, URL, text..."
          backgroundColor={UI.inputBackground}
          textColor={UI.inputText}
          focusedBackgroundColor={UI.inputBackground}
          focusedTextColor={UI.inputText}
          placeholderColor={UI.inputPlaceholder}
          onInput={setSearchQuery}
          focused={focusZone === "search"}
        />
      </box>

      <box flexDirection="row" flexGrow={1}>
        <box
          title={`Stories (${filteredCount})`}
          border
          borderColor={UI.border}
          backgroundColor={UI.panelBackground}
          width="45%"
          marginRight={1}
        >
          <scrollbox
            ref={storyListRef}
            focused={focusZone === "list"}
            rootOptions={{ paddingX: 1, paddingY: 0, backgroundColor: UI.listBackground }}
            scrollbarOptions={{ showArrows: true, trackOptions: { foregroundColor: UI.muted, backgroundColor: UI.listBackground } }}
          >
            {filteredStories.length === 0 && (
              <box height={1}>
                <text fg={UI.muted}>No stories match filters. Change search/filters or press 'n' to load more.</text>
              </box>
            )}

            {filteredStories.map((story, index) => {
              const rank = (feedOrder.get(story.id) ?? index) + 1;
              const selected = index === selectedStoryIndex;
              const title = toSingleLine(story.title ?? "(untitled)");
              const marker = selected ? "> " : "  ";
              const rankLabel = `${String(rank).padStart(rankColumnWidth, " ")}.`;
              const prefixText = `${marker}${rankLabel}`;

              return (
                <box
                  key={story.id}
                  height={1}
                  width="100%"
                  flexDirection="row"
                  alignItems="center"
                  backgroundColor={selected ? UI.listSelectedBackground : UI.listBackground}
                  onMouseDown={() => {
                    setSelectedStoryIndex(index);
                    setFocusZone("list");
                  }}
                >
                  <box width={rowPrefixWidth}>
                    <text fg={selected ? UI.listSelectedText : UI.text} width="100%" wrapMode="none" truncate>
                      {prefixText}
                    </text>
                  </box>
                  <box flexGrow={1}>
                    <text fg={selected ? UI.listSelectedText : UI.text} width="100%" wrapMode="none" truncate>
                      {` ${title}`}
                    </text>
                  </box>
                </box>
              );
            })}
          </scrollbox>
        </box>

        <box title="Post + Thread" border borderColor={UI.border} backgroundColor={UI.panelBackground} flexGrow={1}>
          <scrollbox
            focused={focusZone === "detail"}
            rootOptions={{ padding: 1, backgroundColor: UI.listBackground }}
            viewportOptions={{ paddingRight: 1 }}
            scrollbarOptions={{ showArrows: true, trackOptions: { foregroundColor: UI.muted, backgroundColor: UI.listBackground } }}
          >
            {!detailItem && !detailLoading && <text fg={UI.muted}>Select a story from the list.</text>}

            {detailItem && (
              <box flexDirection="column">
                <text fg={UI.accentWarm}>
                  <strong>{detailItem.title ?? "(untitled)"}</strong>
                </text>
                <text fg={UI.muted}>
                  {compact(detailItem.score)} pts | {compact(detailItem.descendants)} comments | {detailItem.by ?? "unknown"} |{" "}
                  {formatRelativeTime(detailItem.time)}
                </text>
                <text fg={UI.link}>{`HN: ${discussionUrl}`}</text>
                {detailItem.url && <text fg={UI.link}>{`URL: ${detailItem.url}`}</text>}

                <box marginTop={1}>
                  <text fg={UI.success}>
                    <strong>Post text</strong>
                  </text>
                </box>
                {postBodyLines.length === 0 && <text fg={UI.muted}>No post body.</text>}
                {postBodyLines.map((line, lineIndex) => (
                  <text fg={UI.text} key={`post-line-${lineIndex}`}>
                    {line.length === 0 ? " " : line}
                  </text>
                ))}

                <box marginTop={1}>
                  <text fg={UI.success}>
                    <strong>
                      Comments ({detailComments.length}
                      {commentsTruncated ? "+" : ""})
                    </strong>
                  </text>
                </box>
                {commentsTruncated && (
                  <text fg={UI.muted}>Comment tree truncated for performance. Open in browser for full thread.</text>
                )}
                {detailComments.length === 0 && <text fg={UI.muted}>No comments available.</text>}

                {detailComments.map((comment) => {
                  const author = comment.item.by ?? "unknown";
                  const age = formatRelativeTime(comment.item.time);
                  const indent = " ".repeat(Math.min(comment.depth * 2, 20));
                  const commentText = htmlToText(comment.item.text) || "[empty comment]";
                  const lines = commentText.split("\n");

                  return (
                    <box key={`comment-${comment.item.id}`} marginTop={1}>
                      <text fg={UI.link}>{`${indent}${author} | ${age}`}</text>
                      {lines.map((line, lineIndex) => (
                        <text fg={UI.text} key={`comment-${comment.item.id}-line-${lineIndex}`}>
                          {`${indent}${line.length === 0 ? " " : line}`}
                        </text>
                      ))}
                    </box>
                  );
                })}
              </box>
            )}
          </scrollbox>
        </box>
      </box>

      {errorMessage && (
        <box border borderColor={UI.danger} backgroundColor={UI.panelBackground} marginTop={1} padding={1}>
          <text fg={UI.danger}>{errorMessage}</text>
        </box>
      )}

      <box
        border
        borderColor={UI.border}
        backgroundColor={UI.panelBackground}
        marginTop={1}
        paddingX={1}
        height={4}
        justifyContent="center"
      >
        <text fg={UI.muted} width="100%" wrapMode="none" truncate>
          {footerLine1}
        </text>
        <text fg={UI.muted} width="100%" wrapMode="none" truncate>
          {footerLine2}
        </text>
      </box>
    </box>
  );
}

const renderer = await createCliRenderer();
createRoot(renderer).render(<App />);
