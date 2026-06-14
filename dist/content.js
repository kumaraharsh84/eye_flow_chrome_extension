(() => {
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __esm = (fn, res, err) =>
    function __init() {
      if (err) throw err[0];
      try {
        return (fn && (res = (0, fn[__getOwnPropNames(fn)[0]])((fn = 0))), res);
      } catch (e) {
        throw ((err = [e]), e);
      }
    };
  var __commonJS = (cb, mod) =>
    function __require() {
      try {
        return (
          mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod),
          mod.exports
        );
      } catch (e) {
        throw ((mod = 0), e);
      }
    };

  // src/intelligence.js
  var EyeFlowIntelligence;
  var init_intelligence = __esm({
    'src/intelligence.js'() {
      EyeFlowIntelligence = (() => {
        let currentBreakTargetMs = 0;
        let lastReminderAt = 0;
        let cachedSettings = null;
        let lastTypingTime = 0;
        function getCurrentContextKeys(hostname) {
          const cleanHost = hostname.replace(/^www\./, '');
          const path = window.location.pathname || '';
          const keys = [];
          if (cleanHost.includes('youtube.com') && path.startsWith('/shorts')) {
            keys.push('youtube.com/shorts');
          }
          keys.push(hostname);
          if (cleanHost !== hostname) {
            keys.push(cleanHost);
          }
          return keys;
        }
        function getSiteTier(hostname) {
          const contextKeys = getCurrentContextKeys(hostname);
          if (cachedSettings && cachedSettings.siteTiers) {
            for (const key of contextKeys) {
              if (cachedSettings.siteTiers[key]) {
                return cachedSettings.siteTiers[key];
              }
            }
          }
          return 'moderate';
        }
        function getScrollThreshold(hostname) {
          const tier = getSiteTier(hostname);
          const sensitivity = cachedSettings ? cachedSettings.sensitivity : 50;
          const baseThresholds = {
            strict: cachedSettings?.scrollThresholdStrict ?? 20,
            moderate: cachedSettings?.scrollThresholdModerate ?? 30,
            relaxed: cachedSettings?.scrollThresholdRelaxed ?? 45,
          };
          const base = baseThresholds[tier] || 15;
          const multiplier = 1.5 - sensitivity / 100;
          return Math.round(base * multiplier);
        }
        function getTimeWindow(hostname) {
          const tier = getSiteTier(hostname);
          const windows = {
            strict: 1e4,
            moderate: 15e3,
            relaxed: 2e4,
          };
          return windows[tier] || 15e3;
        }
        function determineStage(activeSessionMs = 0) {
          const now = Date.now();
          if (!currentBreakTargetMs) {
            currentBreakTargetMs = getNextBreakTargetMs();
          }
          if (activeSessionMs < currentBreakTargetMs) {
            return 'none';
          }
          if (!lastReminderAt || now - lastReminderAt >= 60 * 1e3) {
            return 'warning';
          }
          return 'none';
        }
        function getMsUntilBreak(activeSessionMs = 0) {
          if (!currentBreakTargetMs) {
            currentBreakTargetMs = getNextBreakTargetMs();
          }
          return Math.max(0, currentBreakTargetMs - activeSessionMs);
        }
        function resetStages() {
          lastReminderAt = 0;
          currentBreakTargetMs = getNextBreakTargetMs();
        }
        function recordBreakCompleted() {
          lastReminderAt = Date.now();
          currentBreakTargetMs = getNextBreakTargetMs();
        }
        function pauseForInactivity(inactiveMs) {
          if (!inactiveMs || inactiveMs <= 0) return;
          if (!currentBreakTargetMs) return;
          currentBreakTargetMs = Math.min(
            currentBreakTargetMs + inactiveMs,
            getNextBreakTargetMs() * 2
          );
        }
        function markReminderShown() {
          lastReminderAt = Date.now();
        }
        function getNextBreakTargetMs() {
          const minMinutes = (cachedSettings && cachedSettings.reminderIntervalMin) || 5;
          const maxMinutes = Math.max(
            minMinutes,
            (cachedSettings && cachedSettings.reminderIntervalMax) || minMinutes
          );
          const sensitivity =
            cachedSettings && cachedSettings.sensitivity !== void 0
              ? cachedSettings.sensitivity
              : 50;
          const multiplier = 1.5 - sensitivity / 100;
          return Math.round(getRandomInt(minMinutes, maxMinutes) * 60 * 1e3 * multiplier);
        }
        function getRandomInt(min, max) {
          const low = Math.ceil(min);
          const high = Math.floor(max);
          return Math.floor(Math.random() * (high - low + 1)) + low;
        }
        function isSingleVideoPage() {
          const url = window.location.href;
          const hostname = window.location.hostname;
          if (hostname.includes('youtube.com') && url.includes('/watch')) {
            return true;
          }
          if (hostname.includes('vimeo.com') && /\/\d+/.test(window.location.pathname)) {
            return true;
          }
          if (hostname.includes('netflix.com') && url.includes('/watch')) {
            return true;
          }
          return false;
        }
        function trackTyping() {
          document.addEventListener(
            'keydown',
            () => {
              lastTypingTime = Date.now();
            },
            { passive: true }
          );
        }
        function isUserTyping() {
          return Date.now() - lastTypingTime < 3e4;
        }
        function updateSettings(settings) {
          cachedSettings = settings;
          if (!currentBreakTargetMs) {
            currentBreakTargetMs = getNextBreakTargetMs();
          }
        }
        function init() {
          trackTyping();
          try {
            chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (settings) => {
              if (settings) cachedSettings = settings;
            });
          } catch (e) {}
        }
        init();
        return {
          getSiteTier,
          getScrollThreshold,
          getTimeWindow,
          determineStage,
          getMsUntilBreak,
          getNextBreakTargetMs,
          resetStages,
          recordBreakCompleted,
          pauseForInactivity,
          markReminderShown,
          isSingleVideoPage,
          isUserTyping,
          updateSettings,
        };
      })();
    },
  });

  // src/overlay.js
  var EyeFlowOverlay;
  var init_overlay = __esm({
    'src/overlay.js'() {
      init_intelligence();
      EyeFlowOverlay = /* @__PURE__ */ (() => {
        const ENFORCED_STRICT_SITES = /* @__PURE__ */ new Set([
          'instagram.com',
          'tiktok.com',
          'reddit.com',
          'facebook.com',
          'twitter.com',
          'x.com',
        ]);
        let overlayElement = null;
        let exerciseTimer = null;
        let dotMoveTimer = null;
        let mediaGuardTimer = null;
        let isShowing = false;
        let pausedMediaElements = [];
        let shouldResetBreakCycleOnHide = false;
        function hasLiveOverlayElement() {
          return Boolean(
            overlayElement && overlayElement.isConnected && document.contains(overlayElement)
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
        const DOT_POSITIONS = [
          { top: '50%', left: '50%' },
          // Center
          { top: '10%', left: '10%' },
          // Top-left
          { top: '10%', left: '90%' },
          // Top-right
          { top: '90%', left: '90%' },
          // Bottom-right
          { top: '90%', left: '10%' },
          // Bottom-left
          { top: '10%', left: '50%' },
          // Top-center
          { top: '90%', left: '50%' },
          // Bottom-center
          { top: '50%', left: '10%' },
          // Left-center
          { top: '50%', left: '90%' },
          // Right-center
          { top: '22%', left: '24%' },
          // Upper-left area
          { top: '22%', left: '76%' },
          // Upper-right area
          { top: '78%', left: '24%' },
          // Lower-left area
          { top: '78%', left: '76%' },
          // Lower-right area
          { top: '18%', left: '50%' },
          // Higher center
          { top: '82%', left: '50%' },
          // Lower center
          { top: '50%', left: '50%' },
          // Back to center
        ];
        function show(settings, site, timeOnSite, options = {}) {
          if (isShowing && ensureOverlayStateIsFresh()) return;
          isShowing = true;
          const duration = (settings && settings.eyeBreakDurationSec) || 20;
          const isStrict = isEnforcedStrictSite(site);
          const suggestions = (settings && settings.redirectSuggestions) || [
            'Take a short walk',
            'Drink a glass of water',
            'Do a quick stretch',
            'Read a book for 5 min',
            'Step outside for fresh air',
          ];
          overlayElement = document.createElement('div');
          overlayElement.id = 'eyeflow-overlay';
          pausePageMedia();
          if (isStrict) {
            overlayElement.classList.add('eyeflow-strict');
          }
          overlayElement.innerHTML = buildExerciseHTML(
            duration,
            isStrict,
            site,
            timeOnSite,
            suggestions
          );
          document.body.appendChild(overlayElement);
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
        function buildExerciseHTML(duration, isStrict, site, timeOnSite, suggestions) {
          const breakLine = `${duration} seconds. Look away, breathe, come back.`;
          return `
      <div class="eyeflow-card eyeflow-card-exercise">
        <div class="eyeflow-title">Your eyes have been working hard</div>
        <div class="eyeflow-subtitle">${breakLine}</div>

        <!-- Eye exercise area \u2014 the dot moves here -->
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
        function startExercise(duration, site, timeOnSite, suggestions, settings, options = {}) {
          let timeLeft = duration;
          let dotIndex = 0;
          const dot = overlayElement.querySelector('.eyeflow-dot');
          const countdown = overlayElement.querySelector('.eyeflow-countdown');
          const progressFill = overlayElement.querySelector('.eyeflow-progress-fill');
          const instruction = overlayElement.querySelector('.eyeflow-instruction');
          const skipBtn = overlayElement.querySelector('.eyeflow-skip-btn');
          const instructions = [
            'Follow the point slowly...',
            'Keep your head still and move only your eyes',
            'Reach the wider edges without rushing',
            'Stay soft and steady',
            'Almost done, let your eyes settle',
          ];
          dotMoveTimer = setInterval(() => {
            dotIndex = (dotIndex + 1) % DOT_POSITIONS.length;
            const pos = DOT_POSITIONS[dotIndex];
            dot.style.top = pos.top;
            dot.style.left = pos.left;
          }, 1500);
          exerciseTimer = setInterval(() => {
            timeLeft--;
            countdown.textContent = timeLeft;
            const progress = ((duration - timeLeft) / duration) * 100;
            progressFill.style.width = `${progress}%`;
            const instrIndex = Math.floor(((duration - timeLeft) / duration) * instructions.length);
            instruction.textContent = instructions[Math.min(instrIndex, instructions.length - 1)];
            if (timeLeft <= 0) {
              clearInterval(exerciseTimer);
              clearInterval(dotMoveTimer);
              try {
                chrome.runtime.sendMessage({ type: 'EYE_BREAK_COMPLETED' });
              } catch (e) {}
              if (typeof EyeFlowIntelligence !== 'undefined') {
                EyeFlowIntelligence.recordBreakCompleted();
              }
              shouldResetBreakCycleOnHide = true;
              showPostBreak(site, timeOnSite, suggestions, settings, options);
            }
          }, 1e3);
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
            'A little water and a little pause help a lot.',
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
          }, 1e3);
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
        function showPostBreak(site, timeOnSite, suggestions, settings, options = {}) {
          if (!overlayElement) return;
          const card = overlayElement.querySelector('.eyeflow-card');
          if (!card) return;
          card.classList.add('eyeflow-card-postbreak');
          const suggestionsHTML = suggestions
            .slice(0, 4)
            .map((s) => `<div class="eyeflow-redirect-chip">${s}</div>`)
            .join('');
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
          card.innerHTML = `
      <div class="eyeflow-postbreak">
        <!-- Title -->
        <div class="eyeflow-kicker">Break complete</div>
        <div class="eyeflow-title">Your eyes got a little room to breathe.</div>
        <div class="eyeflow-subtitle">Take a second to notice how they feel before you jump back in.</div>

        <!-- MOOD CHECK \u2014 How are you feeling? -->
        <div class="eyeflow-mood-title">How do your eyes feel now?</div>
        <div class="eyeflow-mood-options">
          <button class="eyeflow-mood-btn" data-mood="good" title="Feeling good">\u{1F60C}</button>
          <button class="eyeflow-mood-btn" data-mood="okay" title="Feeling okay">\xF0\u0178\u02DC\x90</button>
          <button class="eyeflow-mood-btn" data-mood="bad" title="Feeling stressed">\u{1F624}</button>
        </div>

        <!-- TIME-ON-SITE ALERT \u2014 How long you've been scrolling -->
        <div class="eyeflow-time-alert">
          You have been on <strong>${site}</strong> for <strong>${timeOnSite} minutes</strong>. You can keep going, or use this as a clean stopping point.
        </div>

        ${hydrationSection}

        <!-- ACTION BUTTONS \u2014 Close tab or keep going -->
        <div class="eyeflow-action-btns">
          <button class="eyeflow-action-btn eyeflow-action-primary" id="eyeflow-close-tab">
            Close tab and step away
          </button>
          <button class="eyeflow-action-btn eyeflow-action-secondary" id="eyeflow-keep-going">
            Continue browsing
          </button>
        </div>

        <!-- REDIRECT SUGGESTIONS \u2014 What to do instead -->
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
          const moodBtns = card.querySelectorAll('.eyeflow-mood-btn');
          moodBtns.forEach((btn) => {
            btn.addEventListener('click', () => {
              moodBtns.forEach((b) => b.classList.remove('selected'));
              btn.classList.add('selected');
              const mood = btn.dataset.mood;
              try {
                chrome.runtime.sendMessage({
                  type: 'MOOD_RECORDED',
                  mood,
                  site,
                });
              } catch (e) {}
            });
          });
          const closeBtn = card.querySelector('#eyeflow-close-tab');
          if (closeBtn) {
            closeBtn.addEventListener('click', () => {
              try {
                chrome.runtime.sendMessage({ type: 'CLOSE_TAB' });
              } catch (e) {}
              window.close();
              hide();
            });
          }
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
          const chips = card.querySelectorAll('.eyeflow-redirect-chip');
          chips.forEach((chip) => {
            chip.addEventListener('click', () => {
              chips.forEach((c) => (c.style.borderColor = 'rgba(52, 211, 153, 0.2)'));
              chip.style.borderColor = '#34d399';
              chip.style.background = 'rgba(52, 211, 153, 0.25)';
              setTimeout(hide, 800);
            });
          });
        }
        function hide() {
          const shouldFinalizeBreakCycle = shouldResetBreakCycleOnHide;
          shouldResetBreakCycleOnHide = false;
          if (exerciseTimer) clearInterval(exerciseTimer);
          if (dotMoveTimer) clearInterval(dotMoveTimer);
          exerciseTimer = null;
          dotMoveTimer = null;
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
          } catch (e) {}
        }
        function pausePageMedia() {
          pausedMediaElements = [];
          enforceMediaPause();
          if (mediaGuardTimer) clearInterval(mediaGuardTimer);
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
                wasMuted: media.muted,
              });
            }
            media.muted = true;
            if (!media.paused) {
              media.pause();
            }
          });
        }
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
    },
  });

  // src/utils.js
  var init_utils = __esm({
    'src/utils.js'() {},
  });

  // src/content.js
  var require_content = __commonJS({
    'src/content.js'() {
      init_intelligence();
      init_overlay();
      init_utils();
      var EYEFLOW_DEBUG_CONTENT = false;
      var EyeFlowContent = (() => {
        const DOOM_SCROLL_SITES = /* @__PURE__ */ new Set([
          'instagram.com',
          'tiktok.com',
          'reddit.com',
          'facebook.com',
          'twitter.com',
          'x.com',
        ]);
        const SENSITIVE_HOST_KEYWORDS = [
          'bank',
          'pay',
          'billing',
          'checkout',
          'wallet',
          'stripe',
          'paypal',
          'razorpay',
          'exam',
          'quiz',
          'test',
          'assessment',
          'proctor',
          'auth',
          'login',
          'signin',
          'verify',
          'otp',
          'docs',
          'sheets',
          'slides',
          'notion',
          'figma',
          'miro',
          'canva',
          'zoom',
          'meet',
          'teams',
        ];
        const SENSITIVE_PATH_KEYWORDS = [
          'login',
          'signin',
          'signup',
          'verify',
          'checkout',
          'billing',
          'payment',
          'wallet',
          'otp',
          'auth',
          'exam',
          'quiz',
          'test',
          'assessment',
          'proctor',
        ];
        const COMMUNICATION_HOST_KEYWORDS = [
          'instagram',
          'facebook',
          'messenger',
          'x.com',
          'twitter',
          'discord',
          'snapchat',
        ];
        const SITE_TIME_REPORT_INTERVAL_MS = 60 * 1e3;
        const HYDRATION_JITTER_MINUTES = 3;
        const PRESENCE_WINDOW_MS = 35 * 1e3;
        const REGULAR_PAGE_INACTIVITY_WINDOW_MS = 2 * 60 * 1e3;
        const HYDRATION_EYE_MERGE_WINDOW_MS = 3 * 60 * 1e3;
        const HYDRATION_REMIND_SOON_WINDOW_MS = 5 * 60 * 1e3;
        const HYDRATION_GENTLE_DELAY_MS = 3 * 60 * 1e3;
        const SINGLE_POST_GRACE_MS = 60 * 1e3;
        const BREAK_DUPLICATE_GUARD_MS = 10 * 1e3;
        const GENTLE_REMINDER_DUPLICATE_GUARD_MS = 15 * 1e3;
        const SESSION_RESET_INACTIVITY_MS = 15 * 60 * 1e3;
        const SCROLL_CHECK_INTERVAL_MS = 2e3;
        const DEBUG_CHIP_INTERVAL_MS = 1e3;
        let scrollEvents = [];
        let lastDoomScrollTime = 0;
        let scrollCheckInterval = null;
        let siteEntryTime = Date.now();
        let timeTrackingInterval = null;
        let isActive = true;
        let currentSettings = null;
        let lastScrollSignalAt = 0;
        let lastActivityAt = Date.now();
        let lastMeaningfulInputAt = Date.now();
        let lastKnownUrl = window.location.href;
        let pendingHydrationPopup = false;
        let activeSiteMs = 0;
        let activeSessionStartedAt = 0;
        let lastReportedActiveSiteMs = 0;
        let hydrationTargetMs = 0;
        let lastContextKey = '';
        let isSystemIdle = false;
        let totalActiveUsageMs = 0;
        let totalUsageStartedAt = 0;
        let hydrationMergedIntoNextBreak = false;
        let hydrationGentleReminderAt = 0;
        let lastBreakOverlayShownAt = 0;
        let lastGentleReminderFallbackAt = 0;
        let lastGentleReminderShownAt = 0;
        let singlePostGraceContextKey = '';
        let singlePostGraceStartedAt = 0;
        let nudgeElement = null;
        let warningElement = null;
        let subtleReminderElement = null;
        let debugTimerElement = null;
        let debugTimerInterval = null;
        let debugTimerMeta = {
          nextGentleReminderAt: 0,
          gentlePausedRemainingMs: 0,
          gentleState: 'off',
          gentlePauseReason: 'none',
          nextWaterReminderAt: 0,
          waterReminderPending: false,
          waterQueuedForNextBreak: false,
          lastFetchedAt: 0,
        };
        let sharedDsSyncInFlight = false;
        let sharedDsState = {
          activeMs: 0,
          nextBreakTargetMs: 0,
          isActive: false,
          contextKey: '',
          activeTabId: 0,
          lastSyncedAt: 0,
        };
        function runtimeCallbackFailed() {
          return Boolean(chrome.runtime?.lastError);
        }
        function getHostname() {
          return window.location.hostname.replace(/^(www|m)\./, '');
        }
        function getStatsSiteLabel() {
          const hostname = getHostname();
          const contextKey = getDoomScrollContextKey();
          if (contextKey === 'youtube.com/shorts' || contextKey === 'youtube.com/channel-shorts') {
            return 'YouTube Shorts';
          }
          const siteLabels = {
            'instagram.com': 'Instagram',
            'reddit.com': 'Reddit',
            'facebook.com': 'Facebook',
            'x.com': 'X',
            'twitter.com': 'X',
            'snapchat.com': 'Snapchat',
            'linkedin.com': 'LinkedIn',
            'twitch.tv': 'Twitch',
            'tiktok.com': 'TikTok',
            'youtube.com': 'YouTube',
          };
          return siteLabels[hostname] || hostname;
        }
        function getDoomScrollContextKey() {
          const hostname = getHostname();
          if (isAuthOrVerificationSurface()) {
            return '';
          }
          if (hostname === 'instagram.com') {
            return getInstagramDoomSurfaceKey();
          }
          if (hostname === 'youtube.com') {
            return getYouTubeDoomSurfaceKey();
          }
          if (hostname === 'reddit.com') {
            return getRedditDoomSurfaceKey();
          }
          if (hostname === 'facebook.com') {
            return getFacebookDoomSurfaceKey();
          }
          if (hostname === 'x.com' || hostname === 'twitter.com') {
            return getXDoomSurfaceKey();
          }
          if (hostname === 'snapchat.com') {
            return getSnapchatDoomSurfaceKey();
          }
          if (hostname === 'linkedin.com') {
            return getLinkedInDoomSurfaceKey();
          }
          if (hostname === 'twitch.tv') {
            return getTwitchDoomSurfaceKey();
          }
          if (DOOM_SCROLL_SITES.has(hostname)) {
            return hostname;
          }
          return '';
        }
        function isDoomScrollContext() {
          const contextKey = getDoomScrollContextKey();
          if (!contextKey) {
            return false;
          }
          if (
            isSinglePostGraceContextKey(contextKey) &&
            isWithinSinglePostGraceWindow(contextKey)
          ) {
            return false;
          }
          return true;
        }
        function isSinglePostGraceContextKey(contextKey) {
          return typeof contextKey === 'string' && contextKey.endsWith('/detail');
        }
        function isWithinSinglePostGraceWindow(contextKey = getDoomScrollContextKey()) {
          if (!isSinglePostGraceContextKey(contextKey)) {
            return false;
          }
          if (singlePostGraceContextKey !== contextKey || !singlePostGraceStartedAt) {
            return false;
          }
          return Date.now() - singlePostGraceStartedAt < SINGLE_POST_GRACE_MS;
        }
        function getSinglePostGraceRemainingMs(contextKey = getDoomScrollContextKey()) {
          if (!isWithinSinglePostGraceWindow(contextKey)) {
            return 0;
          }
          return Math.max(0, SINGLE_POST_GRACE_MS - (Date.now() - singlePostGraceStartedAt));
        }
        function isPassiveViewerDoomContext() {
          const contextKey = getDoomScrollContextKey();
          return (
            contextKey === 'tiktok.com' ||
            contextKey === 'youtube.com/shorts' ||
            contextKey === 'instagram.com/reels' ||
            contextKey === 'facebook.com/video'
          );
        }
        function isStrictBreakSite() {
          const contextKey = getDoomScrollContextKey();
          if (!contextKey) {
            return false;
          }
          const hostname = getHostname();
          if (DOOM_SCROLL_SITES.has(hostname)) {
            return true;
          }
          return contextKey === 'youtube.com/shorts';
        }
        function recordActivity() {
          const now = Date.now();
          lastActivityAt = now;
          lastMeaningfulInputAt = now;
        }
        function hasRecentMeaningfulInput() {
          return Date.now() - lastMeaningfulInputAt <= PRESENCE_WINDOW_MS;
        }
        function hasRecentRegularPageInput() {
          return Date.now() - lastMeaningfulInputAt <= REGULAR_PAGE_INACTIVITY_WINDOW_MS;
        }
        function getInstagramDoomSurfaceKey() {
          const path = window.location.pathname || '/';
          if (path.startsWith('/reels')) {
            return 'instagram.com/reels';
          }
          if (path.startsWith('/reel/')) {
            return 'instagram.com/reels';
          }
          if (path.startsWith('/p/')) {
            const modalReelVisible = Boolean(
              document.querySelector(
                '[role="dialog"] video, [role="dialog"] article video, main [role="presentation"] video'
              )
            );
            if (modalReelVisible) {
              return 'instagram.com/reels';
            }
            return 'instagram.com/detail';
          }
          if (path.startsWith('/explore')) {
            const gridVisible = Boolean(
              document.querySelector('main img, main video, main article, main [role="link"]')
            );
            return gridVisible ? 'instagram.com/explore' : '';
          }
          if (path === '/' || path === '') {
            const feedVisible = Boolean(
              document.querySelector('main article, main [role="main"] article, main video')
            );
            return feedVisible ? 'instagram.com/home' : '';
          }
          return '';
        }
        function getRedditDoomSurfaceKey() {
          const path = (window.location.pathname || '/').toLowerCase();
          if (path.startsWith('/explore')) {
            return '';
          }
          if (path.includes('/comments/')) {
            return 'reddit.com/detail';
          }
          if (path === '/' || path === '/best' || path === '/hot') {
            return 'reddit.com/home';
          }
          if (path === '/popular' || path.startsWith('/r/popular')) {
            return 'reddit.com/popular';
          }
          if (path === '/news' || path.startsWith('/r/news')) {
            return '';
          }
          if (/^\/r\/[^/]+\/?$/.test(path)) {
            return 'reddit.com/community';
          }
          return '';
        }
        function getFacebookDoomSurfaceKey() {
          const path = (window.location.pathname || '/').toLowerCase();
          const search = (window.location.search || '').toLowerCase();
          if (path.startsWith('/messages') || path.startsWith('/messenger')) {
            return '';
          }
          if (path.includes('/posts/') || path.includes('/permalink/')) {
            return 'facebook.com/detail';
          }
          if (path.startsWith('/watch') || path.startsWith('/videos') || path.startsWith('/reel')) {
            return 'facebook.com/video';
          }
          if (path.startsWith('/groups')) {
            return 'facebook.com/groups';
          }
          if (search.includes('filter=all')) {
            return 'facebook.com/feeds-all';
          }
          if (search.includes('filter=groups')) {
            return 'facebook.com/feeds-groups';
          }
          if (search.includes('filter=pages')) {
            return 'facebook.com/feeds-pages';
          }
          if (
            search.includes('filter=favourites') ||
            search.includes('filter=favorites') ||
            search.includes('filter=friends')
          ) {
            return '';
          }
          if (path === '/' || path === '') {
            const feedVisible = Boolean(
              document.querySelector(
                '[role="feed"], div[role="feed"], [role="main"] [role="article"], div[data-pagelet*="FeedUnit"], div[data-pagelet*="MainFeed"], div[aria-posinset][role="article"]'
              )
            );
            return feedVisible ? 'facebook.com/home' : '';
          }
          return '';
        }
        function getXDoomSurfaceKey() {
          const path = (window.location.pathname || '/').toLowerCase();
          const reservedOffPaths = [
            '/messages',
            '/notifications',
            '/i/connect_people',
            '/i/premium_sign_up',
            '/premium',
            '/i/premium',
            '/settings',
            '/compose',
            '/i/grok',
            '/grok',
            '/i/verified-orgs-signup',
            '/i/spaces/start',
            '/i/spaces',
            '/i/creators/studio',
            '/i/business',
          ];
          if (reservedOffPaths.some((prefix) => path.startsWith(prefix))) {
            return '';
          }
          if (path.startsWith('/home')) {
            return 'x.com/home';
          }
          if (path.startsWith('/explore')) {
            return 'x.com/explore';
          }
          if (
            path.startsWith('/i/communities') ||
            /^\/[^/]+\/communities(\/|$)/.test(path) ||
            path.startsWith('/communities')
          ) {
            return 'x.com/communities';
          }
          if (path.includes('/status/')) {
            return 'x.com/detail';
          }
          if (path === '/i/following' || path.startsWith('/i/connect_tab')) {
            return '';
          }
          if (
            /^\/[^/]+(?:\/(with_replies|media|likes|highlights|articles|followers|following))?\/?$/.test(
              path
            )
          ) {
            return '';
          }
          return '';
        }
        function getYouTubeDoomSurfaceKey() {
          const path = window.location.pathname || '/';
          if (path.startsWith('/shorts')) {
            return 'youtube.com/shorts';
          }
          const shortsTabSelected = Boolean(
            document.querySelector(
              'yt-tab-shape[tab-title="Shorts"][selected], [role="tab"][aria-label*="Shorts" i][aria-selected="true"], [aria-label*="Shorts" i][tab-identifier="shorts"]'
            )
          );
          const shortsGridVisible = Boolean(
            document.querySelector(
              'ytd-rich-grid-renderer ytd-reel-item-renderer, ytd-reel-shelf-renderer, ytd-reel-video-renderer'
            )
          );
          if (shortsTabSelected && shortsGridVisible) {
            return 'youtube.com/channel-shorts';
          }
          return '';
        }
        function getSnapchatDoomSurfaceKey() {
          const path = (window.location.pathname || '/').toLowerCase();
          if (
            path.startsWith('/chat') ||
            path.startsWith('/accounts') ||
            path.startsWith('/settings') ||
            path.startsWith('/lenses') ||
            path.startsWith('/plus') ||
            path.startsWith('/snapchat-plus') ||
            /^\/@[^/]+\/?$/.test(path)
          ) {
            return '';
          }
          if (path.includes('/spotlight/')) {
            return 'snapchat.com/detail';
          }
          if (path.startsWith('/spotlight')) {
            return 'snapchat.com/spotlight';
          }
          if (path.startsWith('/stories') || path.startsWith('/discover') || path === '/') {
            return 'snapchat.com/feed';
          }
          return '';
        }
        function getLinkedInDoomSurfaceKey() {
          const path = (window.location.pathname || '/').toLowerCase();
          if (
            path.startsWith('/messaging') ||
            path.startsWith('/notifications') ||
            path.startsWith('/jobs') ||
            path.startsWith('/my-items') ||
            path.startsWith('/mynetwork') ||
            path.startsWith('/search') ||
            path.startsWith('/learning') ||
            path.startsWith('/sales') ||
            path.startsWith('/in/') ||
            path.startsWith('/company/') ||
            path.startsWith('/school/')
          ) {
            return '';
          }
          if (path.startsWith('/posts/') || path.startsWith('/feed/update/')) {
            return 'linkedin.com/detail';
          }
          if (path === '/feed' || path.startsWith('/feed/') || path.startsWith('/video/')) {
            return 'linkedin.com/feed';
          }
          return '';
        }
        function getTwitchDoomSurfaceKey() {
          const path = (window.location.pathname || '/').toLowerCase();
          if (
            path.startsWith('/settings') ||
            path.startsWith('/subscriptions') ||
            path.startsWith('/wallet') ||
            path.startsWith('/inventory') ||
            path.startsWith('/messages') ||
            path.startsWith('/friends')
          ) {
            return '';
          }
          if (path.startsWith('/clip/')) {
            return 'twitch.tv/detail';
          }
          if (
            path.startsWith('/clips') ||
            (path.startsWith('/directory/game/') && path.includes('/clips')) ||
            (path.startsWith('/directory/all/tags/') && path.includes('/clips'))
          ) {
            return 'twitch.tv/feed';
          }
          if (/^\/[^/]+\/?$/.test(path)) {
            return '';
          }
          return '';
        }
        function isAuthOrVerificationSurface() {
          const path =
            `${window.location.pathname || ''} ${window.location.search || ''}`.toLowerCase();
          const hasAuthPath = [
            'login',
            'signin',
            'signup',
            'auth',
            'verify',
            'verification',
            'checkpoint',
            'forgot',
            'reset',
          ].some((token) => path.includes(token));
          const authFieldsVisible = Boolean(
            document.querySelector(
              'input[type="password"], input[autocomplete="current-password"], input[autocomplete="username"], input[autocomplete="one-time-code"], input[name*="otp" i], input[name*="password" i], input[id*="password" i]'
            )
          );
          return hasAuthPath || authFieldsVisible;
        }
        function handleInteraction(event) {
          if (!isActive) return;
          if (event.type === 'keydown') {
            const activeKeys = /* @__PURE__ */ new Set([
              'ArrowDown',
              'ArrowUp',
              'ArrowLeft',
              'ArrowRight',
              'PageDown',
              'PageUp',
              ' ',
              'Enter',
              'j',
              'k',
            ]);
            if (activeKeys.has(event.key)) {
              recordActivity();
            }
            return;
          }
          if (event.type === 'click' || event.type === 'pointerup') {
            recordActivity();
            return;
          }
        }
        function getHydrationTargetMs() {
          const baseMinutes = currentSettings?.hydrationReminderMin ?? 80;
          return baseMinutes * 60 * 1e3;
        }
        function getLocalGentleDelayMs() {
          const minMinutes = Math.max(1, Number(currentSettings?.subtleReminderMin) || 25);
          const maxMinutes = Math.max(
            minMinutes,
            Number(currentSettings?.subtleReminderMax) || minMinutes
          );
          const randomMinutes =
            Math.floor(Math.random() * (maxMinutes - minMinutes + 1)) + minMinutes;
          return randomMinutes * 60 * 1e3;
        }
        function applySharedDsState(snapshot) {
          if (!snapshot) return;
          sharedDsState = {
            activeMs: snapshot.activeMs || 0,
            nextBreakTargetMs: snapshot.nextBreakTargetMs || 0,
            isActive: Boolean(snapshot.isActive),
            contextKey: snapshot.contextKey || '',
            activeTabId: snapshot.activeTabId || 0,
            lastSyncedAt: Date.now(),
          };
        }
        function resetTrackedSession({ resetTotalTime = true } = {}) {
          scrollEvents = [];
          lastDoomScrollTime = 0;
          lastActivityAt = Date.now();
          pendingHydrationPopup = false;
          lastReportedActiveSiteMs = 0;
          const jitterMs = Math.floor(Math.random() * (HYDRATION_JITTER_MINUTES + 1)) * 60 * 1e3;
          hydrationTargetMs = (currentSettings?.hydrationReminderMin ?? 80) * 60 * 1e3 + jitterMs;
          if (resetTotalTime) {
            activeSiteMs = 0;
            totalActiveUsageMs = 0;
            totalUsageStartedAt = 0;
          }
          activeSessionStartedAt = 0;
          hydrationMergedIntoNextBreak = false;
          hydrationGentleReminderAt = 0;
          if (typeof EyeFlowIntelligence !== 'undefined') {
            EyeFlowIntelligence.resetStages();
          }
        }
        function flushDsSiteTime() {
          const activeMinutesDelta = Math.floor(
            (getActiveSiteMs() - lastReportedActiveSiteMs) / 6e4
          );
          if (activeMinutesDelta <= 0) return;
          lastReportedActiveSiteMs += activeMinutesDelta * 6e4;
          try {
            const site = getStatsSiteLabel();
            chrome.storage.local.get(['stats'], (result) => {
              const stats = result?.stats || {};
              const siteTimeSpent = { ...(stats.siteTimeSpent || {}) };
              const todayDsSiteTimeSpent = { ...(stats.todayDsSiteTimeSpent || {}) };
              siteTimeSpent[site] = (siteTimeSpent[site] || 0) + activeMinutesDelta;
              todayDsSiteTimeSpent[site] = (todayDsSiteTimeSpent[site] || 0) + activeMinutesDelta;
              chrome.storage.local.set({
                stats: {
                  ...stats,
                  siteTimeSpent,
                  todayDsSiteTimeSpent,
                },
              });
            });
          } catch (e) {}
        }
        function resetSessionTimersFromBackground(snapshot) {
          resetTrackedSession();
          applySharedDsState(snapshot);
          lastGentleReminderFallbackAt = 0;
          lastGentleReminderShownAt = 0;
          removeGentleReminder();
          removeNudge();
          removeWarning();
        }
        function syncRouteState() {
          const currentUrl = window.location.href;
          const contextKey = getDoomScrollContextKey();
          const urlChanged = currentUrl !== lastKnownUrl;
          const contextChanged = contextKey !== lastContextKey;
          if (!urlChanged && !contextChanged) return;
          syncActiveSession();
          lastKnownUrl = currentUrl;
          const shouldResetForRoute = contextChanged && !lastContextKey && !contextKey;
          if (shouldResetForRoute) {
            flushDsSiteTime();
            siteEntryTime = Date.now();
            resetTrackedSession();
            removeGentleReminder();
            removeNudge();
            removeWarning();
          }
          if (contextChanged && lastContextKey && lastContextKey !== contextKey) {
            flushDsSiteTime();
          }
          if (isSinglePostGraceContextKey(contextKey)) {
            if (singlePostGraceContextKey !== contextKey) {
              singlePostGraceContextKey = contextKey;
              singlePostGraceStartedAt = Date.now();
            }
          } else {
            singlePostGraceContextKey = '';
            singlePostGraceStartedAt = 0;
          }
          lastContextKey = contextKey;
        }
        function isTabActivelyVisible() {
          return !document.hidden && document.hasFocus();
        }
        function isSensitiveReminderContext() {
          const hostname = getHostname();
          const path =
            `${window.location.pathname || ''} ${window.location.search || ''}`.toLowerCase();
          const overlayShowing =
            typeof EyeFlowOverlay !== 'undefined' && EyeFlowOverlay.isShowing();
          const activeElement = document.activeElement;
          const focusedEditable = Boolean(
            activeElement &&
            (activeElement.isContentEditable ||
              activeElement.tagName === 'TEXTAREA' ||
              (activeElement.tagName === 'INPUT' &&
                !['checkbox', 'radio', 'range', 'button', 'submit'].includes(
                  (activeElement.type || '').toLowerCase()
                )))
          );
          const passwordOrOtpField = Boolean(
            document.querySelector(
              'input[type="password"], input[autocomplete="one-time-code"], input[name*="otp" i], input[id*="otp" i]'
            )
          );
          const largeForm = document.querySelectorAll('input, textarea, select').length >= 6;
          const videoMeetingSignals = Boolean(
            document.querySelector(
              '[data-meeting-title], [aria-label*="meeting" i], [class*="meeting" i], [class*="conference" i]'
            )
          );
          if (overlayShowing || document.fullscreenElement) return true;
          if (focusedEditable) return true;
          if (EyeFlowIntelligence.isUserTyping() && !isDoomScrollContext()) return true;
          if (passwordOrOtpField) return true;
          if (largeForm && path.includes('form')) return true;
          if (videoMeetingSignals) return true;
          if (SENSITIVE_HOST_KEYWORDS.some((keyword) => hostname.includes(keyword))) return true;
          if (SENSITIVE_PATH_KEYWORDS.some((keyword) => path.includes(keyword))) return true;
          return false;
        }
        function isCommunicationContext() {
          const hostname = getHostname();
          const path =
            `${window.location.pathname || ''} ${window.location.search || ''}`.toLowerCase();
          if (hostname === 'instagram.com' && getDoomScrollContextKey()) return false;
          const activeElement = document.activeElement;
          const chatFocused = Boolean(
            activeElement &&
            (activeElement.isContentEditable ||
              activeElement.tagName === 'TEXTAREA' ||
              (activeElement.tagName === 'INPUT' &&
                ['text', 'search'].includes((activeElement.type || '').toLowerCase())))
          );
          const chatUiSignals = Boolean(
            document.querySelector(
              '[aria-label*="message" i], [aria-label*="chat" i], [data-testid*="message" i], [data-testid*="thread" i], [class*="message" i], [class*="thread" i], [class*="dm" i]'
            )
          );
          const communicationHost = COMMUNICATION_HOST_KEYWORDS.some((value) =>
            hostname.includes(value)
          );
          const callUiSignals = Boolean(
            document.querySelector(
              '[aria-label*="call" i], [aria-label*="mute" i], [aria-label*="camera" i], [aria-label*="hang up" i], [class*="call" i], [class*="voice" i], [class*="videocall" i], [class*="video-call" i], [data-testid*="call" i]'
            )
          );
          const liveOrSharedWatchSignals = Boolean(
            document.querySelector(
              '[aria-label*="live" i], [class*="live" i], [class*="watch-together" i], [class*="watchtogether" i], [data-testid*="live" i]'
            )
          );
          if (chatFocused) return true;
          if (chatUiSignals && communicationHost) {
            return true;
          }
          if (communicationHost && (callUiSignals || liveOrSharedWatchSignals)) return true;
          if (path.includes('/direct/') || path.includes('/messages/') || path.includes('/inbox'))
            return true;
          return false;
        }
        function canShowGentleReminder() {
          if (isEffectivelySystemIdle() || !isActive || !isTabActivelyVisible()) return false;
          if (isDoomScrollContext() || isWithinSinglePostGraceWindow() || warningElement)
            return false;
          if (isSensitiveReminderContext()) return false;
          if (isCommunicationContext()) return false;
          if (isWatchingLongVideoPassively() || isWatchingPassiveDsVideo()) return false;
          return true;
        }
        function canShowGentleReminderWithPassiveVideoSupport() {
          if (!isActive) return false;
          if (isDoomScrollContext() || isWithinSinglePostGraceWindow() || warningElement)
            return false;
          if (isSensitiveReminderContext()) return false;
          if (isCommunicationContext()) return false;
          return canShowGentleReminder();
        }
        function isEffectivelySystemIdle() {
          return isSystemIdle && !isWatchingLongVideoPassively() && !isWatchingPassiveDsVideo();
        }
        function isWatchingLongVideoPassively() {
          if (getHostname() !== 'youtube.com') return false;
          if ((window.location.pathname || '') !== '/watch') return false;
          if (isDoomScrollContext()) return false;
          return Boolean(findPassiveVideoCandidate({ requireLongDuration: true }));
        }
        function findPassiveVideoCandidate({ requireLongDuration = false } = {}) {
          const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
          const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
          const minimumVisibleArea = Math.max(
            160 * 160,
            Math.round(viewportWidth * viewportHeight * 0.06)
          );
          const minimumVideoArea = Math.max(
            220 * 160,
            Math.round(viewportWidth * viewportHeight * 0.08)
          );
          const videos = Array.from(document.querySelectorAll('video'));
          let bestVideo = null;
          let bestScore = 0;
          videos.forEach((video) => {
            if (!video || video.paused || video.ended) return;
            if (video.readyState < 2) return;
            const rect = video.getBoundingClientRect();
            if (rect.width < 180 || rect.height < 120) return;
            const visibleWidth = Math.max(
              0,
              Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0)
            );
            const visibleHeight = Math.max(
              0,
              Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0)
            );
            const visibleArea = visibleWidth * visibleHeight;
            const videoArea = rect.width * rect.height;
            if (visibleArea < minimumVisibleArea) return;
            if (videoArea < minimumVideoArea) return;
            const duration = Number(video.duration);
            if (requireLongDuration && (!Number.isFinite(duration) || duration <= 60)) return;
            const prominenceScore = visibleArea + Math.min(videoArea, visibleArea);
            if (prominenceScore <= bestScore) return;
            bestScore = prominenceScore;
            bestVideo = video;
          });
          return bestVideo;
        }
        function isWatchingPassiveDsVideo() {
          if (!isDoomScrollContext()) return false;
          if (isWithinSinglePostGraceWindow()) return false;
          return Boolean(findPassiveVideoCandidate({ requireLongDuration: true }));
        }
        function shouldCountUsageTime() {
          const overlayShowing =
            typeof EyeFlowOverlay !== 'undefined' && EyeFlowOverlay.isShowing();
          if (!isActive || isEffectivelySystemIdle() || !isTabActivelyVisible() || overlayShowing) {
            return false;
          }
          if (isPassiveViewerDoomContext()) {
            return true;
          }
          if (isWatchingLongVideoPassively()) {
            return true;
          }
          if (isWatchingPassiveDsVideo()) {
            return true;
          }
          if (!isDoomScrollContext()) {
            return hasRecentRegularPageInput();
          }
          return hasRecentMeaningfulInput();
        }
        function shouldCountActiveTime() {
          const overlayShowing =
            typeof EyeFlowOverlay !== 'undefined' && EyeFlowOverlay.isShowing();
          return (
            isActive &&
            !isEffectivelySystemIdle() &&
            isDoomScrollContext() &&
            isTabActivelyVisible() &&
            !overlayShowing &&
            (hasRecentMeaningfulInput() ||
              isPassiveViewerDoomContext() ||
              isWatchingPassiveDsVideo())
          );
        }
        function isUsageActiveNow() {
          return shouldCountUsageTime();
        }
        function syncActiveSession() {
          const now = Date.now();
          const isUsageActiveNow2 = shouldCountUsageTime();
          const isDsActiveNow = shouldCountActiveTime();
          if (isUsageActiveNow2 && !totalUsageStartedAt) {
            totalUsageStartedAt = now;
          } else if (!isUsageActiveNow2 && totalUsageStartedAt) {
            totalActiveUsageMs += now - totalUsageStartedAt;
            totalUsageStartedAt = 0;
          }
          if (isDsActiveNow && !activeSessionStartedAt) {
            activeSessionStartedAt = now;
            return;
          }
          if (!isDsActiveNow && activeSessionStartedAt) {
            const elapsed = now - activeSessionStartedAt;
            activeSiteMs += elapsed;
            activeSessionStartedAt = 0;
            if (typeof EyeFlowIntelligence !== 'undefined') {
              EyeFlowIntelligence.pauseForInactivity(elapsed);
            }
          }
        }
        function getActiveSiteMs() {
          syncActiveSession();
          if (!activeSessionStartedAt) {
            return activeSiteMs;
          }
          return activeSiteMs + (Date.now() - activeSessionStartedAt);
        }
        function getEstimatedSharedDsActiveMs(now = Date.now()) {
          const baseActiveMs = sharedDsState.activeMs || 0;
          if (!shouldCountActiveTime()) {
            return baseActiveMs;
          }
          if (!sharedDsState.lastSyncedAt) {
            return baseActiveMs;
          }
          return baseActiveMs + Math.max(0, now - sharedDsState.lastSyncedAt);
        }
        function getBreakCycleMs() {
          return getEstimatedSharedDsActiveMs();
        }
        function getTotalActiveUsageMs() {
          syncActiveSession();
          if (!totalUsageStartedAt) {
            return totalActiveUsageMs;
          }
          return totalActiveUsageMs + (Date.now() - totalUsageStartedAt);
        }
        function resetBreakCycle() {
          scrollEvents = [];
          sharedDsState.activeMs = 0;
          sharedDsState.nextBreakTargetMs = EyeFlowIntelligence.getNextBreakTargetMs();
          sharedDsState.isActive = false;
          sharedDsState.lastSyncedAt = Date.now();
          activeSessionStartedAt = 0;
          lastDoomScrollTime = Date.now();
        }
        function maybeResetSessionAfterLongGap() {
          const now = Date.now();
          const lastPresenceAt = Math.max(
            lastActivityAt || 0,
            lastMeaningfulInputAt || 0,
            activeSessionStartedAt || 0,
            totalUsageStartedAt || 0
          );
          if (!lastPresenceAt) return;
          if (now - lastPresenceAt < SESSION_RESET_INACTIVITY_MS) return;
          resetTrackedSession();
          sharedDsState.activeMs = 0;
          sharedDsState.nextBreakTargetMs = EyeFlowIntelligence.getNextBreakTargetMs();
          sharedDsState.isActive = false;
          sharedDsState.contextKey = '';
          sharedDsState.activeTabId = 0;
          sharedDsState.lastSyncedAt = now;
          lastDoomScrollTime = now;
        }
        function resetHydrationTimer() {
          hydrationMergedIntoNextBreak = false;
          hydrationGentleReminderAt = 0;
          pendingHydrationPopup = false;
          try {
            chrome.runtime.sendMessage({ type: 'HYDRATION_COMPLETED' });
          } catch (e) {}
        }
        function getMsUntilEyeBreak() {
          if (!sharedDsState.nextBreakTargetMs) {
            return Infinity;
          }
          return Math.max(0, sharedDsState.nextBreakTargetMs - getBreakCycleMs());
        }
        function canShowBreakOverlay() {
          const overlayShowing =
            typeof EyeFlowOverlay !== 'undefined' && EyeFlowOverlay.isShowing();
          if (overlayShowing) return false;
          return Date.now() - lastBreakOverlayShownAt > BREAK_DUPLICATE_GUARD_MS;
        }
        function syncSharedDsTimer() {
          if (sharedDsSyncInFlight) return;
          try {
            const now = Date.now();
            const isActiveNow = shouldCountActiveTime();
            const estimatedActiveMs = getEstimatedSharedDsActiveMs(now);
            sharedDsState.activeMs = estimatedActiveMs;
            sharedDsState.isActive = isActiveNow;
            sharedDsState.contextKey = isActiveNow ? getDoomScrollContextKey() : '';
            sharedDsState.lastSyncedAt = now;
            sharedDsSyncInFlight = true;
            chrome.runtime.sendMessage(
              {
                type: 'SYNC_SHARED_DS_STATE',
                isActive: isActiveNow,
                contextKey: isActiveNow ? sharedDsState.contextKey : '',
              },
              (response) => {
                sharedDsSyncInFlight = false;
                applySharedDsState(response);
              }
            );
          } catch (e) {
            sharedDsSyncInFlight = false;
          }
        }
        function syncSessionAndSharedTimer() {
          maybeResetSessionAfterLongGap();
          syncActiveSession();
          syncSharedDsTimer();
        }
        function formatCountdown(ms) {
          const totalSeconds = Math.max(0, Math.ceil(ms / 1e3));
          const minutes = Math.floor(totalSeconds / 60);
          const seconds = totalSeconds % 60;
          return `${minutes}:${String(seconds).padStart(2, '0')}`;
        }
        function formatReadableTimer(ms) {
          const totalSeconds = Math.max(0, Math.ceil(ms / 1e3));
          const hours = Math.floor(totalSeconds / 3600);
          const minutes = Math.floor((totalSeconds % 3600) / 60);
          const seconds = totalSeconds % 60;
          if (hours > 0) {
            return `${hours}h ${minutes}m`;
          }
          return `${minutes}:${String(seconds).padStart(2, '0')}`;
        }
        function syncDebugTimerMeta(force = false) {
          const now = Date.now();
          if (!force && now - debugTimerMeta.lastFetchedAt < 1e3) return;
          debugTimerMeta.lastFetchedAt = now;
          try {
            chrome.runtime.sendMessage({ type: 'GET_DEBUG_TIMERS' }, (response) => {
              if (runtimeCallbackFailed()) return;
              if (!response) return;
              debugTimerMeta.nextGentleReminderAt = response.nextGentleReminderAt || 0;
              debugTimerMeta.gentlePausedRemainingMs = response.gentlePausedRemainingMs || 0;
              debugTimerMeta.gentleState = response.gentleState || 'off';
              debugTimerMeta.gentlePauseReason = response.gentlePauseReason || 'none';
              debugTimerMeta.nextWaterReminderAt = response.nextWaterReminderAt || 0;
              debugTimerMeta.waterReminderPending = Boolean(response.waterReminderPending);
              debugTimerMeta.waterQueuedForNextBreak = Boolean(response.waterQueuedForNextBreak);
            });
          } catch (e) {}
        }
        function updateDebugTimerChip() {
          if (!EYEFLOW_DEBUG_CONTENT) {
            removeDebugTimerChip();
            return;
          }
          const overlayShowing =
            typeof EyeFlowOverlay !== 'undefined' && EyeFlowOverlay.isShowing();
          const shouldShow = isActive && !overlayShowing;
          if (!shouldShow) {
            removeDebugTimerChip();
            return;
          }
          syncDebugTimerMeta();
          if (EYEFLOW_DEBUG_CONTENT && !debugTimerElement) {
            debugTimerElement = document.createElement('div');
            debugTimerElement.id = 'eyeflow-debug-timer';
            debugTimerElement.innerHTML = `
        <div class="eyeflow-debug-timer-content">
          <div class="eyeflow-debug-timer-row">
            <div class="eyeflow-debug-timer-label">Eye break (tab)</div>
            <div class="eyeflow-debug-timer-value" data-debug-timer="eye">0:00</div>
          </div>
          <div class="eyeflow-debug-timer-row">
            <div class="eyeflow-debug-timer-label">Gentle (global)</div>
            <div class="eyeflow-debug-timer-value" data-debug-timer="gentle">0:00</div>
          </div>
          <div class="eyeflow-debug-timer-row">
            <div class="eyeflow-debug-timer-label">Water (global)</div>
            <div class="eyeflow-debug-timer-value" data-debug-timer="water">0:00</div>
          </div>
        </div>
      `;
            debugTimerElement.style.cssText = `
        position: fixed;
        left: 18px;
        bottom: 18px;
        z-index: 2147483642;
        font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
        pointer-events: none;
      `;
            const style = document.createElement('style');
            style.id = 'eyeflow-debug-timer-style';
            style.textContent = `
        #eyeflow-debug-timer .eyeflow-debug-timer-content {
          min-width: 156px;
          padding: 10px 12px;
          border-radius: 16px;
          background: rgba(28, 20, 14, 0.28);
          border: 1px solid rgba(216, 156, 96, 0.1);
          box-shadow: 0 8px 18px rgba(22, 16, 11, 0.1);
          color: #fff6ea;
          backdrop-filter: blur(3px);
        }
        #eyeflow-debug-timer .eyeflow-debug-timer-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }
        #eyeflow-debug-timer .eyeflow-debug-timer-row + .eyeflow-debug-timer-row {
          margin-top: 6px;
          padding-top: 6px;
          border-top: 1px solid rgba(255, 246, 234, 0.08);
        }
        #eyeflow-debug-timer .eyeflow-debug-timer-label {
          font-size: 11px;
          line-height: 1.2;
          opacity: 0.66;
        }
        #eyeflow-debug-timer .eyeflow-debug-timer-value {
          font-size: 16px;
          font-weight: 700;
          letter-spacing: 0.02em;
          white-space: nowrap;
        }
      `;
            document.head.appendChild(style);
            document.body.appendChild(debugTimerElement);
          }
          const eyeValueElement = debugTimerElement.querySelector('[data-debug-timer="eye"]');
          const gentleValueElement = debugTimerElement.querySelector('[data-debug-timer="gentle"]');
          const waterValueElement = debugTimerElement.querySelector('[data-debug-timer="water"]');
          if (!eyeValueElement || !gentleValueElement || !waterValueElement) return;
          if (isDoomScrollContext()) {
            eyeValueElement.textContent = shouldCountActiveTime()
              ? formatCountdown(getMsUntilEyeBreak())
              : 'Paused';
          } else if (isWithinSinglePostGraceWindow()) {
            eyeValueElement.textContent = `Read ${formatCountdown(getSinglePostGraceRemainingMs())}`;
          } else {
            eyeValueElement.textContent = 'Off';
          }
          if (isDoomScrollContext()) {
            gentleValueElement.textContent = 'Off';
          } else if (debugTimerMeta.gentleState === 'off') {
            gentleValueElement.textContent = 'Off';
          } else if (
            debugTimerMeta.gentleState === 'paused' ||
            debugTimerMeta.gentleState === 'hold'
          ) {
            const holdMs =
              debugTimerMeta.gentlePausedRemainingMs > 0
                ? debugTimerMeta.gentlePausedRemainingMs
                : Math.max(0, debugTimerMeta.nextGentleReminderAt - Date.now());
            gentleValueElement.textContent = `Hold ${formatCountdown(holdMs)}`;
          } else if (debugTimerMeta.nextGentleReminderAt > 0) {
            const gentleRemainingMs = Math.max(0, debugTimerMeta.nextGentleReminderAt - Date.now());
            gentleValueElement.textContent = formatCountdown(gentleRemainingMs);
          } else {
            gentleValueElement.textContent = 'Off';
          }
          if (debugTimerMeta.waterQueuedForNextBreak) {
            waterValueElement.textContent = 'Queued';
          } else if (debugTimerMeta.waterReminderPending) {
            waterValueElement.textContent = 'Pending';
          } else if (debugTimerMeta.nextWaterReminderAt > 0) {
            waterValueElement.textContent = formatReadableTimer(
              debugTimerMeta.nextWaterReminderAt - Date.now()
            );
          } else {
            waterValueElement.textContent = 'Waiting';
          }
        }
        function removeDebugTimerChip() {
          if (debugTimerElement) {
            debugTimerElement.remove();
            debugTimerElement = null;
          }
          const style = document.getElementById('eyeflow-debug-timer-style');
          if (style) style.remove();
        }
        function shouldMergeHydrationIntoBreak() {
          return isHydrationDue() && getMsUntilEyeBreak() <= HYDRATION_EYE_MERGE_WINDOW_MS;
        }
        function maybeTriggerGentleReminderFailsafe() {
          if (isDoomScrollContext()) return;
          if (!debugTimerMeta.nextGentleReminderAt) return;
          if (Date.now() - debugTimerMeta.nextGentleReminderAt < 0) return;
          if (Date.now() - lastGentleReminderFallbackAt < 15e3) return;
          if (Date.now() - lastGentleReminderShownAt < GENTLE_REMINDER_DUPLICATE_GUARD_MS) return;
          if (!canShowGentleReminderWithPassiveVideoSupport()) return;
          lastGentleReminderFallbackAt = Date.now();
          const reminderShown = showGentleReminder();
          if (!reminderShown) return;
          acknowledgeLocalGentleReminder();
          try {
            chrome.runtime.sendMessage({ type: 'GENTLE_REMINDER_SHOWN' });
          } catch (e) {}
        }
        function acknowledgeLocalGentleReminder(now = Date.now()) {
          lastGentleReminderShownAt = now;
          lastGentleReminderFallbackAt = now;
          debugTimerMeta.nextGentleReminderAt = 0;
          debugTimerMeta.gentlePausedRemainingMs = 0;
          debugTimerMeta.gentleState = 'running';
          debugTimerMeta.gentlePauseReason = 'none';
          debugTimerMeta.lastFetchedAt = 0;
          syncDebugTimerMeta(true);
        }
        function isHydrationDue() {
          if (!hydrationTargetMs) return false;
          return getTotalActiveUsageMs() >= hydrationTargetMs;
        }
        function tryShowHydrationPopup() {
          if (
            warningElement ||
            (typeof EyeFlowOverlay !== 'undefined' && EyeFlowOverlay.isShowing())
          ) {
            pendingHydrationPopup = true;
            return;
          }
          pendingHydrationPopup = false;
          removeGentleReminder();
          if (typeof EyeFlowOverlay !== 'undefined') {
            const timeOnSite = Math.round(getActiveSiteMs() / 6e4);
            EyeFlowOverlay.showHydration(currentSettings, getHostname(), timeOnSite);
          }
        }
        function scheduleHydrationGentleReminder(delayMs = HYDRATION_GENTLE_DELAY_MS) {
          hydrationGentleReminderAt = Date.now() + delayMs;
        }
        function maybeShowHydrationGentleReminder() {
          if (!hydrationGentleReminderAt || hydrationGentleReminderAt === 0) return false;
          if (Date.now() >= hydrationGentleReminderAt) {
            if (canShowGentleReminder()) {
              showGentleReminder({
                title: 'Stay Hydrated',
                text: 'Just a gentle nudge to take a sip of water!',
              });
              hydrationGentleReminderAt = 0;
              return true;
            }
          }
          return false;
        }
        function showStageInterruption(stage, hostname) {
          const duration = Math.round(getActiveSiteMs() / 1e3);
          let handled = false;
          if (stage === 'break' && !canShowBreakOverlay()) {
            return;
          }
          try {
            chrome.runtime.sendMessage(
              {
                type: 'DOOM_SCROLL_DETECTED',
                site: hostname,
                stage,
                duration,
                scrollCount: scrollEvents.length,
              },
              (response) => {
                handled = true;
                if (response && response.action === 'INTERVENE') {
                  if (stage === 'break' && !canShowBreakOverlay()) {
                    return;
                  }
                  if (typeof EyeFlowIntelligence !== 'undefined') {
                    EyeFlowIntelligence.markReminderShown();
                  }
                  showInterruption(response.stage, response.settings);
                }
              }
            );
            setTimeout(() => {
              if (handled) return;
              if (stage === 'break' && !canShowBreakOverlay()) {
                return;
              }
              if (typeof EyeFlowIntelligence !== 'undefined') {
                EyeFlowIntelligence.markReminderShown();
              }
              showInterruption(stage, currentSettings || {});
            }, 800);
          } catch (e) {
            if (typeof EyeFlowIntelligence !== 'undefined') {
              EyeFlowIntelligence.markReminderShown();
            }
            showInterruption(stage, currentSettings || {});
          }
        }
        function handleScroll(event) {
          if (!isActive) return;
          const now = Date.now();
          if (now - lastScrollSignalAt < 120) return;
          lastScrollSignalAt = now;
          if (!isMeaningfulScrollSignal(event)) return;
          scrollEvents.push(now);
          recordActivity();
          const timeWindow = EyeFlowIntelligence.getTimeWindow(getHostname());
          scrollEvents = scrollEvents.filter((t) => now - t < timeWindow);
          if (scrollEvents.length > 250) {
            scrollEvents = scrollEvents.slice(-250);
          }
        }
        function isMeaningfulScrollSignal(event) {
          if (!event) return true;
          if (event.type === 'wheel') {
            return Math.abs(event.deltaY || 0) > 6;
          }
          if (event.type === 'touchmove') {
            return true;
          }
          if (event.type === 'scroll') {
            return true;
          }
          return false;
        }
        function checkForDoomScroll() {
          syncRouteState();
          syncSessionAndSharedTimer();
          if (!isActive) return;
          if (!isTabActivelyVisible()) return;
          const hostname = getHostname();
          const now = Date.now();
          if (EyeFlowIntelligence.isSingleVideoPage()) return;
          if (isDoomScrollContext()) {
            const isBreakDue =
              Boolean(sharedDsState.nextBreakTargetMs) &&
              getBreakCycleMs() >= sharedDsState.nextBreakTargetMs;
            if (isBreakDue) {
              if (
                pendingHydrationPopup &&
                !warningElement &&
                !(typeof EyeFlowOverlay !== 'undefined' && EyeFlowOverlay.isShowing())
              ) {
                tryShowHydrationPopup();
                return;
              }
              if (now - lastDoomScrollTime < 5e3) return;
              lastDoomScrollTime = now;
              showStageInterruption('break', hostname);
              return;
            }
          }
          if (EyeFlowIntelligence.isUserTyping()) return;
          if (isCommunicationContext()) return;
          if (maybeShowHydrationGentleReminder()) {
            return;
          }
          if (
            pendingHydrationPopup &&
            !warningElement &&
            !(typeof EyeFlowOverlay !== 'undefined' && EyeFlowOverlay.isShowing())
          ) {
            tryShowHydrationPopup();
            return;
          }
          if (isHydrationDue()) {
            if (isDoomScrollContext()) {
              if (shouldMergeHydrationIntoBreak()) {
                hydrationMergedIntoNextBreak = true;
              } else {
                tryShowHydrationPopup();
                return;
              }
            } else if (canShowGentleReminder()) {
              showGentleReminder({
                title: 'Water check-in',
                text: 'Take a few sips if you have not had water in a while.',
              });
              resetHydrationTimer();
              return;
            }
          }
          if (isDoomScrollContext()) {
            const scrollThreshold = EyeFlowIntelligence.getScrollThreshold(hostname);
            const timeWindow = EyeFlowIntelligence.getTimeWindow(hostname);
            const recentScrollCount = scrollEvents.filter((t) => now - t < timeWindow).length;
            if (recentScrollCount >= scrollThreshold && now - lastDoomScrollTime > 5e3) {
              lastDoomScrollTime = now;
              scrollEvents = [];
              resetBreakCycle();
              showStageInterruption('break', hostname);
              return;
            }
            if (
              !sharedDsState.nextBreakTargetMs ||
              getBreakCycleMs() < sharedDsState.nextBreakTargetMs
            )
              return;
            const stage = 'break';
            if (now - lastDoomScrollTime < 5e3) return;
            lastDoomScrollTime = now;
            showStageInterruption(stage, hostname);
            return;
          }
          return;
        }
        function showInterruption(stage, settings) {
          const hostname = getHostname();
          const timeOnSite = Math.round(getActiveSiteMs() / 6e4);
          const hydrationPrompt = hydrationMergedIntoNextBreak || shouldMergeHydrationIntoBreak();
          switch (stage) {
            case 'nudge':
              break;
            case 'warning':
              removeDebugTimerChip();
              removeGentleReminder();
              removeNudge();
              showWarning(timeOnSite);
              break;
            case 'break':
              if (!canShowBreakOverlay()) {
                return;
              }
              lastBreakOverlayShownAt = Date.now();
              removeDebugTimerChip();
              removeGentleReminder();
              removeNudge();
              removeWarning();
              if (typeof EyeFlowOverlay !== 'undefined') {
                EyeFlowOverlay.show(settings, hostname, timeOnSite, { hydrationPrompt });
              }
              break;
          }
        }
        function showNudge(timeOnSite) {
          if (nudgeElement) return;
          nudgeElement = document.createElement('div');
          nudgeElement.id = 'eyeflow-nudge';
          nudgeElement.innerHTML = `
      <div class="eyeflow-nudge-content">
        <span class="eyeflow-nudge-icon">\u25C9</span>
        <span class="eyeflow-nudge-text">Still here? ${timeOnSite} min already. Move your eyes for 15 seconds now.</span>
        <button class="eyeflow-nudge-dismiss" title="Dismiss">\u2715</button>
      </div>
    `;
          nudgeElement.style.cssText = `
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 2147483645;
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
      animation: eyeflow-slide-up 0.4s ease-out;
    `;
          const style = document.createElement('style');
          style.id = 'eyeflow-nudge-style';
          style.textContent = `
      @keyframes eyeflow-slide-up {
        from { transform: translateX(-50%) translateY(100px); opacity: 0; }
        to { transform: translateX(-50%) translateY(0); opacity: 1; }
      }
      #eyeflow-nudge .eyeflow-nudge-content {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 13px 18px;
        max-width: min(92vw, 460px);
        background: rgba(255, 248, 239, 0.96);
        backdrop-filter: blur(20px);
        border: 1px solid rgba(118, 92, 64, 0.12);
        border-radius: 22px;
        box-shadow: 0 18px 40px rgba(42, 29, 18, 0.15);
        color: #3f2f24;
        font-size: 14px;
      }
      #eyeflow-nudge .eyeflow-nudge-icon {
        width: 30px;
        height: 30px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        background: linear-gradient(135deg, #d89c60, #9f6b43);
        color: #fff8ef;
        font-size: 13px;
        flex-shrink: 0;
      }
      #eyeflow-nudge .eyeflow-nudge-text {
        line-height: 1.45;
      }
      #eyeflow-nudge .eyeflow-nudge-dismiss {
        background: none;
        border: none;
        color: rgba(63,47,36,0.42);
        cursor: pointer;
        font-size: 14px;
        padding: 0 0 0 6px;
        transition: color 0.2s;
      }
      #eyeflow-nudge .eyeflow-nudge-dismiss:hover { color: #3f2f24; }
    `;
          document.head.appendChild(style);
          document.body.appendChild(nudgeElement);
          nudgeElement.querySelector('.eyeflow-nudge-icon').textContent = 'O';
          nudgeElement.querySelector('.eyeflow-nudge-dismiss').textContent = 'x';
          nudgeElement
            .querySelector('.eyeflow-nudge-dismiss')
            .addEventListener('click', removeNudge);
          setTimeout(removeNudge, 15e3);
        }
        function removeNudge() {
          if (nudgeElement) {
            nudgeElement.remove();
            nudgeElement = null;
          }
          const style = document.getElementById('eyeflow-nudge-style');
          if (style) style.remove();
        }
        function showWarning(timeOnSite) {
          if (warningElement) return;
          warningElement = document.createElement('div');
          warningElement.id = 'eyeflow-warning';
          if (isStrictBreakSite()) {
            warningElement.classList.add('eyeflow-warning-strict');
          }
          warningElement.innerHTML = `
      <div class="eyeflow-warning-content">
        <div class="eyeflow-warning-left">
          <span class="eyeflow-warning-icon">\u25CC</span>
          <div>
            <div class="eyeflow-warning-title">Your eyes may need a pause.</div>
            <div class="eyeflow-warning-subtitle">${timeOnSite} minutes on ${getHostname()}. Take a short guided break so your eyes can move and reset.</div>
          </div>
        </div>
        <div class="eyeflow-warning-actions">
          <button class="eyeflow-warning-btn eyeflow-warning-break">30 seconds - that's all</button>
          <button class="eyeflow-warning-btn eyeflow-warning-dismiss">Maybe later</button>
        </div>
      </div>
    `;
          warningElement.style.cssText = `
      position: fixed;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      z-index: 2147483646;
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
      background: rgba(28, 20, 14, 0.46);
      backdrop-filter: blur(10px);
      animation: eyeflow-fade-in 0.25s ease-out;
    `;
          const style = document.createElement('style');
          style.id = 'eyeflow-warning-style';
          style.textContent = `
      @keyframes eyeflow-fade-in {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      #eyeflow-warning .eyeflow-warning-content {
        display: flex;
        flex-direction: column;
        justify-content: center;
        width: min(80vw, 1080px);
        min-height: min(66vh, 560px);
        aspect-ratio: 2 / 1;
        padding: 42px 46px;
        background: rgba(255, 248, 239, 0.97);
        backdrop-filter: blur(20px);
        box-shadow: 0 30px 80px rgba(42,29,18,0.26);
        color: #3f2f24;
        border: 1px solid rgba(118, 92, 64, 0.12);
        border-radius: 34px;
      }
      #eyeflow-warning .eyeflow-warning-left {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 18px;
        width: 100%;
      }
      #eyeflow-warning .eyeflow-warning-icon {
        width: 56px;
        height: 56px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        background: linear-gradient(135deg, #d89c60, #9f6b43);
        color: #fff8ef;
        font-size: 18px;
        flex-shrink: 0;
      }
      #eyeflow-warning .eyeflow-warning-title {
        font-size: clamp(28px, 3vw, 42px);
        line-height: 1.08;
        font-weight: 800;
      }
      #eyeflow-warning .eyeflow-warning-subtitle {
        font-size: clamp(16px, 1.45vw, 21px);
        opacity: 0.78;
        max-width: 760px;
        line-height: 1.6;
      }
      #eyeflow-warning .eyeflow-warning-actions {
        display: flex;
        gap: 14px;
        margin-top: 28px;
        width: 100%;
      }
      #eyeflow-warning .eyeflow-warning-btn {
        padding: 16px 24px;
        border: 1px solid transparent;
        border-radius: 999px;
        cursor: pointer;
        font-size: 17px;
        font-weight: 600;
        transition: all 0.2s;
      }
      #eyeflow-warning .eyeflow-warning-break {
        background: linear-gradient(135deg, #c9864c, #a66a3e);
        color: #fff9f0;
        min-width: 220px;
      }
      #eyeflow-warning .eyeflow-warning-break:hover {
        transform: translateY(-1px);
      }
      #eyeflow-warning .eyeflow-warning-dismiss {
        background: rgba(109, 136, 126, 0.08);
        border-color: rgba(109, 136, 126, 0.14);
        color: #4b5f59;
      }
      #eyeflow-warning .eyeflow-warning-dismiss:hover {
        background: rgba(109, 136, 126, 0.14);
      }
      #eyeflow-warning.eyeflow-warning-strict .eyeflow-warning-dismiss {
        display: none;
      }
      #eyeflow-warning.eyeflow-warning-strict .eyeflow-warning-actions {
        justify-content: flex-start;
      }
      @media (max-width: 720px) {
        #eyeflow-warning {
          padding: 14px;
        }
        #eyeflow-warning .eyeflow-warning-content {
          width: min(96vw, 560px);
          min-height: auto;
          aspect-ratio: auto;
          padding: 28px 22px;
          border-radius: 24px;
        }
        #eyeflow-warning .eyeflow-warning-actions {
          flex-direction: column;
        }
        #eyeflow-warning .eyeflow-warning-break,
        #eyeflow-warning .eyeflow-warning-dismiss {
          width: 100%;
        }
      }
    `;
          document.head.appendChild(style);
          document.body.appendChild(warningElement);
          warningElement.querySelector('.eyeflow-warning-icon').textContent = 'O';
          warningElement.querySelector('.eyeflow-warning-break').addEventListener('click', () => {
            removeWarning();
            if (typeof EyeFlowOverlay !== 'undefined') {
              EyeFlowOverlay.show(currentSettings, getHostname(), timeOnSite);
            }
          });
          warningElement
            .querySelector('.eyeflow-warning-dismiss')
            .addEventListener('click', removeWarning);
          setTimeout(removeWarning, 3e4);
        }
        function removeWarning() {
          if (warningElement) {
            warningElement.remove();
            warningElement = null;
          }
          const style = document.getElementById('eyeflow-warning-style');
          if (style) style.remove();
        }
        function showGentleReminder(options = {}) {
          const overlayShowing =
            typeof EyeFlowOverlay !== 'undefined' && EyeFlowOverlay.isShowing();
          if (!canShowGentleReminderWithPassiveVideoSupport() || overlayShowing) {
            return false;
          }
          if (Date.now() - lastGentleReminderShownAt < GENTLE_REMINDER_DUPLICATE_GUARD_MS) {
            return false;
          }
          removeGentleReminder();
          lastGentleReminderShownAt = Date.now();
          subtleReminderElement = document.createElement('div');
          subtleReminderElement.id = 'eyeflow-gentle-reminder';
          subtleReminderElement.innerHTML = `
      <div class="eyeflow-gentle-reminder-content">
        <div class="eyeflow-gentle-reminder-title">${options.title || 'Your eyes could use a moment'}</div>
        <div class="eyeflow-gentle-reminder-text">${options.text || 'Blink a little and relax your focus.'}</div>
      </div>
    `;
          subtleReminderElement.style.cssText = `
      position: fixed;
      top: 18px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 2147483643;
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
      animation: eyeflow-gentle-fade 0.28s ease-out;
    `;
          const style = document.createElement('style');
          style.id = 'eyeflow-gentle-reminder-style';
          style.textContent = `
      @keyframes eyeflow-gentle-fade {
        from { opacity: 0; transform: translateX(-50%) translateY(-14px); }
        to { opacity: 1; transform: translateX(-50%) translateY(0); }
      }
      #eyeflow-gentle-reminder .eyeflow-gentle-reminder-content {
        width: min(92vw, 420px);
        padding: 15px 18px;
        border-radius: 20px;
        background: rgba(247, 249, 244, 0.985);
        border: 1px solid rgba(90, 116, 103, 0.18);
        box-shadow: 0 20px 44px rgba(25, 37, 32, 0.16);
        color: #23352f;
        text-align: center;
      }
      #eyeflow-gentle-reminder .eyeflow-gentle-reminder-title {
        font-size: 14px;
        font-weight: 700;
        margin-bottom: 5px;
      }
      #eyeflow-gentle-reminder .eyeflow-gentle-reminder-text {
        font-size: 13px;
        line-height: 1.45;
        opacity: 0.84;
      }
    `;
          document.head.appendChild(style);
          document.body.appendChild(subtleReminderElement);
          setTimeout(removeGentleReminder, 5e3);
          return true;
        }
        function removeGentleReminder() {
          if (subtleReminderElement) {
            subtleReminderElement.remove();
            subtleReminderElement = null;
          }
          const style = document.getElementById('eyeflow-gentle-reminder-style');
          if (style) style.remove();
        }
        let proactiveElement = null;
        function showProactiveWarning(warning) {
          if (proactiveElement) return;
          proactiveElement = document.createElement('div');
          proactiveElement.id = 'eyeflow-proactive';
          proactiveElement.innerHTML = `
      <div class="eyeflow-proactive-content">
        <span class="eyeflow-proactive-icon">\u25C9</span>
        <span class="eyeflow-proactive-text">${warning.message}</span>
        <button class="eyeflow-proactive-dismiss">Got it</button>
      </div>
    `;
          proactiveElement.style.cssText = `
      position: fixed;
      top: 16px;
      right: 16px;
      z-index: 2147483644;
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
      animation: eyeflow-fade-in 0.5s ease-out;
    `;
          const style = document.createElement('style');
          style.id = 'eyeflow-proactive-style';
          style.textContent = `
      @keyframes eyeflow-fade-in {
        from { opacity: 0; transform: translateY(-20px); }
        to { opacity: 1; transform: translateY(0); }
      }
      #eyeflow-proactive .eyeflow-proactive-content {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 14px 20px;
        background: rgba(249, 245, 237, 0.96);
        backdrop-filter: blur(20px);
        border: 1px solid rgba(109, 136, 126, 0.16);
        border-radius: 18px;
        box-shadow: 0 16px 32px rgba(42,29,18,0.14);
        color: #3f2f24;
        font-size: 14px;
        max-width: 360px;
      }
      #eyeflow-proactive .eyeflow-proactive-icon {
        width: 28px;
        height: 28px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        background: linear-gradient(135deg, #6f9a8b, #53776b);
        color: #fff8ef;
        font-size: 12px;
        flex-shrink: 0;
      }
      #eyeflow-proactive .eyeflow-proactive-dismiss {
        padding: 6px 14px;
        background: rgba(109,136,126,0.08);
        border: 1px solid rgba(109,136,126,0.14);
        border-radius: 999px;
        color: #45685d;
        cursor: pointer;
        font-size: 13px;
        white-space: nowrap;
        transition: all 0.2s;
      }
      #eyeflow-proactive .eyeflow-proactive-dismiss:hover {
        background: rgba(109,136,126,0.14);
      }
    `;
          document.head.appendChild(style);
          document.body.appendChild(proactiveElement);
          proactiveElement.querySelector('.eyeflow-proactive-icon').textContent = 'O';
          proactiveElement
            .querySelector('.eyeflow-proactive-dismiss')
            .addEventListener('click', () => {
              if (proactiveElement) proactiveElement.remove();
              proactiveElement = null;
              const s = document.getElementById('eyeflow-proactive-style');
              if (s) s.remove();
            });
          setTimeout(() => {
            if (proactiveElement) proactiveElement.remove();
            proactiveElement = null;
            const s = document.getElementById('eyeflow-proactive-style');
            if (s) s.remove();
          }, 2e4);
        }
        function startTimeTracking() {
          timeTrackingInterval = setInterval(() => {
            flushDsSiteTime();
          }, SITE_TIME_REPORT_INTERVAL_MS);
        }
        function setupMessageListener() {
          try {
            chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
              if (message.type === 'SETTINGS_UPDATED') {
                currentSettings = message.settings;
                EyeFlowIntelligence.updateSettings(message.settings);
                isActive = Boolean(message.settings.enabled);
                hydrationTargetMs = getTotalActiveUsageMs() + getHydrationTargetMs();
              }
              if (message.type === 'SNOOZE_STARTED') {
                syncActiveSession();
                isActive = Boolean(currentSettings?.enabled);
                removeGentleReminder();
                removeNudge();
                removeWarning();
              }
              if (message.type === 'SNOOZE_ENDED') {
                isActive = Boolean(currentSettings?.enabled);
                syncSessionAndSharedTimer();
              }
              if (message.type === 'SYSTEM_IDLE_STATE_CHANGED') {
                isSystemIdle = message.state !== 'active';
                if (isSystemIdle) {
                  if (isEffectivelySystemIdle()) {
                    removeGentleReminder();
                  }
                  syncSessionAndSharedTimer();
                } else {
                  syncSessionAndSharedTimer();
                }
              }
              if (message.type === 'RESET_SESSION_TIMERS') {
                resetSessionTimersFromBackground(message.snapshot);
              }
              if (message.type === 'SHOW_GENTLE_REMINDER') {
                if (showGentleReminder()) {
                  acknowledgeLocalGentleReminder();
                }
              }
              if (message.type === 'SHOW_WATER_GENTLE_REMINDER') {
                showGentleReminder({
                  title: 'Water check-in',
                  text: 'Take a few sips of water when you get a moment.',
                });
              }
              if (message.type === 'SHOW_HYDRATION_POPUP') {
                tryShowHydrationPopup();
              }
              if (message.type === 'QUEUE_HYDRATION_FOR_NEXT_BREAK') {
                hydrationMergedIntoNextBreak = true;
                pendingHydrationPopup = false;
              }
              if (message.type === 'CAN_SHOW_GENTLE_REMINDER') {
                sendResponse({ allow: canShowGentleReminderWithPassiveVideoSupport() });
                return true;
              }
              if (message.type === 'GET_PAGE_REMINDER_CONTEXT') {
                sendResponse({
                  isDoomScrollContext: isDoomScrollContext(),
                  msUntilEyeBreak: getMsUntilEyeBreak(),
                  canShowGentleReminder: canShowGentleReminderWithPassiveVideoSupport(),
                  hasPassiveVideoPresence:
                    isWatchingLongVideoPassively() || isWatchingPassiveDsVideo(),
                  hasRecentRegularPageInput: hasRecentRegularPageInput(),
                  isUsageActive: isUsageActiveNow(),
                  isDsActive: shouldCountActiveTime(),
                });
                return true;
              }
              if (!message.type.startsWith('GET_') && message.type !== 'CAN_SHOW_GENTLE_REMINDER') {
                sendResponse({ success: true });
              }
              return true;
            });
          } catch (e) {}
        }
        function init() {
          try {
            chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (settings) => {
              if (runtimeCallbackFailed()) return;
              if (settings) {
                currentSettings = settings;
                isActive = Boolean(settings.enabled);
                EyeFlowIntelligence.updateSettings(settings);
                hydrationTargetMs = getTotalActiveUsageMs() + getHydrationTargetMs();
              }
            });
            chrome.runtime.sendMessage({ type: 'GET_SHARED_DS_STATE' }, (response) => {
              if (runtimeCallbackFailed()) return;
              applySharedDsState(response);
            });
            chrome.runtime.sendMessage({ type: 'GET_SYSTEM_STATE' }, (response) => {
              if (runtimeCallbackFailed()) return;
              if (response && response.state) {
                isSystemIdle = response.state !== 'active';
                syncSessionAndSharedTimer();
              }
            });
          } catch (e) {}
          window.addEventListener('scroll', handleScroll, { passive: true });
          document.addEventListener('scroll', handleScroll, { passive: true, capture: true });
          document.addEventListener('wheel', handleScroll, { passive: true, capture: true });
          document.addEventListener('touchmove', handleScroll, { passive: true, capture: true });
          document.addEventListener('click', handleInteraction, { passive: true, capture: true });
          document.addEventListener('pointerup', handleInteraction, {
            passive: true,
            capture: true,
          });
          document.addEventListener('keydown', handleInteraction, { passive: true, capture: true });
          document.addEventListener(
            'visibilitychange',
            () => {
              if (document.hidden) {
                flushDsSiteTime();
              } else {
                recordActivity();
              }
              syncSessionAndSharedTimer();
              syncDebugTimerMeta();
            },
            { passive: true }
          );
          window.addEventListener(
            'focus',
            () => {
              recordActivity();
              syncSessionAndSharedTimer();
              syncDebugTimerMeta();
            },
            { passive: true }
          );
          window.addEventListener(
            'blur',
            () => {
              flushDsSiteTime();
              syncSessionAndSharedTimer();
            },
            { passive: true }
          );
          window.addEventListener('pagehide', flushDsSiteTime, { passive: true });
          window.addEventListener('beforeunload', flushDsSiteTime, { passive: true });
          window.addEventListener('eyeflow-break-flow-closed', resetBreakCycle, { passive: true });
          window.addEventListener('eyeflow-hydration-completed', resetHydrationTimer, {
            passive: true,
          });
          window.addEventListener(
            'eyeflow-hydration-remind-soon',
            () => {
              hydrationMergedIntoNextBreak = false;
              pendingHydrationPopup = false;
              try {
                chrome.runtime.sendMessage({ type: 'HYDRATION_REMIND_SOON' });
              } catch (e) {}
            },
            { passive: true }
          );
          lastContextKey = getDoomScrollContextKey();
          if (isSinglePostGraceContextKey(lastContextKey)) {
            singlePostGraceContextKey = lastContextKey;
            singlePostGraceStartedAt = Date.now();
          }
          resetTrackedSession();
          syncSessionAndSharedTimer();
          scrollCheckInterval = setInterval(checkForDoomScroll, SCROLL_CHECK_INTERVAL_MS);
          if (EYEFLOW_DEBUG_CONTENT) {
            debugTimerInterval = setInterval(updateDebugTimerChip, DEBUG_CHIP_INTERVAL_MS);
            updateDebugTimerChip();
          }
          startTimeTracking();
          setupMessageListener();
        }
        init();
        return {
          getHostname,
          removeNudge,
          removeWarning,
        };
      })();
    },
  });
  require_content();
})();
