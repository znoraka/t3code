import { useCallback, useEffect, useMemo, useState } from "react";

export type ViewedMap = Record<string, string>;

const STORAGE_PREFIX = "t3code.prViewed";

function hashString(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

export function buildFileDiffHash(fullDiff: string, filePath: string): string {
  if (!fullDiff) return "";
  const marker = `diff --git a/${filePath} b/${filePath}`;
  const lines = fullDiff.split("\n");
  let inSection = false;
  const collected: string[] = [];
  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      if (inSection) break;
      if (line === marker) {
        inSection = true;
      }
    }
    if (inSection) {
      collected.push(line);
    }
  }
  if (collected.length === 0) return "";
  return hashString(collected.join("\n"));
}

function storageKey(cwd: string, prNumber: number): string {
  return `${STORAGE_PREFIX}:${cwd}:${prNumber}`;
}

function safeReadViewedMap(cwd: string | null, prNumber: number | null): ViewedMap {
  if (!cwd || prNumber === null || typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(storageKey(cwd, prNumber));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const result: ViewedMap = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === "string") result[key] = value;
      }
      return result;
    }
  } catch {
    // Ignore malformed JSON / quota errors.
  }
  return {};
}

function safeWriteViewedMap(cwd: string, prNumber: number, map: ViewedMap): void {
  if (typeof window === "undefined") return;
  try {
    if (Object.keys(map).length === 0) {
      window.localStorage.removeItem(storageKey(cwd, prNumber));
    } else {
      window.localStorage.setItem(storageKey(cwd, prNumber), JSON.stringify(map));
    }
  } catch {
    // Ignore quota errors.
  }
}

export interface UsePullRequestViewedFilesInput {
  readonly cwd: string | null;
  readonly prNumber: number | null;
  readonly fullDiff: string;
  readonly filePaths: readonly string[];
}

export interface UsePullRequestViewedFilesResult {
  readonly isViewed: (filePath: string) => boolean;
  readonly setViewed: (filePath: string, viewed: boolean) => void;
  readonly toggleViewed: (filePath: string) => void;
  readonly viewedCount: number;
  readonly totalCount: number;
}

export function usePullRequestViewedFiles({
  cwd,
  prNumber,
  fullDiff,
  filePaths,
}: UsePullRequestViewedFilesInput): UsePullRequestViewedFilesResult {
  const [viewedMap, setViewedMap] = useState<ViewedMap>(() => safeReadViewedMap(cwd, prNumber));

  useEffect(() => {
    setViewedMap(safeReadViewedMap(cwd, prNumber));
  }, [cwd, prNumber]);

  const currentHashes = useMemo(() => {
    const map: Record<string, string> = {};
    for (const path of filePaths) {
      map[path] = buildFileDiffHash(fullDiff, path);
    }
    return map;
  }, [fullDiff, filePaths]);

  const isViewed = useCallback(
    (filePath: string): boolean => {
      const stored = viewedMap[filePath];
      if (!stored) return false;
      const current = currentHashes[filePath];
      if (!current) return false;
      return stored === current;
    },
    [viewedMap, currentHashes],
  );

  const setViewed = useCallback(
    (filePath: string, viewed: boolean) => {
      if (!cwd || prNumber === null) return;
      setViewedMap((prev) => {
        const next: ViewedMap = { ...prev };
        if (viewed) {
          const hash = currentHashes[filePath] ?? buildFileDiffHash(fullDiff, filePath);
          if (!hash) return prev;
          next[filePath] = hash;
        } else if (filePath in next) {
          delete next[filePath];
        } else {
          return prev;
        }
        safeWriteViewedMap(cwd, prNumber, next);
        return next;
      });
    },
    [cwd, prNumber, currentHashes, fullDiff],
  );

  const toggleViewed = useCallback(
    (filePath: string) => {
      setViewed(filePath, !isViewed(filePath));
    },
    [isViewed, setViewed],
  );

  const viewedCount = useMemo(
    () => filePaths.reduce((acc, path) => (isViewed(path) ? acc + 1 : acc), 0),
    [filePaths, isViewed],
  );

  return {
    isViewed,
    setViewed,
    toggleViewed,
    viewedCount,
    totalCount: filePaths.length,
  };
}
