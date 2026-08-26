import type { AuthClientPresentationMetadata } from "@t3tools/contracts";
import { requireOptionalNativeModule } from "expo";
import { Platform } from "react-native";

// [FORK] lempire: upstream imports `expo-device`, whose entry point calls
// `requireNativeModule("ExpoDevice")` and throws when the native module is
// missing. This fork ships OTA updates to binaries built before expo-device
// was a dependency, and this module sits on the connection path — a throw here
// takes the whole app down at import time. Read the module optionally instead
// so pre-expo-device runtimes just omit the device fields.
const ExpoDevice = requireOptionalNativeModule<{
  readonly osVersion?: string | null;
  readonly modelName?: string | null;
}>("ExpoDevice");
// [FORK] end

export function authClientMetadata(appVersion?: string): AuthClientPresentationMetadata {
  const osMajorVersion = Number.parseInt(ExpoDevice?.osVersion?.split(".")[0] ?? "", 10);
  const deviceModel = ExpoDevice?.modelName?.trim();

  return {
    label: "T3 Code Mobile",
    deviceType: "mobile",
    ...(Platform.OS === "ios" ? { os: "iOS" } : Platform.OS === "android" ? { os: "Android" } : {}),
    ...(Number.isFinite(osMajorVersion) && osMajorVersion > 0 ? { osMajorVersion } : {}),
    ...(deviceModel ? { deviceModel } : {}),
    surface: "mobile",
    ...(appVersion ? { appVersion } : {}),
  };
}
