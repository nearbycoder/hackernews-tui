import { spawn } from "node:child_process";

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

function normalizeExternalUrl(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

export function openExternalUrl(url: string): boolean {
  const safeUrl = normalizeExternalUrl(url);
  if (!safeUrl) {
    return false;
  }

  const platform = process.platform;
  if (platform === "darwin") {
    const child = spawn("open", [safeUrl], { detached: true, stdio: "ignore" });
    child.unref();
    return true;
  }
  if (platform === "win32") {
    // Use explorer directly to avoid shell parsing risks from cmd /c start.
    const child = spawn("explorer.exe", [safeUrl], { detached: true, stdio: "ignore" });
    child.unref();
    return true;
  }
  const child = spawn("xdg-open", [safeUrl], { detached: true, stdio: "ignore" });
  child.unref();
  return true;
}
