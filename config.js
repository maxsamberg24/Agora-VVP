/* ═══════════════════════════════════════════════════════════
   AGORA — VVP Review · CONFIG
   Everything you would want to change lives in this one file.
   ═══════════════════════════════════════════════════════════ */

window.AGORA = {

  /* ── 1. Where responses go ────────────────────────────────
     The Web app URL from your Google Apps Script deployment.
     While this is empty, the site shows a dark bar across the top
     and answers stay in that browser only.                     */
  endpoint: 'https://script.google.com/macros/s/AKfycbzpyClIubSyy_KhKFVnn33Mcqc3i2j5AtZYpyVpGv5Ks5sFVThVI2Z0fLyP1SFSL6JA/exec',

  /* Stamped on every row, so separate rounds stay separable.   */
  round: 'Round 01',

  /* ── 2. The ideas ─────────────────────────────────────────
     `num` is your private reference number. Participants never
     see it, and every row in the sheet carries it. Everyone gets
     their own random order, so the order of this list is irrelevant.
     `label` is optional and private: a note to yourself that lands
     next to the number in the sheet.

     Images load from the pattern below with {num} swapped in.
     prepare-images.sh fills vvps/ from a draft set folder.      */
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

  /* ── 3. Who's answering ───────────────────────────────────
     Age, gender and city are all typed in, and all three have to be
     filled before the start button lights up.                    */
  ageRange: { min: 10, max: 110 },

  /* ── 4. Question 1: gut reaction, shown top to bottom ─────
     `score` is what lands in the sheet, so ideas can be averaged.
     Each answer carries its own follow-up wording. The four `key`
     values line up across all three sets (problem / fun / easier /
     social), so you can compare them in one column of the sheet.  */
  reactions: [
    {
      key: 'not_for_me', label: 'Not for me', score: 1, color: '#161616',
      reasons: [
        { key: 'problem', label: "Doesn't solve a problem I have" },
        { key: 'fun',     label: "Doesn't sound fun" },
        { key: 'easier',  label: 'Would not make my life any easier' },
        { key: 'social',  label: 'Would not improve my social life' }
      ]
    },
    {
      key: 'interesting', label: 'Sounds interesting, would want to learn more', score: 2, color: '#ADF1FF',
      reasons: [
        { key: 'problem', label: 'Could solve a problem I have' },
        { key: 'fun',     label: 'Sounds like it could be fun' },
        { key: 'easier',  label: 'Could potentially make my life easier' },
        { key: 'social',  label: 'Could maybe improve my social life' }
      ]
    },
    {
      key: 'asap', label: 'Would use this ASAP', score: 3, color: '#F67451',
      reasons: [
        { key: 'problem', label: 'Solves a problem I have' },
        { key: 'fun',     label: 'Sounds fun' },
        { key: 'easier',  label: 'Would make my life easier' },
        { key: 'social',  label: 'Would improve my social life' }
      ]
    }
  ],

  /* ── 5. Question 2 wording ────────────────────────────────  */
  reasonPrompt: 'What made you choose that answer?',
  reasonHint: 'Pick as many as you like.',

  /* ── 6. The one written question, at the very end ─────────  */
  closingPrompt: 'Let me know if you have any ideas, thoughts, or suggestions about any of these concepts!',
  closingPlaceholder: 'Anything at all. What stood out, what missed, what you would build instead.'
};
