/**
 * @file offscreen.js
 * @description Audio Playback Handler running in Chrome Offscreen Document.
 *
 * @purpose
 * In Manifest V3, Chrome Extension background scripts run as service workers.
 * Service workers do not have access to DOM-based APIs, including the Web Audio API
 * (AudioContext) or HTMLMediaElement (<audio>), meaning they cannot play sound alerts.
 * To play sound without forcing a popup to remain open, we create a temporary, hidden
 * "offscreen document" (offscreen.html + offscreen.js) that runs in a standard DOM context
 * and handles audio synthesis.
 *
 * @project-fit
 *   - Spawned and closed by background.js using the `chrome.offscreen` API.
 *   - Listens for message commands to play sound and plays a synthesized chime using Web Audio API.
 */

// Global AudioContext cache. Reusing the context prevents memory leaks and potential browser warnings.
let audioContext = null;

// ============================================================
// MESSAGE LISTENER
// ============================================================
/**
 * chrome.runtime.onMessage.addListener
 * @description Listens for messages from the service worker (background.js).
 * If the action requested is 'PLAY_REMINDER_SOUND', it triggers the audio synthesizer.
 *
 * @param {Object} message - The message payload sent from background.js.
 * @param {chrome.runtime.MessageSender} sender - Information about the script sending the message.
 * @param {Function} sendResponse - Callback function to acknowledge receipt and return output.
 *
 * @returns {boolean} True - Signals to Chrome that the response is asynchronous, keeping the message channel open.
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== 'PLAY_REMINDER_SOUND') return;

  // Synthesize and play the tone, returning success or failure to the sender
  playReminderTone()
    .then(() => sendResponse({ success: true }))
    .catch(() => sendResponse({ success: false }));

  // Returning true is crucial here; it tells Chrome we want to resolve the promise/callback asynchronously
  return true;
});

// ============================================================
// AUDIO SYNTHESIS LOGIC
// ============================================================
/**
 * @function playReminderTone
 * @description Synthesizes a gentle dual-frequency chime using the Web Audio API.
 * We programmatically generate the audio wave instead of loading an .mp3 file,
 * which eliminates network latency and local file-io overhead.
 *
 * @returns {Promise<void>} Resolves when the tone has finished playing.
 *
 * @side-effects
 *   - Resumes or instantiates the browser's global AudioContext.
 *   - Outputs audio frequencies to the system's active sound card.
 *
 * @called-by
 *   - The runtime message listener on 'PLAY_REMINDER_SOUND'.
 *
 * @uses
 *   - AudioContext: Standard HTML5 API for synthesizing and processing audio.
 *   - OscillatorNode: Generates sine waves of specific frequencies.
 *   - GainNode: Controls the sound envelope (fade-in, volume, fade-out).
 */
async function playReminderTone() {
  // Lazily initialize the AudioContext. Browsers block audio initialization before user interaction,
  // but offscreen pages have special permissions under Chrome extensions.
  if (!audioContext) {
    audioContext = new AudioContext();
  }

  // If the context is suspended (often done by browsers to save memory), resume it before synthesizing.
  if (audioContext.state === 'suspended') {
    await audioContext.resume();
  }

  // Create Web Audio nodes
  // Oscillator generates the frequency; GainNode acts as the volume knob.
  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();
  const now = audioContext.currentTime;

  // Tone profile: Sine wave
  oscillator.type = 'sine';

  // Set initial tone frequency to 880Hz (A5 note)
  oscillator.frequency.setValueAtTime(880, now);
  // Slide down exponentially to 660Hz (E5 note) over 0.45 seconds to create a gentle, descending chime
  oscillator.frequency.exponentialRampToValueAtTime(660, now + 0.45);

  // Volume envelope (prevent pop/clicks by starting at volume 0 and fading in/out)
  gainNode.gain.setValueAtTime(0.0001, now);
  // Quick fade-in (attack stage) to peak volume 0.05 in 30ms
  gainNode.gain.exponentialRampToValueAtTime(0.05, now + 0.03);
  // Smooth fade-out (decay/release stage) to silence by 550ms
  gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);

  // Connect nodes: Oscillator -> Gain Node -> Speakers/Destination
  oscillator.connect(gainNode);
  gainNode.connect(audioContext.destination);

  // Start synthesizing immediately
  oscillator.start(now);
  // Stop synthesizing at 600ms, which is slightly after the gain hits near-zero
  oscillator.stop(now + 0.6);

  // Wait for the oscillator node's onended event to fire before resolving the promise
  // This ensures the service worker doesn't tear down the offscreen document while sound is playing
  await new Promise((resolve) => {
    oscillator.onended = resolve;
  });
}
