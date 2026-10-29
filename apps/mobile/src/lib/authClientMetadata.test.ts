import { describe, expect, it, vi } from "vite-plus/test";

// [FORK] lempire: authClientMetadata reads ExpoDevice optionally so OTA
// bundles keep booting on binaries built before expo-device existed.
vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
}));

vi.mock("expo", () => ({
  requireOptionalNativeModule: () => null,
}));

describe("authClientMetadata", () => {
  it("omits device details when the runtime has no ExpoDevice native module", async () => {
    const { authClientMetadata } = await import("./authClientMetadata");

    expect(authClientMetadata()).toEqual({
      label: "T3 Code Mobile",
      deviceType: "unknown",
      os: "iOS",
      surface: "mobile",
    });
  });
});
