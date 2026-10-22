import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId } from "@t3tools/contracts";

import { toStableSavedRemoteConnection } from "./connection";

const mobilePlatform = vi.hoisted(() => ({ OS: "ios" as "ios" | "android" }));
const mobileDevice = vi.hoisted(() => ({
  deviceType: 1 as number | null,
  osVersion: "18.4.1" as string | null,
  modelName: "iPhone 15 Pro" as string | null,
}));
// [FORK] lempire: authClientMetadata reads ExpoDevice optionally so OTA
// bundles keep booting on binaries built before expo-device existed.
const nativeDevice = vi.hoisted(() => ({ current: mobileDevice as unknown }));

vi.mock("./runtime", () => ({
  runtime: {
    runPromise: vi.fn(),
  },
}));

vi.mock("react-native", () => ({
  Platform: mobilePlatform,
}));

vi.mock("expo", () => ({
  requireOptionalNativeModule: () => nativeDevice.current,
}));

describe("mobile remote connection records", () => {
  afterEach(() => {
    mobilePlatform.OS = "ios";
    mobileDevice.deviceType = 1;
    mobileDevice.osVersion = "18.4.1";
    mobileDevice.modelName = "iPhone 15 Pro";
    nativeDevice.current = mobileDevice;
  });

  it("omits device details when the runtime has no ExpoDevice native module", async () => {
    nativeDevice.current = null;
    vi.resetModules();

    const { authClientMetadata: withoutNativeDevice } = await import("./authClientMetadata");

    expect(withoutNativeDevice()).toEqual({
      label: "T3 Code Mobile",
      deviceType: "unknown",
      os: "iOS",
      surface: "mobile",
    });
  });

  it("drops short-lived managed environment credentials from stable records", () => {
    const connection = {
      environmentId: EnvironmentId.make("environment-1"),
      environmentLabel: "Desktop",
      pairingUrl: "https://desktop.example/",
      displayUrl: "https://desktop.example/",
      httpBaseUrl: "https://desktop.example/",
      wsBaseUrl: "wss://desktop.example/",
      bearerToken: null,
      authenticationMethod: "dpop",
      dpopAccessToken: "short-lived-token",
      relayManaged: true,
    } as const;

    expect(toStableSavedRemoteConnection(connection)).not.toHaveProperty("dpopAccessToken");
  });
});
