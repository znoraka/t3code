import { useAuth } from "@clerk/expo";
import {
  AuthView,
  type UserProfileCustomPage,
  UserProfileView,
} from "@clerk/expo/native-components";
import { StackActions, useNavigation } from "@react-navigation/native";
import { useEffect, useLayoutEffect, useState } from "react";
import { View } from "react-native";

import { hasCloudPublicConfig } from "../cloud/publicConfig";
// [FORK] lempire: local-relay builds have no Clerk account UI
import { isLocalRelayAuthBuild } from "../../_lempire/cloudAuth";
// [FORK] end
import { T3ConnectProfilePage } from "../cloud/T3ConnectProfilePage";

const USER_PROFILE_CUSTOM_PAGES = [
  {
    path: "t3-connect",
    label: "T3 Connect",
    icon: "globe",
    content: <T3ConnectProfilePage />,
  },
] satisfies UserProfileCustomPage[];

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
  const handleHostBack = () => navigation.dispatch(StackActions.popTo("SettingsContent"));
  // Once signed in, stay on the profile view so signing out pops back instead of
  // flashing the sign-in form.
  const [hasBeenSignedIn, setHasBeenSignedIn] = useState(isSignedIn === true);
  if (isSignedIn && !hasBeenSignedIn) setHasBeenSignedIn(true);

  useEffect(() => {
    if (hasBeenSignedIn && isLoaded && isSignedIn === false) {
      navigation.dispatch(StackActions.popTo("SettingsContent"));
    }
  }, [hasBeenSignedIn, isLoaded, isSignedIn, navigation]);

  return (
    <View collapsable={false} className="flex-1 overflow-hidden bg-sheet">
      {isLoaded ? (
        hasBeenSignedIn ? (
          <UserProfileView
            customPages={USER_PROFILE_CUSTOM_PAGES}
            isDismissible={false}
            onHostBack={handleHostBack}
          />
        ) : (
          <AuthView isDismissible={false} onHostBack={handleHostBack} />
        )
      ) : null}
    </View>
  );
}
