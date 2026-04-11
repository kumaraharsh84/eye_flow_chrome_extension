# EyeFlow Manual QA Guide

This file is the manual test guide for the parts of EyeFlow that still need real human checking.

Use this guide when you want to verify:

- real browsing behavior
- timer correctness
- eye-break flow
- hydration flow
- popup polish
- site-rule correctness
- multi-tab behavior
- final release feel

You do not need to manually repeat the parts already automated in Puppeteer unless you want extra confidence.

## What Is Already Automated

These are already covered by the Puppeteer test suite:

- onboarding preset save flow
- popup enable and disable
- popup snooze and resume
- advanced settings save and validation
- redirect suggestion add and remove persistence
- basic content-script presence on supported live sites
- gentle reminder render path on supported sites

This manual guide is for everything that still benefits from human judgment or long real-world browsing.

## Before You Start

### Goal

Set up Chrome in a way that makes EyeFlow testing easier and more reliable.

### Do This First

1. Open Chrome.
2. Open `chrome://extensions/`.
3. Make sure `Developer mode` is on.
4. Make sure EyeFlow is loaded.
5. Pin the EyeFlow icon to the toolbar.
6. Keep one tab open on `chrome://extensions/` so you can quickly reload the extension when needed.
7. Keep a text file or notes app open for bug reports.

### Important Testing Rule

If you click `Reload` on the extension in `chrome://extensions/`, refresh the site tabs you are testing after that.

Why:

- content scripts run inside already-open pages
- after extension reload, old tabs may still have the old page context
- refreshing the tab makes sure the latest EyeFlow code is actually running there

### Bug Report Format

Use this format for every bug you find:

- Site or screen:
- Exact steps:
- Expected result:
- Actual result:
- Repeatable or one-time:
- Screenshot or recording:

## Test 1. Extension Load Check

### Goal

Confirm the extension loads cleanly in Chrome and the basic Chrome-side install is healthy.

### Steps

1. Open `chrome://extensions/`.
2. Find the EyeFlow card.
3. Click `Reload`.
4. Watch the extension card carefully.
5. Check whether Chrome shows any red error text.
6. Check whether the EyeFlow icon is visible in the toolbar.
7. Click the EyeFlow icon once.

### Expected Result

- the extension reloads without visible errors
- the service worker does not show a crash/error badge
- the popup opens normally
- the icon is visible and clickable

### Fail Examples

- red error text under the extension
- missing icon
- popup does not open
- service worker crashes immediately

### Checklist

- [yes ] Reloaded extension
- [yes ] No visible Chrome extension errors
- [yes ] Toolbar icon appears
- [yes ] Popup opens

## Test 2. Fresh Install And Onboarding

### Goal

Confirm the true first-run experience is correct.

### Steps

1. Open `chrome://extensions/`.
2. Remove EyeFlow completely.
3. Confirm the icon disappears from the toolbar.
4. Click `Load unpacked`.
5. Select:
   the `eyeflow chorme extension` project folder
6. Wait for EyeFlow to load again.
7. Watch whether onboarding opens automatically in a new tab.
8. Read through onboarding normally.
9. Pick any mode and finish the flow.

### Expected Result

- onboarding opens automatically on a true fresh install
- the flow looks readable and smooth
- the chosen mode saves correctly
- finishing onboarding does not leave the tab stuck or broken

### Fail Examples

- onboarding never opens
- onboarding opens multiple times
- broken layout
- finish button does nothing

### Checklist

- [yes ] Removed extension
- [yes ] Reinstalled extension
- [yes ] Onboarding opened automatically
- [yes ] Finished onboarding successfully

## Test 3. Popup UI And Work Mode

### Goal

Check the popup visually and confirm the Work Mode section behaves cleanly.

### Steps

