<div align="center">

# 👁️ EyeFlow

### A Chrome Extension That Fights Doom Scrolling — And Looks After Your Eyes

[![Version](https://img.shields.io/badge/version-1.0.0-orange?style=flat-square)](https://github.com/kumaraharsh84/eye_flow_chrome_extension)
[![Manifest](https://img.shields.io/badge/Manifest-V3-blue?style=flat-square)](https://developer.chrome.com/docs/extensions/mv3/)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)
[![Status](https://img.shields.io/badge/status-testing%20phase-yellow?style=flat-square)](https://github.com/kumaraharsh84/eye_flow_chrome_extension)

<br/>

> You open Instagram for 5 minutes. Two hours later, your eyes hurt and you forgot to drink water.
> EyeFlow watches for that loop — and quietly breaks it.

<br/>

---

</div>

## What Is This?

EyeFlow is a Chrome extension that detects doom scrolling on high-risk sites like **Instagram Reels, YouTube Shorts, Reddit, Facebook, and X** — and responds with:

- **Guided eye-break exercises** — a moving dot you follow with your eyes, proven to reduce screen strain
- **Gentle reminders** during normal browsing, when you have been staring at a screen too long
- **Hydration nudges** because we all forget to drink water when we are deep in a scroll loop

The goal is simple: interrupt unhealthy loops without becoming annoying during normal work, chats, forms, or anything that actually matters.

---

## Screenshots

> Add your screenshots to `docs/screenshots/` folder and update the links below

| Popup | Eye Break Overlay | Onboarding |
|---|---|---|
| ![Popup](docs/screenshots/popup.png) | ![Overlay](docs/screenshots/overlay.png) | ![Onboarding](docs/screenshots/onboarding.png) |

---

## Features

### Core
| Feature | Description |
|---|---|
| 🔍 Doom-scroll detection | Detects high-risk scrolling on Instagram, YouTube Shorts, Reddit, Facebook, X, and TikTok |
| 👁️ Fullscreen eye-break overlay | Guided 6-step exercise with moving dot, countdown, and progress bar |
| 💧 Hydration reminder | Global water reminder every 2 hours |
| 😌 Post-break recovery | Mood logging, time-on-site alert, and next-step suggestions after every break |
| 🔔 Gentle reminder | Soft corner reminder during normal non-DS browsing |

### Smart Behavior
| Feature | Description |
|---|---|
| 🎯 Context-aware detection | Instagram DMs, login pages, payment flows, typing — all suppressed automatically |
| 📺 Passive video detection | Watching a long YouTube video without scrolling? Extension stays quiet |
| 🔄 Tab sync | DS timer is shared across all open doom-scroll tabs |
| 😴 Idle detection | Walk away from your laptop — timers pause automatically |
| ⏸️ Work mode snooze | Pause gentle reminders for 1h, 2h, or 4h without disabling DS protection |

### User Control
| Feature | Description |
|---|---|
| ⚙️ Popup settings | Sensitivity, timing, snooze, theme, suggestions — all configurable |
| 🎨 Dark / Light theme | Popup supports both themes |
| 📊 Stats dashboard | Blocked sessions, breaks taken, weekly history, mood trends |
| 🧭 Onboarding | 3 preset modes on first install — Strict, Balanced, or Gentle |

---

## How It Works

```
You open Instagram
    ↓
EyeFlow detects you are on a doom-scroll surface
    ↓
You start scrolling rapidly
    ↓
Stage 1 → Small nudge appears at the corner
          "Still here?"
    ↓
You ignore it
    ↓
Stage 2 → Warning banner appears
          "30 seconds — that's all"
    ↓
You ignore that too
    ↓
Stage 3 → Fullscreen eye-break overlay
          Guided 6-step exercise with moving dot
    ↓
Break complete → Mood check → Next-step suggestion
    ↓
Timer resets — cycle begins again
```

---

## Supported Sites

| Site | Strong DS surfaces | Gentle only | Suppressed |
|---|---|---|---|
| **Instagram** | Home, Explore, Reels | Direct messages, single posts | Live streams, video calls |
| **YouTube** | Shorts | Long-form videos | Live chat |
| **Reddit** | Home, Popular, feeds | Single post + comments | Notifications, settings |
| **X / Twitter** | Home, Explore | Single tweet, notifications | Direct messages |
| **Facebook** | Home, Watch, Groups | — | Messenger |
| **TikTok** | Everything | — | Direct messages |

---

## Onboarding Modes

| Mode | What It Does |
|---|---|
| 🔒 **Strict** | Higher sensitivity, faster reminders, no skip button |
| ⚖️ **Balanced** | Recommended — nudge first, then warning, then full break |
| 🌿 **Gentle** | Lower sensitivity, fewer interruptions |

---

## Project Structure

```
eyeflow-chrome-extension/
│
├── manifest.json           ← Chrome extension config (MV3)
├── background.js           ← Global scheduler, timers, storage, alarms
├── content.js              ← Page detection, per-tab behavior
├── overlay.js              ← Fullscreen eye-break and post-break UI
├── overlay.css             ← Overlay styles
├── intelligence.js         ← Detection heuristics
├── site-rules.js           ← Per-site context rules
│
├── popup.html              ← Extension popup
├── popup.js                ← Popup logic
├── popup.css               ← Popup styles
│
├── onboarding.html         ← First-run setup
├── onboarding.js           ← Onboarding logic
├── onboarding.css          ← Onboarding styles
│
├── icons/                  ← Extension icons (16, 48, 128px)
│
└── tests/
    ├── puppeteer-extension-smoke.js
    ├── puppeteer-extension-e2e.js
    └── artifacts/
        └── eyeflow-test-report.html
```

---

## Install Locally (Developer Mode)

```bash
# 1. Clone the repo
git clone https://github.com/kumaraharsh84/eye_flow_chrome_extension.git

# 2. Open Chrome and go to
chrome://extensions/

# 3. Turn on Developer Mode (top right toggle)

# 4. Click "Load unpacked"

# 5. Select the cloned folder

# 6. Pin the EyeFlow icon to your toolbar
```

---

## Testing

### Automated Tests

```bash
# Install dependencies
npm install

# Run smoke tests
npm test

# Run full E2E suite
npm run test:e2e

# Test specific flows
npm run test:onboarding
npm run test:popup
npm run test:sites
npm run test:online
```

Test reports are written to `tests/artifacts/eyeflow-test-report.html` after each run.

### What Is Already Automated

- Onboarding preset save flow
- Popup enable and disable
- Popup snooze and resume
- Advanced settings save and validation
- Redirect suggestion add and remove
- Content script presence checks on live sites
- Gentle reminder render checks

### Manual QA

The manual testing guide is at:
```
docs/internal/MANUAL_ONLY_REMAINING_CHECKLIST.md
```

---

## Current Status

```
✅ Extension runtime         working
✅ Popup and onboarding      working
✅ Shared timer logic        working
✅ Fullscreen overlay flow   working
✅ Automated test coverage   working
✅ Manual QA checklist       ready

🔄 Final QA                 in progress
🔄 Visual polish            in progress
🔜 Chrome Web Store         coming soon
```

---

## Known Issues

- Gentle reminder behavior is still being tuned for predictability across tab switching and media-heavy pages
- Water reminder flow needs final real-world QA coverage in longer sessions
- Some site-specific detection rules may need fine-tuning for edge cases like chat pages and mixed-content feeds
- Final visual polish is still in progress

---

## Roadmap

### v1.1 — Post-launch polish
- [ ] Normal mode vs Power mode UI split
- [ ] Streak system — consecutive days tracking
- [ ] Weekly summary notification
- [ ] Better passive video detection across all DS sites

### v2.0 — Future
- [ ] State machine timer architecture
- [ ] Cross-device sync

---

## Privacy

EyeFlow does not collect, transmit, or store any personal data on any server.

- All data lives in your browser's local storage only
- No accounts required
- No analytics or tracking
- No data ever leaves your device

---

## License

MIT — use it, fork it, change it, share it.

---

<div align="center">

Built to help you pause, reset, and keep going with less strain. 👁️💧

</div>
