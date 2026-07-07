import type { ConfigContext, ExpoConfig } from "expo/config";

import { loadRepoEnv } from "../../scripts/lib/public-config.ts";

type AppVariant = "development" | "preview" | "production";

const repoEnv = loadRepoEnv();
Object.assign(process.env, repoEnv);

const APP_VARIANT = resolveAppVariant(repoEnv.APP_VARIANT);

// Bundle identifiers are globally unique per Apple team; forks must override this root
// (e.g. MOBILE_BUNDLE_ID=dev.ezag.t3code) to provision under their own team.
const BUNDLE_ID_ROOT = repoEnv.MOBILE_BUNDLE_ID ?? "com.t3tools.t3code";

const VARIANT_CONFIG: Record<
  AppVariant,
  {
    readonly appName: string;
    readonly scheme: string;
    readonly iosIcon: string;
    readonly splashIcon: string;
    readonly iosBundleIdentifier: string;
    readonly androidPackage: string;
  }
> = {
  development: {
    appName: "T3 Code Dev",
    scheme: "t3code-dev",
    iosIcon: "./assets/icon-composer-dev.icon",
    splashIcon: "./assets/splash-icon-dev.png",
    iosBundleIdentifier: `${BUNDLE_ID_ROOT}.dev`,
    androidPackage: `${BUNDLE_ID_ROOT}.dev`,
  },
  preview: {
    appName: "T3 Code Preview",
    scheme: "t3code-preview",
    iosIcon: "./assets/icon-composer-prod.icon",
    splashIcon: "./assets/splash-icon-prod.png",
    iosBundleIdentifier: `${BUNDLE_ID_ROOT}.preview`,
    androidPackage: `${BUNDLE_ID_ROOT}.preview`,
  },
  production: {
    appName: "T3 Code",
    scheme: "t3code",
    iosIcon: "./assets/icon-composer-prod.icon",
    splashIcon: "./assets/splash-icon-prod.png",
    iosBundleIdentifier: BUNDLE_ID_ROOT,
    androidPackage: BUNDLE_ID_ROOT,
  },
};

function resolveAppVariant(value: string | undefined): AppVariant {
  switch (value) {
    case "development":
    case "preview":
    case "production":
      return value;
    default:
      return "production";
  }
}

const variant = VARIANT_CONFIG[APP_VARIANT];

const EAS_OWNER = repoEnv.EAS_OWNER ?? "pingdotgg";
const EAS_PROJECT_ID =
  repoEnv.EAS_PROJECT_ID ??
  (EAS_OWNER === "pingdotgg" ? "d763fcb8-d37c-41ea-a773-b54a0ab4a454" : undefined);

// Universal Links (applinks) + passkey/password autofill (webcredentials) domain.
// These only validate when this domain's apple-app-site-association lists THIS app's
// ID, so a fork must point it at a domain it controls (MOBILE_RELYING_PARTY) AND enable
// the Associated Domains capability on its provisioning profile. Enabling the entitlement
// without a matching profile fails code signing, so default it on only for the upstream
// app; when unset, the associatedDomains entitlement is omitted entirely.
const RELYING_PARTY =
  repoEnv.MOBILE_RELYING_PARTY ?? (EAS_OWNER === "pingdotgg" ? "clerk.t3.codes" : undefined);

