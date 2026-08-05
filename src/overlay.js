/**
 * @file overlay.js
 * @description Renders and manages the full-screen Eye-Break and Hydration overlay interface.
 *
 * @purpose
 * This script is injected as a content script to build the distraction-blocking
 * user interface directly on top of host doom-scrolling sites. It:
 *   1. Synthesizes a guided eye exercise screen (moving dot animation) promoting the 20-20-20 rule.
 *   2. Displays a timer countdown that blocks keyboard/mouse scrolling during the break cycle.
 *   3. Prompts the user with post-break mood check-ins and session details (time spent on site).
 *   4. Controls HTML5 media elements (`<video>`/`<audio>`) on the page, pausing autoplaying feeds
 *      (like reels or shorts) while the overlay is mounted, then resuming them when closed.
 *
 * @project-fit
 *   - Instantiated as a namespace singleton `EyeFlowOverlay`.
 *   - Driven directly by events and conditions tracked in `content.js`.
 *   - Communicates user feedback (e.g. logged moods) to the background worker (`background.js`).
 */

import { EyeFlowIntelligence } from './intelligence.js';

// ============================================================
// OVERLAY.JS — EyeFlow Eye-Break Overlay + Post-Break Experience
// ============================================================
// This file creates and manages the fullscreen eye-break overlay.
// It handles:
//   1. The eye exercise — animated dot that moves around the screen
//   2. Countdown timer — shows remaining time
//   3. Post-break mood check — "How are you feeling?" (😌 🙂 😤)
//   4. Time-on-site alert — "You've been on Instagram for 34 min"
//   5. Redirect suggestions — "Instead of scrolling, how about..."
//   6. Strict enforcement - hides the skip button on high-risk sites
// ============================================================

// -------------------------------------------------------
// EYEFLOW OVERLAY — Main overlay controller
// -------------------------------------------------------
/**
 * @namespace EyeFlowOverlay
 * @description IIFE managing the overlay mount state, animations, media control,
 * and user interactions during eye break exercises.
 */
