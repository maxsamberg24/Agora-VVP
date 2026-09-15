/* ═══════════════════════════════════════════════════════════
   AGORA — VVP Review · app
   How it works → for each idea: gut reaction → why → note →
   next idea, automatically → submit, or flip through again.
   Every answer streams to the sheet the moment it's given.
   ═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const CFG = window.AGORA;
  const STORE_KEY  = 'agora.vvp.session.v2';
  const OUTBOX_KEY = 'agora.vvp.outbox.v2';
  const WIDE  = window.matchMedia('(min-width: 1100px)');
  const TOUCH = window.matchMedia('(hover: none)');
  const STEP_DELAY = 280;   // ms to let a tap register before moving on
  const SEND_DELAY = 1500;  // ms to gather one card's answers into a single request

  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const pad = n => String(n).padStart(2, '0');
  const nowIso = () => new Date().toISOString();

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
      id: uid(), round: CFG.round, name: '',
      startedAt: '', submittedAt: '',
      order: shuffle([...IDEAS.keys()]),   // this participant's random order
      active: 0, step: 1, view: 'intro',
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
    s.order  = order.concat(added);
    s.active = Math.min(Math.max(0, s.active | 0), Math.max(0, s.order.length - 1));
    s.step   = [1, 2, 3].includes(s.step) ? s.step : 1;
    s.answers = s.answers || {};
    if (!['intro', 'vote', 'finish', 'thanks'].includes(s.view)) s.view = 'intro';
    return s;
  }

  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch (e) { /* private mode */ }
  }

  const current = () => S.order[S.active];
  const answer = num => S.answers[num] || (S.answers[num] = {});
  const isComplete = num => !!(S.answers[num] && S.answers[num].reaction && S.answers[num].reason);

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
      session_id: S.id, round: S.round, name: S.name,
      started_at: S.startedAt, updated_at: nowIso(),
      submitted: !!S.submittedAt, submitted_at: S.submittedAt,
      cards_answered: S.order.filter(isComplete).length, cards_total: S.order.length,
      order: S.order.join(','),
      device: TOUCH.matches ? 'touch' : 'mouse',
      screen: `${window.screen.width}x${window.screen.height}`,
      user_agent: navigator.userAgent.slice(0, 300)
    };
  }

  function responseEvent(num) {
    const a = S.answers[num] || {};
    const r = CFG.reactions.find(x => x.key === a.reaction);
    const why = CFG.reasons.find(x => x.key === a.reason);
    return {
      type: 'response',
      session_id: S.id, round: S.round, name: S.name,
      vvp_num: num, vvp_label: IDEAS.get(num).label,
      position: S.order.indexOf(num) + 1,
      reaction: r ? r.label : '', reaction_score: r ? r.score : '',
      reason: why ? why.label : '',
      note: (a.note || '').trim(),
      seconds_to_react: a.shownAt && a.reactedAt ? Math.round((a.reactedAt - a.shownAt) / 100) / 10 : '',
      updated_at: nowIso()
    };
  }

  const sendAnswer = num => { if (S.answers[num] && S.answers[num].reaction) Outbox.push(responseEvent(num)); };
  const sendSession = () => Outbox.push(sessionEvent());

  /* ───────────────────────────────────────────────────────────
     4. Elements
     ─────────────────────────────────────────────────────────── */
  const el = {
    body: document.body,
    bar: $('#setupBar'),
    progress: $('#progress'), progressLabel: $('#progressLabel'), rail: $('#rail'),
    intro: $('#introView'), nameInput: $('#nameInput'), startBtn: $('#startBtn'), startLabel: $('#startLabel'),
    vote: $('#voteView'), deckArea: $('#deckArea'), deck: $('#deck'),
    panel: $('#panel'), dots: $$('#dots .dot'), back: $('#backBtn'),
    reactions: $('#reactions'), reasons: $('#reasons'), said: $('#said'),
    reasonPrompt: $('#reasonPrompt'), notePrompt: $('#notePrompt'),
    note: $('#noteInput'), skip: $('#skipBtn'),
    finish: $('#finishView'), finishKicker: $('#finishKicker'),
    submit: $('#submitBtn'), again: $('#againBtn'),
    thanks: $('#thanksView'), sendStatus: $('#sendStatus'),
    reader: $('#reader'), readerInner: $('#readerInner'), readerClose: $('#readerClose')
  };

  /* ───────────────────────────────────────────────────────────
     5. Build the panel, deck and progress rail
     ─────────────────────────────────────────────────────────── */
  function choiceButton(label, n) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'choice';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', 'false');
    b.innerHTML = `<span class="text"></span>${n <= 9 ? `<kbd class="key">${n}</kbd>` : ''}`;
    b.querySelector('.text').textContent = label;
    return b;
  }

  CFG.reactions.forEach((r, i) => {
    const b = choiceButton(r.label, i + 1);
    b.dataset.key = r.key;
    b.style.setProperty('--bead', r.color);
    b.insertAdjacentHTML('afterbegin', '<span class="bead" aria-hidden="true"></span>');
    b.addEventListener('click', () => chooseReaction(r.key));
    el.reactions.appendChild(b);
  });

  CFG.reasons.forEach((r, i) => {
    const b = choiceButton(r.label, i + 1);
    b.dataset.key = r.key;
    b.addEventListener('click', () => chooseReason(r.key));
    el.reasons.appendChild(b);
  });

  el.reasonPrompt.textContent = CFG.reasonPrompt;
  el.notePrompt.textContent = CFG.notePrompt;
  el.note.placeholder = CFG.notePlaceholder;

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
     Cards ride a circle whose pivot sits below the stage.
     Offset 0 is front and centre; positive offsets wait, fanned
     to the bottom-right; spent cards flip and fall bottom-left.
     ─────────────────────────────────────────────────────────── */
  const gutter = () => Math.min(64, Math.max(20, window.innerWidth * 0.05));

  function metrics() {
    const W = el.deckArea.clientWidth, H = el.deckArea.clientHeight;
    if (WIDE.matches) {
      const panelRight = gutter() + el.panel.offsetWidth + 56;
      const cw = Math.max(200, Math.min(460, (H * 0.8) / 1.5, W - panelRight - 24));
      return { cw, cx: Math.max(W / 2, panelRight + cw / 2), cy: H / 2 + 10, step: 11 };
    }
    const cw = Math.max(170, Math.min(400, (H * 0.84) / 1.5, W * 0.66));
    return { cw, cx: W / 2, cy: H / 2 + 6, step: 14 };
  }

  function layout(dragDx = 0) {
    if (el.vote.hidden) return;
    const m = metrics();
    el.deck.style.setProperty('--card-w', m.cw.toFixed(1) + 'px');
    el.deck.style.left = m.cx + 'px';
    el.deck.style.top = m.cy + 'px';

    const R = m.cw * 3.6;
    const front = S.view === 'vote' ? S.active : cards.length;   // finished: every card has fallen

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
      card.querySelector('.card-mark').style.background = reactionColor(ans);

      if (d >= -1 && d <= 3) ensureImage(i);
    });
  }

  function reactionColor(ans) {
    const r = ans && CFG.reactions.find(x => x.key === ans.reaction);
    return r ? r.color : 'transparent';
  }

  /* ───────────────────────────────────────────────────────────
     7. The three questions
     ─────────────────────────────────────────────────────────── */
  let stepTimer = 0, noteTimer = 0;

  function renderPanel() {
    const a = S.answers[current()] || {};

    $$('.step', el.panel).forEach(s => s.classList.toggle('on', Number(s.dataset.step) === S.step));
    $$('.choice', el.reactions).forEach(b => setOn(b, b.dataset.key === a.reaction));
    $$('.choice', el.reasons).forEach(b => setOn(b, b.dataset.key === a.reason));

    const r = CFG.reactions.find(x => x.key === a.reaction);
    el.said.textContent = '';
    if (r) {
      el.said.append('You said ');
      const b = document.createElement('b');
      b.textContent = r.label;
      el.said.append(b);
    }

    if (document.activeElement !== el.note) el.note.value = a.note || '';
    el.skip.textContent = el.note.value.trim() ? 'Next →' : 'Skip →';

    const reachable = [true, !!a.reaction, !!(a.reaction && a.reason)];
    const done = [!!a.reaction, !!a.reason, !!a.passed];
    el.dots.forEach((dot, i) => {
      dot.disabled = !reachable[i];
      dot.classList.toggle('now', S.step === i + 1);
      dot.classList.toggle('done', done[i] && S.step !== i + 1);
    });
    el.back.hidden = S.active === 0 && S.step === 1;

    el.progressLabel.textContent = `${pad(S.active + 1)} / ${pad(S.order.length)}`;
    ticks.forEach((t, i) => {
      t.classList.toggle('now', i === S.active);
      t.classList.toggle('done', isComplete(S.order[i]));
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
    a.reaction = key;
    save(); sendAnswer(num); renderPanel(); layout();
    queueStep(2);
  }

  function chooseReason(key) {
    if (S.view !== 'vote') return;
    const num = current(), a = answer(num);
    if (!a.reaction) return;
    a.reason = key;
    save(); sendAnswer(num); renderPanel();
    queueStep(3);
  }

  function queueStep(n) {
    clearTimeout(stepTimer);
    stepTimer = setTimeout(() => goStep(n), STEP_DELAY);
  }

  function goStep(n) {
    clearTimeout(stepTimer);
    captureNote();
    S.step = n;
    save(); renderPanel();
    if (n === 3 && !TOUCH.matches) el.note.focus({ preventScroll: true });
    else if (document.activeElement === el.note) el.note.blur();
    keepPanelInView();
  }

  function captureNote() {
    if (S.step !== 3 || S.view !== 'vote') return;
    const num = current(), a = answer(num);
    if ((a.note || '') !== el.note.value) {
      a.note = el.note.value;
      save(); sendAnswer(num);
    }
  }

  function finishNote() {
    if (S.view !== 'vote' || S.step !== 3) return;
    clearTimeout(noteTimer);
    const num = current(), a = answer(num);
    a.note = el.note.value;
    a.passed = true;
    save(); sendAnswer(num); sendSession();
    el.note.blur();
    nextCard();
  }

  el.note.addEventListener('input', () => {
    el.skip.textContent = el.note.value.trim() ? 'Next →' : 'Skip →';
    clearTimeout(noteTimer);
    noteTimer = setTimeout(captureNote, 1200);
  });
  el.note.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      finishNote();
    }
  });

  el.skip.addEventListener('click', finishNote);
  el.back.addEventListener('click', back);
  el.dots.forEach((dot, i) => dot.addEventListener('click', () => goStep(i + 1)));

  /* ───────────────────────────────────────────────────────────
     8. Moving through the deck
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
      markShown(); save(); layout(); renderPanel();
      keepDeckInView();
    } else {
      showView('finish');
    }
  }

  /* swipe left / → key: only once the first two questions are answered */
  function tryNext() {
    if (!isComplete(current())) { nudge(); layout(); return; }
    captureNote();
    const num = current();
    answer(num).passed = true;
    save(); sendAnswer(num); sendSession();
    nextCard();
  }

  function back() {
    clearTimeout(stepTimer);
    if (S.step > 1) { goStep(S.step - 1); return; }
    prevCard();
  }

  function prevCard() {
    clearTimeout(stepTimer);
    captureNote();
    if (S.active === 0) { layout(); return; }
    S.active -= 1;
    const a = S.answers[current()] || {};
    S.step = a.reason ? 3 : a.reaction ? 2 : 1;
    markShown(); save(); layout(); renderPanel();
    keepDeckInView();
  }

  function nudge() {
    el.panel.classList.remove('nudge');
    void el.panel.offsetWidth;
    el.panel.classList.add('nudge');
    keepPanelInView();
  }

  /* stacked layout (phones, tablets): keep the right thing on screen */
  function keepPanelInView() {
    if (WIDE.matches) return;
    const r = el.panel.getBoundingClientRect();
    if (r.bottom > window.innerHeight || r.top < 0) el.panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  function keepDeckInView() {
    if (WIDE.matches) return;
    const r = el.deckArea.getBoundingClientRect();
    if (r.top < 0) window.scrollTo({ top: window.scrollY + r.top - 8, behavior: 'smooth' });
  }

  /* drag the front card to flip; a plain tap opens the full-size reader */
  let drag = null;
  el.deckArea.addEventListener('pointerdown', e => {
    if (S.view !== 'vote' || e.button > 0) return;
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
    if (!moved) { if (e.type === 'pointerup') openReader(S.active); return; }
    if (dx < -90) tryNext();
    else if (dx > 90) prevCard();
    else layout();
  }
  el.deckArea.addEventListener('pointerup', endDrag);
  el.deckArea.addEventListener('pointercancel', endDrag);

  /* ───────────────────────────────────────────────────────────
     9. Views: intro → vote → finish → thanks
     ─────────────────────────────────────────────────────────── */
  function showView(view) {
    const wasHidden = el.vote.hidden;
    S.view = view;
    save();

    el.body.dataset.view = view;
    el.intro.hidden = view !== 'intro';
    el.vote.hidden = view === 'intro';
    el.panel.hidden = view !== 'vote';
    el.finish.hidden = view !== 'finish';
    el.thanks.hidden = view !== 'thanks';
    el.progress.hidden = view !== 'vote';

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
      markShown(); save(); renderPanel();
    }
    if (view === 'finish') {
      el.finishKicker.textContent = `All ${S.order.length} ideas`;
      sendSession();
      if (!TOUCH.matches) el.submit.focus({ preventScroll: true });
    }
    if (view === 'thanks') renderSendStatus();
    if (wasHidden || view === 'finish' || view === 'thanks') window.scrollTo(0, 0);
  }

  function start() {
    if (S.view !== 'intro') return;
    S.name = el.nameInput.value.trim().slice(0, 80);
    if (!S.startedAt) S.startedAt = nowIso();
    save(); sendSession();
    showView('vote');
  }

  el.startBtn.addEventListener('click', start);

  el.submit.addEventListener('click', () => {
    S.submittedAt = nowIso();
    save(); sendSession();
    Outbox.flush();
    showView('thanks');
  });

  el.again.addEventListener('click', () => {
    S.active = 0;
    S.step = 1;
    save();
    showView('vote');
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

    if (S.view === 'intro') {
      if (e.key === 'Enter' && !e.repeat) { e.preventDefault(); start(); }
      return;
    }
    if (S.view !== 'vote') return;
    if (/^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;

    if (e.key === 'ArrowLeft') { e.preventDefault(); back(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); tryNext(); }
    else if (/^[1-9]$/.test(e.key)) {
      const n = Number(e.key) - 1;
      if (S.step === 1 && CFG.reactions[n]) chooseReaction(CFG.reactions[n].key);
      else if (S.step === 2 && CFG.reasons[n]) chooseReason(CFG.reasons[n].key);
    }
    else if (e.key === 'Enter' && S.step === 3 && e.target.tagName !== 'BUTTON') { e.preventDefault(); finishNote(); }
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
  el.nameInput.value = S.name;
  if (S.startedAt && S.view === 'intro') el.startLabel.textContent = 'Pick up where you left off';

  showView(S.view);
  Outbox.flush();

  window.addEventListener('resize', debounce(() => layout(), 120));
})();
