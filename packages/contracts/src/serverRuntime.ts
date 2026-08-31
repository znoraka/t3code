import * as Schema from "effect/Schema";

/**
 * Shape of the `server-runtime.json` file a live server persists next to its
 * database (see apps/server/src/serverRuntimeState.ts for the write side).
 * Read by `t3 pair` discovery and by the desktop app when deciding whether to
 * adopt an already-running server instead of spawning its own.
 */
export const PersistedServerRuntimeState = Schema.Struct({
  version: Schema.Literal(1),
  pid: Schema.Int,
  host: Schema.optional(Schema.String),
  port: Schema.Int,
  origin: Schema.String,
  // Present when the server fronts a dev web server (VITE_DEV_SERVER_URL).
  // Dev is single-origin: browsers must pair through this URL, not `origin`.
  devUrl: Schema.optional(Schema.String),
  startedAt: Schema.String,
});
export type PersistedServerRuntimeState = typeof PersistedServerRuntimeState.Type;

/**
 * Machine-readable result of `t3 pair --json`, printed as one JSON line on
 * stdout. The desktop app runs the bundled server CLI with this flag to mint
 * a bootstrap credential against an adopted (externally started) server.
 */
export const PairingMintResult = Schema.Struct({
  origin: Schema.String,
  pairingUrl: Schema.String,
  token: Schema.String,
  expiresAt: Schema.String,
  serverLabel: Schema.String,
});
export type PairingMintResult = typeof PairingMintResult.Type;