1. Click the EyeFlow icon.
2. Look at the popup without touching anything first.
3. Check for clipped text, overlapping controls, weird spacing, or ugly wrapping.
4. Expand `Work Mode`.
5. Confirm the snooze buttons appear only after expanding the section.
6. Click `1h`.
7. Confirm the status area changes to a snoozed state.
8. Confirm the snooze status text appears.
9. Confirm the `Cancel Snooze` button appears.
10. Close the popup.
11. Open the popup again.
12. Confirm the snoozed visual state still looks correct.
13. Click `Cancel Snooze`.
14. Repeat a quick visual pass with `2h` and `4h`.

### Expected Result

- popup feels clean and readable
- `Work Mode` opens and closes normally
- snooze buttons look correct
- snooze state persists when popup is reopened
- canceling snooze updates the popup correctly

### Fail Examples

- snooze buttons appear when section is closed
- status text does not update
- popup layout jumps or clips
- cancel snooze does not reset the state

### Checklist

- [yes ] Popup looks clean
- [yes ] Work Mode expands correctly
- [yes ] 1h snooze works visually
- [yes ] 2h snooze works visually
- [yes ] 4h snooze works visually
- [yes ] Cancel Snooze works visually

## Test 4. Debug Chip Check

### Goal

Confirm the testing-mode debug chip is visible and believable.

### Steps

1. Open a normal page such as a company site or static article.
2. Look at the bottom-left of the page.
3. Confirm the debug chip appears.
4. Check the three labels:
   - `Eye break (tab)`
   - `Gentle (global)`
   - `Water (global)`
5. Repeat on at least one DS page and one non-DS page.

### Expected Result

- chip appears reliably
- chip is readable
- chip does not block too much of the page
- `Eye break (tab)` is `Off` on non-DS pages
- `Gentle (global)` is `Off` on strong DS pages

### Fail Examples

- chip missing
- chip shows impossible values
- chip blocks too much content
- DS page still shows gentle countdown instead of `Off`

### Checklist

- [yes ] Chip appears on non-DS page
- [yes ] Chip appears on DS page
- [yes ] Eye break value matches page type
- [yes ] Gentle value matches page type

## Test 5. Gentle Reminder Timer On Normal Browsing

### Goal

Confirm the global gentle timer works across normal tabs and only pauses when it should.

### Steps

1. Open two normal non-DS tabs.
   Example:
   - a company website
   - a GitHub page
2. Confirm both tabs are not DS surfaces.
3. Look at `Gentle (global)` in both tabs.
4. Switch between the two tabs.
5. Confirm the countdown stays almost the same in both tabs.
6. Stay active in one tab and wait for the gentle reminder.
7. After the gentle reminder appears, confirm the timer resets into a fresh cycle.

### Expected Result

- gentle timer is shared across normal non-DS tabs
- switching tabs does not create different countdowns
- after the reminder appears, the countdown restarts cleanly

### Acceptable Difference

- a 1 to 2 second difference between tabs is fine

### Bad Result

- one tab shows `20 min` and another shows `6 min`
- reminder appears repeatedly without reset
- timer freezes without reason

### Checklist

- [yes ] Gentle timer matches across normal tabs
- [yes ] Reminder appears on normal browsing
- [yes ] Timer resets after reminder

## Test 6. Gentle Timer Pause On Inactivity

### Goal

Confirm EyeFlow stops counting gentle time when the user is effectively away.

### Steps

1. Open a normal non-DS page.
2. Make sure no DS page is active.
3. Watch the `Gentle (global)` countdown.
4. Stop all input completely.
   Do not move mouse, scroll, type, or click.
5. Wait for more than 2 minutes.
6. Check whether the gentle timer pauses.
7. Move the mouse or give real input again.
8. Confirm the timer resumes.

### Expected Result

- after about 2 minutes of no input, the gentle timer should pause
- after user input returns, the timer should continue from remaining time

### Checklist

- [no ] Gentle pauses after inactivity
- [no beause it doest stop see accroing to you timer will stop if user have no input for 2 min it doest happen iseatd what happen is that i have oepn 4 chorme tab one extaoin tab one whatapp web 3tab hotsar with ipl and 4 tab github with active tab and leave it for 2 min gentlere remider timer doest pasue after 2 min i was think beause of the hotstar playing in other tab so i close it and then wait for 2 min but still no pasue and i notice that this timer genle remider timer hit 00:00 that when it get pause and when i give input with mouse it start the timer again with random fucntion and doest show the genlete remider notification ] Gentle resumes after user input

