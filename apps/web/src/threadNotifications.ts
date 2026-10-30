import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { ClientSettings } from "@t3tools/contracts/settings";

type NotificationMode = ClientSettings["notificationMode"];
export const NOTIFICATION_MODE_LABELS = {
  off: "Off",
  notifications: "Notifications only",
  sound: "Sound only",
  "notifications-and-sound": "Notifications with sound",
} satisfies Record<NotificationMode, string>;

export function hasNotificationSound(mode: NotificationMode) {
  return mode === "sound" || mode === "notifications-and-sound";
}

export function hasDesktopNotifications(mode: NotificationMode) {
  return mode === "notifications" || mode === "notifications-and-sound";
}

const TAG_HASH_OFFSET_BASIS = 0xcbf29ce484222325n;
const TAG_HASH_PRIME = 0x100000001b3n;
const TAG_HASH_MASK = 0xffffffffffffffffn;

/** Windows drops toast notifications with the 73-character environment/thread tag. */
export function threadNotificationTag(environmentId: EnvironmentId, threadId: ThreadId): string {
  const key = `${environmentId}:${threadId}`;
  let hash = TAG_HASH_OFFSET_BASIS;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= BigInt(key.charCodeAt(index));
    hash = (hash * TAG_HASH_PRIME) & TAG_HASH_MASK;
  }
  return hash.toString(16).padStart(16, "0");
}

let originalFavicon: HTMLLinkElement | undefined;
let badgeFavicon: HTMLLinkElement | undefined;

export function setNotificationBadge(count: number) {
  const bridge = window.desktopBridge;
  let image: string | null = null;
  if (count > 0 && (!bridge || bridge.getClientPlatform() === "win32")) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    const context = canvas.getContext("2d");
    if (context) {
      context.fillStyle = "#e5484d";
      context.beginPath();
      context.arc(32, 32, 28, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "white";
      context.font = `600 ${count > 9 ? 30 : 40}px "Segoe UI", sans-serif`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(count > 9 ? "9+" : String(count), 32, 34);
      image = canvas.toDataURL("image/png");
    }
  }
  if (!bridge) {
    if (image) {
      if (!badgeFavicon) {
        originalFavicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]') ?? undefined;
        badgeFavicon = document.createElement("link");
        badgeFavicon.rel = "icon";
        badgeFavicon.type = "image/png";
        badgeFavicon.sizes.value = "64x64";
        originalFavicon?.remove();
        document.head.append(badgeFavicon);
      }
      badgeFavicon.href = image;
    } else if (badgeFavicon) {
      badgeFavicon.remove();
      badgeFavicon = undefined;
      if (originalFavicon) document.head.append(originalFavicon);
      originalFavicon = undefined;
    }
  }
  void bridge?.setNotificationBadge({ count, image }).catch(() => undefined);
}

let audioContext: AudioContext | undefined;
/** When each sound's current playback ends, on the audio context's clock. */
const playingUntil = new Map<string, number>();

// [FORK] lempire: our two-note chimes instead of upstream's recorded sounds.
const CHIMES = {
  completion: [659.25, 523.25],
  input: [523.25, 659.25],
} satisfies Record<"completion" | "input", ReadonlyArray<number>>;
const NOTE_SECONDS = 0.12;
const NOTE_GAP_SECONDS = 0.05;

/** Called from a gesture so browsers allow later background playback. */
export function unlockNotificationAudio() {
  audioContext ??= new AudioContext();
  void audioContext.resume().catch(() => undefined);
}

export function playNotificationSound(kind: "completion" | "input", shouldPlay: () => boolean) {
  if (!audioContext || audioContext.state !== "running" || !shouldPlay()) return;
  const context = audioContext;
  const now = context.currentTime;
  // Coalesce same-sound bursts to avoid clipping; input and completion alerts keep separate slots.
  if (now < (playingUntil.get(kind) ?? 0)) return;
  const notes = CHIMES[kind];
  notes.forEach((frequency, index) => {
    const start = now + index * (NOTE_SECONDS + NOTE_GAP_SECONDS);
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.3, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + NOTE_SECONDS);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + NOTE_SECONDS);
  });
  playingUntil.set(kind, now + notes.length * (NOTE_SECONDS + NOTE_GAP_SECONDS));
}
// [FORK] end
