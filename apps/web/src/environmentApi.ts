// [FORK] Thin imperative bridge for the few environment RPCs the fork still
// invokes outside the atom hooks. Upstream #2978 removed the old
// `WsRpcClient`-backed environment API in favour of Effect atoms; the
// PR-review data layer now lives in `state/gitPr.ts`. The only remaining
// imperative consumer is the commit → new-chat flow, which dispatches an
// orchestration command (with an inline thread bootstrap) from an event
// handler. Backed by `callEnvironmentRpc` (see ./rpc/imperativeEnvironmentRpc).
import {
  ORCHESTRATION_WS_METHODS,
  type EnvironmentApi,
  type EnvironmentId,
} from "@t3tools/contracts";

import { callEnvironmentRpc } from "./rpc/imperativeEnvironmentRpc";

export interface EnvironmentApiShim {
  readonly orchestration: Pick<EnvironmentApi["orchestration"], "dispatchCommand">;
}

export function ensureEnvironmentApi(environmentId: EnvironmentId): EnvironmentApiShim {
  if (typeof window === "undefined") {
    throw new Error(`Environment API is unavailable outside the browser`);
  }
  if (!environmentId) {
    throw new Error(`Environment API not found for environment ${environmentId}`);
  }
  return {
    orchestration: {
      dispatchCommand: (input) =>
        callEnvironmentRpc(environmentId, ORCHESTRATION_WS_METHODS.dispatchCommand, input),
    },
  };
}