## Test 7. YouTube Shorts DS Timer

### Goal

Confirm YouTube Shorts is treated as a real DS surface.

### Steps

1. Open YouTube Shorts directly.
2. Refresh the page if you recently reloaded the extension.
3. Wait a few seconds.
4. Look at the debug chip.
5. Confirm `Eye break (tab)` shows a real countdown and not `Off`.
6. Confirm `Gentle (global)` shows `Off`.
7. Stay on Shorts for several minutes.
8. Let the eye-break timer continue until the break flow appears.

### Expected Result

- Shorts is treated as DS
- eye-break timer runs
- gentle stays off
- break eventually triggers

### Fail Examples

- `Eye break (tab)` stays frozen
- `Eye break (tab)` shows `Off`
- `Gentle (global)` runs on Shorts
- no break appears after enough time

### Checklist

- [yes ] Shorts starts DS timer
- [yes ] Gentle is off on Shorts
- [yes ] Break triggers after enough time

## Test 8. Instagram Explore To Reel / Modal Flow

### Goal

Confirm Instagram Explore and opened reel/video surfaces keep DS behavior.

### Steps

1. Open Instagram Explore.
2. Confirm `Eye break (tab)` is counting.
3. Confirm `Gentle (global)` is `Off`.
4. Click a reel or video from Explore.
5. Watch what happens to the debug chip.
6. Stay on the opened reel/modal for a while.

### Expected Result

- Explore acts like DS
- opening a reel/video from Explore should keep DS behavior
- eye-break timer should continue
- gentle should remain off

### Fail Examples

- Explore is DS but reel modal becomes non-DS
- eye-break turns off after opening reel
- gentle starts running on the reel modal

### Checklist

- [yes ] Explore is DS
- [yes ] Opened reel/modal stays DS
- [yes ] Gentle stays off there

## Test 9. X Site Rules

### Goal

Confirm the X rules match the latest product decisions.

### DS Surfaces To Check

- Home
- Explore
- Communities
- community feed paths

### Off Surfaces To Check

- Notifications
- Chat
- Grok
- Premium
- Profile
- Post / compose
- Creator Studio
- Business
- Create your Space
- Settings and privacy
- Follow / connect people page

### Steps

1. Visit one DS surface such as Home or Explore.
2. Confirm `Eye break (tab)` is on and `Gentle (global)` is off.
3. Visit Communities.
4. Confirm Communities is also DS.
5. Visit one off surface from the list above.
6. Confirm `Eye break (tab)` becomes `Off`.
7. Confirm normal gentle behavior returns there if appropriate.

### Expected Result

- DS surfaces run eye-break timer
- off surfaces do not run DS timer
- communities should not be missed

### Checklist

- [yes ] X Home is DS
- [yes ] X Explore is DS
- [yes ] X Communities is DS
- [yes ] Notifications is off
- [yes ] Chat is off
- [yes ] Grok is off
- [yes ] Premium is off
- [yes ] Profile is off
- [yes ] Creator Studio is off
- [yes ] Business is off
- [yes ] Create your Space is off
- [yes ] Settings and privacy is off
i would like to add one more thing i just notics this taht people can go to the follow section and then they go the anyone prgile for ex i am going to MR Beast the famous one there they have soo many post and i thnk we should treat that section also as a DS beuase you can visit to anyopne prfile who is sharing meme and there you can do the DS so i think we should check this and aslo the like sction navtion of the like scetion is like this you can go the progile scaetion at there you will find the post replies highlightartilve media and like section or we can say tab so i ithink we should also add the DS in this spefic point like scsetion beause there he have already like item so think when user get bore from DS any he want to check his regular feed so he can visit there to watch that and also all the reel post are there fav 

## Test 10. Reddit DS Behavior

### Goal

Confirm Reddit feed-style surfaces behave as DS.

### Steps

