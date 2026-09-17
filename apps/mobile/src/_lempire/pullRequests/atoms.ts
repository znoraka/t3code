// [FORK] lempire: the reads the phone's pull-request surface needs.
//
// Fork-owned rather than added to `state/pull-requests.ts`, which upstream owns:
// the whole feature is one directory a sync never touches. Everything here is a
// read the server already answers for any client — nothing was added to the
// wire for the phone.
import { createPlandropReportsAtomFamily } from "@t3tools/client-runtime/_lempire/plandrop-reports";
import { createEnvironmentRpcQueryAtomFamily } from "@t3tools/client-runtime/state/runtime";
import { WS_METHODS } from "@t3tools/contracts";

import { connectionAtomRuntime } from "../../connection/runtime";

/** A listing is cheap to re-read and the point of the screen is being current. */
const LIST_STALE_TIME_MS = 60_000;
/** One pull request's detail while you are looking at it. */
const DETAIL_STALE_TIME_MS = 60_000;

export const pullRequestList = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "mobile:_lempire:pr-list",
  tag: WS_METHODS.pullRequestsList,
  staleTimeMs: LIST_STALE_TIME_MS,
});

export const pullRequestDetail = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "mobile:_lempire:pr-detail",
  tag: WS_METHODS.pullRequestsDetail,
  staleTimeMs: DETAIL_STALE_TIME_MS,
});

/**
 * The conversation-shaped half. The phone shows none of it and reads it for one
 * field — `commits`, the head the stale check compares against — so it is read
 * after the detail rather than alongside it, and the card renders without a
 * staleness claim until it lands.
 */
export const pullRequestActivity = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "mobile:_lempire:pr-activity",
  tag: WS_METHODS.pullRequestsActivity,
  staleTimeMs: DETAIL_STALE_TIME_MS,
});

export const plandropReports = createPlandropReportsAtomFamily(connectionAtomRuntime);
