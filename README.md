# Agora · VVP Review

A voting site for Visual Value Propositions. Each participant reads how it works, then flips through every idea in their own random order and answers three quick questions per card. Every answer streams into a Google Sheet you own, tagged with the idea's private number.

## The flow

1. **How it works.** The bullets, then age, gender and city. The button stays dim until all three are filled, then Enter starts it.
2. **Each idea.** The card sits in the middle of the rolodex; the two questions sit on the left under *Gut reaction.*
   - **Q1 · Gut reaction:** Not for me · Sounds interesting, would want to learn more · Would use this ASAP
   - **Q2 · What made you choose that answer?** Four options, pick any number of them or skip. The wording changes to match the Q1 answer, so "Sounds fun" becomes "Doesn't sound fun" for a no.

   Answering Q1 moves straight to Q2, and Enter (or *Skip*) moves to the next idea. There are no save buttons. **Once an idea is done it can't be reopened**, and the intro says so. Tap or click a card to read the whole image full size.
3. **The end.** One optional written question, a *View again* button for looking back through the deck without voting, then *Submit*.
4. **Thank you.**

The four Q2 options mean the same four things in every set, and the sheet records a stable key for each (`problem`, `fun`, `easier`, `social`) next to the wording, so they can be compared across answers.

## What's in the folder

| File | What it is |
|---|---|
| `config.js` | **Everything you edit:** the collector URL, the ideas, all three questions |
| `index.html` · `styles.css` · `app.js` | The site |
| `google-apps-script.gs` | The collector that writes answers into your Google Sheet |
| `prepare-images.sh` | Fills `vvps/` from a draft set folder |
| `assets/` | Logo lockup and mark |
| `vvps/` | The idea images (empty until you run the script) |

---

## 1. Add the ideas

```bash
cd "$HOME/Desktop/Agora Files/VVP/VVP Website (9.15.2026)"
./prepare-images.sh "../VVP Draft Set v1 (8.9.2026)"
```

This turns each `VVP #7.png` into `vvps/vvp-7.jpg`, a web-size JPEG. The 30 PNGs in Draft Set v1 are about 66 MB; as JPEGs they come to about 15 MB (roughly half a megabyte each), which matters for anyone opening the link on a phone. It takes a couple of seconds.

The number in each filename becomes that idea's **private number**. `config.js` already lists numbers 1 to 30. If a set has a different count, add or remove `{ num: … }` lines to match. A number without an image shows a blank template, so gaps are easy to spot before you send the link.

Optional: give each idea a `label` in `config.js` (e.g. `'Social venue'`). Participants never see it; it shows up next to the number in the sheet.

## 2. Collect responses (Google Sheet, about 5 minutes)

1. Create a new Google Sheet, e.g. *Agora VVP Responses*.
2. **Extensions → Apps Script.** Delete what's in `Code.gs` and paste in all of `google-apps-script.gs`. Save.
3. In the function menu at the top, choose **`setup`** and press **Run**. Google will ask you to approve access to the sheet. This creates the *Summary*, *Responses* and *Sessions* tabs.
4. **Deploy → New deployment.** Click the gear, choose **Web app**, and set:
   - **Execute as:** Me
   - **Who has access:** **Anyone**
5. Press **Deploy** and copy the **Web app URL** (it ends in `/exec`).
6. Paste it into `config.js`:
   ```js
   endpoint: 'https://script.google.com/macros/s/…/exec',
   ```
7. Check it: open that URL in a browser tab. You should see *"Agora VVP collector is live."*

> **"Who has access" must be Anyone.** With any other setting the site can't write, and answers pile up unsent in each participant's browser.

If you edit the script later: **Deploy → Manage deployments → pencil → Version: New version → Deploy.** The URL stays the same.

## 3. Test it before you send it

- The dark bar across the top of the site means `endpoint` is still empty. It disappears once the collector is connected.
- The site remembers each browser and resumes where that person left off. To start over as a new participant, add **`?new`** to the end of the URL.
- Vote on a couple of ideas. Rows should appear in *Responses* within a few seconds.
- Before sending the link out, delete your test rows from *Responses* and *Sessions*, or change `round` in `config.js` so they're easy to filter out.

## 4. Put it online

The simplest option is **Netlify Drop**: go to app.netlify.com/drop and drag the whole `VVP Website (9.15.2026)` folder onto the page. You get a link to send. GitHub Pages works too.

Upload the whole folder, including `vvps/`. Anyone with the link can see the images. The page tells search engines not to index it.

---

## Reading the results

**Summary tab.** Participants and submissions at the top, then every idea ranked by average score (1 = not for me, 2 = interesting, 3 = ASAP), and a table of how many people gave each reaction per idea.

**Responses tab.** One row per person per idea.

| Column | Meaning |
|---|---|
| `vvp_num` | The idea's private number |
| `vvp_label` | Your label from `config.js`, if you set one |
| `reaction` · `reaction_score` | Q1, as words and as 1 / 2 / 3 |
| `reasons` | Q2, the wording they picked, separated by `;` (empty if they skipped) |
| `reason_keys` | The same picks as `problem` / `fun` / `easier` / `social`, for comparing across answers |
| `position` | Where this idea fell in *their* order (1 = first card they saw) |
| `seconds_to_react` | Time from first seeing the card to answering Q1 |
| `session_id` | Who. Unique per person; their age, gender and city are on the Sessions tab |
| `updated_at` · `received_at` | When they answered, and when the sheet got it |

**Sessions tab.** One row per person: `age`, `gender`, `city`, when they started, whether they pressed **Submit** (`submitted`), how many ideas they finished, their `closing_note` from the end of the run, and `order`, the exact sequence of idea numbers they were shown.

`position` and `order` let you check for order effects, such as ideas scoring lower simply because they came late.

## Good to know

- **Answers send as they're given.** Someone who closes the tab halfway still counts; their *Sessions* row just shows `submitted` as FALSE.
- **A changed answer overwrites, it doesn't duplicate.** If someone flips through again and changes a vote, their row updates to the final answer.
- **Flaky connections are fine.** Unsent answers wait in that person's browser and go through once they're back online, including the next time they open the link.
- **To change the questions**, edit sections 3 to 6 of `config.js`. Each Q1 answer carries its own list of Q2 options, so edit them inside the matching `reactions` entry. The sheet stores the answer text, so rename options between rounds rather than mid-round.
- **If you change the columns in `google-apps-script.gs`**, paste the new script in, run `setup` once (it repairs the header rows and rebuilds Summary), then **Deploy → Manage deployments → pencil → New version**. Clear out old rows first, since they were written under the old headers.
- **Keyboard:** number keys answer (and toggle Q2 picks), Enter moves on, ← goes back from Q2 to Q1, Esc closes the full-size view.
- **The collector URL lives in the site's code**, so a determined visitor could find it and post junk to your sheet. That's fine for a feedback round; just don't reuse the setup for anything sensitive.

## Tuning the rolodex

The card size follows the screen. The arc's shape is set in `layout()` in `app.js`: `R` (arc radius, as a multiple of card width), `step` (degrees between cards), and the `if (d < 0)` branch (how far the spent card falls to the bottom-left).