1. Open Reddit Popular or another supported feed-like Reddit surface.
2. Check the debug chip.
3. Confirm `Eye break (tab)` is running.
4. Confirm `Gentle (global)` is off.
5. Open a Reddit single-post thread.
6. Watch whether the grace behavior appears.

### Expected Result

- feed-like Reddit surfaces act as DS
- detail/thread page gets the reading grace
- after grace, DS timing can begin if user stays there

### Checklist

- [yes ] Reddit feed surface is DS
- [yes ] Reddit detail page gets reading grace

## Test 11. Facebook DS Behavior

### Goal

Confirm Facebook feed/reel/video surfaces behave correctly.

### Steps

1. Open a Facebook feed-like surface.
2. Open Reels if available.
3. Open a single post or permalink if available.
4. Check the chip in each surface.

### Expected Result

- feed/reel/video surfaces should behave like DS
- single-post/permalink should get the 1-minute reading grace
- chat/message surfaces should stay quiet

### Checklist

- [yes /no i just check that home secation of facebook is not in DS but on reel viedo and groups   ] Facebook feed/reels/videos behave as DS hey i just notice that my eye break time just carsh it get stuck at 00:00 i dont how i just cleaing my grup beause i just open i my facebook id and i see that i have been join in multiple grp so i decided to leave all the georup at that time tiemr was runnign then the timer hit the zero it just get stuck even i refesh the page but still its is on 00:00 so i think may it a bug but i am not sure buease i wa just celaing i mean ust levaing all the grp  whic i have joind and this happen and also notice this that the DS timer did t start at home scetion beause the gentle remider tiemr was on so that a easy guess sople fix also and and reel scetion and group section is already on and also one more imp think i will tell if user havet join any grp so the group tab will not have any reel or any post it was like if you have joind some grp then the grp section will have reel and psot so i think it doest mantter for us on the DS timer where user can watch the reel and do time pass and there is all the all section where user can do doom scling just remind me about this that i have to check facebook again for better understand i think ther eonly one place left which was all section i will tell you about this in chat so just remidn me about that 
- [yes ] Facebook detail page gets grace
- [yes ] Facebook messaging stays off

## Test 12. Snapchat Spotlight

### Goal

Confirm Snapchat Spotlight is treated as a strong DS surface.

### Steps

1. Open Snapchat Spotlight.
2. Refresh the page if needed after extension reload.
3. Wait for the page to settle.
4. Check the debug chip.
5. Confirm `Eye break (tab)` is active.
6. Confirm `Gentle (global)` is off.

### Expected Result

- Spotlight is DS
- eye-break timer runs there
- chat/profile/account areas should stay off

### Checklist

- [ ] Spotlight is DS
- [yes ] Gentle is off on Spotlight
- [yes ] Chat/account/profile areas stay off
there is a big mistake in this remidn me about this in the chat scetion this need a huge update in this scetion remind like this manaer or user that i am telling you this you the feature of the 1 min reading timer that the think which in the benfit in snapchat shpotlight every reel is treaed as single post so i want that treat this a intagram reel scetion intagram reel secrtion is equal to snapchat spotlight and also add the DS on the stoires scetion buease it aslo like a DS site just remind me about this and i will share you the image then you will agre on this firstly you think this prievte and we should not add but when i will share the screenshot i think you will agree to me 

## Test 13. LinkedIn Video / Feed Behavior

### Goal

Confirm LinkedIn only treats feed/video surfaces as DS and leaves professional surfaces quiet.

### Steps

1. Open LinkedIn feed or video-style content.
2. Check the chip.
3. Visit messaging.
4. Visit notifications.
5. Visit jobs.
6. Visit a profile or company page.

### Expected Result

- feed/video surfaces may behave as DS
- messaging, notifications, jobs, profile, company pages should stay off

### Checklist

