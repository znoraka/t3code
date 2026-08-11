import {
  EnvironmentHttpApi,
  EnvironmentHttpCommonError,
  EnvironmentResourceNotFoundError,
  type EnvironmentAuthInvalidError,
  type EnvironmentInternalError,
  type EnvironmentOperationForbiddenError,
  type EnvironmentRequestInvalidError,
  type EnvironmentScopeRequiredError,
} from "@t3tools/contracts";
import { httpHeaderRedactionLayer } from "@t3tools/shared/httpObservability";

import type { EnvironmentHttpAuthHeaders } from "../state/environmentHttpAuth.ts";
import * as Data from "effect/Data";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { FetchHttpClient, HttpClient, HttpClientError } from "effect/unstable/http";
import * as HttpApiClient from "effect/unstable/httpapi/HttpApiClient";

const isEnvironmentHttpCommonError = Schema.is(EnvironmentHttpCommonError);

export class RemoteEnvironmentAuthFetchError extends Data.TaggedError(
  "RemoteEnvironmentAuthFetchError",
)<{
  readonly message: string;
  readonly cause: unknown;
}> {}

export class RemoteEnvironmentAuthInvalidJsonError extends Data.TaggedError(
  "RemoteEnvironmentAuthInvalidJsonError",
)<{
  readonly message: string;
  readonly cause: unknown;
}> {}

export class RemoteEnvironmentAuthUndeclaredStatusError extends Data.TaggedError(
  "RemoteEnvironmentAuthUndeclaredStatusError",
)<{
  readonly message: string;
  readonly status: number;
  readonly requestUrl: string;
}> {
  constructor(requestUrl: string, status: number) {
    super({
      message: `Remote environment endpoint ${requestUrl} returned undeclared status ${status}.`,
      requestUrl,
      status,
    });
  }
}

export class RemoteEnvironmentAuthTimeoutError extends Data.TaggedError(
  "RemoteEnvironmentAuthTimeoutError",
)<{
  readonly message: string;
  readonly requestUrl: string;
  readonly timeoutMs: number;
}> {
  constructor(requestUrl: string, timeoutMs: number) {
    super({
      message: `Remote environment endpoint ${requestUrl} timed out after ${timeoutMs}ms.`,
      requestUrl,
      timeoutMs,
    });
  }
}

export type RemoteEnvironmentRequestError =
  | EnvironmentRequestInvalidError
  | EnvironmentAuthInvalidError
  | EnvironmentScopeRequiredError
  | EnvironmentOperationForbiddenError
  | EnvironmentResourceNotFoundError
  | EnvironmentInternalError
  | RemoteEnvironmentAuthFetchError
  | RemoteEnvironmentAuthInvalidJsonError
  | RemoteEnvironmentAuthUndeclaredStatusError
  | RemoteEnvironmentAuthTimeoutError;

export const remoteHttpClientLayer = (
  fetchFn: typeof globalThis.fetch,
): Layer.Layer<HttpClient.HttpClient> =>
  Layer.merge(
    FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetchFn))),
    httpHeaderRedactionLayer,
  );

const remoteApiBaseUrl = (httpBaseUrl: string): string => {
  const url = new URL(httpBaseUrl);
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.toString();
};

export const makeEnvironmentHttpApiClient = (httpBaseUrl: string) =>
  HttpApiClient.make(EnvironmentHttpApi, {
    baseUrl: remoteApiBaseUrl(httpBaseUrl),
  });

/** Contract-derived request URLs for authentication proofs, tracing, and structured errors. */
export const makeEnvironmentHttpApiUrlBuilder = (httpBaseUrl: string) =>
  HttpApiClient.urlBuilder(EnvironmentHttpApi, {
    baseUrl: remoteApiBaseUrl(httpBaseUrl),
  });

const failRemoteRequest = (
  requestUrl: string,
  cause: unknown,
): Effect.Effect<never, RemoteEnvironmentRequestError> => {
  if (cause instanceof RemoteEnvironmentAuthTimeoutError) {
    return Effect.fail(cause);
  }
  if (isEnvironmentHttpCommonError(cause)) {
    return Effect.fail(cause);
  }
  if (Schema.isSchemaError(cause)) {
    return Effect.fail(
      new RemoteEnvironmentAuthInvalidJsonError({
        message: `Remote environment endpoint returned an invalid response from ${requestUrl}.`,
        cause,
      }),
    );
  }
  if (HttpClientError.isHttpClientError(cause) && cause.response !== undefined) {
    const response = cause.response;
    if (response.status < 200 || response.status >= 300) {
      return Effect.fail(
        new RemoteEnvironmentAuthUndeclaredStatusError(requestUrl, response.status),
      );
    }
    return Effect.fail(
      new RemoteEnvironmentAuthInvalidJsonError({
        message: `Remote environment endpoint returned an invalid response from ${requestUrl}.`,
        cause,
      }),
    );
  }
  return Effect.fail(
    new RemoteEnvironmentAuthFetchError({
      message: `Failed to fetch remote environment endpoint ${requestUrl} (${String(cause)}).`,
      cause,
    }),
  );
};

