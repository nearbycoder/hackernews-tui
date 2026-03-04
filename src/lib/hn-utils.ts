export interface HNItem {
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

export type StoryKind = "story" | "ask" | "show" | "job";

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Unknown error";
}

export function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  if (maxLength <= 3) {
    return value.slice(0, maxLength);
  }
  return `${value.slice(0, maxLength - 3)}...`;
}

export function toSingleLine(value: string): string {
  return value
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function decodeHtmlEntities(value: string): string {
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

export function htmlToText(input?: string): string {
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

export function formatRelativeTime(unixSeconds?: number, nowMs: number = Date.now()): string {
  if (!unixSeconds) {
    return "unknown time";
  }

  const seconds = Math.max(0, Math.floor(nowMs / 1000) - unixSeconds);
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

export function classifyStory(item: HNItem): StoryKind {
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

export function cycleValue<T>(values: readonly T[], current: T): T {
  const currentIndex = values.indexOf(current);
  if (currentIndex < 0) {
    return values[0] as T;
  }
  const nextIndex = (currentIndex + 1) % values.length;
  return values[nextIndex] as T;
}