- [yes / no see i check this 3 time  and it happen all the first i wasthink bug  what the hell evein i amying this i am here to find the bug so the bug was i vist to all the tab se first i open leinkind then home scetion eye break timer was couting no issuse but when i go the the network and then jobs and then message and then notification and then i  came back to home sction and i otice that the eye break tiemr was pasue then i refesh do this agin same so i think we need to fix this bug] LinkedIn feed/video behaves correctly
- [yes ] Messaging is off
- [yes ] Notifications is off
- [yes ] Jobs is off
- [yes ] Profile/company is off

## Test 14. Twitch Behavior

### Goal

Confirm Twitch only treats clips-style short content as DS and leaves long-form watching alone.

### Steps

1. Open a normal Twitch live stream or channel page.
2. Check the chip.
3. Confirm `Eye break (tab)` is `Off`.
4. Then open a Twitch clips feed or single clip.
5. Check the chip again.

### Expected Result

- normal live stream/channel pages should not trigger DS timer
- clips-style short content should be treated as DS

### Checklist

- [yes ] Live stream page is off
- [yes ] Channel page is off
- [no ] Clips feed is DS
- [no ] Single clip behaves as short-content surface
i think this very difficlut to understand may be beuse i never used the twitch tv so i think we can remove this and now lets go the thread which is ismilar to the x so remind me about this beuse i just seen in twitch tv that it is complex to user beause i havet user may i think we should keep this think on annd we will modify it and make it more better with proper taing so i think we should keep this think but we will add the thread in ourproject so remid me for adding the thdraed and i will do the testing ok then
## Test 15. Single-Post Grace Rule

### Goal

Confirm supported single-post/detail pages get the 1-minute reading grace before DS timing starts.

### Sites To Try

- X single post / status
- Reddit comments thread
- Instagram single post / detail
- Facebook post / permalink

### Steps

1. Open a supported single-post/detail page.
2. Look at the debug chip immediately.
3. Confirm `Eye break (tab)` shows `Read 0:xx` instead of the normal DS countdown.
4. Stay there for around 1 minute.
5. Confirm the normal DS timer begins after the grace period.

### Expected Result

- first minute is a reading grace
- during grace, DS timer should not run yet
- after grace, DS timer can begin if the user is still there

### Checklist

- [yes ] Grace state appears
- [yes ] Grace lasts about 1 minute
- [yes ] DS timer starts after grace
yes i notice one more thing everthing was perfect just one thing was off that on x and reddit i notice that if post is have playlable which direct mean viedoe media then red time was be there and if user have image in there post then read time was there but this was not in inatragm in intagram post have video has no read time and post wioth page or only images had a read time so make this think clear add one min for everythink or just remove form everythink so about this i was think that we can i we should keep the timer of one min of reading on every single post which user manul click ok but dont let is go like when user whatchh reel we can say that beause that is also the smae logic  user is on sinlge post also now what so i think lets just remove this reding timer i dont hink we need this or the best think we can do this that we can add the one min reding timer only for the iamges upload post even if that post have mutiple meida wher eonly one meida is image and all other midea is viedo our amin goal is where ever is iamges or banner somthing like that i mena only viedo post no one min reading timer if post has one image add the one min timer tell me about this in the chat 
## Test 16. Eye-Break Overlay

### Goal

Confirm the main eye-break overlay feels clean, centered, and usable.

### Steps

1. Trigger an eye break on a DS surface.
2. Let the overlay open.
3. Check the moving-point exercise area.
4. Confirm the point is easy to follow.
5. Confirm the point moves across a wide enough track.
6. Check whether the layout feels centered and not cut off.
7. Let the countdown complete.

### Expected Result

- moving-point area is large enough
- point is easy to see
- countdown is readable
- no weird scrollbars on normal desktop view
- overlay feels fitted to the tab, not cropped

### Checklist

- [yes ] Moving point is visible
- [may be we can inscre it more  ] Tracking area is large enough
- [yes ] Layout is centered
- [yes ] No unwanted scrollbar
- [yes but the think i that it still show this on the tab where eye tracking is open Your eyes have been working hard
30 seconds. Look away, breathe, come back. but i have set the eye break pop for 20 sec so i think we can remove this Your eyes have been working hard
30 seconds and make some good sapce for better are for track  ] Countdown finishes correctly

