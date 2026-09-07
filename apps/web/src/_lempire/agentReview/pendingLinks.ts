// [FORK] lempire: PR links waiting for their review thread to exist.
//
// "Review with agent" opens a draft in the project without checking anything
// out, so the server has no thread to link until the first message is sent.
// The pending link is keyed on the thread id the draft will use and written
// (see PendingLinksBootstrap) once that shell shows up. Persisted so a reload
// between opening the draft and sending does not lose it.
import type { ThreadId, ThreadLinkedPullRequest } from "@t3tools/contracts";

const STORAGE_KEY = "t3code:agent-review-pending-links";
const MAX_AGE_MS = 7 * 24 * 60 * 60_000;

interface PendingLink {
  readonly link: ThreadLinkedPullRequest;
  readonly createdAt: number;
}

type PendingLinks = Record<string, PendingLink>;

function read(): PendingLinks {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const now = Date.now();
    const fresh: PendingLinks = {};
    for (const [threadId, entry] of Object.entries(parsed as Record<string, PendingLink>)) {
      if (entry && typeof entry.createdAt === "number" && now - entry.createdAt < MAX_AGE_MS) {
        fresh[threadId] = entry;
      }
    }
    return fresh;
  } catch {
    return {};
  }
}

function write(links: PendingLinks): void {
  try {
    if (Object.keys(links).length === 0) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(links));
  } catch {
    // Storage unavailable: the link is lost, the review still runs.
  }
}

export function rememberPendingLink(threadId: ThreadId, link: ThreadLinkedPullRequest): void {
  const links = read();
  links[threadId] = { link, createdAt: Date.now() };
  write(links);
}

export function readPendingLinks(): ReadonlyMap<ThreadId, ThreadLinkedPullRequest> {
  return new Map(
    Object.entries(read()).map(([threadId, entry]) => [threadId as ThreadId, entry.link]),
  );
}

export function forgetPendingLink(threadId: ThreadId): void {
  const links = read();
  if (!(threadId in links)) return;
  delete links[threadId];
  write(links);
}
