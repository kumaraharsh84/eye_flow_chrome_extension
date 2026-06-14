// ============================================================
// OVERLAY.JS — EyeFlow Eye-Break Overlay + Post-Break Experience
// ============================================================
// This file creates and manages the fullscreen eye-break overlay.
// It handles:
//   1. The eye exercise — animated dot that moves around the screen
//   2. Countdown timer — shows remaining time
//   3. Post-break mood check — "How are you feeling?" (😌 ðŸ˜ 😤)
//   4. Time-on-site alert — "You've been on Instagram for 34 min"
//   5. Redirect suggestions — "Instead of scrolling, how about..."
//   6. Strict enforcement - hides the skip button on high-risk sites
// ============================================================

const EYEFLOW_DEBUG_OVERLAY = false;

// -------------------------------------------------------
// EYEFLOW OVERLAY — Main overlay controller
// -------------------------------------------------------
export const EyeFlowOverlay = (() => {
  const ENFORCED_STRICT_SITES = new Set([
    'instagram.com',
    'tiktok.com',
    'reddit.com',
    'facebook.com',
    'twitter.com',
    'x.com'
  ]);

  let overlayElement = null;       // The overlay DOM element
  let exerciseTimer = null;        // Interval for the countdown
  let dotMoveTimer = null;         // Interval for moving the dot
  let mediaGuardTimer = null;      // Re-pauses autoplaying media while the overlay is visible
  let isShowing = false;           // Whether the overlay is currently visible
  let pausedMediaElements = [];    // Media paused while overlay is visible
  let shouldResetBreakCycleOnHide = false; // Delay the next break cycle until the post-break UI is dismissed

  function hasLiveOverlayElement() {
    return Boolean(
      overlayElement &&
      overlayElement.isConnected &&
      document.contains(overlayElement)
    );
  }

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
  const DOT_POSITIONS = [
    { top: '50%', left: '50%' },   // Center
    { top: '10%', left: '10%' },   // Top-left
    { top: '10%', left: '90%' },   // Top-right
    { top: '90%', left: '90%' },   // Bottom-right
    { top: '90%', left: '10%' },   // Bottom-left
    { top: '10%', left: '50%' },   // Top-center
    { top: '90%', left: '50%' },   // Bottom-center
    { top: '50%', left: '10%' },   // Left-center
    { top: '50%', left: '90%' },   // Right-center
    { top: '22%', left: '24%' },   // Upper-left area
    { top: '22%', left: '76%' },   // Upper-right area
    { top: '78%', left: '24%' },   // Lower-left area
    { top: '78%', left: '76%' },   // Lower-right area
    { top: '18%', left: '50%' },   // Higher center
    { top: '82%', left: '50%' },   // Lower center
    { top: '50%', left: '50%' },   // Back to center
  ];


  // -------------------------------------------------------
  // SHOW OVERLAY — Display the fullscreen eye-break overlay
  // -------------------------------------------------------
  // Called when content.js determines it's time for a break.
  // Parameters:
  //   settings — current extension settings
  //   site     — the hostname where doom scrolling was detected
  //   timeOnSite — how many minutes the user has been on this site
  function show(settings, site, timeOnSite, options = {}) {
    // Don't show multiple overlays
    if (isShowing && ensureOverlayStateIsFresh()) return;
    isShowing = true;

    const duration = (settings && settings.eyeBreakDurationSec) || 20;
    const isStrict = isEnforcedStrictSite(site);
    const suggestions = (settings && settings.redirectSuggestions) || [
      'Take a short walk',
      'Drink a glass of water',
      'Do a quick stretch',
      'Read a book for 5 min',
      'Step outside for fresh air'
    ];

    // Create the overlay DOM
    overlayElement = document.createElement('div');
    overlayElement.id = 'eyeflow-overlay';
    pausePageMedia();

    // Add strict enforcement styling automatically on high-risk sites.
    if (isStrict) {
      overlayElement.classList.add('eyeflow-strict');
    }

    // Build the exercise HTML
    overlayElement.innerHTML = buildExerciseHTML(duration, isStrict, site, timeOnSite, suggestions);

    // Add to page
    document.body.appendChild(overlayElement);

    // Start the eye exercise
    startExercise(duration, site, timeOnSite, suggestions, settings, options);
  }

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

    overlayElement.innerHTML = buildHydrationHTML(duration);
    document.body.appendChild(overlayElement);
    startHydration(duration);
  }

  function isEnforcedStrictSite(site) {
    if (ENFORCED_STRICT_SITES.has(site)) {
      return true;
    }

    return site === 'youtube.com' && window.location.pathname.startsWith('/shorts');
  }


  // -------------------------------------------------------
  // BUILD EXERCISE HTML — Create the exercise screen HTML
  // -------------------------------------------------------
  function buildExerciseHTML(duration, isStrict, site, timeOnSite, suggestions) {
    const breakLine = `${duration} seconds. Look away, breathe, come back.`;
    return `
      <div class="eyeflow-card eyeflow-card-exercise">
        <div class="eyeflow-title">Your eyes have been working hard</div>
        <div class="eyeflow-subtitle">${breakLine}</div>

        <!-- Eye exercise area — the dot moves here -->
        <div class="eyeflow-exercise-area">
          <div class="eyeflow-dot"></div>
        </div>

        <!-- Instruction text (changes during exercise) -->
        <div class="eyeflow-instruction">${breakLine}</div>

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

  function buildHydrationHTML(duration) {
    return `
      <div class="eyeflow-card eyeflow-card-hydration">
        <div class="eyeflow-title">Take a moment to drink some water.</div>
        <div class="eyeflow-subtitle">Pause here for a moment, take a few sips, and let your body reset before the next reel catches you.</div>

        <div class="eyeflow-exercise-area eyeflow-hydration-area">
          <div class="eyeflow-hydration-glass">
            <div class="eyeflow-hydration-glass-label">Water break</div>
            <div class="eyeflow-hydration-glass-note">Drink first, then choose what happens next.</div>
          </div>
        </div>

        <div class="eyeflow-instruction">Take a slow sip and breathe.</div>

        <div class="eyeflow-countdown">${duration}</div>

        <div class="eyeflow-progress-bar">
          <div class="eyeflow-progress-fill"></div>
        </div>

        <div class="eyeflow-hydration-actions">
          <button class="eyeflow-action-btn eyeflow-action-primary" data-hydration-action="done">Yes, just had some</button>
          <button class="eyeflow-action-btn eyeflow-action-secondary" data-hydration-action="later">Not right now</button>
        </div>
      </div>
    `;
  }


  // -------------------------------------------------------
  // START EXERCISE — Begin the eye movement exercise
  // -------------------------------------------------------
  // Moves the dot to different positions and counts down.
  function startExercise(duration, site, timeOnSite, suggestions, settings, options = {}) {
    let timeLeft = duration;
    let dotIndex = 0;

    const dot = overlayElement.querySelector('.eyeflow-dot');
    const countdown = overlayElement.querySelector('.eyeflow-countdown');
    const progressFill = overlayElement.querySelector('.eyeflow-progress-fill');
    const instruction = overlayElement.querySelector('.eyeflow-instruction');
    const skipBtn = overlayElement.querySelector('.eyeflow-skip-btn');

    // --- Instruction messages that rotate during the exercise ---
    const instructions = [
      'Follow the point slowly...',
      'Keep your head still and move only your eyes',
      'Reach the wider edges without rushing',
      'Stay soft and steady',
      'Almost done, let your eyes settle'
    ];

    // --- Move the dot every 1.5 seconds ---
    dotMoveTimer = setInterval(() => {
      dotIndex = (dotIndex + 1) % DOT_POSITIONS.length;
      const pos = DOT_POSITIONS[dotIndex];
      dot.style.top = pos.top;
      dot.style.left = pos.left;
    }, 1500);

    // --- Countdown every 1 second ---
    exerciseTimer = setInterval(() => {
      timeLeft--;

      // Update the countdown number
      countdown.textContent = timeLeft;

      // Update the progress bar width
      const progress = ((duration - timeLeft) / duration) * 100;
      progressFill.style.width = `${progress}%`;

      // Rotate through instruction messages
      const instrIndex = Math.floor(((duration - timeLeft) / duration) * instructions.length);
      instruction.textContent = instructions[Math.min(instrIndex, instructions.length - 1)];

      // When countdown reaches 0, exercise is complete!
      if (timeLeft <= 0) {
        clearInterval(exerciseTimer);
        clearInterval(dotMoveTimer);

        // Report eye break completion to background.js
        try {
          chrome.runtime.sendMessage({ type: 'EYE_BREAK_COMPLETED' });
        } catch (e) { /* ignore */ }

        if (typeof EyeFlowIntelligence !== 'undefined') {
          EyeFlowIntelligence.recordBreakCompleted();
        }

        // Do not restart the next break timer yet. Wait until the user fully
        // dismisses the post-break UI so we do not immediately queue another break.
        shouldResetBreakCycleOnHide = true;

        // Transition to post-break experience
        showPostBreak(site, timeOnSite, suggestions, settings, options);
      }
    }, 1000);

    // --- Skip button handler ---
    if (skipBtn) {
      skipBtn.addEventListener('click', () => {
        clearInterval(exerciseTimer);
        clearInterval(dotMoveTimer);
        hide();
      });
    }
  }

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
      'A little water and a little pause help a lot.'
    ];

    exerciseTimer = setInterval(() => {
      timeLeft--;
      countdown.textContent = timeLeft;

      const progress = ((duration - timeLeft) / duration) * 100;
      progressFill.style.width = `${progress}%`;

      const instrIndex = Math.floor(((duration - timeLeft) / duration) * instructions.length);
      instruction.textContent = instructions[Math.min(instrIndex, instructions.length - 1)];

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
  function showPostBreak(site, timeOnSite, suggestions, settings, options = {}) {
    if (!overlayElement) return;

    const card = overlayElement.querySelector('.eyeflow-card');
    if (!card) return;
    card.classList.add('eyeflow-card-postbreak');

    // Build the redirect suggestions HTML
    const suggestionsHTML = suggestions.slice(0, 4).map(s =>
      `<div class="eyeflow-redirect-chip">${s}</div>`
    ).join('');
    const hydrationSection = options.hydrationPrompt ? `
        <div class="eyeflow-hydration-followup">
          <div class="eyeflow-hydration-followup-title">Before you jump back in, take a few sips of water.</div>
          <div class="eyeflow-hydration-followup-text">Hydration is also due, so this is a good moment to reset both your eyes and your body.</div>
          <div class="eyeflow-hydration-actions">
            <button class="eyeflow-action-btn eyeflow-action-primary" data-hydration-followup="done">Yes, just had some</button>
            <button class="eyeflow-action-btn eyeflow-action-secondary" data-hydration-followup="later">Not right now</button>
          </div>
        </div>
    ` : '';

    // Replace the card content with post-break UI
    card.innerHTML = `
      <div class="eyeflow-postbreak">
        <!-- Title -->
        <div class="eyeflow-kicker">Break complete</div>
        <div class="eyeflow-title">Your eyes got a little room to breathe.</div>
        <div class="eyeflow-subtitle">Take a second to notice how they feel before you jump back in.</div>

        <!-- MOOD CHECK — How are you feeling? -->
        <div class="eyeflow-mood-title">How do your eyes feel now?</div>
        <div class="eyeflow-mood-options">
          <button class="eyeflow-mood-btn" data-mood="good" title="Feeling good">😌</button>
          <button class="eyeflow-mood-btn" data-mood="okay" title="Feeling okay">ðŸ˜</button>
          <button class="eyeflow-mood-btn" data-mood="bad" title="Feeling stressed">😤</button>
        </div>

        <!-- TIME-ON-SITE ALERT — How long you've been scrolling -->
        <div class="eyeflow-time-alert">
          You have been on <strong>${site}</strong> for <strong>${timeOnSite} minutes</strong>. You can keep going, or use this as a clean stopping point.
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

        <!-- REDIRECT SUGGESTIONS — What to do instead -->
        <div class="eyeflow-redirect-title">If you want a next step, try one of these:</div>
        <div class="eyeflow-redirect-list">
          ${suggestionsHTML}
        </div>

        <!-- Done message -->
        <div class="eyeflow-done-msg">Done - back to it</div>
      </div>
    `;
    card.querySelector('[data-mood="good"]').textContent = 'Good';
    card.querySelector('[data-mood="okay"]').textContent = 'Okay';
    card.querySelector('[data-mood="bad"]').textContent = 'Strained';

    // --- Mood button handlers ---
    // When user taps a mood emoji, save it and highlight the selection
    const moodBtns = card.querySelectorAll('.eyeflow-mood-btn');
    moodBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        // Highlight selected mood
        moodBtns.forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');

        // Send mood to background.js for stats
        const mood = btn.dataset.mood;
        try {
          chrome.runtime.sendMessage({
            type: 'MOOD_RECORDED',
            mood: mood,
            site: site
          });
        } catch (e) { /* ignore */ }
      });
    });

    // --- Close tab button ---
    // Actually closes the current tab when clicked
    const closeBtn = card.querySelector('#eyeflow-close-tab');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        // Try to close the tab via Chrome extension API
        try {
          chrome.runtime.sendMessage({ type: 'CLOSE_TAB' });
        } catch (e) { /* ignore */ }
        // Also try window.close() as fallback
        window.close();
        // If that didn't work, just hide the overlay
        hide();
      });
    }

    // --- Keep going button ---
    // Closes the overlay and lets the user continue browsing
    const keepBtn = card.querySelector('#eyeflow-keep-going');
    if (keepBtn) {
      keepBtn.addEventListener('click', hide);
    }

    const hydrationDoneBtn = card.querySelector('[data-hydration-followup="done"]');
    const hydrationLaterBtn = card.querySelector('[data-hydration-followup="later"]');
    if (hydrationDoneBtn) {
      hydrationDoneBtn.addEventListener('click', () => {
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

    // --- Redirect chip handlers ---
    // When user clicks a suggestion, close the overlay
    // (the suggestion itself is just a reminder)
    const chips = card.querySelectorAll('.eyeflow-redirect-chip');
    chips.forEach(chip => {
      chip.addEventListener('click', () => {
        // Highlight the chosen suggestion
        chips.forEach(c => c.style.borderColor = 'rgba(52, 211, 153, 0.2)');
        chip.style.borderColor = '#34d399';
        chip.style.background = 'rgba(52, 211, 153, 0.25)';

        // Close after a brief moment so user sees the selection
        setTimeout(hide, 800);
      });
    });
  }


  // -------------------------------------------------------
  // HIDE OVERLAY — Remove the overlay from the page
  // -------------------------------------------------------
  function hide() {
    const shouldFinalizeBreakCycle = shouldResetBreakCycleOnHide;
    shouldResetBreakCycleOnHide = false;

    // Clear any running timers
    if (exerciseTimer) clearInterval(exerciseTimer);
    if (dotMoveTimer) clearInterval(dotMoveTimer);
    exerciseTimer = null;
    dotMoveTimer = null;

    // Fade out animation
    if (overlayElement) {
      overlayElement.style.animation = 'eyeflow-overlay-fadein 0.3s ease-in reverse';
      setTimeout(() => {
        if (overlayElement) {
          overlayElement.remove();
          overlayElement = null;
        }
        resumePausedMedia();
        isShowing = false;
        if (shouldFinalizeBreakCycle) finalizeBreakCycleClose();
      }, 300);
    } else {
      resumePausedMedia();
      isShowing = false;
      if (shouldFinalizeBreakCycle) finalizeBreakCycleClose();
    }
  }

  function finalizeBreakCycleClose() {
    window.dispatchEvent(new CustomEvent('eyeflow-break-flow-closed'));
    try {
      chrome.runtime.sendMessage({ type: 'EYE_BREAK_FLOW_CLOSED' });
    } catch (e) { /* ignore */ }
  }

  function pausePageMedia() {
    pausedMediaElements = [];
    enforceMediaPause();

    if (mediaGuardTimer) clearInterval(mediaGuardTimer);
    // Some reels/shorts surfaces try to auto-resume media after overlays mount.
    // Keep a lightweight guard running so the feed stays paused until EyeFlow hides.
    mediaGuardTimer = setInterval(enforceMediaPause, 500);
  }

  function resumePausedMedia() {
    if (mediaGuardTimer) {
      clearInterval(mediaGuardTimer);
      mediaGuardTimer = null;
    }

    pausedMediaElements.forEach((media) => {
      if (!document.contains(media.element)) return;
      media.element.muted = media.wasMuted;
      if (media.wasPlaying) {
        media.element.play().catch(() => {});
      }
    });
    pausedMediaElements = [];
  }

  function enforceMediaPause() {
    document.querySelectorAll('video, audio').forEach((media) => {
      if (!pausedMediaElements.some((entry) => entry.element === media)) {
        pausedMediaElements.push({
          element: media,
          wasPlaying: !media.paused,
          wasMuted: media.muted
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
    }
  };

})();

