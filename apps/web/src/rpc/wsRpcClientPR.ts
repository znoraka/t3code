import { WS_METHODS } from "@t3tools/contracts";
import type { WsRpcProtocolClient } from "./protocol";

type RpcTag = keyof WsRpcProtocolClient & string;
type RpcMethod<TTag extends RpcTag> = WsRpcProtocolClient[TTag];
type RpcInput<TTag extends RpcTag> = Parameters<RpcMethod<TTag>>[0];

type RpcUnaryMethod<TTag extends RpcTag> =
  RpcMethod<TTag> extends (input: any, options?: any) => import("effect").Effect.Effect<infer TSuccess, any, any>
    ? (input: RpcInput<TTag>) => Promise<TSuccess>
    : never;

export type WsRpcClientPRGitMethods = {
  readonly listPullRequests: RpcUnaryMethod<typeof WS_METHODS.gitListPullRequests>;
  readonly getPullRequestDiff: RpcUnaryMethod<typeof WS_METHODS.gitGetPullRequestDiff>;
  readonly getPullRequestFileDiff: RpcUnaryMethod<typeof WS_METHODS.gitGetPullRequestFileDiff>;
  readonly getPullRequestReviewComments: RpcUnaryMethod<
    typeof WS_METHODS.gitGetPullRequestReviewComments
  >;
  readonly getPullRequestIssueComments: RpcUnaryMethod<
    typeof WS_METHODS.gitGetPullRequestIssueComments
  >;
  readonly getPullRequestBody: RpcUnaryMethod<typeof WS_METHODS.gitGetPullRequestBody>;
  readonly postPullRequestReviewComment: RpcUnaryMethod<
    typeof WS_METHODS.gitPostPullRequestReviewComment
  >;
  readonly postPullRequestIssueComment: RpcUnaryMethod<
    typeof WS_METHODS.gitPostPullRequestIssueComment
  >;
  readonly getPullRequestViewedFiles: RpcUnaryMethod<
    typeof WS_METHODS.gitGetPullRequestViewedFiles
  >;
  readonly setPullRequestFileViewed: RpcUnaryMethod<
    typeof WS_METHODS.gitSetPullRequestFileViewed
  >;
};

export function makePRGitMethods(
  transport: import("./wsTransport").WsTransport,
): WsRpcClientPRGitMethods {
  return {
    listPullRequests: (input) =>
      transport.request((client) => client[WS_METHODS.gitListPullRequests](input)),
    getPullRequestDiff: (input) =>
      transport.request((client) => client[WS_METHODS.gitGetPullRequestDiff](input)),
    getPullRequestFileDiff: (input) =>
      transport.request((client) => client[WS_METHODS.gitGetPullRequestFileDiff](input)),
    getPullRequestReviewComments: (input) =>
      transport.request((client) => client[WS_METHODS.gitGetPullRequestReviewComments](input)),
    getPullRequestIssueComments: (input) =>
      transport.request((client) => client[WS_METHODS.gitGetPullRequestIssueComments](input)),
    getPullRequestBody: (input) =>
      transport.request((client) => client[WS_METHODS.gitGetPullRequestBody](input)),
    postPullRequestReviewComment: (input) =>
      transport.request((client) => client[WS_METHODS.gitPostPullRequestReviewComment](input)),
    postPullRequestIssueComment: (input) =>
      transport.request((client) => client[WS_METHODS.gitPostPullRequestIssueComment](input)),
    getPullRequestViewedFiles: (input) =>
      transport.request((client) => client[WS_METHODS.gitGetPullRequestViewedFiles](input)),
    setPullRequestFileViewed: (input) =>
      transport.request((client) => client[WS_METHODS.gitSetPullRequestFileViewed](input)),
  };
}
