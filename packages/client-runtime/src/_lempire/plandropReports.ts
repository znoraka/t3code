// [FORK] lempire: the plandrop review reports for a pull request.
//
// The environment answers from plandrop's index, which is keyed by pull request
// rather than by thread, so a review found this way does not depend on its URL
// having been said in a thread this environment can see. A host with no plandrop
// credential answers `configured: false`, which is not an error.
import { WS_METHODS } from "@t3tools/contracts";
import type { Atom } from "effect/unstable/reactivity";

import type * as EnvironmentRegistry from "../connection/registry.ts";
import { createEnvironmentRpcQueryAtomFamily } from "../state/runtime.ts";

/**
 * A verdict does not change unless a review is re-run, so this can sit a while.
 * Exported because a client that comes back to a pull request it left open has
 * to decide whether to ask again, and that decision is this window.
 */
export const REPORTS_STALE_TIME_MS = 5 * 60_000;
const REPORTS_IDLE_TTL_MS = 30 * 60_000;

export function createPlandropReportsAtomFamily<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry.EnvironmentRegistry | R, E>,
) {
  return createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:plandrop:reports",
    tag: WS_METHODS.plandropReportsForPullRequest,
    staleTimeMs: REPORTS_STALE_TIME_MS,
    idleTtlMs: REPORTS_IDLE_TTL_MS,
  });
}

/**
 * The same lookup for a whole list, one round trip for every row's badge. Shares
 * the single lookup's staleness window: a verdict changes only when a review is
 * re-run, whether one row is watching or forty.
 */
export function createPlandropListReportsAtomFamily<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry.EnvironmentRegistry | R, E>,
) {
  return createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:plandrop:list-reports",
    tag: WS_METHODS.plandropReportsForPullRequests,
    staleTimeMs: REPORTS_STALE_TIME_MS,
    idleTtlMs: REPORTS_IDLE_TTL_MS,
  });
}