/**
 * Fetches a JSON document and decodes it from the response **text**.
 *
 * `HttpApiClient` reads bodies via `response.arrayBuffer` and then `TextDecoder`.
 * On React Native that is pathological: `FileReader.readAsArrayBuffer`
 * (Libraries/Blob/FileReader.js) is implemented as `readAsDataURL`, so the body
 * crosses the bridge base64-encoded, gets `split(',')` into another copy, and is
 * then base64-decoded in JavaScript — before `TextDecoder` turns it back into a
 * string. For a multi-megabyte snapshot that allocated enough to spend ~18
 * seconds in garbage collection with the JS thread pinned, while the equivalent
 * decode from the local cache took ~320ms.
 *
 * Reading `.text` instead goes through `FileReader.readAsText`, which decodes
 * natively and hands back a string directly.
 *
 * Only worth using for large payloads; small requests are fine through the typed
 * client and keep its declared error handling.
 */
export const fetchEnvironmentJsonDocument = <A, E>(options: {
  readonly requestUrl: string;
  // Left open rather than pinned to a schema error: the failure is only ever
  // carried as `cause` on RemoteEnvironmentAuthInvalidJsonError, never matched
  // on, and the two callers decode with different codecs.
  readonly decode: (body: string) => Effect.Effect<A, E>;
  readonly headers: EnvironmentHttpAuthHeaders;
}): Effect.Effect<A, RemoteEnvironmentRequestError, HttpClient.HttpClient> =>
  HttpClient.get(options.requestUrl, { headers: { ...options.headers } }).pipe(
    Effect.flatMap((response) => {
      // Preserved so callers can keep treating a missing resource as "defer to
      // the socket" rather than an error worth surfacing.
      const failure: Effect.Effect<string, RemoteEnvironmentRequestError> =
        response.status === 404
          ? Effect.fail(
              new EnvironmentResourceNotFoundError({
                code: "not_found",
                reason: "thread_not_found",
                traceId: "client-http",
              }),
            )
          : Effect.fail(
              new RemoteEnvironmentAuthUndeclaredStatusError(options.requestUrl, response.status),
            );
      return response.status >= 200 && response.status < 300
        ? response.text.pipe(
            Effect.mapError(
              (cause) =>
                new RemoteEnvironmentAuthFetchError({
                  message: `Remote environment endpoint ${options.requestUrl} returned an unreadable body.`,
                  cause,
                }),
            ),
          )
        : failure;
    }),
    Effect.flatMap((body) =>
      // Hoisted by the caller: compiling the codec per request would rebuild the
      // decoder on every load.
      options.decode(body).pipe(
        Effect.mapError(
          (cause) =>
            new RemoteEnvironmentAuthInvalidJsonError({
              message: `Remote environment endpoint returned an invalid response from ${options.requestUrl}.`,
              cause,
            }),
        ),
      ),
    ),
    Effect.catch(
      (cause): Effect.Effect<never, RemoteEnvironmentRequestError> =>
        cause instanceof HttpClientError.HttpClientError
          ? Effect.fail(
              new RemoteEnvironmentAuthFetchError({
                message: `Remote environment endpoint ${options.requestUrl} could not be reached.`,
                cause,
              }),
            )
          : Effect.fail(cause),
    ),
  );

export const executeEnvironmentHttpRequest = <A, E, R>(
  requestUrl: string,
  timeoutMs: number,
  request: Effect.Effect<A, E, R>,
): Effect.Effect<A, RemoteEnvironmentRequestError, R> =>
  request.pipe(
    Effect.timeoutOption(Duration.millis(timeoutMs)),
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.fail(new RemoteEnvironmentAuthTimeoutError(requestUrl, timeoutMs)),
        onSome: Effect.succeed,
      }),
    ),
    Effect.catch((cause) => failRemoteRequest(requestUrl, cause)),
  );
