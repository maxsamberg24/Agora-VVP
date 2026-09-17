/* ═══════════════════════════════════════════════════════════
   AGORA — VVP Review · app
   How it works → for each idea: gut reaction → why (pick any) →
   next idea, automatically. No going back to an idea once it's
   done. At the end: one written question, an optional look back
   through the deck, then submit.
   Every answer streams to the sheet the moment it's given.
   ═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const CFG = window.AGORA;
  const STORE_KEY  = 'agora.vvp.session.v3';
  const OUTBOX_KEY = 'agora.vvp.outbox.v3';
  const WIDE  = window.matchMedia('(min-width: 1100px)');
  const TOUCH = window.matchMedia('(hover: none)');
  const STEP_DELAY = 280;   // ms to let a tap register before moving on
  const SEND_DELAY = 1500;  // ms to gather one card's answers into a single request

  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const pad = n => String(n).padStart(2, '0');
  const nowIso = () => new Date().toISOString();
  const reactionFor = key => CFG.reactions.find(r => r.key === key);

  /* ───────────────────────────────────────────────────────────
     1. Ideas
     ─────────────────────────────────────────────────────────── */
  const IDEAS = new Map();
  CFG.vvps.forEach(v => {
    const num = Number(v.num);
    if (!Number.isInteger(num) || IDEAS.has(num)) {
      console.warn('[agora] skipping a VVP with a missing or duplicate num:', v);
      return;
    }
    IDEAS.set(num, { num, label: v.label || '', src: v.src || imageFor(num) });
  });
  function imageFor(num) {
    return encodeURI(CFG.images.replace('{num}', num)).replace(/#/g, '%23');
  }

  /* ───────────────────────────────────────────────────────────
     2. Session: one per participant, per browser.
     Add ?new to the URL to start a fresh one (handy for testing).
     ─────────────────────────────────────────────────────────── */
  let S = loadSession();

  function newSession() {
    return {
      id: uid(), round: CFG.round,
      profile: { age: '', gender: '', city: '' },
      startedAt: '', submittedAt: '', closingNote: '',
      order: shuffle([...IDEAS.keys()]),   // this participant's random order
      active: 0, step: 1, reviewAt: 0, view: 'intro',
      answers: {}                          // keyed by the private VVP number
    };
  }

  function loadSession() {
    const params = new URLSearchParams(location.search);
    if (params.has('new')) {
      params.delete('new');
      const q = params.toString();
      history.replaceState(null, '', location.pathname + (q ? '?' + q : '') + location.hash);
      return newSession();
    }
    try {
      const s = JSON.parse(localStorage.getItem(STORE_KEY));
      if (s && s.id && Array.isArray(s.order)) return reconcile(s);
    } catch (e) { /* unreadable storage: start fresh */ }
    return newSession();
  }

  /* keep a saved session valid if config.js changed since */
  function reconcile(s) {
    const order = s.order.filter(n => IDEAS.has(n));
    const added = shuffle([...IDEAS.keys()].filter(n => !order.includes(n)));
    s.order    = order.concat(added);
    s.active   = Math.min(Math.max(0, s.active | 0), Math.max(0, s.order.length - 1));
    s.reviewAt = Math.min(Math.max(0, s.reviewAt | 0), Math.max(0, s.order.length - 1));
    s.step     = s.step === 2 ? 2 : 1;
    s.answers  = s.answers || {};
    s.profile  = s.profile || { age: '', gender: '', city: '' };
    s.closingNote = s.closingNote || '';
    if (!['intro', 'vote', 'finish', 'review', 'thanks'].includes(s.view)) s.view = 'intro';
    return s;
  }

  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch (e) { /* private mode */ }
  }

  const current = () => S.order[S.active];
  const answer = num => S.answers[num] || (S.answers[num] = {});
  const hasVote = num => !!(S.answers[num] && S.answers[num].reaction);

  function uid() {
    if (window.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  function shuffle(list) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const r = new Uint32Array(1);
      crypto.getRandomValues(r);
      const j = r[0] % (i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /* ───────────────────────────────────────────────────────────
     3. Outbox. Answers queue in localStorage and stream to the
     sheet. A queued answer is only dropped once the collector
     confirms it wrote the row, so closed tabs, flaky wifi and
     reloads don't lose anything. The collector upserts, so a
     resend just overwrites the same row.
     ─────────────────────────────────────────────────────────── */
  const Outbox = (function () {
    let queue = read();
    let busy = false, wait = 0, timer = 0;
    const listeners = [];

    function read() {
      try { return JSON.parse(localStorage.getItem(OUTBOX_KEY)) || []; } catch (e) { return []; }
    }
    function persist() {
      try { localStorage.setItem(OUTBOX_KEY, JSON.stringify(queue)); } catch (e) {}
      listeners.forEach(fn => fn(queue.length));
    }
    const keyOf = ev => ev.type === 'response' ? `r|${ev.session_id}|${ev.vvp_num}` : `s|${ev.session_id}`;

    function push(ev) {
      const k = keyOf(ev);
      queue = queue.filter(e => keyOf(e) !== k);   // newest version of a row wins
      queue.push(ev);
      persist();
      // start the clock on the first unsent answer only, so a fast voter can't keep pushing it back,
      // and a running retry backoff isn't cut short
      if (!timer && !busy) later(wait || SEND_DELAY);
    }
    function later(ms) { clearTimeout(timer); timer = setTimeout(() => { timer = 0; flush(); }, ms); }

    async function flush() {
      if (busy || !queue.length || !CFG.endpoint) return;
      if (navigator.onLine === false) return;      // the 'online' event resumes
      busy = true;
      const batch = queue.slice(0, 20);
      let ok = false;
      try {
        const body = JSON.stringify({ events: batch });
        const res = await fetch(CFG.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },   // no CORS preflight
          body,
          keepalive: body.length < 60000
        });
        const data = await res.json().catch(() => null);
        ok = !!(data && data.ok);
        if (!ok) console.warn('[agora] the collector did not confirm the write:', data || res.status);
      } catch (err) {
        console.warn('[agora] could not reach the collector, will retry:', err);
      }
      busy = false;
      if (ok) {
        queue = queue.filter(e => !batch.includes(e));
        wait = 0;
        persist();
        if (queue.length) later(0);
      } else {
        wait = Math.min(wait ? wait * 2 : 2000, 60000);
        later(wait);
        listeners.forEach(fn => fn(queue.length));
      }
    }

    /* last-chance send when the tab is hidden or closed; rows stay queued until confirmed */
    function beacon() {
      if (!CFG.endpoint || !queue.length || !navigator.sendBeacon) return;
      try {
        navigator.sendBeacon(CFG.endpoint,
          new Blob([JSON.stringify({ events: queue.slice(0, 20) })], { type: 'text/plain;charset=utf-8' }));
      } catch (e) {}
    }

    window.addEventListener('online', () => later(0));
    window.addEventListener('pagehide', beacon);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') beacon(); });

    return {
      push,
      flush: () => later(0),
      pending: () => queue.length,
      onChange: fn => listeners.push(fn)
    };
  })();

  function sessionEvent() {
    return {
      type: 'session',
      session_id: S.id, round: S.round,
      age: S.profile.age, gender: S.profile.gender, city: S.profile.city,
      started_at: S.startedAt, updated_at: nowIso(),
      submitted: !!S.submittedAt, submitted_at: S.submittedAt,
      cards_answered: S.order.filter(hasVote).length, cards_total: S.order.length,
      closing_note: (S.closingNote || '').trim(),
      order: S.order.join(','),
      device: TOUCH.matches ? 'touch' : 'mouse',
      screen: `${window.screen.width}x${window.screen.height}`,
      user_agent: navigator.userAgent.slice(0, 300)
    };
  }

  function responseEvent(num) {
    const a = S.answers[num] || {};
    const r = reactionFor(a.reaction);
    const picked = a.reasons || [];
    const labels = picked.map(k => {
      const found = r && r.reasons.find(x => x.key === k);
      return found ? found.label : k;
    });
    return {
      type: 'response',
      session_id: S.id, round: S.round,
      vvp_num: num, vvp_label: IDEAS.get(num).label,
      position: S.order.indexOf(num) + 1,
      reaction: r ? r.label : '', reaction_score: r ? r.score : '',
      reasons: labels.join('; '), reason_keys: picked.join('; '),
      seconds_to_react: a.shownAt && a.reactedAt ? Math.round((a.reactedAt - a.shownAt) / 100) / 10 : '',
      updated_at: nowIso()
    };
  }

  const sendAnswer = num => { if (hasVote(num)) Outbox.push(responseEvent(num)); };
  const sendSession = () => Outbox.push(sessionEvent());

  /* ───────────────────────────────────────────────────────────
     4. Elements
     ─────────────────────────────────────────────────────────── */
  const el = {
    body: document.body,
    bar: $('#setupBar'),
    progress: $('#progress'), progressLabel: $('#progressLabel'), rail: $('#rail'),
    intro: $('#introView'), fields: $('#fields'),
    age: $('#ageInput'), gender: $('#genderInput'), city: $('#cityInput'),
    startBtn: $('#startBtn'), startLabel: $('#startLabel'),
    vote: $('#voteView'), deckArea: $('#deckArea'), deck: $('#deck'),
    panel: $('#panel'), dots: $$('#dots .dot'), back: $('#backBtn'),
    reactions: $('#reactions'), reasons: $('#reasons'), said: $('#said'),
    reasonPrompt: $('#reasonPrompt'), reasonHint: $('#reasonHint'), reasonNext: $('#reasonNext'),
    reviewBar: $('#reviewBar'), revPrev: $('#revPrev'), revNext: $('#revNext'),
    revCount: $('#revCount'), revDone: $('#revDone'),
    finish: $('#finishView'), finishKicker: $('#finishKicker'), viewAgain: $('#viewAgainBtn'),
    closingPrompt: $('#closingPrompt'), closingNote: $('#closingNote'), submit: $('#submitBtn'),
    thanks: $('#thanksView'), sendStatus: $('#sendStatus'),
    reader: $('#reader'), readerInner: $('#readerInner'), readerClose: $('#readerClose')
  };

  /* ───────────────────────────────────────────────────────────
     5. Build the intro fields, the panel, the deck and the rail
     ─────────────────────────────────────────────────────────── */
  el.gender.innerHTML = '<option value="" disabled selected>Choose one</option>' +
    CFG.genders.map(g => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join('');
  el.gender.required = true;
  el.age.min = CFG.ageRange.min;
  el.age.max = CFG.ageRange.max;
  el.reasonPrompt.textContent = CFG.reasonPrompt;
  el.reasonHint.textContent = CFG.reasonHint;
  el.closingPrompt.textContent = CFG.closingPrompt;
  el.closingNote.placeholder = CFG.closingPlaceholder;

  function choiceButton(label, n, kind) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'choice';
    b.setAttribute('role', kind === 'reason' ? 'checkbox' : 'radio');
    b.setAttribute('aria-checked', 'false');
    const mark = kind === 'reason'
      ? '<span class="tick-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 13l5 5L19 7"/></svg></span>'
      : '';
    b.innerHTML = `${mark}<span class="text"></span>${n <= 9 ? `<kbd class="key">${n}</kbd>` : ''}`;
    b.querySelector('.text').textContent = label;
    return b;
  }

  CFG.reactions.forEach((r, i) => {
    const b = choiceButton(r.label, i + 1, 'reaction');
    b.dataset.key = r.key;
    b.style.setProperty('--bead', r.color);
    b.insertAdjacentHTML('afterbegin', '<span class="bead" aria-hidden="true"></span>');
    b.addEventListener('click', () => chooseReaction(r.key));
    el.reactions.appendChild(b);
  });

  const readVerb = TOUCH.matches ? 'Tap' : 'Click';
  const cards = S.order.map((num, i) => {
    const card = document.createElement('article');
    card.className = 'card';
    card.setAttribute('aria-label', `Idea ${i + 1} of ${S.order.length}`);
    card.innerHTML = `
      <div class="card-window${i % 2 ? ' cool' : ''}"></div>
      <div class="card-strip">
        <span class="num">${pad(i + 1)}</span>
        <span class="card-mark" aria-hidden="true"></span>
        <span class="read">${readVerb} to read it all</span>
        <button class="expand-btn" type="button" aria-label="Read full size">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4H4v5M15 20h5v-5M20 9V4h-5M4 15v5h5"/></svg>
        </button>
      </div>`;
    card.querySelector('.expand-btn').addEventListener('click', e => { e.stopPropagation(); openReader(i); });
    el.deck.appendChild(card);
    return card;
  });

  S.order.forEach(() => {
    const t = document.createElement('span');
    t.className = 'tick';
    el.rail.appendChild(t);
  });
  const ticks = $$('.tick', el.rail);

  /* images load only when a card is near the front: 30 full images at once is a lot on a phone */
  function ensureImage(i) {
    const card = cards[i];
    if (!card || card.dataset.img) return;
    card.dataset.img = 'loading';
    const idea = IDEAS.get(S.order[i]);
    const win = card.querySelector('.card-window');
    const img = new Image();
    img.alt = '';
    img.draggable = false;
    img.decoding = 'async';
    img.onload = () => { card.dataset.img = 'ok'; win.appendChild(img); };
    img.onerror = () => { card.dataset.img = 'missing'; win.innerHTML = blankTemplate(i, idea); };
    img.src = idea.src;
  }

  function blankTemplate(i, idea) {
    return `
      <div class="card-blank${i % 2 ? ' cool' : ''}">
        <div class="doorway"></div>
        <div class="slot">Idea ${pad(i + 1)}</div>
        <p class="hint">Image not added yet.<br><code>${escapeHtml(idea.src)}</code></p>
      </div>`;
  }

  /* ───────────────────────────────────────────────────────────
     6. The rolodex arc
     ─────────────────────────────────────────────────────────── */
  const gutter = () => Math.min(64, Math.max(20, window.innerWidth * 0.05));

  function metrics() {
    const W = el.deckArea.clientWidth, H = el.deckArea.clientHeight;
    const voting = S.view === 'vote';
    if (WIDE.matches && voting) {
      const panelRight = gutter() + el.panel.offsetWidth + 56;
      const cw = Math.max(200, Math.min(460, (H * 0.8) / 1.5, W - panelRight - 24));
      return { cw, cx: Math.max(W / 2, panelRight + cw / 2), cy: H / 2 + 10, step: 11 };
    }
    const cw = Math.max(170, Math.min(WIDE.matches ? 460 : 400, (H * (voting ? 0.84 : 0.72)) / 1.5, W * 0.66));
    return { cw, cx: W / 2, cy: H / 2 + (voting ? 6 : -10), step: WIDE.matches ? 11 : 14 };
  }

  function frontIndex() {
    if (S.view === 'vote') return S.active;
    if (S.view === 'review') return S.reviewAt;
    return cards.length;                       // finished: every card has fallen away
  }

  function layout(dragDx = 0) {
    if (el.vote.hidden) return;
    const m = metrics();
    el.deck.style.setProperty('--card-w', m.cw.toFixed(1) + 'px');
    el.deck.style.left = m.cx + 'px';
    el.deck.style.top = m.cy + 'px';

    const R = m.cw * 3.6;
    const front = frontIndex();

    cards.forEach((card, i) => {
      const d = i - front;
      const dp = Math.max(-2, Math.min(d, 6));        // keep far cards from wrapping round the circle
      const a = (dp * m.step * Math.PI) / 180;

      let x = R * Math.sin(a);
      let y = R * (1 - Math.cos(a));
      let rot = dp * m.step;
      let rotY = -6 * Math.max(-1, Math.min(dp, 4));
      const scale = Math.max(0.68, 1 - Math.abs(dp) * 0.055);
      let op = 1;

      if (d < 0) {                                     // spent: flip and fall away bottom-left
        x -= m.cw * 0.42;
        y += m.cw * (0.95 + Math.abs(dp) * 0.2);
        rot -= 16;
        rotY = -42;
        op = 0;
      } else if (d > 3) {
        op = d === 4 ? 0.28 : 0;
      }

      if (d === 0 && dragDx) {
        x += dragDx;
        rot += dragDx * 0.045;
        op = Math.max(0.35, 1 - Math.abs(dragDx) / 620);
      }

      card.style.transform =
        `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) rotateY(${rotY}deg) rotate(${rot.toFixed(2)}deg) scale(${scale.toFixed(3)})`;
      card.style.opacity = op;
      card.style.zIndex = d < 0 ? 300 : 200 - Math.min(d, 199);
      card.style.visibility = d < -2 || d > 6 ? 'hidden' : '';
      card.classList.toggle('is-active', d === 0);

      const ans = S.answers[S.order[i]];
      card.classList.toggle('is-voted', !!(ans && ans.reaction));
      const mark = card.querySelector('.card-mark');
      const r = ans && reactionFor(ans.reaction);
      mark.style.background = r ? r.color : 'transparent';

      if (d >= -1 && d <= 3) ensureImage(i);
    });
  }

  /* ───────────────────────────────────────────────────────────
     7. The two questions
     ─────────────────────────────────────────────────────────── */
  let stepTimer = 0;

  function renderReasons() {
    const a = S.answers[current()] || {};
    const r = reactionFor(a.reaction);
    el.reasons.innerHTML = '';
    if (!r) return;
    r.reasons.forEach((x, i) => {
      const b = choiceButton(x.label, i + 1, 'reason');
      b.dataset.key = x.key;
      b.addEventListener('click', () => toggleReason(x.key));
      el.reasons.appendChild(b);
    });
  }

  function renderPanel() {
    const a = S.answers[current()] || {};
    const picked = a.reasons || [];

    $$('.step', el.panel).forEach(s => s.classList.toggle('on', Number(s.dataset.step) === S.step));
    $$('.choice', el.reactions).forEach(b => setOn(b, b.dataset.key === a.reaction));
    $$('.choice', el.reasons).forEach(b => setOn(b, picked.includes(b.dataset.key)));

    const r = reactionFor(a.reaction);
    el.said.textContent = '';
    if (r) {
      el.said.append('You said ');
      const b = document.createElement('b');
      b.textContent = r.label;
      el.said.append(b);
    }
    el.reasonNext.textContent = picked.length ? 'Next →' : 'Skip →';

    const reachable = [true, !!a.reaction];
    const done = [!!a.reaction, !!a.passed];
    el.dots.forEach((dot, i) => {
      dot.disabled = !reachable[i];
      dot.classList.toggle('now', S.step === i + 1);
      dot.classList.toggle('done', done[i] && S.step !== i + 1);
    });
    el.back.hidden = S.step !== 2;

    el.progressLabel.textContent = `${pad(S.active + 1)} / ${pad(S.order.length)}`;
    ticks.forEach((t, i) => {
      t.classList.toggle('now', i === S.active);
      t.classList.toggle('done', hasVote(S.order[i]));
    });
  }

  function setOn(b, on) {
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
  }

  function chooseReaction(key) {
    if (S.view !== 'vote') return;
    const num = current(), a = answer(num);
    if (!a.reactedAt) a.reactedAt = Date.now();
    if (a.reaction !== key) a.reasons = [];     // the follow-up wording changes with the answer
    a.reaction = key;
    save(); sendAnswer(num); layout();
    renderReasons(); renderPanel();
    clearTimeout(stepTimer);
    stepTimer = setTimeout(() => goStep(2), STEP_DELAY);
  }

  function toggleReason(key) {
    if (S.view !== 'vote') return;
    const num = current(), a = answer(num);
    if (!a.reaction) return;
    a.reasons = a.reasons || [];
    const i = a.reasons.indexOf(key);
    if (i > -1) a.reasons.splice(i, 1); else a.reasons.push(key);
    save(); sendAnswer(num); renderPanel();
  }

  function goStep(n) {
    clearTimeout(stepTimer);
    S.step = n;
    if (n === 2) renderReasons();
    save(); renderPanel(); keepPanelInView();
  }

  /* leave this idea for good */
  function continueCard() {
    if (S.view !== 'vote' || S.step !== 2) return;
    const num = current();
    answer(num).passed = true;
    save(); sendAnswer(num); sendSession();
    nextCard();
  }

  el.reasonNext.addEventListener('click', continueCard);
  el.back.addEventListener('click', back);
  el.dots.forEach((dot, i) => dot.addEventListener('click', () => {
    if (i === 0 || S.answers[current()] && S.answers[current()].reaction) goStep(i + 1);
  }));

  /* ───────────────────────────────────────────────────────────
     8. Moving through the deck. Forward only: once an idea is
     done it can't be reopened, and the deck says so up front.
     ─────────────────────────────────────────────────────────── */
  function markShown() {
    const a = answer(current());
    if (!a.shownAt) a.shownAt = Date.now();
  }

  function nextCard() {
    clearTimeout(stepTimer);
    if (S.active < S.order.length - 1) {
      S.active += 1;
      S.step = 1;
      markShown(); save(); layout();
      renderReasons(); renderPanel();
      keepDeckInView();
    } else {
      showView('finish');
    }
  }

  function tryNext() {
    const a = S.answers[current()] || {};
    if (!a.reaction) { nudge(); layout(); return; }
    if (S.step === 1) { goStep(2); layout(); return; }
    continueCard();
  }

  function back() {
    if (S.view !== 'vote') return;
    clearTimeout(stepTimer);
    if (S.step === 2) goStep(1);
  }

  function nudge() {
    el.panel.classList.remove('nudge');
    void el.panel.offsetWidth;
    el.panel.classList.add('nudge');
    keepPanelInView();
  }

  /* stacked layout (phones, tablets): keep the right thing on screen */
  function keepPanelInView() {
    if (WIDE.matches || S.view !== 'vote') return;
    const r = el.panel.getBoundingClientRect();
    if (r.bottom > window.innerHeight || r.top < 0) el.panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  function keepDeckInView() {
    if (WIDE.matches) return;
    const r = el.deckArea.getBoundingClientRect();
    if (r.top < 0) window.scrollTo({ top: window.scrollY + r.top - 8, behavior: 'smooth' });
  }

  /* drag the front card; a plain tap opens the full-size reader */
  let drag = null;
  el.deckArea.addEventListener('pointerdown', e => {
    if (!(S.view === 'vote' || S.view === 'review') || e.button > 0) return;
    const card = e.target.closest('.card.is-active');
    if (!card || e.target.closest('.expand-btn')) return;
    drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, dx: 0, moved: false, card };
  });
  el.deckArea.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
    if (!drag.moved) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { drag = null; return; }   // a scroll, not a flip
      if (Math.abs(dx) < 8) return;
      drag.moved = true;
      drag.card.classList.add('is-dragging');
      try { drag.card.setPointerCapture(e.pointerId); } catch (err) {}
    }
    drag.dx = dx;
    layout(dx);
  });
  function endDrag(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const { moved, dx, card } = drag;
    drag = null;
    card.classList.remove('is-dragging');
    if (!moved) { if (e.type === 'pointerup') openReader(frontIndex()); return; }
    if (S.view === 'review') {
      if (dx < -90) reviewStep(1);
      else if (dx > 90) reviewStep(-1);
      else layout();
      return;
    }
    if (dx < -90) tryNext();
    else layout();                                   // no going back to an idea
  }
  el.deckArea.addEventListener('pointerup', endDrag);
  el.deckArea.addEventListener('pointercancel', endDrag);

  /* ───────────────────────────────────────────────────────────
     9. Views: intro → vote → finish (→ review) → thanks
     ─────────────────────────────────────────────────────────── */
  function showView(view) {
    const wasHidden = el.vote.hidden;
    S.view = view;
    save();

    el.body.dataset.view = view;
    el.intro.hidden     = view !== 'intro';
    el.vote.hidden      = view === 'intro';
    el.panel.hidden     = view !== 'vote';
    el.reviewBar.hidden = view !== 'review';
    el.finish.hidden    = view !== 'finish';
    el.thanks.hidden    = view !== 'thanks';
    el.progress.hidden  = !(view === 'vote' || view === 'review');

    if (view !== 'intro') {
      if (wasHidden) {                         // place cards without animating in from nowhere
        el.deck.classList.add('no-anim');
        layout();
        void el.deck.offsetWidth;
        el.deck.classList.remove('no-anim');
      } else {
        layout();
      }
    }

    if (view === 'vote') {
      markShown(); save();
      renderReasons(); renderPanel();
    }
    if (view === 'review') renderReview();
    if (view === 'finish') {
      el.finishKicker.textContent = `All ${S.order.length} ideas`;
      el.closingNote.value = S.closingNote || '';
      sendSession();
    }
    if (view === 'thanks') renderSendStatus();
    if (wasHidden || view === 'finish' || view === 'thanks') window.scrollTo(0, 0);
  }

  /* ── intro: age, gender and city before the button lights up ── */
  function readProfile() {
    return { age: el.age.value.trim(), gender: el.gender.value, city: el.city.value.trim() };
  }
  function profileOk(p) {
    const n = Number(p.age);
    return Number.isFinite(n) && n >= CFG.ageRange.min && n <= CFG.ageRange.max && !!p.gender && !!p.city;
  }
  function syncStart() {
    const ok = profileOk(readProfile());
    el.startBtn.classList.toggle('is-waiting', !ok);
    el.startBtn.setAttribute('aria-disabled', String(!ok));
    return ok;
  }
  [el.age, el.gender, el.city].forEach(input => {
    input.addEventListener('input', syncStart);
    input.addEventListener('change', syncStart);
  });

  function start() {
    if (S.view !== 'intro') return;
    const p = readProfile();
    if (!profileOk(p)) {
      el.fields.classList.remove('nudge');
      void el.fields.offsetWidth;
      el.fields.classList.add('nudge');
      const n = Number(p.age);
      const first = !(Number.isFinite(n) && n >= CFG.ageRange.min && n <= CFG.ageRange.max) ? el.age
                  : !p.gender ? el.gender : el.city;
      first.focus();
      return;
    }
    S.profile = p;
    if (!S.startedAt) S.startedAt = nowIso();
    save(); sendSession();
    showView('vote');
  }
  el.startBtn.addEventListener('click', start);

  /* ── looking back through the deck, without voting ── */
  function renderReview() {
    el.revCount.textContent = `${pad(S.reviewAt + 1)} / ${pad(S.order.length)}`;
    el.revPrev.disabled = S.reviewAt === 0;
    el.revNext.disabled = S.reviewAt === S.order.length - 1;
    el.progressLabel.textContent = el.revCount.textContent;
    ticks.forEach((t, i) => {
      t.classList.toggle('now', i === S.reviewAt);
      t.classList.toggle('done', hasVote(S.order[i]));
    });
  }
  function reviewStep(delta) {
    S.reviewAt = Math.min(Math.max(0, S.reviewAt + delta), S.order.length - 1);
    save(); layout(); renderReview();
  }
  el.viewAgain.addEventListener('click', () => { S.reviewAt = 0; showView('review'); });
  el.revPrev.addEventListener('click', () => reviewStep(-1));
  el.revNext.addEventListener('click', () => reviewStep(1));
  el.revDone.addEventListener('click', () => showView('finish'));

  /* ── the one written question, then submit ── */
  let closingTimer = 0;
  function captureClosing() {
    if (S.closingNote === el.closingNote.value) return;
    S.closingNote = el.closingNote.value;
    save(); sendSession();
  }
  el.closingNote.addEventListener('input', () => {
    clearTimeout(closingTimer);
    closingTimer = setTimeout(captureClosing, 1200);
  });
  el.closingNote.addEventListener('blur', captureClosing);

  el.submit.addEventListener('click', () => {
    clearTimeout(closingTimer);
    S.closingNote = el.closingNote.value;
    S.submittedAt = nowIso();
    save(); sendSession(); Outbox.flush();
    showView('thanks');
  });

  function renderSendStatus() {
    if (el.thanks.hidden) return;
    const n = Outbox.pending();
    el.sendStatus.textContent =
      !CFG.endpoint ? 'Saved in this browser. This copy isn’t connected to a sheet yet.'
      : n ? 'Sending your answers. Keep this tab open for a moment…'
      : 'Your answers are in.';
  }
  Outbox.onChange(renderSendStatus);

  /* ───────────────────────────────────────────────────────────
     10. Full-size reader
     ─────────────────────────────────────────────────────────── */
  let readerReturn = null;

  function openReader(i) {
    const idea = IDEAS.get(S.order[i]);
    if (!idea) return;
    el.readerInner.innerHTML = '';
    if (cards[i].dataset.img === 'missing') {
      el.readerInner.innerHTML = blankTemplate(i, idea);
    } else {
      const img = new Image();
      img.alt = `Idea ${i + 1}, full size`;
      img.onerror = () => { el.readerInner.innerHTML = blankTemplate(i, idea); };
      img.src = idea.src;
      el.readerInner.appendChild(img);
    }
    readerReturn = document.activeElement;
    el.reader.hidden = false;
    el.reader.scrollTop = 0;
    el.body.classList.add('reading');
    el.readerClose.focus({ preventScroll: true });
  }

  function closeReader() {
    if (el.reader.hidden) return;
    el.reader.hidden = true;
    el.body.classList.remove('reading');
    if (readerReturn && readerReturn.focus && !TOUCH.matches) readerReturn.focus({ preventScroll: true });
  }

  el.readerClose.addEventListener('click', closeReader);
  el.reader.addEventListener('click', e => {
    if (!e.target.closest('img, .card-blank, .close-btn')) closeReader();
  });

  /* ───────────────────────────────────────────────────────────
     11. Keyboard
     ─────────────────────────────────────────────────────────── */
  document.addEventListener('keydown', e => {
    if (!el.reader.hidden) {
      if (e.key === 'Escape') { e.preventDefault(); closeReader(); }
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);

    if (S.view === 'intro') {
      if (e.key === 'Enter' && !e.repeat) { e.preventDefault(); start(); }
      return;
    }
    if (S.view === 'review') {
      if (e.key === 'ArrowLeft')  { e.preventDefault(); reviewStep(-1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); reviewStep(1); }
      return;
    }
    if (S.view !== 'vote' || typing) return;

    if (e.key === 'ArrowLeft') { e.preventDefault(); back(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); tryNext(); }
    else if (/^[1-9]$/.test(e.key)) {
      const n = Number(e.key) - 1;
      if (S.step === 1 && CFG.reactions[n]) chooseReaction(CFG.reactions[n].key);
      else if (S.step === 2) {
        const r = reactionFor((S.answers[current()] || {}).reaction);
        if (r && r.reasons[n]) toggleReason(r.reasons[n].key);
      }
    }
    else if (e.key === 'Enter' && S.step === 2 && e.target.tagName !== 'BUTTON') { e.preventDefault(); continueCard(); }
  });

  /* ───────────────────────────────────────────────────────────
     12. Boot
     ─────────────────────────────────────────────────────────── */
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  if (!CFG.endpoint) {
    el.bar.hidden = false;
    el.body.classList.add('has-bar');
  }
  el.age.value = S.profile.age || '';
  el.city.value = S.profile.city || '';
  if (S.profile.gender) el.gender.value = S.profile.gender;
  syncStart();
  if (S.startedAt && S.view === 'intro') el.startLabel.textContent = 'Pick up where you left off';

  showView(S.view);
  Outbox.flush();

  window.addEventListener('resize', debounce(() => layout(), 120));
})();