## Test 17. Post-Break Screen

### Goal

Confirm the post-break screen looks clean and the break cycle does not restart too early.

### Steps

1. Finish the eye-break countdown.
2. Wait on the post-break screen without clicking anything.
3. Leave it open for a while.
4. Confirm another eye break does not immediately start while this screen is still open.
5. Check the layout:
   - mood buttons
   - continue button
   - close tab button
   - suggestion cards
6. Click `Continue browsing`.

### Expected Result

- next DS cycle should not restart until the user dismisses this final screen
- layout should fit the tab cleanly
- only a small set of suggestions should be shown
- clicking `Continue browsing` should start the next cycle fresh

### Fail Examples

- second eye-break appears immediately
- top of the card looks cut
- too many suggestions clutter the layout

### Checklist

- [yes ] No immediate second break while post-break screen is open
- [yes ] Layout fits the screen
- [yes ] Continue browsing works
- [yes ] Close tab and step away works
You can keep browsing if you want. The important part was taking the pause. i thnk we should remove the unescassy part or text from the post eye break this will make more clear think we hsould not add soo many text what do you think about this 
## Test 18. Hydration Flow

### Goal

Confirm the water reminder still works and the new default timing feels correct.

### Steps

1. Open the popup.
2. Check the water reminder default and current value.
3. Confirm the default is now 1 hour.
4. Leave browsing active long enough or use your testing shortcut path if available.
5. Wait for hydration behavior to appear.

### Expected Result

- default water reminder is 1 hour
- hydration reminder still appears correctly
- hydration reminder does not break the overlay flow

### Checklist

- [yes /no not sure about this beause i just set accoing to my self so you can check from you side if its ok then upte me about this  ] Default water reminder is 1 hour
- [yes ] Hydration reminder appears correctly

## Test 19. DS Site Time Stats

### Goal

Confirm `Your Stats` now reflects DS time by site instead of old blocked/break counts.

### Important Rule

Only the active DS tab should count.

That means:

- if several DS tabs are open, only the one you are actually viewing should count
- background DS tabs should not keep increasing
- time is committed in whole minutes

### Steps

1. Open YouTube Shorts, Instagram, and another DS site in separate tabs.
2. Stay only on one DS tab for a few minutes.
3. Switch to another DS tab.
4. Open the EyeFlow popup.
5. Expand `Your Stats`.
6. Check `Top DS Sites Today`.
7. Confirm the site you actually used is ranked correctly.
8. Close one DS tab after spending time on it.
9. Reopen the popup and check whether that time is reflected.

### Expected Result

- only active DS tab time should be counted
- closed/switched-away DS sessions should commit to stats
- stats should show top DS sites for today
- old `Blocked Today` / `Breaks Today` boxes should not be there anymore

### Important Note

Very short sessions under 1 full minute may not appear yet, because DS stats are stored in whole minutes.

### Checklist

- [yes ] Only active DS tab is counted
- [yes ] Switching tabs commits time correctly
- [yes ] Closing DS tab commits time correctly
- [yes but the ui ux of shoing this is not good i mean it get mix and overlapp somethime so remember me this in chat to fix this issue] Stats ranking looks believable
- [yes ] Old count boxes are gone
the ui of this think is not good remind me about this in my chat 
## Test 20. Stats Persistence

### Goal

Confirm DS site-time stats do not reset when they should not.

### Steps

1. Spend a few minutes on a DS site.
2. Open the popup and note the DS site time.
3. Refresh that site tab.
4. Check the popup again.
5. Reload the extension from `chrome://extensions/`.
6. Refresh the site tab.
7. Check the popup again.
8. Close Chrome fully and reopen it.
9. Open the popup again.

### Expected Result

- `Top DS Sites Today` should survive:
  - page refresh
  - extension reload
  - Chrome close and reopen
- it should reset only when the day changes

### Checklist

- [yes ] Stats survive page refresh
- [yes ] Stats survive extension reload
- [yes ] Stats survive Chrome restart

