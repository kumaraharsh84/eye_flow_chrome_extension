# Chrome Web Store — EyeFlow Listing Copy

Everything needed to fill in the Developer Dashboard. Upload the zip made by `npm run package`.

---

## Name

EyeFlow - Doom Scroll Blocker & Eye Care

## Short Description (132 characters max)

Taken from `description` in `src/manifest.json`. Keep the two in sync.

> Spots doom scrolling and guides a short eye break. Gentle eye and water reminders that stay quiet while you work.

Character count: 113 ✅

---

## Long Description

**EyeFlow** watches quietly while you browse and steps in when your eyes need a break.

**Detects doom scrolling** on Instagram, YouTube Shorts, Reddit, X (Twitter), Facebook, TikTok, Snapchat, LinkedIn and Twitch. It knows the difference between a feed and the rest of the site: Reels count, your DMs do not. Shorts count, a long video does not.

**Guided eye breaks.** After a few minutes of active scrolling (5 by default), a fullscreen 20-second exercise asks you to follow a moving dot with your eyes. The feed is paused behind it. On the most addictive feeds the break cannot be skipped.

**One shared timer.** Jumping from Instagram to Shorts to Reddit does not restart the clock. Stopping, switching to a normal tab, or walking away pauses it.

**Gentle reminders on normal pages.** A small, quiet toast every 25 minutes or so reminds you to rest your eyes. It stays away when you are typing, in a meeting, watching a video, or on a banking or sign-in page.

**Water reminders.** Every 1 to 4 hours, in whatever form fits where you are.

**Stays out of your way.** Work mode pauses gentle reminders for 1, 2 or 4 hours. Everything is adjustable from the popup.

### Features

- Doom-scroll detection on 9 platforms, by feed surface rather than by whole site
- Fullscreen guided eye break with countdown; feed video is paused
- Sensitivity slider and fixed or surprise (random) timing
- Post-break mood check and a "close tab and step away" button
- Water reminders that merge into an eye break when one is close
- Gentle reminder toasts on normal pages; optional background chime
- Keyboard shortcut to start an eye break any time (Ctrl+Shift+E)
- Today's top doom-scroll sites and your peak scrolling time
- Export your stats as JSON
- Optional weekly report to a webhook you provide, for keeping an eye on a sibling's or your own habits
- Dark and light theme

### Privacy

EyeFlow has no server, no account and no analytics. Settings and stats are stored locally in your browser. Nothing leaves your device unless you turn on the optional weekly report, which is sent only to the webhook address you enter yourself.

Full privacy policy: https://kumaraharsh84.github.io/eye_flow_chrome_extension/privacy-policy.html

---

## Category

Well-being (alternative: Productivity → Tools)

## Language

English

---

## Privacy Practices Tab

### Single purpose

EyeFlow reduces eye strain from long browsing sessions: it detects doom scrolling on social feeds and prompts short eye breaks, plus gentle eye and water reminders on other pages.

### Permission justifications

| Permission                                 | Justification to paste                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `storage`                                  | Saves the user's settings, break statistics and reminder timers locally with chrome.storage.local.                                                                                                                                                                                                                          |
| `alarms`                                   | A 30-second repeating alarm wakes the service worker to check whether a gentle reminder, water reminder or the daily stats rollover is due. A service worker cannot keep its own timers running.                                                                                                                            |
| `notifications`                            | Shows the water reminder as a system notification when Chrome is not the focused window or the current page cannot show an in-page reminder.                                                                                                                                                                                |
| `idle`                                     | Detects when the user is away or the screen is locked so the timers pause and no reminders are shown to an empty chair.                                                                                                                                                                                                     |
| `offscreen`                                | Plays a short reminder chime (Web Audio) while Chrome is in the background. Service workers cannot play audio. The feature is opt-in and off by default.                                                                                                                                                                    |
| Host permissions (9 social sites)          | Used to find the open tabs on the tracked social sites so settings changes and idle state can be sent to them. These are the only sites where doom-scroll time is measured.                                                                                                                                                 |
| Optional host permission (`https://*/*`)   | Requested at runtime, for one origin only, when the user enters a webhook address for the optional weekly report. Needed to POST the report to that address. Never requested otherwise.                                                                                                                                     |
| Content script on all http and https sites | Gentle eye and water reminders are shown as an in-page toast on whichever site the user is on, and the eye break can be started on any page with a keyboard shortcut. On sites outside the 9 tracked ones the script is dormant: it reads no page content, runs no timers and sends nothing until asked to show a reminder. |

### Remote code

No. All code is bundled in the package. No external scripts, styles or fonts are loaded.

### Data usage disclosure

Tick **"Web history"** and **"User activity"** as collected-and-kept-locally categories if the form requires a choice, with this explanation:

- EyeFlow records the _names_ of the tracked social sites and the time actively spent on their feeds (for example "Reddit: 12 minutes"), plus scroll and click _activity signals_ used only to tell whether the user is actively scrolling. No URLs of other sites, no page content and no keystrokes are recorded.
- This data is stored locally. It is transmitted only if the user enables the optional weekly report, and then only to the webhook address the user entered.

Certify all three statements: data is not sold, not used for unrelated purposes, not used for creditworthiness.

---

## Screenshots needed (1280x800 or 640x400)

1. Popup, dark theme, with "Top DS Sites Today" visible
2. Eye break overlay with the dot and countdown
3. Post-break card with the mood check
4. Gentle reminder toast on a normal page
5. Onboarding "EyeFlow is ready" screen

## Promo tile (440x280)

- Dark background
- EyeFlow logo + tagline: "Doom scroll less. See better."

---

## Reviewer notes (optional field)

To see an eye break without waiting 5 minutes, press Ctrl+Shift+E on any website. To see doom-scroll detection, open youtube.com/shorts and scroll for 5 minutes with the default settings. The weekly report feature is off unless a webhook URL is saved in Advanced Controls.
