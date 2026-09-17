// [FORK] lempire: the plandrop review report index, read for one pull request.
//
// /test-and-review uploads its verdict as a data-only `meta.json` artifact and
// plandrop indexes those by pull request, so `GET /api/reports?repo&number`
// answers "has this PR been reviewed" even when the run happened on another
// machine or in a thread nobody linked. The index needs the host's plandrop
// bearer token (`~/.plandrop/config.json`, written by the plandrop installer),
// which is why the lookup lives here instead of in the client: the token never
// leaves the environment, and every client — web, desktop, mobile, remote —
// gets the answer through the socket it already has.
import {
  PlandropUnavailableError,
  type PlandropReport,
  type PlandropReportsInput,
  type PlandropReportsResult,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/unstable/http";
import * as NodeOS from "node:os";

const LOOKUP_TIMEOUT_MS = 8_000;

/** Test hook: the config file the lookup reads, when it is not the real one. */
const CONFIG_PATH_ENV = "T3CODE_PLANDROP_CONFIG";

const PlandropConfig = Schema.Struct({
  server: Schema.String,
  token: Schema.String,
});

/**
 * The index entry as plandrop writes it. Decoded loosely on purpose: a report
 * gains fields faster than this fork tracks them, and an unknown one must not
 * cost the card its verdict.
 */
const PlandropIndexEntry = Schema.Struct({
  url: Schema.String,
  title: Schema.optional(Schema.String),
  verdict: Schema.optional(
    Schema.Struct({
      state: Schema.String,
      label: Schema.optional(Schema.String),
      note: Schema.optional(Schema.String),
    }),
  ),
  sources: Schema.optional(
    Schema.Array(
      Schema.Struct({
        name: Schema.String,
        crit: Schema.optional(Schema.Number),
        warn: Schema.optional(Schema.Number),
        good: Schema.optional(Schema.Number),
      }),
    ),
  ),
  pr: Schema.optional(Schema.Struct({ headSha: Schema.optional(Schema.String) })),
  generatedAt: Schema.optional(Schema.String),
  createdAt: Schema.optional(Schema.String),
  updatedAt: Schema.optional(Schema.String),
});

const PlandropIndex = Schema.Struct({ reports: Schema.Array(PlandropIndexEntry) });

const decodeConfig = Schema.decodeUnknownEffect(Schema.fromJsonString(PlandropConfig));
const decodeIndex = Schema.decodeUnknownEffect(PlandropIndex);

type VerdictState = "ok" | "warn" | "crit";

const asVerdictState = (value: string | undefined): VerdictState | null =>
  value === "ok" || value === "warn" || value === "crit" ? value : null;

const count = (value: number | undefined): number =>
  value === undefined || !Number.isFinite(value) || value < 0 ? 0 : Math.floor(value);

/**
 * Index entry → wire report. An entry with no usable timestamp is dropped
 * rather than dated now: the card orders by it and calls the newest one the
 * review of record.
 */
function toReport(entry: typeof PlandropIndexEntry.Type): PlandropReport | null {
  const generatedAt = entry.generatedAt ?? entry.createdAt ?? entry.updatedAt;
  if (generatedAt === undefined || entry.url.length === 0) return null;
  const state = asVerdictState(entry.verdict?.state);
  const verdict =
    state === null
      ? undefined
      : {
          state,
          label: entry.verdict?.label ?? "",
          ...(entry.verdict?.note === undefined ? {} : { note: entry.verdict.note }),
        };
  const report: PlandropReport = {
    url: entry.url,
    ...(entry.title === undefined ? {} : { title: entry.title }),
    ...(verdict === undefined ? {} : { verdict }),
    sources: (entry.sources ?? []).flatMap((source) =>
      source.name.length === 0
        ? []
        : [
            {
              name: source.name,
              crit: count(source.crit),
              warn: count(source.warn),
              good: count(source.good),
            },
          ],
    ),
    ...(entry.pr?.headSha === undefined ? {} : { headSha: entry.pr.headSha }),
    generatedAt,
  };
  return report;
}

/** Newest first, by the timestamp the card dates the review with. */
export function orderReports(
  reports: ReadonlyArray<PlandropReport>,
): ReadonlyArray<PlandropReport> {
  return [...reports].sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
}

const NOT_CONFIGURED: PlandropReportsResult = { configured: false, reports: [] };

/** The lookup itself, against whatever `HttpClient` the caller holds. */
export const lookupReports = Effect.fn("_lempire.plandropReportsForPullRequest")(function* (
  input: PlandropReportsInput,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const httpClient = yield* HttpClient.HttpClient;

  const configPath =
    process.env[CONFIG_PATH_ENV] ?? path.join(NodeOS.homedir(), ".plandrop", "config.json");

  // Read per lookup: installing plandrop mid-session must not need a restart,
  // and the file is a few bytes next to an HTTP round trip.
  const config = yield* Effect.gen(function* () {
    const raw = yield* fileSystem.readFileString(configPath).pipe(Effect.orElseSucceed(() => null));
    if (raw === null) return null;
    const config = yield* decodeConfig(raw).pipe(Effect.orElseSucceed(() => null));
    return config === null || config.server.length === 0 || config.token.length === 0
      ? null
      : config;
  });
  if (config === null) return NOT_CONFIGURED;

  const url = new URL("/api/reports", config.server);
  url.searchParams.set("repo", input.repository);
  url.searchParams.set("number", String(input.number));

  const response = yield* httpClient
    .get(url.toString(), { headers: { authorization: `Bearer ${config.token}` } })
    .pipe(
      Effect.timeout(LOOKUP_TIMEOUT_MS),
      Effect.mapError(() => new PlandropUnavailableError({ reason: "unreachable" })),
    );

  if (response.status === 401 || response.status === 403) {
    return yield* new PlandropUnavailableError({ reason: "rejected" });
  }

  const index = yield* HttpClientResponse.filterStatusOk(response).pipe(
    Effect.flatMap((ok) => ok.json),
    Effect.flatMap((json) => decodeIndex(json)),
    Effect.mapError(
      () =>
        new PlandropUnavailableError({
          reason: response.status >= 400 ? "unreachable" : "malformed",
          detail: `status ${response.status}`,
        }),
    ),
  );

  return {
    configured: true,
    reports: orderReports(index.reports.flatMap((entry) => toReport(entry) ?? [])),
  };
});

/**
 * The reports plandrop holds for one pull request, newest first. Carries its own
 * fetch client so a caller only has to be able to read files: the lookup is one
 * request off the pull request view, not a service the runtime has to hold.
 */
export const reportsForPullRequest = (
  input: PlandropReportsInput,
): Effect.Effect<
  PlandropReportsResult,
  PlandropUnavailableError,
  FileSystem.FileSystem | Path.Path
> => lookupReports(input).pipe(Effect.provide(FetchHttpClient.layer));