## Test 21. Multi-Tab DS Behavior

### Goal

Confirm DS timing behaves correctly when several DS tabs are open at once.

### Steps

1. Open 3 DS tabs.
   Example:
   - YouTube Shorts
   - Instagram Reels
   - Reddit feed
2. Stay on tab 1 for a while.
3. Switch to tab 2.
4. Then switch to tab 3.
5. Watch the debug chip each time.
6. Open `Your Stats` later.

### Expected Result

- DS timer should follow the active viewed DS tab
- background DS tabs should not continue counting as if they were active
- stats should match the tabs you actually spent time in

### Checklist

- [yes ] Only active DS tab counts
- [yes ] DS timer moves correctly with tab switching
- [yes ] Stats reflect real active use

## Test 22. Sleep / Idle / Reopen Behavior

### Goal

Confirm long gaps like laptop sleep do not create fake carried-over DS time.

### Steps

1. Spend some time on a DS site.
2. Close the laptop lid or leave the machine inactive for a long gap.
3. Reopen the laptop.
4. Return to a DS site.
5. Watch the debug chip and later check popup stats.

### Expected Result

- EyeFlow should not behave like the earlier DS session continued forever
- after a long gap, timing should feel fresh or correctly resumed, not instantly due

### Checklist

- [yes ] No fake carried-over DS break after long gap
- [yes ] Timer behavior feels fresh after reopen

## Test 23. Non-DS Quiet Surfaces

### Goal

Confirm EyeFlow stays calm on pages where it should not interfere strongly.

### Surfaces To Try

- login pages
- account/auth pages
- chats/messages
- settings pages
- profiles
- business/admin screens
- payment or forms if available

### Steps

1. Visit a few quiet surfaces.
2. Watch the debug chip.
3. Confirm `Eye break (tab)` stays `Off`.
4. Confirm no intrusive DS overlay appears.

### Expected Result

- no DS timer on quiet surfaces
- no strong eye-break interruption on quiet surfaces

### Checklist

- [yes ] Login/auth stays quiet
- [yes ] Chat/message stays quiet
- [yes ] Settings stays quiet
- [yes ] Profile stays quiet

## Test 24. Final Visual Polish Pass

### Goal

Do one last “would a normal user trust this?” pass.

### Check These Things

- popup spacing
- popup wording
- debug chip placement during testing
- eye-break overlay fit
- post-break screen cleanliness
- suggestion cards not overcrowded
- no obviously broken or unfinished screen

### Expected Result

- product should feel intentional
- no screen should feel hacked together or broken

### Checklist

- [no ] Popup feels polished
- [ no] Overlay feels polished
- [no need implrovemt there is a sldie baar  ] Post-break screen feels polished
- [ not sure about this] No obviously broken screen remains

## Release Decision

Use this section only after all major tests above are done.

### Ready To Release If

- no major timer bug appears
- core DS sites behave correctly
- gentle reminder behaves correctly on normal tabs
- hydration still works
- popup stats look believable
- no serious UI break remains

### Hold Release If

- DS timer is wrong on a major site
- gentle/global timer is badly desynced
- post-break screen causes immediate repeat breaks
- stats are clearly inaccurate
- extension breaks important pages

## Quick Final Sign-Off

- [yes but need improvemnt in UIUX ] Extension loads cleanly
- [not sure ] Onboarding works
- [no need impormnet ] Popup looks clean
- [yes ] Work Mode works
- [yes ] Gentle timer works on normal tabs
- [yes ] DS timer works on major DS sites
- [yes ] Single-post grace works
- [yes ] Eye-break overlay works
- [ ] Post-break screen works
- [ ] Hydration works
- [yes ] Stats update correctly
- [yes ] Stats persist correctly
- [yes ] Multi-tab behavior is correct
- [yes ] Long-gap / reopen behavior is correct
- [not sure ] Quiet surfaces stay quiet
- [no need improvemnt in ui ux where ever is slider baar remove it and make perfect ui ux to fix on the normal tab size and auto adjust it self accoding to the user active tab size ] Product feels ready for first release
