export const STORY_FETCH_STEP = 120;
export const STORY_FETCH_CONCURRENCY = 16;
export const COMMENT_INITIAL_BATCH = 40;
export const COMMENT_BATCH_SIZE = 30;
export const COMMENT_NEAR_BOTTOM_THRESHOLD = 4;

export const FEED_OPTIONS = [
  { value: "topstories", label: "Top" },
  { value: "newstories", label: "New" },
  { value: "beststories", label: "Best" },
  { value: "askstories", label: "Ask" },
  { value: "showstories", label: "Show" },
  { value: "jobstories", label: "Jobs" },
] as const;

export const SORT_OPTIONS = ["rank", "newest", "points", "comments"] as const;
export const SORT_LABELS: Record<(typeof SORT_OPTIONS)[number], string> = {
  rank: "Rank",
  newest: "Newest",
  points: "Points",
  comments: "Comments",
};

export const TYPE_FILTER_OPTIONS = ["all", "story", "ask", "show", "job"] as const;
export const TYPE_FILTER_LABELS: Record<(typeof TYPE_FILTER_OPTIONS)[number], string> = {
  all: "All",
  story: "Stories",
  ask: "Ask",
  show: "Show",
  job: "Jobs",
};

export const SCORE_FILTER_OPTIONS = [0, 10, 50, 100, 250] as const;

export const UI = {
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
} as const;

export type FeedKey = (typeof FEED_OPTIONS)[number]["value"];
export type SortMode = (typeof SORT_OPTIONS)[number];
export type StoryClass = (typeof TYPE_FILTER_OPTIONS)[number];
export type FocusZone = "list" | "detail" | "search";
