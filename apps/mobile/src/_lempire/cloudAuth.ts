// [FORK] lempire: cloud-auth hooks that work with or without Clerk.
//
// This fork talks to a self-hosted single-user relay that has no Clerk in
// front of it, so `ClerkProvider` is never mounted (see CloudAuthProvider).
// Calling `useAuth`/`useUser` outside that provider throws — upstream hits the
// same hazard in showcase captures and works around it per call site
// (CloudEnvironmentRows.tsx:47). These hooks centralise that: screens import
// them instead of Clerk's and stop caring which mode the build is in.
//
// The choice is made once at module load rather than per render: it comes from
// the build-time Expo config, so it cannot change during a session, and picking
// the hook up front keeps the rules of hooks satisfied.
import { useAuth, useUser } from "@clerk/expo";

import {
  isLocalRelayAuth,
  LOCAL_RELAY_ACCOUNT_ID,
  LOCAL_RELAY_TOKEN,
} from "../features/cloud/publicConfig";

export const isLocalRelayAuthBuild = isLocalRelayAuth();

// The relay accepts any bearer and resolves its single user itself, so this
// reports a permanently signed-in account and hands out a fixed token.
function useLocalRelayAuth() {
  return {
    getToken: () => Promise.resolve(LOCAL_RELAY_TOKEN),
    isLoaded: true,
    isSignedIn: true,
    userId: LOCAL_RELAY_ACCOUNT_ID,
  };
}

// Only the primary email is read (for the account row's label), so that is all
// this supplies — the label reads "Local relay" instead of an address.
function useLocalRelayUser() {
  return { user: { primaryEmailAddress: { emailAddress: "Local relay" } } };
}

// The casts are the point of the module: the local shims implement exactly the
// slice of Clerk's surface this app reads, and the alternative is repeating a
// conditional at every call site.
export const useCloudAuth: typeof useAuth = isLocalRelayAuthBuild
  ? (useLocalRelayAuth as unknown as typeof useAuth)
  : useAuth;

export const useCloudUser: typeof useUser = isLocalRelayAuthBuild
  ? (useLocalRelayUser as unknown as typeof useUser)
  : useUser;
// [FORK] end