export const EyeFlowOverlay = (() => {
  // A set of domains where we hide the "Skip" button to prevent impulsive bypasses.
  const ENFORCED_STRICT_SITES = new Set([
    'instagram.com',
    'tiktok.com',
    'reddit.com',
    'facebook.com',
    'twitter.com',
    'x.com',
  ]);

  // Reference to the main overlay root element appended to the host document's body.
  let overlayElement = null;

  // Timer ID for the countdown clock.
  let exerciseTimer = null;

  // Timer ID for updating the eye-tracking dot's position.
  let dotMoveTimer = null;

  // Timer ID for repeating video pauses (protects against pages that try to auto-play under the overlay).
  let mediaGuardTimer = null;

  // Toggle describing if the overlay UI is currently shown to the user.
  let isShowing = false;

  // Cache of paused video/audio elements and their initial playback settings, used for restorations.
  let pausedMediaElements = [];

  /**
   * @function hasLiveOverlayElement
   * @description Validates if our custom overlay element is actively attached to the browser's DOM tree.
   * @returns {boolean} True if the overlay element exists and is connected.
   */
  function hasLiveOverlayElement() {
    return Boolean(
      overlayElement && overlayElement.isConnected && document.contains(overlayElement)
    );
  }

  /**
   * @function ensureOverlayStateIsFresh
   * @description Checks if the overlay element was accidentally destroyed or detached by host page scripts.
   * Resets local flags if the element is missing.
   * @returns {boolean} True if the overlay is healthy and attached, false if it had to be cleaned up.
   */
  function ensureOverlayStateIsFresh() {
    if (hasLiveOverlayElement()) {
      return true;
    }

    overlayElement = null;
    isShowing = false;
    return false;
  }

  // -------------------------------------------------------
  // DOT POSITIONS — Where the eye dot moves to
  // -------------------------------------------------------
  // These positions guide the eye movement exercise.
  // The dot moves to each position in sequence, and the user
  // follows it with their eyes. Uses percentages of the area.
  /**
   * @constant {Object[]} DOT_POSITIONS
   * @description Screen coordinate percentages (relative to the viewport) that the eye-focus dot
   * will cycle through to encourage eye muscle stretches during the break exercise.
   */
  const DOT_POSITIONS = [
    { top: '50%', left: '50%' }, // Center
    { top: '10%', left: '10%' }, // Top-left
    { top: '10%', left: '90%' }, // Top-right
    { top: '90%', left: '90%' }, // Bottom-right
    { top: '90%', left: '10%' }, // Bottom-left
    { top: '10%', left: '50%' }, // Top-center
    { top: '90%', left: '50%' }, // Bottom-center
    { top: '50%', left: '10%' }, // Left-center
    { top: '50%', left: '90%' }, // Right-center
    { top: '22%', left: '24%' }, // Upper-left area
    { top: '22%', left: '76%' }, // Upper-right area
    { top: '78%', left: '24%' }, // Lower-left area
    { top: '78%', left: '76%' }, // Lower-right area
    { top: '18%', left: '50%' }, // Higher center
    { top: '82%', left: '50%' }, // Lower center
    { top: '50%', left: '50%' }, // Back to center
  ];

  // -------------------------------------------------------
  // SHOW OVERLAY — Display the fullscreen eye-break overlay
  // -------------------------------------------------------
  /**
   * @function show
   * @description Mounts the fullscreen guided eye exercise overlay onto the page, pauses background audio/video,
   * and starts the countdown/animation loops.
   *
   * @param {Object} settings - Extension settings dictionary.
   * @param {string} site - Hostname of the site we are blocking.
   * @param {number} timeOnSite - Time spent on this site in minutes.
   * @param {Object} [options={}] - Secondary display options (e.g. hydrationPrompt toggle).
   * @returns {void}
   *
   * @side-effects
   *   - Injects #eyeflow-overlay HTML element into document.body.
   *   - Pauses all site media playing in the tab.
   *   - Sets interval loops for animations.
   *
   * @called-by
   *   - content.js when an eye-break is triggered.
   */
  function show(settings, site, timeOnSite, options = {}) {
    // If the overlay is already showing and active in the DOM, do not duplicate it
    if (isShowing && ensureOverlayStateIsFresh()) return;
    isShowing = true;

    const duration = (settings && settings.eyeBreakDurationSec) || 20;
    const isStrict = isEnforcedStrictSite(site);

    // Create the overlay container
    overlayElement = document.createElement('div');
    overlayElement.id = 'eyeflow-overlay';

    // Pause background scroll loops and mute/pause video players
    pausePageMedia();

    // High-risk sites get extra CSS styles (like hiding scrollbars and forcing position overrides)
    if (isStrict) {
      overlayElement.classList.add('eyeflow-strict');
    }

    // Build the visual skeleton of the dot tracker
    overlayElement.innerHTML = buildExerciseHTML(duration, isStrict, site, timeOnSite);

    // Append to document root
    document.body.appendChild(overlayElement);

    // Bootstrap timers for countdown and dot movement
    startExercise(duration, site, timeOnSite, settings, options);
  }

  /**
   * @function showHydration
   * @description Mounts the dedicated full-screen Hydration reminder overlay.
   * Similar to the eye break, but displays instructions encouraging drinking water.
   *
   * @param {Object} settings - Extension settings dictionary.
   * @param {string} site - Hostname of the active page.
   * @param {number} timeOnSite - Unused parameter preserved for signature matching.
   * @returns {void}
   */
  function showHydration(settings, site, timeOnSite) {
    if (isShowing && ensureOverlayStateIsFresh()) return;
    isShowing = true;

    const duration = (settings && settings.hydrationBreakDurationSec) || 40;
    const isStrict = isEnforcedStrictSite(site);

    overlayElement = document.createElement('div');
    overlayElement.id = 'eyeflow-overlay';
    pausePageMedia();

    if (isStrict) {
      overlayElement.classList.add('eyeflow-strict');
    }

    overlayElement.innerHTML = buildHydrationHTML(duration, isStrict);
    document.body.appendChild(overlayElement);
    startHydration(duration);
  }

  /**
   * @function isEnforcedStrictSite
   * @description Helper to identify if the current URL fits strict block constraints.
   *
   * @param {string} site - HOST domain representation.
   * @returns {boolean} True if strict rules are active.
   */
  function isEnforcedStrictSite(site) {
    if (ENFORCED_STRICT_SITES.has(site)) {
      return true;
    }

    // Treat YouTube Shorts specifically as a strict doom-scroll site
    return site === 'youtube.com' && window.location.pathname.startsWith('/shorts');
  }

  // -------------------------------------------------------
  // BUILD EXERCISE HTML — Create the exercise screen HTML
  // -------------------------------------------------------
  /**
   * @function buildExerciseHTML
   * @description Creates the initial inner HTML structure for the eye exercise layout.
   */
  function buildExerciseHTML(duration, isStrict, site, timeOnSite) {
    return `
      <div class="eyeflow-card eyeflow-card-exercise">
        <!-- Eye exercise area — the dot moves here -->
        <div class="eyeflow-exercise-area">
          <div class="eyeflow-dot"></div>
        </div>

        <!-- Instruction text (changes during exercise) -->
        <div class="eyeflow-instruction">Follow the dot with your eyes — ${duration} seconds.</div>

        <!-- Countdown timer -->
        <div class="eyeflow-countdown">${duration}</div>

        <!-- Progress bar -->
        <div class="eyeflow-progress-bar">
          <div class="eyeflow-progress-fill"></div>
        </div>

        <!-- Skip button - hidden by strict enforcement on high-risk sites -->
        <button class="eyeflow-skip-btn">Not right now</button>
      </div>
    `;
  }

  /**
   * @function buildHydrationHTML
   * @description Creates the initial inner HTML structure for the hydration layout.
   */
  function buildHydrationHTML(duration, isStrict = false) {
    const actionButtons = isStrict
      ? ''
      : `
        <div class="eyeflow-hydration-actions">
          <button class="eyeflow-action-btn eyeflow-action-primary" data-hydration-action="done">Yes, just had some</button>
          <button class="eyeflow-action-btn eyeflow-action-secondary" data-hydration-action="later">Not right now</button>
        </div>
      `;

    const glassNote = isStrict
      ? 'Take your water sips while the timer resets.'
      : 'Drink first, then choose what happens next.';

    return `
      <div class="eyeflow-card eyeflow-card-hydration${isStrict ? ' eyeflow-strict' : ''}">
        <div class="eyeflow-title">Take a moment to drink some water.</div>
        <div class="eyeflow-subtitle">Pause here for a moment, take a few sips, and let your body reset before the next reel catches you.</div>

        <div class="eyeflow-exercise-area eyeflow-hydration-area">
          <div class="eyeflow-hydration-glass">
            <div class="eyeflow-hydration-glass-label">Water break</div>
            <div class="eyeflow-hydration-glass-note">${glassNote}</div>
          </div>
        </div>

        <div class="eyeflow-instruction">Take a slow sip and breathe.</div>

        <div class="eyeflow-countdown">${duration}</div>

        <div class="eyeflow-progress-bar">
          <div class="eyeflow-progress-fill"></div>
        </div>

        ${actionButtons}
      </div>
    `;
  }

  // -------------------------------------------------------
  // START EXERCISE — Begin the eye movement exercise
  // -------------------------------------------------------
  /**
   * @function startExercise
   * @description Sets up interval hooks to move the eye tracking dot, count down remaining time,
   * trigger compliance updates, and handle user exit clicks.
   */
  function startExercise(duration, site, timeOnSite, settings, options = {}) {
    let timeLeft = duration;
    let dotIndex = 0;

    // Retrieve visual nodes from the newly built overlay
    const dot = overlayElement.querySelector('.eyeflow-dot');
    const countdown = overlayElement.querySelector('.eyeflow-countdown');
    const progressFill = overlayElement.querySelector('.eyeflow-progress-fill');
    const instruction = overlayElement.querySelector('.eyeflow-instruction');
    const skipBtn = overlayElement.querySelector('.eyeflow-skip-btn');

    // Instructions displayed to guide the user's focus during exercise phases
    const instructions = [
      'Follow the point slowly...',
      'Keep your head still and move only your eyes',
      'Reach the wider edges without rushing',
      'Stay soft and steady',
      'Almost done, let your eyes settle',
    ];

    // Position the dot at initial coordinate
    if (dot) {
      const pos = DOT_POSITIONS[0];
      dot.style.top = pos.top;
      dot.style.left = pos.left;
    }

    // Dot motion loop: Moves the target dot to a new coordinate every 1.5 seconds
    dotMoveTimer = setInterval(() => {
      if (!dot) return;
      dotIndex = (dotIndex + 1) % DOT_POSITIONS.length;
      const pos = DOT_POSITIONS[dotIndex];
      dot.style.top = pos.top;
      dot.style.left = pos.left;
    }, 1500);

    // Countdown loop: Updates remaining time every 1 second
    exerciseTimer = setInterval(() => {
      timeLeft--;

      if (countdown) countdown.textContent = timeLeft;

      // Update linear progress bar fill width
      if (progressFill) {
        const progress = ((duration - timeLeft) / duration) * 100;
        progressFill.style.width = `${progress}%`;
      }

      // Rotate text instruction relative to remaining time segment
      if (instruction) {
        const instrIndex = Math.floor(((duration - timeLeft) / duration) * instructions.length);
        instruction.textContent = instructions[Math.min(instrIndex, instructions.length - 1)];
      }

      // Once time runs out, stop timers and transition to post-break screen
      if (timeLeft <= 0) {
        clearInterval(exerciseTimer);
        clearInterval(dotMoveTimer);

        // Tell background to register a successful break in the user statistics
        try {
          chrome.runtime.sendMessage({ type: 'EYE_BREAK_COMPLETED' });
        } catch (e) {
          // Ignored (fails when context is lost, but we fall back on local heuristics)
        }

        if (typeof EyeFlowIntelligence !== 'undefined') {
          EyeFlowIntelligence.recordBreakCompleted();
        }

        // Show feedback screen
        showPostBreak(site, timeOnSite, settings, options);
      }
    }, 1000);

    // Handle optional Skip interaction
    if (skipBtn) {
      skipBtn.addEventListener('click', () => {
        clearInterval(exerciseTimer);
        clearInterval(dotMoveTimer);
        try {
          // Log bypass decision
          chrome.runtime.sendMessage({
            type: 'ADD_AUDIT_LOG',
            event: 'Break Overlay Skipped',
            details: 'User clicked skip button during eye exercise',
          });
        } catch (_) {}
        hide();
      });
    }
  }

  /**
   * @function startHydration
   * @description Sets up timers and click events for the water reminder dialog.
   */
  function startHydration(duration) {
    let timeLeft = duration;
    const countdown = overlayElement.querySelector('.eyeflow-countdown');
    const progressFill = overlayElement.querySelector('.eyeflow-progress-fill');
    const instruction = overlayElement.querySelector('.eyeflow-instruction');
    const doneBtn = overlayElement.querySelector('[data-hydration-action="done"]');
    const laterBtn = overlayElement.querySelector('[data-hydration-action="later"]');

    const instructions = [
      'Take a slow sip and breathe.',
      'Relax your jaw and shoulders.',
      'Let your eyes rest away from the feed.',
      'A little water and a little pause help a lot.',
    ];

    exerciseTimer = setInterval(() => {
      timeLeft--;
      if (countdown) countdown.textContent = timeLeft;

      if (progressFill) {
        const progress = ((duration - timeLeft) / duration) * 100;
        progressFill.style.width = `${progress}%`;
      }

      if (instruction) {
        const instrIndex = Math.floor(((duration - timeLeft) / duration) * instructions.length);
        instruction.textContent = instructions[Math.min(instrIndex, instructions.length - 1)];
      }

      if (timeLeft <= 0) {
        clearInterval(exerciseTimer);
        window.dispatchEvent(new CustomEvent('eyeflow-hydration-completed'));
        hide();
      }
    }, 1000);

    if (doneBtn) {
      doneBtn.addEventListener('click', () => {
        window.dispatchEvent(new CustomEvent('eyeflow-hydration-completed'));
        hide();
      });
    }

    if (laterBtn) {
      laterBtn.addEventListener('click', () => {
        window.dispatchEvent(new CustomEvent('eyeflow-hydration-remind-soon'));
        hide();
      });
    }
  }

  // -------------------------------------------------------
  // SHOW POST-BREAK — The experience after the eye exercise
  // -------------------------------------------------------
  // Instead of just closing, we show:
  //   1. Mood check (one tap)
  //   2. Time-on-site alert
  //   3. Redirect suggestions
  /**
   * @function showPostBreak
   * @description Replaces the active exercise animation screen with a summary feedback card.
   * Prompts the user to log eye strain level, tells them their usage time on the current site,
   * and gives options to step away (close tab) or stay.
   */
  function showPostBreak(site, timeOnSite, settings, options = {}) {
    if (!overlayElement) return;

    const card = overlayElement.querySelector('.eyeflow-card');
    if (!card) return;
    card.classList.add('eyeflow-card-postbreak');

    // Build sub-prompt if hydration needs check in alongside eye break completion
    const hydrationSection = options.hydrationPrompt
      ? `
        <div class="eyeflow-hydration-followup">
          <div class="eyeflow-hydration-followup-title">Before you jump back in, take a few sips of water.</div>
          <div class="eyeflow-hydration-followup-text">Hydration is also due, so this is a good moment to reset both your eyes and your body.</div>
          <div class="eyeflow-hydration-actions">
            <button class="eyeflow-action-btn eyeflow-action-primary" data-hydration-followup="done">Yes, just had some</button>
            <button class="eyeflow-action-btn eyeflow-action-secondary" data-hydration-followup="later">Not right now</button>
          </div>
        </div>
    `
      : '';

    // Swap content of screen card to input/feedback view
    card.innerHTML = `
      <div class="eyeflow-postbreak">
        <!-- Title -->
        <div class="eyeflow-kicker">Break complete</div>
        <div class="eyeflow-title">Your eyes got a moment to breathe.</div>

        <!-- MOOD CHECK — How are you feeling? -->
        <div class="eyeflow-mood-title">How do your eyes feel?</div>
        <div class="eyeflow-mood-options">
          <button class="eyeflow-mood-btn" data-mood="good" title="Feeling good">Good</button>
          <button class="eyeflow-mood-btn" data-mood="okay" title="Feeling okay">Okay</button>
          <button class="eyeflow-mood-btn" data-mood="bad" title="Feeling stressed">Strained</button>
        </div>

        <!-- TIME-ON-SITE ALERT — How long you've been scrolling -->
        <div class="eyeflow-time-alert">
          You have been on <strong>${site}</strong> for <strong>${timeOnSite} minutes</strong>.
        </div>

        ${hydrationSection}

        <!-- ACTION BUTTONS — Close tab or keep going -->
        <div class="eyeflow-action-btns">
          <button class="eyeflow-action-btn eyeflow-action-primary" id="eyeflow-close-tab">
            Close tab and step away
          </button>
          <button class="eyeflow-action-btn eyeflow-action-secondary" id="eyeflow-keep-going">
            Continue browsing
          </button>
        </div>

        </div>
      </div>
    `;

    // --- Mood button handlers ---
    const moodBtns = card.querySelectorAll('.eyeflow-mood-btn');
    moodBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        moodBtns.forEach((b) => b.classList.remove('selected'));
        btn.classList.add('selected');

        const mood = btn.dataset.mood;
        try {
          // Log mood feedback to background worker
          chrome.runtime.sendMessage({
            type: 'MOOD_RECORDED',
            mood: mood,
            site: site,
          });
        } catch (e) {
          /* ignore */
        }
      });
    });

    // --- Close tab button ---
    const closeBtn = card.querySelector('#eyeflow-close-tab');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        try {
          chrome.runtime.sendMessage({
            type: 'ADD_AUDIT_LOG',
            event: 'Close Tab Clicked',
            details: 'User chose to close tab and step away',
          });
        } catch (_) {}

        try {
          // Instruct background script to perform tab removal (content scripts cannot close tabs themselves)
          chrome.runtime.sendMessage({ type: 'CLOSE_TAB' });
        } catch (e) {
          /* ignore */
        }
        window.close();
        hide();
      });
    }

    // --- Keep going button ---
    const keepBtn = card.querySelector('#eyeflow-keep-going');
    if (keepBtn) {
      keepBtn.addEventListener('click', () => {
        try {
          chrome.runtime.sendMessage({
            type: 'ADD_AUDIT_LOG',
            event: 'Continue Browsing Clicked',
            details: 'User dismissed post-break feedback card',
          });
        } catch (_) {}
        hide();
      });
    }

    // --- Hydration actions inside follow up prompt ---
    const hydrationDoneBtn = card.querySelector('[data-hydration-followup="done"]');
    const hydrationLaterBtn = card.querySelector('[data-hydration-followup="later"]');

    if (hydrationDoneBtn) {
      hydrationDoneBtn.addEventListener('click', () => {
        // Dispatch custom events locally to let content.js know water has been consumed
        window.dispatchEvent(new CustomEvent('eyeflow-hydration-completed'));
        hydrationDoneBtn.disabled = true;
        hydrationDoneBtn.textContent = 'Done - back to it';
      });
    }

    if (hydrationLaterBtn) {
      hydrationLaterBtn.addEventListener('click', () => {
        window.dispatchEvent(new CustomEvent('eyeflow-hydration-remind-soon'));
        hydrationLaterBtn.disabled = true;
        hydrationLaterBtn.textContent = 'Not right now';
      });
    }
  }

  // -------------------------------------------------------
  // HIDE OVERLAY — Remove the overlay from the page
  // -------------------------------------------------------
  /**
   * @function hide
   * @description Cleans up timers, triggers removal transition animations, deletes the overlay
   * DOM elements, resumes background audio/video, and triggers cleanup dispatch handlers.
   */
  function hide() {
    // Clear animation and counting intervals
    if (exerciseTimer) clearInterval(exerciseTimer);
    if (dotMoveTimer) clearInterval(dotMoveTimer);
    exerciseTimer = null;
    dotMoveTimer = null;

    if (overlayElement) {
      // Set reverse animation class for fade-out styling
      overlayElement.style.animation = 'eyeflow-overlay-fadein 0.3s ease-in reverse';

      // Wait for the fade-out CSS animation (300ms) to complete before removing the element
      setTimeout(() => {
        if (overlayElement) {
          overlayElement.remove();
          overlayElement = null;
        }
        resumePausedMedia();
        isShowing = false;
        finalizeBreakCycleClose();
      }, 300);
    } else {
      resumePausedMedia();
      isShowing = false;
      finalizeBreakCycleClose();
    }
  }

  /**
   * @function finalizeBreakCycleClose
   * @description Dispatches standard events notifying surrounding content scripts and background script
   * that the break view is closed and the countdown timeline can resume.
   */
  function finalizeBreakCycleClose() {
    window.dispatchEvent(new CustomEvent('eyeflow-break-flow-closed'));
    try {
      chrome.runtime.sendMessage({ type: 'EYE_BREAK_FLOW_CLOSED' });
    } catch (e) {
      /* ignore */
    }
  }

  /**
   * @function pausePageMedia
   * @description Scans the active page for HTML5 audio and video tags, pauses them,
   * and sets up a periodic loop checker.
   * Reels and Shorts pages frequently try to auto-play tracks or slide to next tracks
   * when overlays are appended; a loop checker defends against this.
   */
  function pausePageMedia() {
    pausedMediaElements = [];
    enforceMediaPause();

    if (mediaGuardTimer) clearInterval(mediaGuardTimer);
    mediaGuardTimer = setInterval(enforceMediaPause, 500);
  }

  /**
   * @function resumePausedMedia
   * @description Clears repeating media check timers and restores muted/paused states
   * on all video/audio tags to their states prior to the overlay block.
   */
  function resumePausedMedia() {
    if (mediaGuardTimer) {
      clearInterval(mediaGuardTimer);
      mediaGuardTimer = null;
    }

    pausedMediaElements.forEach((media) => {
      // Confirm the element still exists in the page structure
      if (!document.contains(media.element)) return;

      media.element.muted = media.wasMuted;
      if (media.wasPlaying) {
        media.element.play().catch(() => {});
      }
    });
    pausedMediaElements = [];
  }

  /**
   * @function enforceMediaPause
   * @description Query and force muting and pausing on all document-level audio and video media.
   */
  function enforceMediaPause() {
    document.querySelectorAll('video, audio').forEach((media) => {
      // Cache original states of the elements before we mute or pause them
      if (!pausedMediaElements.some((entry) => entry.element === media)) {
        pausedMediaElements.push({
          element: media,
          wasPlaying: !media.paused,
          wasMuted: media.muted,
        });
      }

      media.muted = true;
      if (!media.paused) {
        media.pause();
      }
    });
  }

  // -------------------------------------------------------
  // PUBLIC API — What content.js can call
  // -------------------------------------------------------
  return {
    show,
    showHydration,
    hide,
    isShowing: () => {
      if (!isShowing) return false;
      return ensureOverlayStateIsFresh();
    },
  };
})();
