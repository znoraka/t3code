// [FORK] lempire: one feed of pull requests across every environment that has them.
//
// Four reads per environment — one per involvement bucket — with no `projectId`,
// because a listing asked without one answers for every project that environment
// holds (`apps/server/src/pullRequest/PullRequestService.ts`). Those reads are
// collapsed into a single subscription by an atom keyed on the environment list,
// the same shape as `createArchivedThreadSnapshotsAtomFamily`, so a screen
// watching a dozen listings re-renders once.
import { useAtomValue } from "@effect/atom-react";
import { EnvironmentId, type PullRequestListInput } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { useCallback, useMemo } from "react";

import { appAtomRegistry } from "../../state/atom-registry";
import { useServerConfigs } from "../../state/entities";
import { pullRequestList } from "./atoms";
import type { PullRequestFeedSource } from "./pullRequestFeed";

/** Rows per open bucket; this is a triage list, not an archive. */
const OPEN_LIMIT = 40;
/** Merged rows behind the settled tail, enough for a week of landings. */
const MERGED_LIMIT = 15;

const BUCKET_INPUTS = {
  reviewRequested: { state: "open", involvement: "reviewing", limit: OPEN_LIMIT },
  involved: { state: "open", involvement: "involved", limit: OPEN_LIMIT },
  mine: { state: "open", involvement: "authored", limit: OPEN_LIMIT },
  merged: { state: "merged", limit: MERGED_LIMIT },
} as const satisfies Record<string, PullRequestListInput>;

type BucketName = keyof typeof BUCKET_INPUTS;
const BUCKET_NAMES = Object.keys(BUCKET_INPUTS) as ReadonlyArray<BucketName>;

export type PullRequestFeedSources = Readonly<
  Record<BucketName, ReadonlyArray<PullRequestFeedSource>>
>;

export interface PullRequestFeedState {
  readonly sources: PullRequestFeedSources;
  /** The first environment that could not answer, or null. Rows already read still show. */
  readonly error: string | null;
  readonly isPending: boolean;
}

// Unit separator: never in an environment id, so the key round-trips.
const KEY_SEPARATOR = "\u001f";

function feedEnvironmentKey(environmentIds: ReadonlyArray<EnvironmentId>): string {
  return [...environmentIds].sort().join(KEY_SEPARATOR);
}

function parseFeedEnvironmentKey(key: string): ReadonlyArray<EnvironmentId> {
  return key.length === 0 ? [] : key.split(KEY_SEPARATOR).map((value) => EnvironmentId.make(value));
}

function formatFailure(cause: Cause.Cause<unknown>): string {
  const error = Cause.squash(cause);
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "The environment could not list pull requests.";
}

const feedAtom = Atom.family((key: string) =>
  Atom.make((get): PullRequestFeedState => {
    const sources: Record<BucketName, PullRequestFeedSource[]> = {
      reviewRequested: [],
      involved: [],
      mine: [],
      merged: [],
    };
    let error: string | null = null;
    let isPending = false;

    for (const environmentId of parseFeedEnvironmentKey(key)) {
      for (const bucket of BUCKET_NAMES) {
        const result = get(pullRequestList({ environmentId, input: BUCKET_INPUTS[bucket] }));
        isPending ||= result.waiting;
        const value = Option.getOrNull(AsyncResult.value(result));
        if (value !== null) sources[bucket].push({ environmentId, entries: value.entries });
        // First failure only: one rate-limited host should read as one notice,
        // not four.
        if (error === null && result._tag === "Failure") error = formatFailure(result.cause);
      }
    }

    return { sources, error, isPending };
  }).pipe(Atom.withLabel(`mobile:_lempire:pr-feed:${key}`)),
);

export function usePullRequestFeed(): PullRequestFeedState & {
  /** Environments whose server can list pull requests at all. */
  readonly environmentCount: number;
  readonly refresh: () => void;
} {
  const serverConfigs = useServerConfigs();
  const environmentIds = useMemo(
    () =>
      [...serverConfigs].flatMap(([environmentId, config]) =>
        config.environment.capabilities.pullRequests === true ? [environmentId] : [],
      ),
    [serverConfigs],
  );
  const state = useAtomValue(feedAtom(feedEnvironmentKey(environmentIds)));
  const refresh = useCallback(() => {
    for (const environmentId of environmentIds) {
      for (const bucket of BUCKET_NAMES) {
        appAtomRegistry.refresh(pullRequestList({ environmentId, input: BUCKET_INPUTS[bucket] }));
      }
    }
  }, [environmentIds]);

  return { ...state, environmentCount: environmentIds.length, refresh };
}
