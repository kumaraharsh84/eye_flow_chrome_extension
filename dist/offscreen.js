(() => {
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __commonJS = (cb, mod) => function __require() {
    try {
      return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
    } catch (e) {
      throw mod = 0, e;
    }
  };

  // src/offscreen.js
  var require_offscreen = __commonJS({
    "src/offscreen.js"() {
      var audioContext = null;
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type !== "PLAY_REMINDER_SOUND") return;
        playReminderTone().then(() => sendResponse({ success: true })).catch(() => sendResponse({ success: false }));
        return true;
      });
      async function playReminderTone() {
        if (!audioContext) {
          audioContext = new AudioContext();
        }
        if (audioContext.state === "suspended") {
          await audioContext.resume();
        }
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        const now = audioContext.currentTime;
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(880, now);
        oscillator.frequency.exponentialRampToValueAtTime(660, now + 0.45);
        gainNode.gain.setValueAtTime(1e-4, now);
        gainNode.gain.exponentialRampToValueAtTime(0.05, now + 0.03);
        gainNode.gain.exponentialRampToValueAtTime(1e-4, now + 0.55);
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        oscillator.start(now);
        oscillator.stop(now + 0.6);
        await new Promise((resolve) => {
          oscillator.onended = resolve;
        });
      }
    }
  });
  require_offscreen();
})();
