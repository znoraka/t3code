import { useAuth } from "@clerk/expo";
import { AuthView, UserProfileView } from "@clerk/expo/native";
import { StackActions, useNavigation } from "@react-navigation/native";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { useEffect } from "react";
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

  useEffect(() => {
    if (!showAccountScreen) {
      navigation.dispatch(StackActions.replace("Settings"));
    }
  }, [navigation, showAccountScreen]);

  return showAccountScreen ? <ConfiguredSettingsAuthRouteScreen /> : null;
}

function ConfiguredSettingsAuthRouteScreen() {
  const { isLoaded, isSignedIn } = useAuth({ treatPendingAsSignedOut: false });

  return (
    <>
      <NativeStackScreenOptions options={{ title: isSignedIn ? "Account" : "Sign in" }} />
      <View collapsable={false} className="flex-1 overflow-hidden bg-sheet">
        {isLoaded ? (
          isSignedIn ? (
            <UserProfileView isDismissible={false} />
          ) : (
            <AuthView isDismissible={false} />
          )
        ) : null}
      </View>
    </>
  );
}
