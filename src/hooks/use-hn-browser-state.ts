import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  COMMENT_BATCH_SIZE,
  COMMENT_INITIAL_BATCH,
  STORY_FETCH_CONCURRENCY,
  STORY_FETCH_STEP,
  type FeedKey,
  type SortMode,
  type StoryClass,
} from "../app/constants";
import {
  createCommentStack,
  loadNextCommentBatch,
  type CommentStackNode,
  type FlatComment,
} from "../lib/comment-loader";
import { getFeedIds, getItemCached, mapWithConcurrency } from "../lib/hn-api";
import { classifyStory, getErrorMessage, htmlToText, type HNItem } from "../lib/hn-utils";

interface CommentCursorState {
  storyId: number;
  stack: CommentStackNode[];
}

export function useHnBrowserState() {
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
  const [minScore, setMinScore] = useState(0);

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
        const ids = await getFeedIds(feed, refreshTick);
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

      const haystack = [story.title ?? "", story.by ?? "", story.url ?? "", htmlToText(story.text)]
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
        default:
          return (
            (feedOrder.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
            (feedOrder.get(b.id) ?? Number.MAX_SAFE_INTEGER)
          );
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

  const loadMoreComments = useCallback(async (storyId: number, batchSize: number = COMMENT_BATCH_SIZE) => {
    const cursor = commentCursorRef.current;
    if (!cursor || cursor.storyId !== storyId || commentLoadInFlightRef.current) {
      return;
    }
    if (cursor.stack.length === 0) {
      setHasMoreComments(false);
      return;
    }

    commentLoadInFlightRef.current = true;
    setLoadingMoreComments(true);

    try {
      const loadedBatch = await loadNextCommentBatch(cursor.stack, batchSize, getItemCached);

      if (commentCursorRef.current?.storyId !== storyId) {
        return;
      }
      if (loadedBatch.length > 0) {
        setDetailComments((previous) => [...previous, ...loadedBatch]);
      }
      setHasMoreComments(cursor.stack.length > 0);
    } catch (error) {
      if (commentCursorRef.current?.storyId !== storyId) {
        return;
      }
      setErrorMessage(`Failed to load comments: ${getErrorMessage(error)}`);
    } finally {
      if (commentCursorRef.current?.storyId === storyId) {
        setLoadingMoreComments(false);
      }
      commentLoadInFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (!selectedStoryId) {
      setDetailLoading(false);
      setDetailItem(null);
      setDetailComments([]);
      setHasMoreComments(false);
      setLoadingMoreComments(false);
      commentCursorRef.current = null;
      commentLoadInFlightRef.current = false;
      return;
    }

    setDetailItem(selectedStory);
    setDetailComments([]);
    setHasMoreComments(false);
    setLoadingMoreComments(false);
    commentCursorRef.current = null;
    commentLoadInFlightRef.current = false;
    setDetailLoading(true);
    setErrorMessage(null);

    void (async () => {
      try {
        const item = await getItemCached(selectedStoryId);
        if (!item) {
          throw new Error(`Story ${selectedStoryId} not found`);
        }
        if (cancelled) {
          return;
        }
        setDetailItem(item);
        setDetailComments([]);
        const stack = createCommentStack(item.kids);

        commentCursorRef.current = {
          storyId: selectedStoryId,
          stack,
        };
        setHasMoreComments(stack.length > 0);

        if (stack.length > 0) {
          await loadMoreComments(selectedStoryId, COMMENT_INITIAL_BATCH);
        }
      } catch (error) {
        if (cancelled) {
          return;
        }
        setDetailItem(selectedStory ?? null);
        setDetailComments([]);
        setHasMoreComments(false);
        setLoadingMoreComments(false);
        commentCursorRef.current = null;
        commentLoadInFlightRef.current = false;
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
  }, [selectedStoryId, selectedStory, loadMoreComments]);

  const refreshFeed = () => {
    setRefreshTick((current) => current + 1);
  };

  return {
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
    isCommentLoadInFlight: commentLoadInFlightRef,
  };
}
