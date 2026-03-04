import { createCliRenderer, type ScrollBoxRenderable } from "@opentui/core";
import { createRoot, useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  COMMENT_BATCH_SIZE,
  COMMENT_NEAR_BOTTOM_THRESHOLD,
  FEED_OPTIONS,
  SCORE_FILTER_OPTIONS,
  SORT_LABELS,
  SORT_OPTIONS,
  STORY_FETCH_STEP,
  TYPE_FILTER_LABELS,
  TYPE_FILTER_OPTIONS,
  UI,
  type FocusZone,
} from "./app/constants";
import { useHnBrowserState } from "./hooks/use-hn-browser-state";
import { openExternalUrl } from "./lib/open-external-url";
import { cycleValue, formatRelativeTime, htmlToText, toSingleLine, truncate } from "./lib/hn-utils";

const COMPACT_NUMBER = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function compact(value?: number): string {
  return COMPACT_NUMBER.format(value ?? 0);
}

function App() {
  const tuiRenderer = useRenderer();
  const { width: terminalWidth } = useTerminalDimensions();
  const storyListRef = useRef<ScrollBoxRenderable>(null);
  const detailScrollRef = useRef<ScrollBoxRenderable>(null);
  const isQuittingRef = useRef(false);

  const [focusZone, setFocusZone] = useState<FocusZone>("list");

  const {
    feed,
    setFeed,
    storyLimit,
    setStoryLimit,
    feedIds,
    stories,
    selectedStoryIndex,
    setSelectedStoryIndex,
    feedLoading,
    storyLoading,
    detailLoading,
    errorMessage,
    searchQuery,
    setSearchQuery,
    sortMode,
    setSortMode,
    storyClass,
    setStoryClass,
    minScore,
    setMinScore,
    detailItem,
    detailComments,
    hasMoreComments,
    loadingMoreComments,
    feedOrder,
    filteredStories,
    selectedStory,
    selectedStoryId,
    loadMoreComments,
    refreshFeed,
    isCommentLoadInFlight,
  } = useHnBrowserState();

  const activeFeedIndex = FEED_OPTIONS.findIndex((entry) => entry.value === feed);
  const activeFeedLabel = FEED_OPTIONS[activeFeedIndex >= 0 ? activeFeedIndex : 0]?.label ?? "Top";
  const loadedStoriesCount = stories.length;
  const targetLoadedCount = Math.min(storyLimit, feedIds.length);
  const filteredCount = filteredStories.length;

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
  }, [selectedStoryIndex, filteredStories.length]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (!selectedStoryId || !hasMoreComments || isCommentLoadInFlight.current) {
        return;
      }

      const detail = detailScrollRef.current;
      if (!detail) {
        return;
      }

      const viewportHeight = Math.max(1, detail.viewport.height);
      const remaining = detail.scrollHeight - (detail.scrollTop + viewportHeight);
      if (remaining <= COMMENT_NEAR_BOTTOM_THRESHOLD) {
        void loadMoreComments(selectedStoryId, COMMENT_BATCH_SIZE);
      }
    }, 120);

    return () => {
      clearInterval(interval);
    };
  }, [selectedStoryId, hasMoreComments, isCommentLoadInFlight, loadMoreComments]);

  useKeyboard((key) => {
    const keyName = key.name.toLowerCase();

    if (keyName === "q" || (key.ctrl && keyName === "c")) {
      quitApp();
      return;
    }

    if (key.name === "tab") {
      const order: FocusZone[] = ["list", "detail", "search"];
      const currentIndex = order.indexOf(focusZone);
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
      refreshFeed();
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

    if (focusZone === "detail" && (key.name === "left" || key.name === "h")) {
      setFocusZone("list");
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
            scrollbarOptions={{
              showArrows: true,
              trackOptions: { foregroundColor: UI.muted, backgroundColor: UI.listBackground },
            }}
          >
            {filteredStories.length === 0 && (
              <box height={1}>
                <text fg={UI.muted}>
                  No stories match filters. Change search/filters or press 'n' to load more.
                </text>
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

        <box
          title="Post + Thread"
          border
          borderColor={UI.border}
          backgroundColor={UI.panelBackground}
          flexGrow={1}
        >
          <scrollbox
            ref={detailScrollRef}
            focused={focusZone === "detail"}
            rootOptions={{ padding: 1, backgroundColor: UI.listBackground }}
            viewportOptions={{ paddingRight: 1 }}
            scrollbarOptions={{
              showArrows: true,
              trackOptions: { foregroundColor: UI.muted, backgroundColor: UI.listBackground },
            }}
          >
            {!detailItem && !detailLoading && <text fg={UI.muted}>Select a story from the list.</text>}

            {detailItem && (
              <box flexDirection="column">
                <text fg={UI.accentWarm}>
                  <strong>{detailItem.title ?? "(untitled)"}</strong>
                </text>
                <text fg={UI.muted}>
                  {compact(detailItem.score)} pts | {compact(detailItem.descendants)} comments |{" "}
                  {detailItem.by ?? "unknown"} | {formatRelativeTime(detailItem.time)}
                </text>
                <box onMouseDown={() => openExternalUrl(discussionUrl)}>
                  <text fg={UI.link}>
                    HN:{" "}
                    <a href={discussionUrl}>
                      <u>{discussionUrl}</u>
                    </a>
                  </text>
                </box>
                {detailItem.url && (
                  <box onMouseDown={() => openExternalUrl(detailItem.url ?? discussionUrl)}>
                    <text fg={UI.link}>
                      URL:{" "}
                      <a href={detailItem.url}>
                        <u>{detailItem.url}</u>
                      </a>
                    </text>
                  </box>
                )}

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
                      {hasMoreComments ? "+" : ""})
                    </strong>
                  </text>
                </box>
                {loadingMoreComments && <text fg={UI.muted}>Loading more comments...</text>}
                {!loadingMoreComments && hasMoreComments && (
                  <text fg={UI.muted}>Scroll down to load more comments.</text>
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
