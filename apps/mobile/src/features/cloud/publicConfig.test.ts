import { describe, expect, it, vi } from "vite-plus/test";

import { isLocalRelayAuth, resolveCloudPublicConfig } from "./publicConfig";

vi.mock("expo-constants", () => ({
  default: {
    expoConfig: {
      extra: {},
    },
  },
}));

describe("resolveCloudPublicConfig", () => {
  it("rejects an insecure relay URL", () => {
    expect(
      resolveCloudPublicConfig({
        clerk: { publishableKey: "pk_test_example", jwtTemplate: "t3-relay" },
        relay: { url: "http://relay.example.test" },
      }),
    ).toEqual({
      clerk: {
        publishableKey: "pk_test_example",
        jwtTemplate: "t3-relay",
      },
      relay: {
        url: null,
      },
      observability: {
        tracesUrl: null,
        tracesDataset: null,
        tracesToken: null,
      },
    });
  });
});

// [FORK] lempire: self-hosted relay without Clerk
describe("local relay auth", () => {
  const localRelay = resolveCloudPublicConfig({
    relay: { url: "https://notify.example.test" },
  });
  const clerkRelay = resolveCloudPublicConfig({
    relay: { url: "https://relay.example.test" },
    clerk: { publishableKey: "pk_test_x", jwtTemplate: "t3-relay" },
  });

  it("treats a relay without Clerk as local auth", () => {
    expect(isLocalRelayAuth(localRelay)).toBe(true);
  });

  it("does not treat a Clerk-backed relay as local auth", () => {
    expect(isLocalRelayAuth(clerkRelay)).toBe(false);
  });

  it("needs a relay url before local auth applies", () => {
    expect(isLocalRelayAuth(resolveCloudPublicConfig({}))).toBe(false);
  });
});
