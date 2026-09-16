/* ═══════════════════════════════════════════════════════════
   AGORA — VVP Review · CONFIG
   Everything you would want to change lives in this one file.
   ═══════════════════════════════════════════════════════════ */

window.AGORA = {

  /* ── 1. Where responses go ────────────────────────────────
     Paste the Web app URL from your Google Apps Script deployment
     (it ends in /exec). While this is empty, the site shows a dark
     bar across the top and answers stay in that browser only.
     README.md → "2. Collect responses" walks through it.       */
  endpoint: 'https://script.google.com/macros/s/AKfycbyMxJS4psj_NVlOYoM9lYDUH7MM9U99y9rcdccn3hmr1dZNqT8aesHm4D-dEyMJpdWI/exec',

  /* Stamped on every row, so separate rounds stay separable.   */
  round: 'Round 01',

  /* ── 2. The ideas ─────────────────────────────────────────
     `num` is your private reference number. Participants never
     see it, and every row in the sheet carries it. Everyone gets
     their own random order, so the order of this list is irrelevant.

     `label` is optional and private: a short note to yourself that
     lands next to the number in the sheet (e.g. 'Social venue').

     Images load from the pattern below with {num} swapped in.
     prepare-images.sh fills vvps/ from a draft set folder.
     A missing image shows a blank template instead.            */
  images: 'vvps/vvp-{num}.jpg',

  vvps: [
    { num: 1,  label: '' }, { num: 2,  label: '' }, { num: 3,  label: '' },
    { num: 4,  label: '' }, { num: 5,  label: '' }, { num: 6,  label: '' },
    { num: 7,  label: '' }, { num: 8,  label: '' }, { num: 9,  label: '' },
    { num: 10, label: '' }, { num: 11, label: '' }, { num: 12, label: '' },
    { num: 13, label: '' }, { num: 14, label: '' }, { num: 15, label: '' },
    { num: 16, label: '' }, { num: 17, label: '' }, { num: 18, label: '' },
    { num: 19, label: '' }, { num: 20, label: '' }, { num: 21, label: '' },
    { num: 22, label: '' }, { num: 23, label: '' }, { num: 24, label: '' },
    { num: 25, label: '' }, { num: 26, label: '' }, { num: 27, label: '' },
    { num: 28, label: '' }, { num: 29, label: '' }, { num: 30, label: '' }
  ],

  /* ── 3. Question 1: gut reaction, shown top to bottom ─────
     `score` is what lands in the sheet, so ideas can be averaged. */
  reactions: [
    { key: 'not_for_me',  label: 'Not for me',                                   score: 1, color: '#161616' },
    { key: 'interesting', label: 'Sounds interesting, would want to learn more', score: 2, color: '#ADF1FF' },
    { key: 'asap',        label: 'Would use this ASAP',                          score: 3, color: '#F67451' }
  ],

  /* ── 4. Question 2: one tap, then it moves on ─────────────── */
  reasonPrompt: 'What’s driving that?',
  reasons: [
    { key: 'problem', label: 'The problem it solves' },
    { key: 'how',     label: 'How it would work' },
    { key: 'who',     label: 'Who it’s for' },
    { key: 'effort',  label: 'The cost, time or effort' },
    { key: 'unclear', label: 'Hard to tell from the image' }
  ],

  /* ── 5. Question 3: optional, in their own words ──────────── */
  notePrompt: 'In your words',
  notePlaceholder: 'What’s working? What isn’t? What would you change?'
};
