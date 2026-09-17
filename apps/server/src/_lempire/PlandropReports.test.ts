import { assert, describe, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";

import { lookupReports, orderReports } from "./PlandropReports.ts";

const CONFIG_PATH_ENV = "T3CODE_PLANDROP_CONFIG";

const INPUT = { repository: "l3mpire/lempire", number: 12000 } as const;

const entry = (overrides: Record<string, unknown> = {}) => ({
  url: "https://plans.gawaak.ovh/p/me/report-a/",
  title: "PR 12000 — review",
  verdict: { state: "warn", label: "Mergeable with reserves", note: "One item first." },
  sources: [{ name: "Review", crit: 1, warn: 4, good: 6 }],
  pr: { repo: INPUT.repository, number: INPUT.number, headSha: "abc123" },
  generatedAt: "2026-09-17T14:05:00Z",
  createdAt: "2026-09-17T13:26:01Z",
  ...overrides,
});

/** Captures what the lookup asked plandrop for, and answers with `response`. */
const httpClientLayer = (input: {
  readonly response: () => Response;
  readonly seen?: { requests: string[]; authorization: (string | undefined)[] };
}) =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) => {
      input.seen?.requests.push(request.url);
      input.seen?.authorization.push(request.headers["authorization"]);
      return Effect.succeed(HttpClientResponse.fromWeb(request, input.response()));
    }),
  );

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Writes a plandrop config the lookup will read, or none at all. */
const withConfig = <A, E, R>(
  config: unknown | null,
  use: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R | FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-plandrop-" });
    const configPath = path.join(directory, "config.json");
    if (config !== null) {
      yield* fileSystem.writeFileString(configPath, JSON.stringify(config));
    }
    const previous = process.env[CONFIG_PATH_ENV];
    process.env[CONFIG_PATH_ENV] = configPath;
    return yield* Effect.ensuring(
      use,
      Effect.sync(() => {
        if (previous === undefined) delete process.env[CONFIG_PATH_ENV];
        else process.env[CONFIG_PATH_ENV] = previous;
      }),
    );
  }).pipe(Effect.scoped);

const CONFIG = { server: "https://drop.test", token: "plandrop-token" };

describe("orderReports", () => {
  it("puts the newest report first", () => {
    const report = (generatedAt: string) => ({ url: generatedAt, sources: [], generatedAt });
    assert.deepStrictEqual(
      orderReports([
        report("2026-09-10T00:00:00Z"),
        report("2026-09-17T14:05:00Z"),
        report("2026-09-12T00:00:00Z"),
      ]).map((entry) => entry.generatedAt),
      ["2026-09-17T14:05:00Z", "2026-09-12T00:00:00Z", "2026-09-10T00:00:00Z"],
    );
  });
});

it.layer(NodeServices.layer)("plandrop report lookup", (it) => {
  it.effect("asks the configured host for the pull request's reports", () =>
    withConfig(
      CONFIG,
      Effect.gen(function* () {
        const seen = { requests: [] as string[], authorization: [] as (string | undefined)[] };
        const result = yield* lookupReports(INPUT).pipe(
          Effect.provide(httpClientLayer({ response: () => json({ reports: [entry()] }), seen })),
        );
        assert.deepStrictEqual(seen.requests, [
          "https://drop.test/api/reports?repo=l3mpire%2Flempire&number=12000",
        ]);
        assert.deepStrictEqual(seen.authorization, ["Bearer plandrop-token"]);
        assert.deepStrictEqual(result, {
          configured: true,
          reports: [
            {
              url: "https://plans.gawaak.ovh/p/me/report-a/",
              title: "PR 12000 — review",
              verdict: {
                state: "warn",
                label: "Mergeable with reserves",
                note: "One item first.",
              },
              sources: [{ name: "Review", crit: 1, warn: 4, good: 6 }],
              headSha: "abc123",
              generatedAt: "2026-09-17T14:05:00Z",
            },
          ],
        });
      }),
    ),
  );

  it.effect("reports that the host has no plandrop credential without calling out", () =>
    withConfig(
      null,
      Effect.gen(function* () {
        const seen = { requests: [] as string[], authorization: [] as (string | undefined)[] };
        const result = yield* lookupReports(INPUT).pipe(
          Effect.provide(httpClientLayer({ response: () => json({ reports: [entry()] }), seen })),
        );
        assert.deepStrictEqual(result, { configured: false, reports: [] });
        assert.deepStrictEqual(seen.requests, []);
      }),
    ),
  );

  it.effect("fails as rejected when plandrop refuses the credential", () =>
    withConfig(
      CONFIG,
      Effect.gen(function* () {
        const error = yield* lookupReports(INPUT).pipe(
          Effect.provide(httpClientLayer({ response: () => json({}, 401) })),
          Effect.flip,
        );
        assert.strictEqual(error.reason, "rejected");
      }),
    ),
  );

  it.effect("keeps a report the index describes loosely, and drops an undatable one", () =>
    withConfig(
      CONFIG,
      Effect.gen(function* () {
        const result = yield* lookupReports(INPUT).pipe(
          Effect.provide(
            httpClientLayer({
              response: () =>
                json({
                  reports: [
                    // No verdict this fork understands, no counts, no head sha:
                    // still a report, and still the newest one.
                    {
                      url: "https://plans.gawaak.ovh/p/me/report-b/",
                      verdict: { state: "unknown-to-this-fork" },
                      sources: [{ name: "QA" }],
                      createdAt: "2026-09-18T09:00:00Z",
                      unexpectedField: 42,
                    },
                    entry(),
                    { url: "https://plans.gawaak.ovh/p/me/report-c/" },
                  ],
                }),
            }),
          ),
        );
        assert.deepStrictEqual(
          result.reports.map((report) => [report.url, report.verdict?.state ?? null]),
          [
            ["https://plans.gawaak.ovh/p/me/report-b/", null],
            ["https://plans.gawaak.ovh/p/me/report-a/", "warn"],
          ],
        );
        assert.deepStrictEqual(result.reports[0]?.sources, [
          { name: "QA", crit: 0, warn: 0, good: 0 },
        ]);
        assert.strictEqual(result.reports[0]?.generatedAt, "2026-09-18T09:00:00Z");
      }),
    ),
  );

  it.effect("fails as malformed when the index is not an index", () =>
    withConfig(
      CONFIG,
      Effect.gen(function* () {
        const error = yield* lookupReports(INPUT).pipe(
          Effect.provide(httpClientLayer({ response: () => json({ nope: true }) })),
          Effect.flip,
        );
        assert.strictEqual(error.reason, "malformed");
      }),
    ),
  );
});
