
# EyeFlow Final Release 10-Minute Test Pass
Use this file right before release when you want a fast confidence check.

This is not the full QA guide.

For the full manual walkthrough, use:

- `MANUAL_ONLY_REMAINING_CHECKLIST.md`

## Goal

In about 10 minutes, confirm that the most important EyeFlow behavior still works:

- extension loads
- popup works
- gentle timer works
- DS timer works
- eye-break flow works
- stats update
- no obvious release blocker remains

## 1. Extension Load

### Steps

1. Open `chrome://extensions/`.
2. Reload EyeFlow.
3. Refresh the site tabs you plan to test.
4. Click the EyeFlow icon.

### Expected Result

- no visible extension error
- popup opens

### Check

- [ ] Extension reloads cleanly
- [ ] Popup opens

## 2. Popup Quick Check

### Steps

1. Open the popup.
2. Expand `Work Mode`.
3. Click `1h`.
4. Confirm snooze state appears.
5. Click `Cancel Snooze`.
6. Expand `Your Stats`.

### Expected Result

- Work Mode expands correctly
- snooze visual state updates
- cancel resets correctly
- stats section opens normally

### Check

- [ ] Work Mode works
- [ ] Snooze works
- [ ] Cancel Snooze works
- [ ] Stats section opens

## 3. Normal Tab Gentle Timer

### Steps

1. Open two normal non-DS tabs.
2. Look at the debug chip in both.
3. Compare `Gentle (global)`.
4. Switch between the tabs.

### Expected Result

- gentle timer is nearly the same across both tabs
- eye break stays off on these pages

### Check

- [ ] Gentle timer matches across normal tabs
- [ ] Eye break is off on non-DS pages

## 4. One Major DS Site

### Steps

1. Open YouTube Shorts or Instagram Reels.
2. Look at the debug chip.

### Expected Result

- `Eye break (tab)` is running
- `Gentle (global)` is `Off`

### Check

- [ ] DS timer starts
- [ ] Gentle is off on DS page

## 5. Eye-Break Flow

### Steps

1. Stay on the DS page until the eye-break flow appears.
2. Let the moving-dot exercise run.
3. Let the countdown finish.
4. Stay on the post-break screen for a short moment.
5. Click `Continue browsing`.

### Expected Result

- overlay opens cleanly
- moving point is visible and easy to follow
- no extra scrollbar on normal desktop view
- no second immediate eye break while post-break screen is still open
- next cycle restarts only after user dismisses the post-break screen

### Check

- [ ] Eye-break overlay opens correctly
- [ ] Exercise screen looks clean
- [ ] Post-break screen looks clean
- [ ] No immediate repeated break
- [ ] Continue browsing works

## 6. Stats Quick Check

### Steps

1. After spending time on a DS site, open the popup.
2. Expand `Your Stats`.
3. Check `Top DS Sites Today`.

### Expected Result

- the active DS site appears after committed time
- old blocked/break count cards are not there anymore

### Check

- [ ] DS site time appears
- [ ] Stats look believable
- [ ] Old count cards are gone

## 7. One Quiet Surface Check

### Steps

1. Open one quiet page like:
   - chat
   - profile
   - settings
   - login
2. Look at the chip.

### Expected Result

- `Eye break (tab)` is `Off`
- no intrusive DS overlay appears

### Check

- [ ] Quiet surface stays quiet

## 8. Final Release Question

Ask yourself these 4 questions:

1. Did the popup behave correctly?
2. Did one major DS site behave correctly?
3. Did the eye-break flow complete correctly?
4. Did stats update correctly after use?

## Ship / Hold

### Ship If

- all major checks above passed
- no major timer bug appeared
- no broken UI appeared

### Hold If

- DS timer is wrong on a major site
- gentle timer is clearly wrong across tabs
- post-break flow repeats immediately
- stats are clearly not updating

## Final Sign-Off

- [ ] Extension load is good
- [ ] Popup is good
- [ ] Gentle timer is good
- [ ] DS timer is good
- [ ] Eye-break flow is good
- [ ] Stats are good
- [ ] Quiet surfaces are good
- [ ] Ready to release
