import type { AuthClientPresentationMetadata } from "@t3tools/contracts";
import { requireOptionalNativeModule } from "expo";
import { Platform } from "react-native";

// [FORK] lempire: `expo-device` throws at import when its native module is missing,
// and OTA bundles reach binaries built before it was a dependency. This sits on the
// connection path, so read it optionally and omit the device fields instead.
const ExpoDevice = requireOptionalNativeModule<{
  readonly osVersion?: string | null;
  readonly modelName?: string | null;
  readonly deviceType?: number | null;
}>("ExpoDevice");

// Numeric values of expo-device's DeviceType enum, mirrored here so we can
// interpret the native constant without importing expo-device.
const DEVICE_TYPE_PHONE = 1;
const DEVICE_TYPE_TABLET = 2;
// [FORK] end

export function authClientMetadata(appVersion?: string): AuthClientPresentationMetadata {
  const osMajorVersion = Number.parseInt(ExpoDevice?.osVersion?.split(".")[0] ?? "", 10);
  const deviceModel = ExpoDevice?.modelName?.trim();

  return {
    // oxlint-disable-next-line t3code/no-untranslated-copy -- product name
    label: "T3 Code Mobile",
    deviceType:
      ExpoDevice?.deviceType === DEVICE_TYPE_TABLET
        ? "tablet"
        : ExpoDevice?.deviceType === DEVICE_TYPE_PHONE
          ? "mobile"
          : "unknown",
    ...(Platform.OS === "ios" ? { os: "iOS" } : Platform.OS === "android" ? { os: "Android" } : {}),
    ...(Number.isFinite(osMajorVersion) && osMajorVersion > 0 ? { osMajorVersion } : {}),
    ...(deviceModel ? { deviceModel } : {}),
    surface: "mobile",
    ...(appVersion ? { appVersion } : {}),
  };
}
