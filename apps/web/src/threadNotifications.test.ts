import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const audio = { currentTime: 0, notes: [] as number[] };

class FakeAudioContext {
  state = "running";
  destination = {};
  get currentTime() {
    return audio.currentTime;
  }
  resume() {
    return Promise.resolve();
  }
  createGain() {
    return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} };
  }
  createOscillator() {
    const oscillator = {
      type: "",
      frequency: { value: 0 },
      connect() {},
      start() {
        audio.notes.push(oscillator.frequency.value);
      },
      stop() {},
    };
    return oscillator;
  }
}

async function loadUnlocked() {
  const notifications = await import("./threadNotifications");
  notifications.unlockNotificationAudio();
  return notifications;
}

beforeEach(() => {
  vi.resetModules();
  audio.currentTime = 0;
  audio.notes = [];
  vi.stubGlobal("AudioContext", FakeAudioContext);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("playNotificationSound", () => {
  it("plays one sound for threads that complete together", async () => {
    const { playNotificationSound } = await loadUnlocked();

    for (let index = 0; index < 4; index += 1) playNotificationSound("completion", () => true);

    expect(audio.notes).toEqual([659.25, 523.25]);
  });

  it("still plays an input alert over a completion sound", async () => {
    const { playNotificationSound } = await loadUnlocked();
    playNotificationSound("completion", () => true);

    playNotificationSound("input", () => true);

    expect(audio.notes).toEqual([659.25, 523.25, 523.25, 659.25]);
  });

  it("leaves the slot free when a sound is turned off before it plays", async () => {
    const { playNotificationSound } = await loadUnlocked();
    playNotificationSound("completion", () => false);

    playNotificationSound("completion", () => true);

    expect(audio.notes).toEqual([659.25, 523.25]);
  });
});
