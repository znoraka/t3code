// [FORK] lempire: the reads the phone's pull-request surface needs.
//
// Fork-owned rather than added to `state/pull-requests.ts`, which upstream owns:
// the whole feature is one directory a sync never touches. Everything here is a
// read the server already answers for any client — nothing was added to the
// wire for the phone.
import {
  createPlandropListReportsAtomFamily,
  createPlandropReportsAtomFamily,
} from "@t3tools/client-runtime/_lempire/plandrop-reports";
import { createEnvironmentRpcQueryAtomFamily } from "@t3tools/client-runtime/state/runtime";
import { WS_METHODS } from "@t3tools/contracts";

import { connectionAtomRuntime } from "../../connection/runtime";

/** A listing is cheap to re-read and the point of the screen is being current. */
const LIST_STALE_TIME_MS = 60_000;

export const pullRequestList = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "mobile:_lempire:pr-list",
  tag: WS_METHODS.pullRequestsList,
  staleTimeMs: LIST_STALE_TIME_MS,
});

export const plandropReports = createPlandropReportsAtomFamily(connectionAtomRuntime);

/** The same index for a whole feed, one round trip per environment. */
export const plandropListReports = createPlandropListReportsAtomFamily(connectionAtomRuntime);
