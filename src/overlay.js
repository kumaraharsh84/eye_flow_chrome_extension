/**
 * @file overlay.js
 * @description Fullscreen eye-break and water-break UI injected into the page.
 *
 * This module is pure UI. It builds the overlay with DOM APIs (never innerHTML),
 * pauses page media while it is up, keeps keyboard and wheel input away from the
 * feed underneath, and reports what the user did through callbacks. content.js
 * owns all messaging with the service worker.
 *
 * Styles live in overlay.css, scoped under #eyeflow-overlay.
 */

export const EyeFlowOverlay = (() => {
  // Positions (percent of the exercise area) the dot visits, one every 1.5 seconds.
  const DOT_POSITIONS = [
    ['50%', '50%'],
    ['10%', '10%'],
    ['10%', '90%'],
    ['90%', '90%'],
    ['90%', '10%'],
    ['10%', '50%'],
    ['90%', '50%'],
    ['50%', '10%'],
    ['50%', '90%'],
    ['22%', '24%'],
    ['22%', '76%'],
    ['78%', '24%'],
    ['78%', '76%'],
    ['18%', '50%'],
    ['82%', '50%'],
    ['50%', '50%'],
  ];
  const DOT_MOVE_INTERVAL_MS = 1500;
  const GUARD_INTERVAL_MS = 500;
  const FADE_OUT_MS = 300;

  const EXERCISE_INSTRUCTIONS = [
    'Follow the point slowly...',
    'Keep your head still and move only your eyes',
    'Reach the wider edges without rushing',
    'Stay soft and steady',
    'Almost done, let your eyes settle',
  ];
  const HYDRATION_INSTRUCTIONS = [
    'Take a slow sip and breathe.',
    'Relax your jaw and shoulders.',
    'Let your eyes rest away from the feed.',
    'A little water and a little pause help a lot.',
  ];
  const BLOCKED_EVENTS = ['keydown', 'keyup', 'keypress', 'wheel', 'touchmove'];

  let overlayElement = null;
  let countdownTimer = null;
  let dotTimer = null;
  let guardTimer = null;
  let pausedMedia = [];
  let closeHandler = null;
  let isClosing = false;

  // -------------------------------------------------------
  // DOM HELPERS
  // -------------------------------------------------------

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function button(className, text, onClick) {
    const node = el('button', className, text);
    node.type = 'button';
    node.addEventListener('click', onClick);
    return node;
  }

  function append(parent, ...children) {
    children.filter(Boolean).forEach((child) => parent.appendChild(child));
    return parent;
  }

  function callSafely(callback, ...args) {
    try {
      if (typeof callback === 'function') callback(...args);
    } catch (error) {
      // A failing callback must never leave the overlay stuck on screen
    }
  }

  // -------------------------------------------------------
  // MOUNT / UNMOUNT
  // -------------------------------------------------------

  function mount(card, { strict, label, onClosed }) {
    overlayElement = el('div', strict ? 'eyeflow-strict' : '');
    overlayElement.id = 'eyeflow-overlay';
    overlayElement.tabIndex = -1;
    overlayElement.setAttribute('role', 'dialog');
    overlayElement.setAttribute('aria-modal', 'true');
    overlayElement.setAttribute('aria-label', label);
    overlayElement.appendChild(card);

    closeHandler = onClosed;
    isClosing = false;

    attachOverlay();
    pausedMedia = [];
    runGuard();
    guardTimer = setInterval(runGuard, GUARD_INTERVAL_MS);
    BLOCKED_EVENTS.forEach((type) =>
      window.addEventListener(type, handleBlockedEvent, { capture: true, passive: false })
    );
    overlayElement.focus({ preventScroll: true });
  }

  function attachOverlay() {
    (document.body || document.documentElement).appendChild(overlayElement);
  }

  /** Keeps media paused and puts the overlay back if the page removed it. */
  function runGuard() {
    if (!overlayElement) return;
    if (!overlayElement.isConnected) attachOverlay();

    document.querySelectorAll('video, audio').forEach((media) => {
      if (!pausedMedia.some((entry) => entry.element === media)) {
        pausedMedia.push({ element: media, wasPlaying: !media.paused, wasMuted: media.muted });
      }
      media.muted = true;
      if (!media.paused) media.pause();
    });
  }

  function resumeMedia() {
    pausedMedia.forEach(({ element, wasPlaying, wasMuted }) => {
      if (!element.isConnected) return;
      element.muted = wasMuted;
      if (wasPlaying) element.play().catch(() => {});
    });
    pausedMedia = [];
  }

  function clearTimers() {
    clearInterval(countdownTimer);
    clearInterval(dotTimer);
    countdownTimer = null;
    dotTimer = null;
  }

  /** Fades the overlay out, restores the page, then reports `result` to the opener. */
  function hide(result = {}) {
    if (!overlayElement || isClosing) return;
    isClosing = true;
    clearTimers();
    overlayElement.classList.add('eyeflow-closing');

    setTimeout(() => {
      clearInterval(guardTimer);
      guardTimer = null;
      BLOCKED_EVENTS.forEach((type) =>
        window.removeEventListener(type, handleBlockedEvent, { capture: true })
      );
      if (overlayElement) overlayElement.remove();
      overlayElement = null;
      isClosing = false;
      resumeMedia();

      const onClosed = closeHandler;
      closeHandler = null;
      callSafely(onClosed, result);
    }, FADE_OUT_MS);
  }

  // -------------------------------------------------------
  // INPUT BLOCKING
  // -------------------------------------------------------

  /**
   * While a break is up, the feed underneath must not scroll or react to hotkeys.
   * Browser shortcuts (Ctrl/Cmd/Alt combos, function keys) are left alone.
   */
  function handleBlockedEvent(event) {
    if (!overlayElement) return;
    const target = event.target instanceof Element ? event.target : null;
    const insideOverlay = Boolean(target && overlayElement.contains(target));

    if (event.type === 'wheel' || event.type === 'touchmove') {
      // Allow scrolling a tall card on small screens, never the page behind it.
      const card = insideOverlay ? target.closest('.eyeflow-card') : null;
      const cardCanScroll = Boolean(card && card.scrollHeight > card.clientHeight);
      if (!cardCanScroll && event.cancelable) event.preventDefault();
      return;
    }

    if (event.ctrlKey || event.metaKey || event.altKey || /^F\d{1,2}$/.test(event.key)) return;
    event.stopImmediatePropagation();

    if (event.key === 'Tab') {
      event.preventDefault();
      if (event.type === 'keydown') moveFocus(event.shiftKey ? -1 : 1);
      return;
    }

    const activatesButton =
      insideOverlay && target.tagName === 'BUTTON' && (event.key === 'Enter' || event.key === ' ');
    if (!activatesButton) event.preventDefault();
  }

  /** Simple focus trap: Tab cycles through the overlay's own buttons. */
  function moveFocus(direction) {
    const buttons = Array.from(overlayElement.querySelectorAll('button:not(:disabled)'));
    if (buttons.length === 0) {
      overlayElement.focus({ preventScroll: true });
      return;
    }
    const currentIndex = buttons.indexOf(document.activeElement);
    const nextIndex =
      currentIndex === -1
        ? direction > 0
          ? 0
          : buttons.length - 1
        : (currentIndex + direction + buttons.length) % buttons.length;
    buttons[nextIndex].focus({ preventScroll: true });
  }

  // -------------------------------------------------------
  // COUNTDOWN
  // -------------------------------------------------------

  function buildCountdownParts(duration, instruction) {
    const progressFill = el('div', 'eyeflow-progress-fill');
    return {
      instruction: el('div', 'eyeflow-instruction', instruction),
      countdown: el('div', 'eyeflow-countdown', String(duration)),
      progressBar: append(el('div', 'eyeflow-progress-bar'), progressFill),
      progressFill,
    };
  }

  /** Counts down once per second. Time only passes while the tab is visible. */
  function startCountdown(duration, parts, instructions, onDone) {
    let timeLeft = duration;

    countdownTimer = setInterval(() => {
      if (document.hidden) return;
      timeLeft--;

      const elapsedShare = (duration - timeLeft) / duration;
      parts.countdown.textContent = String(Math.max(0, timeLeft));
      parts.progressFill.style.width = `${Math.min(100, elapsedShare * 100)}%`;
      parts.instruction.textContent =
        instructions[
          Math.min(instructions.length - 1, Math.floor(elapsedShare * instructions.length))
        ];

      if (timeLeft <= 0) {
        clearTimers();
        onDone();
      }
    }, 1000);
  }

  // -------------------------------------------------------
  // EYE BREAK
  // -------------------------------------------------------

  /**
   * Shows the guided eye exercise, then the post-break card.
   *
   * @param {Object} settings - Uses eyeBreakDurationSec.
   * @param {Object} options
   * @param {string} options.site - Site name shown on the post-break card.
   * @param {number} options.timeOnSite - Minutes of active time on the site.
   * @param {boolean} options.strict - Hide the skip button.
   * @param {boolean} options.hydrationPrompt - Add the water follow-up to the post-break card.
   * @param {Function} options.onCompleted - The exercise ran to the end.
   * @param {Function} options.onMood - (mood) The user tapped a mood button.
   * @param {Function} options.onHydration - ('done' | 'later') Water follow-up answer.
   * @param {Function} options.onCloseTab - The user chose to close the tab.
   * @param {Function} options.onClosed - ({ completed }) The overlay is gone.
   * @returns {boolean} False when an overlay is already showing.
   */
  function show(settings, options = {}) {
    if (overlayElement) return false;

    const duration = Number(settings?.eyeBreakDurationSec) || 20;
    const parts = buildCountdownParts(
      duration,
      `Follow the dot with your eyes - ${duration} seconds.`
    );
    const dot = el('div', 'eyeflow-dot');
    const card = append(
      el('div', 'eyeflow-card eyeflow-card-exercise'),
      append(el('div', 'eyeflow-exercise-area'), dot),
      parts.instruction,
      parts.countdown,
      parts.progressBar,
      options.strict
        ? null
        : button('eyeflow-skip-btn', 'Not right now', () => hide({ completed: false }))
    );

    mount(card, { strict: options.strict, label: 'EyeFlow eye break', onClosed: options.onClosed });

    let dotIndex = 0;
    dotTimer = setInterval(() => {
      dotIndex = (dotIndex + 1) % DOT_POSITIONS.length;
      [dot.style.top, dot.style.left] = DOT_POSITIONS[dotIndex];
    }, DOT_MOVE_INTERVAL_MS);

    startCountdown(duration, parts, EXERCISE_INSTRUCTIONS, () => {
      callSafely(options.onCompleted);
      showPostBreak(card, options);
    });
    return true;
  }

  function showPostBreak(card, options) {
    if (!overlayElement) return;
    card.className = 'eyeflow-card eyeflow-card-postbreak';

    const moodOptions = el('div', 'eyeflow-mood-options');
    [
      ['good', 'Good'],
      ['okay', 'Okay'],
      ['bad', 'Strained'],
    ].forEach(([mood, label]) => {
      const moodButton = button('eyeflow-mood-btn', label, () => {
        moodOptions
          .querySelectorAll('.eyeflow-mood-btn')
          .forEach((other) => other.classList.toggle('selected', other === moodButton));
        callSafely(options.onMood, mood);
      });
      moodOptions.appendChild(moodButton);
    });

    const minutes = Math.max(0, Math.round(Number(options.timeOnSite) || 0));
    const timeAlert = el('div', 'eyeflow-time-alert');
    if (minutes > 0 && options.site) {
      append(
        timeAlert,
        document.createTextNode('You have been on '),
        el('strong', '', options.site),
        document.createTextNode(' for '),
        el('strong', '', `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`),
        document.createTextNode('.')
      );
    } else {
      timeAlert.textContent = 'A short pause like this keeps your eyes fresh.';
    }

    const content = append(
      el('div', 'eyeflow-postbreak'),
      el('div', 'eyeflow-kicker', 'Break complete'),
      el('div', 'eyeflow-title', 'Your eyes got a moment to breathe.'),
      el('div', 'eyeflow-mood-title', 'How do your eyes feel?'),
      moodOptions,
      timeAlert,
      options.hydrationPrompt ? buildHydrationFollowUp(options) : null,
      append(
        el('div', 'eyeflow-action-btns'),
        button('eyeflow-action-btn eyeflow-action-primary', 'Close tab and step away', () => {
          callSafely(options.onCloseTab);
          hide({ completed: true });
        }),
        button('eyeflow-action-btn eyeflow-action-secondary', 'Continue browsing', () =>
          hide({ completed: true })
        )
      )
    );

    card.replaceChildren(content);
    overlayElement.focus({ preventScroll: true });
  }

  function buildHydrationFollowUp(options) {
    const actions = el('div', 'eyeflow-hydration-actions');
    const answer = (result, label) => {
      actions.querySelectorAll('button').forEach((node) => {
        node.disabled = true;
      });
      actions.replaceChildren(el('div', 'eyeflow-done-msg', label));
      callSafely(options.onHydration, result);
    };

    append(
      actions,
      button('eyeflow-action-btn eyeflow-action-primary', 'Already drank water', () =>
        answer('done', 'Nice. Water timer reset.')
      ),
      button('eyeflow-action-btn eyeflow-action-secondary', 'Remind me soon', () =>
        answer('later', 'Okay, we will check in again in a few minutes.')
      )
    );

    return append(
      el('div', 'eyeflow-hydration-followup'),
      el(
        'div',
        'eyeflow-hydration-followup-title',
        'Before you jump back in, take a few sips of water.'
      ),
      el(
        'div',
        'eyeflow-hydration-followup-text',
        'Hydration is also due, so this is a good moment to reset both your eyes and your body.'
      ),
      actions
    );
  }

  // -------------------------------------------------------
  // WATER BREAK
  // -------------------------------------------------------

  /**
   * Shows the fullscreen water break used on doom-scroll surfaces.
   *
   * @param {Object} settings - Uses hydrationBreakDurationSec.
   * @param {Object} options
   * @param {boolean} options.strict - No buttons; the countdown must run out.
   * @param {Function} options.onHydration - ('done' | 'later') How the break ended.
   * @param {Function} options.onClosed - The overlay is gone.
   * @returns {boolean} False when an overlay is already showing.
   */
  function showHydration(settings, options = {}) {
    if (overlayElement) return false;

    const duration = Number(settings?.hydrationBreakDurationSec) || 40;
    const parts = buildCountdownParts(duration, HYDRATION_INSTRUCTIONS[0]);
    const finish = (result) => {
      callSafely(options.onHydration, result);
      hide();
    };

    const card = append(
      el('div', 'eyeflow-card eyeflow-card-hydration'),
      el('div', 'eyeflow-title', 'Take a moment to drink some water.'),
      el(
        'div',
        'eyeflow-subtitle',
        'Pause here for a moment, take a few sips, and let your body reset before the next reel catches you.'
      ),
      append(
        el('div', 'eyeflow-exercise-area eyeflow-hydration-area'),
        append(
          el('div', 'eyeflow-hydration-glass'),
          el('div', 'eyeflow-hydration-glass-label', 'Water break'),
          el(
            'div',
            'eyeflow-hydration-glass-note',
            options.strict
              ? 'Take your water sips while the timer runs.'
              : 'Drink first, then choose what happens next.'
          )
        )
      ),
      parts.instruction,
      parts.countdown,
      parts.progressBar,
      options.strict
        ? null
        : append(
            el('div', 'eyeflow-hydration-actions'),
            button('eyeflow-action-btn eyeflow-action-primary', 'Already drank water', () =>
              finish('done')
            ),
            button('eyeflow-action-btn eyeflow-action-secondary', 'Remind me soon', () =>
              finish('later')
            )
          )
    );

    mount(card, {
      strict: options.strict,
      label: 'EyeFlow water break',
      onClosed: options.onClosed,
    });
    startCountdown(duration, parts, HYDRATION_INSTRUCTIONS, () => finish('done'));
    return true;
  }

  return {
    show,
    showHydration,
    hide,
    isShowing: () => Boolean(overlayElement),
  };
})();
