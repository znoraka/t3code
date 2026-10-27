import { ClerkProvider, getClerkInstance } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import { setManagedRelaySession } from "@t3tools/client-runtime/relay";
import { useEffect, type ReactNode } from "react";

import { appAtomRegistry } from "../../state/atom-registry";
import { releaseAgentAwarenessRelayTokenProvider } from "../agent-awareness/remoteRegistration";
import {
  activateCloudRelayAccount,
  cloudAccountService,
  deactivateCloudRelayAccount,
} from "./cloudAccountService";
import {
  isLocalRelayAuth,
  LOCAL_RELAY_ACCOUNT_ID,
  LOCAL_RELAY_TOKEN,
  resolveCloudPublicConfig,
} from "./publicConfig";

const cloudConfig = resolveCloudPublicConfig();
// Build-time constant: null when this build has no cloud config.
const publishableKey = cloudConfig.relay.url ? cloudConfig.clerk.publishableKey : null;
// [FORK] lempire: local relay auth replaces the Clerk provider entirely.
const localRelayAuth = isLocalRelayAuth(cloudConfig);

if (publishableKey) {
  // The same native singleton ClerkProvider renders with, so the service
  // observes it for the app's lifetime without a React subscription.
  cloudAccountService.attach(getClerkInstance({ publishableKey }));
} else if (!localRelayAuth) {
  // Without cloud config no account can ever activate, so drop anything a
  // previous build with cloud enabled left registered.
  deactivateCloudRelayAccount();
}

// [FORK] lempire: the self-hosted relay has no Clerk, so there is no sign-in to
// wait for. Activating the relay session on mount is enough: everything
// downstream only consumes the token provider this installs.
function LocalRelayAuthBridge(props: { readonly children: ReactNode }) {
  useEffect(() => {
    activateCloudRelayAccount(LOCAL_RELAY_ACCOUNT_ID, () => Promise.resolve(LOCAL_RELAY_TOKEN));
    return () => {
      // Unmounting is not a sign-out: keep the persisted registration and any
      // running activities, exactly as the Clerk service's detach does.
      releaseAgentAwarenessRelayTokenProvider();
      setManagedRelaySession(appAtomRegistry, null);
    };
  }, []);

  return props.children;
}
// [FORK] end

export function CloudAuthProvider(props: { readonly children: ReactNode }) {
  // [FORK] lempire
  if (localRelayAuth) {
    return <LocalRelayAuthBridge>{props.children}</LocalRelayAuthBridge>;
  }
  // [FORK] end

  if (!publishableKey) {
    return props.children;
  }

  return (
    <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>
      {props.children}
    </ClerkProvider>
  );
}
