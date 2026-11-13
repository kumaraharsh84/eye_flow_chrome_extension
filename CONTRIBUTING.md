# Contributing to EyeFlow

Thank you for your interest in contributing to EyeFlow.

## How to contribute

- Open an issue for bug reports, feature requests, or questions.
- Send a pull request for fixes or improvements.
- Keep changes small and focused.
- Follow existing code style in JavaScript and HTML.

## Development workflow

1. Fork the repository.
2. Create a branch for your change.
3. Make your changes.
4. Run `npm install` if needed.
5. Run `npm run lint` and `npm test` (build, unit tests, and a browser smoke test).
6. If you changed the popup or onboarding, also run `npm run test:popup` or `npm run test:onboarding`.
7. Submit a pull request.

## Where things live

- `src/background.js` owns all stored state. Pages and content scripts ask it to change things; they never write settings or stats themselves.
- `src/content.js` runs on every site, so keep it idle outside the tracked hosts: no timers, no messages on page load.
- `src/overlay.css` is injected into every site. Every selector must start with `#eyeflow-`, and no `:root` rules or generic `@keyframes` names.
- Do not load remote scripts, styles or fonts. The Chrome Web Store package must be self-contained.
