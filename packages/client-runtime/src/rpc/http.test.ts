import { OrchestrationShellSnapshot } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { FetchHttpClient, HttpClient } from "effect/unstable/http";

import { fetchEnvironmentJsonDocument } from "./http.ts";

const SNAPSHOT = {
  snapshotSequence: 3,
  projects: [],
  threads: [],
  updatedAt: "2026-06-01T00:00:00.000Z",
};

const decodeShellSnapshot = Schema.decodeUnknownEffect(
  Schema.fromJsonString(OrchestrationShellSnapshot),
);

/**
 * Records which body accessor the client reached for. `arrayBuffer` is the one
 * that must never be used for large payloads on React Native: FileReader
 * implements it by shipping the body across the bridge base64-encoded and
 * decoding it in JavaScript.
 */
function trackingFetch(options: {
  readonly body: string;
  readonly status?: number;
  readonly reads: Array<string>;
}) {
  return (() =>
    Promise.resolve({
      status: options.status ?? 200,
      headers: new Headers({ "content-type": "application/json" }),
      text: () => {
        options.reads.push("text");
        return Promise.resolve(options.body);
      },
      arrayBuffer: () => {
        options.reads.push("arrayBuffer");
        return Promise.resolve(new TextEncoder().encode(options.body).buffer);
      },
      json: () => Promise.resolve(JSON.parse(options.body)),
    } as unknown as Response)) as unknown as typeof globalThis.fetch;
}

function layerFor(fetchFn: typeof globalThis.fetch): Layer.Layer<HttpClient.HttpClient> {
  return FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetchFn)));
}

describe("fetchEnvironmentJsonDocument", () => {
  it.effect("reads the body as text rather than an array buffer", () =>
    Effect.gen(function* () {
      const reads: Array<string> = [];
      const snapshot = yield* fetchEnvironmentJsonDocument({
        requestUrl: "https://example.test/api/orchestration/shell",
        decode: decodeShellSnapshot,
        headers: {},
        // @effect-diagnostics-next-line preferSchemaOverJson:off - Fixture body.
      }).pipe(Effect.provide(layerFor(trackingFetch({ body: JSON.stringify(SNAPSHOT), reads }))));

      expect(snapshot.snapshotSequence).toBe(3);
      expect(reads).toEqual(["text"]);
    }),
  );

  it.effect("maps a 404 to a not-found error so callers can defer to the socket", () =>
    Effect.gen(function* () {
      const reads: Array<string> = [];
      const result = yield* fetchEnvironmentJsonDocument({
        requestUrl: "https://example.test/api/orchestration/threads/missing",
        decode: decodeShellSnapshot,
        headers: {},
      }).pipe(
        Effect.provide(layerFor(trackingFetch({ body: "", status: 404, reads }))),
        Effect.flip,
      );

      expect(result._tag).toBe("EnvironmentResourceNotFoundError");
    }),
  );

  it.effect("reports an unreadable body as invalid JSON", () =>
    Effect.gen(function* () {
      const reads: Array<string> = [];
      const result = yield* fetchEnvironmentJsonDocument({
        requestUrl: "https://example.test/api/orchestration/shell",
        decode: decodeShellSnapshot,
        headers: {},
      }).pipe(Effect.provide(layerFor(trackingFetch({ body: "not json", reads }))), Effect.flip);

      expect(result._tag).toBe("RemoteEnvironmentAuthInvalidJsonError");
    }),
  );

  it.effect("surfaces an undeclared status", () =>
    Effect.gen(function* () {
      const reads: Array<string> = [];
      const result = yield* fetchEnvironmentJsonDocument({
        requestUrl: "https://example.test/api/orchestration/shell",
        decode: decodeShellSnapshot,
        headers: {},
      }).pipe(
        Effect.provide(layerFor(trackingFetch({ body: "", status: 500, reads }))),
        Effect.flip,
      );

      expect(result._tag).toBe("RemoteEnvironmentAuthUndeclaredStatusError");
    }),
  );
});