// The OTA config lives in apps/mobile/app.json (self-hosted expo-updates-go),
// which Expo passes here as `base`. Its runtimeVersion / updates.url are also
// what the `newversion` publish tool reads. When app.json omits them (e.g.
// upstream), we fall back to EAS Update below.
const buildConfig = (base: ConfigContext["config"]): ExpoConfig => ({
  name: variant.appName,
  slug: "t3-code",
  platforms: ["ios", "android"],
  scheme: variant.scheme,
  version: "0.1.0",
  runtimeVersion: base.runtimeVersion ?? {
    // Fingerprint (not appVersion) so an OTA only reaches binaries whose native
    // project — native deps, config plugins, AND patches/ — matches the update.
    // With appVersion, every 0.1.0 build shares a runtime version, so a JS update
    // could land on a binary missing the native changes it needs and crash.
    policy: process.env.MOBILE_VERSION_POLICY ?? "fingerprint",
  },
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "automatic",
  updates:
    base.updates ??
    (EAS_PROJECT_ID
      ? {
          enabled: true,
          url: `https://u.expo.dev/${EAS_PROJECT_ID}`,
          checkAutomatically: "ON_LOAD",
          fallbackToCacheTimeout: 0,
        }
      : { enabled: false }),
  ios: {
    icon: variant.iosIcon,
    supportsTablet: true,
    bundleIdentifier: variant.iosBundleIdentifier,
    // Pin code signing to the T3 Tools team so non-interactive `expo run:ios`
    // does not fall back to a personal team (which cannot sign app groups,
    // Sign in with Apple, or push notification entitlements).
    appleTeamId: "ARK85ZXQ4Z",
    ...(RELYING_PARTY
      ? {
          associatedDomains: [`applinks:${RELYING_PARTY}`, `webcredentials:${RELYING_PARTY}`],
        }
      : {}),
    infoPlist: {
      NSAppTransportSecurity: {
        NSAllowsArbitraryLoads: true,
      },
      NSLocalNetworkUsageDescription:
        "Allow T3 Code to connect to T3 Code servers on your local network or tailnet.",
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    icon: "./assets/icon.png",
    package: variant.androidPackage,
    adaptiveIcon: {
      backgroundColor: "#E6F4FE",
      foregroundImage: "./assets/android-icon-foreground.png",
      backgroundImage: "./assets/android-icon-background.png",
      monochromeImage: "./assets/android-icon-monochrome.png",
    },
    predictiveBackGestureEnabled: false,
  },
  web: {
    favicon: "./assets/favicon.png",
  },
  plugins: [
    "expo-font",
    "expo-secure-store",
    ["@clerk/expo", { theme: "./clerk-theme.json" }],
    "expo-web-browser",
    [
      "expo-camera",
      {
        cameraPermission: "Allow T3 Code to access your camera so you can scan pairing QR codes.",
        barcodeScannerEnabled: true,
      },
    ],
    [
      "expo-splash-screen",
      {
        image: variant.splashIcon,
        resizeMode: "contain",
        backgroundColor: "#ffffff",
        imageWidth: 220,
        dark: {
          image: variant.splashIcon,
          backgroundColor: "#0a0a0a",
        },
      },
    ],
    [
      "expo-build-properties",
      {
        ios: {
          deploymentTarget: "18.0",
          // AppCheckCore 11.3+ includes Swift and needs module maps for these Objective-C dependencies.
          extraPods: [
            { name: "GoogleUtilities", modular_headers: true },
            { name: "RecaptchaInterop", modular_headers: true },
          ],
        },
      },
    ],
    "./plugins/withIosCocoaPodsUuidCache.cjs",
    // Must be listed BEFORE expo-widgets: same-type mods run last-registered-
    // first, so registering earlier makes this plugin's mods run AFTER
    // expo-widgets' — its dangerous mod wipes ios/ExpoWidgetsTarget/ (which
    // would delete the asset catalog) and its xcodeproj mod creates the widget
    // target (which must exist before the compile phase can be attached).
    "./plugins/withWidgetLogoAsset.cjs",
    [
      "expo-widgets",
      {
        bundleIdentifier: `${variant.iosBundleIdentifier}.widgets`,
        groupIdentifier: `group.${variant.iosBundleIdentifier}`,
        enablePushNotifications: true,
        // Agent activity can update many times an hour; without the
        // frequent-updates entitlement iOS throttles the update budget sooner.
        frequentUpdates: true,
        widgets: [
          {
            name: "AgentActivity",
            displayName: "Agent Activity",
            description: "Shows the current state of active T3 Code agents.",
            supportedFamilies: ["systemSmall", "systemMedium", "accessoryRectangular"],
          },
        ],
      },
    ],
    "./plugins/withIosSceneLifecycle.cjs",
    "./plugins/withAndroidCleartextTraffic.cjs",
  ],
  extra: {
    appVariant: APP_VARIANT,
    relay: {
      url: repoEnv.T3CODE_RELAY_URL ?? null,
    },
    clerk: {
      publishableKey: repoEnv.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? null,
      jwtTemplate: repoEnv.EXPO_PUBLIC_CLERK_JWT_TEMPLATE ?? null,
    },
    observability: {
      tracesUrl: repoEnv.EXPO_PUBLIC_OTLP_TRACES_URL ?? "https://api.axiom.co/v1/traces",
      tracesDataset: repoEnv.EXPO_PUBLIC_OTLP_TRACES_DATASET ?? null,
      tracesToken: repoEnv.EXPO_PUBLIC_OTLP_TRACES_TOKEN ?? null,
    },
    ...(EAS_PROJECT_ID ? { eas: { projectId: EAS_PROJECT_ID } } : {}),
  },
  owner: EAS_OWNER,
});

export default ({ config }: ConfigContext): ExpoConfig => buildConfig(config);
