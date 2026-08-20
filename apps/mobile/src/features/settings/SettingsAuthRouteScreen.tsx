import { useAuth } from "@clerk/expo";
import { AuthView, UserProfileView } from "@clerk/expo/native";
import { StackActions, useNavigation } from "@react-navigation/native";
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { View } from "react-native";

import { hasCloudPublicConfig } from "../cloud/publicConfig";
// [FORK] lempire: local-relay builds have no Clerk account UI
import { isLocalRelayAuthBuild } from "../../_lempire/cloudAuth";
// [FORK] end

export function SettingsAuthRouteScreen() {
  const navigation = useNavigation();
  // [FORK] lempire: the self-hosted relay has no accounts, so there is nothing
  // for Clerk's AuthView/UserProfileView to render — and no ClerkProvider to
  // render them under. Treat local-relay builds like an unconfigured cloud.
  const showAccountScreen = hasCloudPublicConfig() && !isLocalRelayAuthBuild;
  // [FORK] end

  useLayoutEffect(() => {
    if (!showAccountScreen) {
      navigation.dispatch(StackActions.replace("SettingsContent"));
    }
  }, [navigation, showAccountScreen]);

  return showAccountScreen ? <ConfiguredSettingsAuthRouteScreen /> : null;
}

function ConfiguredSettingsAuthRouteScreen() {
  const { isLoaded, isSignedIn } = useAuth({ treatPendingAsSignedOut: false });
  const navigation = useNavigation();
  const handleHostBack = useCallback(
    () => navigation.dispatch(StackActions.popTo("SettingsContent")),
    [navigation],
  );
  const hasBeenSignedIn = useRef(isSignedIn);
  if (isSignedIn) {
    hasBeenSignedIn.current = true;
  }

  useEffect(() => {
    if (hasBeenSignedIn.current && isLoaded && isSignedIn === false) {
      navigation.dispatch(StackActions.popTo("SettingsContent"));
    }
  }, [isLoaded, isSignedIn, navigation]);

  return (
    <View collapsable={false} className="flex-1 overflow-hidden bg-sheet">
      {isLoaded ? (
        hasBeenSignedIn.current ? (
          <UserProfileView isDismissible={false} onHostBack={handleHostBack} />
        ) : (
          <AuthView isDismissible={false} onHostBack={handleHostBack} />
        )
      ) : null}
    </View>
  );
}
