/* Feral Futures companion page.
 *
 * How it fits together:
 *   CONFIG       storage key, links you'll want to edit
 *   content      loaded from cards.json (or the cards.js fallback on file://)
 *   state        everything the participant writes or picks, saved to localStorage
 *   components   card, card back, flip card, progress marker, action bar
 *   SCREENS      one entry per screen: which part it belongs to, its forward button, and a render function
 *   actions      what each data-action="..." button does
 *
 * Rendering is deliberately simple: every change re-renders the current screen from state.
 * Typing in a textarea saves to state but doesn't re-render, so the cursor never jumps.
 */
(() => {
  'use strict';

  /* ------------------------------------------------------------------ CONFIG */

  const CONFIG = {
    storageKey: 'feral-futures',
    stateVersion: 3,
    links: {
      newsletter: 'https://futureinthemaking.substack.com',
      deck: '#', // TODO: link to the card deck once it exists
    },
  };

  const PARTS = [
    { n: 1, label: "What's keeping it tame", start: 'creature' },
    { n: 2, label: 'Imagine it wilder', start: 'play' },
    { n: 3, label: 'Try one small thing', start: 'try' },
  ];

  const DECK_LABELS = { creature: 'Creature', world: 'World', twist: 'Twist' };

  /* ----------------------------------------------------------------- content */

  let cards = null; // filled in init()
  const byId = {};

  async function loadCards() {
    try {
      const res = await fetch('cards.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error(res.status);
      return await res.json();
    } catch (err) {
      if (window.CARDS) return window.CARDS; // opened from disk: use the generated fallback
      throw err;
    }
  }

  function indexCards() {
    for (const key of ['areas', 'creatures', 'worlds', 'twists', 'ways']) {
      byId[key] = Object.fromEntries(cards[key].map((item) => [item.id, item]));
    }
  }

  const shownRules = () => cards.rules.filter((rule) => rule.show);

  /* ------------------------------------------------------------------- state */

  const freshState = () => ({
    version: CONFIG.stateVersion,
    screen: 'welcome',
    startedAt: new Date().toISOString(),
    creatureId: null,
    creatureNote: '',
    areaId: null,
    obvious: '',
    boring: '',
    rule: '',
    table: { worldId: null, twistIds: [] }, // the cards currently in play
    seenWorlds: [], // world ids drawn since the deck was last reshuffled
    draft: '', // the idea being typed, before it goes on the pile
    ideas: [], // { id, text, worldId, twistIds, starred, createdAt }
    picked: [], // idea ids people take with them into "Try one small thing" (max 2)
    moves: {}, // idea id -> the small move for that idea
    move: '', // a general small move, used when no idea is picked
  });

  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  // Old screen names, so saved progress and old links still land somewhere sensible.
  const SCREEN_ALIASES = { world: 'play', twist: 'play', wild: 'try' };

  // When the state shape changes, bump CONFIG.stateVersion and add a step here so nobody loses their answers.
  const MIGRATIONS = {
    // v1 had linear rounds (world → idea → twist → twisted idea → wild sentence). v2 has a pile of ideas.
    1: (s) => {
      const rounds = Array.isArray(s.rounds) ? s.rounds : [];
      const ideas = [];
      const add = (text, worldId, twistIds, starred = false) => {
        if (String(text || '').trim()) ideas.push({ id: newId(), text: String(text).trim(), worldId: worldId || null, twistIds: twistIds || [], starred, createdAt: new Date().toISOString() });
      };
      const wilds = rounds.map((r) => String(r.wild || '').trim()).filter(Boolean);
      rounds.forEach((r) => {
        add(r.idea, r.worldId, []);
        add(r.twisted, r.worldId, r.twistIds);
      });
      wilds.slice(0, -1).forEach((w) => add(w, null, [], true)); // earlier wild futures become starred ideas
      const last = rounds[rounds.length - 1] || {};
      const { rounds: _drop, wayId: _gone, ...rest } = s;
      return { ...rest, table: { worldId: last.worldId || null, twistIds: last.twistIds || [] }, ideas, picked: [], draft: '', wild: wilds[wilds.length - 1] || '' };
    },
    // v2 had a one-sentence "wild future". v3 drops it: the pile is the output, and picked ideas get small moves.
    2: (s) => {
      const { wild, ...rest } = s;
      const ideas = Array.isArray(s.ideas) ? [...s.ideas] : [];
      if (String(wild || '').trim()) ideas.push({ id: newId(), text: String(wild).trim(), worldId: null, twistIds: [], starred: true, createdAt: new Date().toISOString() });
      return { ...rest, ideas, moves: {} };
    },
  };

  let storageOk = true;
  let state = freshState();

  function loadState() {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(CONFIG.storageKey));
    } catch (err) {
      storageOk = false;
    }
    if (!saved || typeof saved !== 'object') return freshState();

    while (saved.version < CONFIG.stateVersion && MIGRATIONS[saved.version]) {
      saved = { ...MIGRATIONS[saved.version](saved), version: saved.version + 1 };
    }
    if (saved.version !== CONFIG.stateVersion) return freshState();

    // Merge onto defaults and drop anything that no longer exists in cards.json.
    const s = { ...freshState(), ...saved };
    if (!byId.creatures[s.creatureId]) s.creatureId = null;
    if (!byId.areas[s.areaId]) s.areaId = null;
    const cleanTwists = (ids) => (Array.isArray(ids) ? ids : []).filter((id) => byId.twists[id]).slice(0, 2);
    const cleanWorld = (id) => (byId.worlds[id] ? id : null);
    s.seenWorlds = (Array.isArray(s.seenWorlds) ? s.seenWorlds : []).filter((id) => byId.worlds[id]);
    s.table = { worldId: cleanWorld(s.table?.worldId), twistIds: cleanTwists(s.table?.twistIds) };
    s.ideas = (Array.isArray(s.ideas) ? s.ideas : [])
      .filter((i) => i && typeof i.text === 'string' && i.text.trim())
      .map((i) => ({ id: String(i.id || newId()), text: i.text, worldId: cleanWorld(i.worldId), twistIds: cleanTwists(i.twistIds), starred: Boolean(i.starred), createdAt: i.createdAt || s.startedAt }));
    s.picked = (Array.isArray(s.picked) ? s.picked : []).filter((id) => s.ideas.some((i) => i.id === id)).slice(0, 2);
    s.moves = Object.fromEntries(Object.entries(s.moves && typeof s.moves === 'object' ? s.moves : {}).filter(([, v]) => typeof v === 'string'));
    s.screen = SCREEN_ALIASES[s.screen] || s.screen;
    if (!SCREENS[s.screen]) s.screen = 'welcome';
    return s;
  }

  function saveState() {
    try {
      localStorage.setItem(CONFIG.storageKey, JSON.stringify(state));
      storageOk = true;
    } catch (err) {
      storageOk = false;
    }
  }

  // Screen-only UI state that shouldn't survive a refresh.
  const ui = {
    confirmReset: false,
    justDrew: null, // 'world' | 'twist': flip that card in on the next render
    justAdded: null, // id of the idea that just landed on the pile
    lastRemoved: null, // { idea, index } so a removal can be undone
    twistChooserOpen: false,
    restOpen: false, // "The rest of your pile" on the try screen
  };

  /* ----------------------------------------------------------------- helpers */

  const esc = (value) =>
    String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

  const creature = () => byId.creatures[state.creatureId] || null;
  const area = () => byId.areas[state.areaId] || null;
  // Work for both the table and an idea (anything with worldId / twistIds).
  const worldOf = (x) => byId.worlds[x.worldId] || null;
  const twistsOf = (x) => x.twistIds.map((id) => byId.twists[id]).filter(Boolean);

  const nick = () => creature()?.nickname || '';
  const areaWord = () => (area() ? area().name.toLowerCase() : 'life');
  const aOrAn = (word) => (/^[aeiou]/i.test(word) ? 'an' : 'a');
  const dropStop = (text) => String(text).trim().replace(/\.$/, '');

  // Starred first, then newest first.
  const sortedIdeas = () => [...state.ideas].sort((a, b) => (b.starred - a.starred) || (b.createdAt > a.createdAt ? 1 : -1));
  const ideaTags = (idea) => [worldOf(idea) && dropStop(worldOf(idea).name), ...twistsOf(idea).map((t) => dropStop(t.name))].filter(Boolean);

  // The prompt above the idea box, built from the cards on the table.
  function cardPrompt() {
    const twists = twistsOf(state.table);
    if (twists.length) return twistPrompt(twists);
    const c = creature();
    const who = c ? `${aOrAn(c.nickname)} ${c.nickname}` : 'a wild creature';
    const where = worldOf(state.table) ? 'In this world, what' : 'What';
    return `${where} would your ${areaWord()} look like if you lived like ${who}?`;
  }

  function hostname(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch (err) {
      return 'source';
    }
  }

  function formatDate(iso) {
    const date = new Date(iso);
    const valid = !Number.isNaN(date.getTime());
    return (valid ? date : new Date()).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  // "It's nocturnal." -> "nocturnal". Returns null if the twist doesn't read well after "make it".
  function makeItPhrase(twist) {
    const match = dropStop(twist.name).match(/^It['’]s\s+(.+)$/i);
    return match ? match[1] : null;
  }

  function twistPrompt(twists) {
    const phrases = twists.map(makeItPhrase);
    if (phrases.every(Boolean)) return `Now make it ${phrases.join(' and ')}. What changes?`;
    const names = twists.map((t) => dropStop(t.name));
    return twists.length === 1
      ? `Add the twist: ${names[0]}. What changes?`
      : `Add the twists: ${names.join(' and ')}. What changes?`;
  }

  const pickedIdeas = () => state.picked.map((id) => state.ideas.find((i) => i.id === id)).filter(Boolean);
  const moveLabel = () => (nick() ? `My ${nick()} move for 2027 is…` : 'My move for 2027 is…');

  // What people leave with: each picked idea and its small move (or the general move if nothing's picked).
  function takeaways() {
    const picked = pickedIdeas();
    if (!picked.length) return state.move.trim() ? [{ idea: null, move: state.move.trim() }] : [];
    return picked.map((idea) => ({ idea, move: (state.moves[idea.id] || '').trim() }));
  }

  function moveCopyText() {
    const items = takeaways().filter((t) => t.move);
    if (!items.length) return '';
    const who = nick() ? `The ${nick()}'s` : 'My';
    if (items.length === 1) return `${who} move for 2027: ${items[0].move}`;
    return `${who} moves for 2027:\n${items.map((t) => `• ${t.move}`).join('\n')}`;
  }

  /* -------------------------------------------------------------- components */

  // One reusable card. Shows the image if cards.json has one, otherwise a coloured text panel.
  // variant: 'name' (front with name only) or 'full' (label, name and text).
  function card(deck, item, { variant = 'full' } = {}) {
    const text = item.short ?? item.text ?? '';
    const face = item.image
      ? `<img class="card__img" src="${esc(item.image)}" alt="" loading="lazy">
         <span class="card__caption"><span class="card__name">${esc(item.name)}</span></span>`
      : `<span class="card__panel">
           <span class="card__label">${esc(DECK_LABELS[deck])}</span>
           <span class="card__name">${esc(item.name)}</span>
           ${variant === 'full' && text ? `<span class="card__text">${esc(text)}</span>` : ''}
         </span>`;
    return `<span class="card card--${deck} card--${variant}">${face}</span>`;
  }

  function cardBack(deck) {
    return `<span class="card card--${deck} card--back" aria-hidden="true">
      <span class="card__back-mark"><span>✶</span>${esc(DECK_LABELS[deck])}s</span>
    </span>`;
  }

  // Face down: a button that draws. Face up: the card, flipping in if it was just drawn.
  function flipCard(deck, item, { variant = 'full' } = {}) {
    if (!item) {
      return `<button type="button" class="flip" data-action="draw-${deck}" data-key="draw-${deck}" aria-label="Draw a ${esc(DECK_LABELS[deck].toLowerCase())} card">
        <span class="flip__inner"><span class="flip__face flip__face--back">${cardBack(deck)}</span></span>
      </button>`;
    }
    const flipped = ui.justDrew === deck ? '' : ' is-flipped';
    return `<div class="flip${flipped}" data-flip="${deck}">
      <span class="flip__inner">
        <span class="flip__face flip__face--back">${cardBack(deck)}</span>
        <span class="flip__face flip__face--front">${card(deck, item, { variant })}</span>
      </span>
    </div>`;
  }

  function progress(current) {
    const steps = PARTS.map((p) => {
      const isCurrent = p.n === current;
      return `<li><button type="button" class="progress__step${isCurrent ? ' is-current' : ''}" data-action="go" data-to="${p.start}" data-key="part-${p.n}"${isCurrent ? ' aria-current="step"' : ''}>
        <span class="progress__num">${p.n}</span><span class="progress__label">${esc(p.label)}</span>
      </button></li>`;
    }).join('');
    return `<nav class="progress" aria-label="Workshop parts"><ol>${steps}</ol></nav>`;
  }

  function actionBar(screenId) {
    const screen = SCREENS[screenId];
    const index = ORDER.indexOf(screenId);
    const back = index > 0
      ? `<button type="button" class="btn btn--ghost" data-action="back" data-key="back"><span aria-hidden="true">←</span> Back</button>`
      : '<span></span>';
    const label = typeof screen.primary.label === 'function' ? screen.primary.label() : screen.primary.label;
    const primary = `<button type="button" class="btn btn--primary" data-action="${screen.primary.action || 'next'}" data-key="primary">${esc(label)}${screen.primary.action ? '' : ' <span aria-hidden="true">→</span>'}</button>`;
    return `<nav class="actionbar" aria-label="Move between screens"><div class="actionbar__inner">${back}${primary}</div></nav>`;
  }

  const title = (text) => `<h1 id="screen-title" class="screen-title" tabindex="-1">${esc(text)}</h1>`;

  const field = ({ id, path, label, placeholder = '', rows = 4, hint = '' }) => `
    <div class="field">
      <label class="field__label" for="${id}">${esc(label)}</label>
      <textarea id="${id}" data-field="${path}" rows="${rows}" placeholder="${esc(placeholder)}">${esc(getField(path))}</textarea>
      ${hint ? `<p class="hint">${esc(hint)}</p>` : ''}
    </div>`;

  const copyButton = (what, label = 'Copy to share') => `
    <div class="copy-row">
      <button type="button" class="btn btn--secondary" data-action="copy" data-copy="${what}" data-key="copy-${what}">${esc(label)}</button>
      <span class="copy-status" role="status" data-status="${what}"></span>
    </div>`;

  /* ----------------------------------------------------------------- screens */

  function screenWelcome() {
    return `
      <div class="hero">
        <p class="wordmark wordmark--large">Feral Futures</p>
        ${title('Draw your wild card for 2027')}
        <p class="lede">Tonight you'll imagine a future that's much wilder than the one you're heading for, and find one small way to start.</p>
      </div>
      <ol class="parts-list">
        ${PARTS.map((p) => `<li><span class="parts-list__num">${p.n}</span>${esc(p.label)}</li>`).join('')}
      </ol>`;
  }

  function screenCreature() {
    const chosen = creature();
    const grid = cards.creatures.map((c) => {
      const mine = c.id === state.creatureId;
      return `<li>
        <button type="button" class="card-btn${mine ? ' is-selected' : ''}" data-action="open-creature" data-id="${esc(c.id)}" data-key="creature-${esc(c.id)}"
          aria-label="${esc(c.name)}${mine ? ' (your creature)' : ''}. Open card">
          ${card('creature', c, { variant: 'name' })}
          ${mine ? '<span class="badge">Yours</span>' : ''}
        </button>
      </li>`;
    }).join('');

    return `
      ${title('Pick your creature')}
      <p class="lede">Tap a card to look closer.</p>
      <ul class="card-grid card-grid--creatures">${grid}</ul>
      ${chosen ? `<div class="callout">
        <p class="callout__kicker">You're the ${esc(chosen.nickname)}.</p>
        ${field({ id: 'f-creature-note', path: 'creatureNote', rows: 3, placeholder: `Like the ${chosen.nickname}, I…`,
          label: `What's resonating with you about the ${chosen.nickname}? What could you channel?` })}
      </div>` : ''}`;
  }

  // The reverse side of a creature card, shown when it's enlarged and turned over.
  function creatureBack(c) {
    return `<span class="card card--creature card--detail">
      <span class="card__panel">
        <span class="card__label">Creature</span>
        <span class="card__name" id="focus-title">${esc(c.name)}</span>
        <span class="card__text">${esc(c.short)}</span>
        <span class="card__question"><span class="card__label">Ask yourself</span>${esc(c.question)}</span>      </span>
    </span>`;
  }

  /* ------------------------------------------------- creature: enlarge + turn over */

  // Lives outside #app (so re-renders don't wipe it). Animated with GSAP when it's loaded;
  // without GSAP, or with reduced motion, it simply appears turned over.
  let focus = null; // { el, id, card }

  const canAnimate = () => Boolean(window.gsap) && !prefersReducedMotion();
  const gridCard = (id) => app.querySelector(`[data-key="creature-${CSS.escape(id)}"]`);

  // Offset and scale that make the big card sit exactly on top of the small one.
  function offsetTo(fromEl, toEl) {
    const a = fromEl.getBoundingClientRect();
    const b = toEl.getBoundingClientRect();
    return {
      x: a.left + a.width / 2 - (b.left + b.width / 2),
      y: a.top + a.height / 2 - (b.top + b.height / 2),
      scale: a.width / b.width,
    };
  }

  function openCreature(id) {
    const c = byId.creatures[id];
    const source = gridCard(id);
    if (!c || !source || focus) return;
    const mine = c.id === state.creatureId;

    const el = document.createElement('div');
    el.className = 'focus';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'focus-title');
    el.innerHTML = `
      <div class="focus__backdrop" data-action="close-creature"></div>
      <div class="focus__stage">
        <div class="focus__card">
          <div class="focus__face focus__face--front">${card('creature', c, { variant: 'name' })}</div>
          <div class="focus__face focus__face--back">${creatureBack(c)}</div>
        </div>
        <div class="focus__controls">
          <button type="button" class="btn btn--primary" data-action="choose-creature" data-id="${esc(c.id)}">
            ${mine ? `You're the ${esc(c.nickname)} ✓` : `Go with the ${esc(c.nickname)}`}
          </button>
          <button type="button" class="btn btn--ghost" data-action="close-creature">${state.screen === 'creature' ? 'Back to all creatures' : 'Back to the table'}</button>
        </div>
      </div>`;
    el.addEventListener('click', onClick);
    document.body.appendChild(el);
    app.inert = true;

    const cardEl = el.querySelector('.focus__card');
    focus = { el, id, card: cardEl };
    const focusChoose = () => el.querySelector('[data-action="choose-creature"]').focus({ preventScroll: true });

    if (!canAnimate()) {
      cardEl.classList.add('is-turned');
      focusChoose();
      return;
    }

    const gsap = window.gsap;
    const from = offsetTo(source.querySelector('.card'), cardEl);
    source.style.visibility = 'hidden'; // the card "lifts" out of the grid
    gsap.set(cardEl, { transformPerspective: 1400 });
    gsap.timeline({ onComplete: focusChoose })
      .fromTo(el.querySelector('.focus__backdrop'), { opacity: 0 }, { opacity: 1, duration: 0.35, ease: 'power1.out' }, 0)
      .fromTo(cardEl, { x: from.x, y: from.y, scale: from.scale, rotationY: 0 },
        { x: 0, y: 0, scale: 1, duration: 0.6, ease: 'power3.inOut' }, 0)
      .to(cardEl, { rotationY: 180, duration: 0.7, ease: 'back.out(1.1)' }, 0.35)
      .fromTo(el.querySelector('.focus__controls'), { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.3, ease: 'power2.out' }, 0.75);
  }

  // afterClose runs once the card is back in the grid (e.g. to re-render with the new choice).
  function closeCreature({ afterClose, instant = false } = {}) {
    if (!focus) return;
    const { el, id, card: cardEl } = focus;
    focus = null;

    const finish = () => {
      el.remove();
      app.inert = false;
      const source = gridCard(id);
      if (source) source.style.visibility = '';
      afterClose?.();
      gridCard(id)?.focus({ preventScroll: true });
    };

    const source = gridCard(id);
    if (instant || !canAnimate() || !source) {
      window.gsap?.killTweensOf(cardEl);
      finish();
      return;
    }

    const gsap = window.gsap;
    gsap.killTweensOf(cardEl);
    // Measure with the card at rest (it already is, once open) so the offset is exact.
    gsap.set(cardEl, { x: 0, y: 0, scale: 1 });
    const back = offsetTo(source.querySelector('.card'), cardEl);
    gsap.timeline({ onComplete: finish })
      .to(el.querySelector('.focus__controls'), { opacity: 0, duration: 0.15 }, 0)
      .to(cardEl, { rotationY: 0, duration: 0.45, ease: 'power2.inOut' }, 0)
      .to(cardEl, { x: back.x, y: back.y, scale: back.scale, duration: 0.5, ease: 'power3.inOut' }, 0.2)
      .to(el.querySelector('.focus__backdrop'), { opacity: 0, duration: 0.35 }, 0.3);
  }

  function screenArea() {
    const options = cards.areas.map((a) => `
      <li><button type="button" class="option" data-action="pick-area" data-id="${esc(a.id)}" data-key="area-${esc(a.id)}" aria-pressed="${a.id === state.areaId}">
        <span class="option__name">${esc(a.name)}</span>
        <span class="option__text">${esc(a.text)}</span>
      </button></li>`).join('');
    return `
      ${title('Pick a part of life')}
      <p class="lede">Which part of your life gets to go feral tonight?</p>
      <ul class="options">${options}</ul>`;
  }

  function screenHeaded() {
    return `
      ${title('Where is this headed?')}
      ${field({ id: 'f-obvious', path: 'obvious', rows: 5, placeholder: 'I see…',
        label: `Your ${areaWord()}, five years from now, if nothing changes. Write the obvious version.` })}
      ${field({ id: 'f-boring', path: 'boring', rows: 3, label: '…but it feels boring because' })}`;
  }

  // A few examples, picked at random once per page load (placeholder until the curated set exists).
  const examples = {};
  function pickExamples(key, list, count) {
    if (!examples[key]) examples[key] = [...list].sort(() => Math.random() - 0.5).slice(0, count);
    return examples[key];
  }

  function screenTame() {
    const slips = pickExamples('rules', shownRules(), 3)
      .map((r) => `<li class="rule-slip">${esc(r.name)}</li>`).join('');
    return `
      ${title("What's keeping it tame?")}
      <p class="lede">Rules most of us live by without choosing them. Which one is holding yours in place?</p>
      <div class="examples">
        <p class="eyebrow">A few common ones</p>
        <ul class="rule-slips">${slips}</ul>
      </div>
      ${field({ id: 'f-rule', path: 'rule', rows: 2, label: 'The rule keeping mine tame:' })}`;
  }

  /* ---- Part 2: play with the cards, pile up ideas ---- */

  // mode: 'pile' (star + remove), 'pick' (whole note toggles), 'static' (read only)
  function ideaNote(idea, mode = 'pile') {
    const tags = ideaTags(idea);
    const tint = state.ideas.indexOf(idea) % 4;
    const cls = `idea idea--t${tint}${idea.starred ? ' is-starred' : ''}${idea.id === ui.justAdded ? ' is-new' : ''}`;
    const body = `
      <span class="idea__text">${esc(idea.text)}</span>
      ${tags.length ? `<span class="idea__tags">${tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</span>` : ''}`;

    if (mode === 'pick') {
      const on = state.picked.includes(idea.id);
      return `<li><button type="button" class="${cls} idea--pick${on ? ' is-picked' : ''}" data-action="pick-idea" data-id="${esc(idea.id)}" data-key="pick-${esc(idea.id)}" aria-pressed="${on}">
        ${idea.starred ? '<span class="idea__star-mark" aria-label="Starred">★</span>' : ''}${body}
      </button></li>`;
    }
    if (mode === 'static') {
      return `<li class="${cls}">${body}</li>`;
    }
    return `<li class="${cls}">
      ${body}
      <span class="idea__actions">
        <button type="button" class="idea__btn idea__star" data-action="star-idea" data-id="${esc(idea.id)}" data-key="star-${esc(idea.id)}" aria-pressed="${idea.starred}" aria-label="Star this idea">${idea.starred ? '★' : '☆'}</button>
        <button type="button" class="idea__btn" data-action="remove-idea" data-id="${esc(idea.id)}" aria-label="Remove this idea">×</button>
      </span>
    </li>`;
  }

  function twistChooser() {
    const grid = cards.twists.map((t) => {
      const on = state.table.twistIds.includes(t.id);
      return `<li><button type="button" class="card-btn${on ? ' is-selected' : ''}" data-action="toggle-twist" data-id="${esc(t.id)}" data-key="twist-${esc(t.id)}" aria-pressed="${on}">
        ${card('twist', t)}
        ${on ? '<span class="badge">On the table</span>' : ''}
      </button></li>`;
    }).join('');
    return `<details class="disclosure" data-chooser${ui.twistChooserOpen ? ' open' : ''}>
      <summary>Choose a twist yourself</summary>
      <div class="disclosure__body">
        <p class="hint">Pick one, or two at most. Tap again to take it off the table.</p>
        <ul class="card-grid card-grid--twists">${grid}</ul>
        <p class="hint" role="status" data-status="twist"></p>
      </div>
    </details>`;
  }

  function screenPlay() {
    const c = creature();
    const w = worldOf(state.table);
    const twists = twistsOf(state.table);
    // Two twists share one slot: show them as one combined card.
    const twistItem = twists.length > 1 ? { name: twists.map((t) => dropStop(t.name)).join(' + ') } : twists[0];

    const slot = (label, inner, extra = '') => `
      <li class="table__slot">
        <span class="table__label">${label}</span>
        ${inner}
        ${extra}
      </li>`;
    const redraw = (deck) => `<button type="button" class="btn btn--mini" data-action="draw-${deck}" data-key="redraw-${deck}"><span aria-hidden="true">↻</span> New</button>`;

    const creatureSlot = c
      ? `<button type="button" class="card-btn" data-action="open-creature" data-id="${esc(c.id)}" data-key="creature-${esc(c.id)}" aria-label="${esc(c.name)}. Open card">${card('creature', c, { variant: 'name' })}</button>`
      : `<button type="button" class="slot-empty" data-action="go" data-to="creature">Pick a creature</button>`;

    const readout = [
      w && `<p><strong>${esc(dropStop(w.name))}.</strong> ${esc(w.text)}</p>`,
      ...twists.map((t) => `<p><strong>${esc(dropStop(t.name))}.</strong> ${esc(t.text)}</p>`),
    ].filter(Boolean).join('');

    const pile = sortedIdeas();
    return `
      ${title('Play with it')}
      <p class="lede">Draw cards, swap them, pile up ideas. Strange is good. More is better.</p>

      <section class="table" aria-label="Cards in play">
        <ul class="table__cards">
          ${slot('You', creatureSlot)}
          ${slot('World', flipCard('world', w, { variant: 'name' }), w ? redraw('world') : '')}
          ${slot('Twist', flipCard('twist', twistItem, { variant: 'name' }), twists.length ? redraw('twist') : '')}
        </ul>
        ${readout ? `<div class="table__readout">${readout}</div>` : '<p class="hint">Tap a face-down card to draw it.</p>'}
        <p class="visually-hidden" role="status">${ui.justDrew === 'world' && w ? `You drew: ${esc(w.name)}` : ''}${ui.justDrew === 'twist' && twistItem ? `You drew: ${esc(twistItem.name)}` : ''}</p>
        ${w && w.example ? `<details class="disclosure disclosure--quiet">
          <summary>This world already exists</summary>
          <div class="disclosure__body">
            <p>${esc(w.example)}</p>
            ${w.source ? `<p><a href="${esc(w.source)}" target="_blank" rel="noopener noreferrer">Read more on ${esc(hostname(w.source))}<span class="visually-hidden"> (opens in a new tab)</span></a></p>` : ''}
          </div>
        </details>` : ''}
        ${twistChooser()}
      </section>

      <section class="catch" aria-label="Add an idea">
        <div class="field">
          <label class="field__label" for="f-draft">${esc(cardPrompt())}</label>
          <textarea id="f-draft" data-field="draft" rows="3" placeholder="Quick and messy is fine…">${esc(state.draft)}</textarea>
        </div>
        <div class="catch__actions">
          <button type="button" class="btn btn--primary" data-action="add-idea" data-key="add-idea">+ Add to pile</button>
        </div>
        <p class="hint" role="status" data-status="pile"></p>
      </section>

      <section class="pile" aria-labelledby="pile-title">
        <h2 id="pile-title" class="pile__title">Your pile <span class="pile__count">${pile.length}</span></h2>
        ${ui.lastRemoved ? `<p class="hint">Idea removed. <button type="button" class="linkish" data-action="undo-remove" data-key="undo-remove">Undo</button></p>` : ''}
        ${pile.length
          ? `<ul class="pile__list">${pile.map((i) => ideaNote(i)).join('')}</ul>
             <p class="hint">Star the ones that spark something.</p>`
          : '<p class="pile__empty">Nothing yet. Every idea counts, especially the odd ones.</p>'}
      </section>`;
  }

  /* ---- Part 3: take an idea or two from the pile, and a small move for each ---- */

  function pilePicker() {
    const pile = sortedIdeas();
    if (!pile.length) {
      return `<p class="note">Your pile is empty. <button type="button" class="linkish" data-action="go" data-to="play">Go play with the cards</button> first, or just write a move below.</p>`;
    }
    const starred = pile.filter((i) => i.starred);
    const rest = pile.filter((i) => !i.starred);
    const list = (ideas) => `<ul class="pile__list pile__list--pick">${ideas.map((i) => ideaNote(i, 'pick')).join('')}</ul>`;
    // With stars, show those up front and fold the rest away so a big pile doesn't bury the page.
    const body = starred.length && rest.length
      ? `${list(starred)}
         <details class="disclosure disclosure--quiet" data-rest${ui.restOpen ? ' open' : ''}>
           <summary>The rest of your pile (${rest.length})</summary>
           <div class="disclosure__body">${list(rest)}</div>
         </details>`
      : list(pile);
    return `<p class="lede">Pick the idea or two you want to take with you.</p>
      ${body}
      <p class="hint" role="status" data-status="pick"></p>`;
  }

  function screenTry() {
    const tiles = pickExamples('ways', cards.ways, 4).map((w, i) => `
      <li class="way-tile way-tile--${i + 1}">
        <span class="way-tile__name">${esc(dropStop(w.name))}</span>
        <span class="way-tile__text">${esc(w.text)}</span>
      </li>`).join('');
    const picked = pickedIdeas();
    const forThisOne = nick() ? `My ${nick()} move for this one is…` : 'My move for this one is…';
    const moves = picked.length
      ? picked.map((idea) => `
          <div class="takeaway">
            <p class="eyebrow">Taking with me</p>
            <p class="takeaway__idea">${esc(idea.text)}</p>
            ${field({ id: `f-move-${idea.id}`, path: `moves.${idea.id}`, rows: 2, label: forThisOne })}
          </div>`).join('')
      : field({ id: 'f-move', path: 'move', rows: 3, label: moveLabel() });
    return `
      ${title('Try one small thing')}
      ${pilePicker()}
      <div class="examples">
        <p class="eyebrow">A few ways in. Steal one, or invent your own.</p>
        <ul class="way-tiles">${tiles}</ul>
      </div>
      ${moves}
      ${copyButton('move')}`;
  }

  // Shared by the field notes screen and "Copy as text", so both always match.
  function notesData() {
    const c = creature();
    const sections = [];
    if (area()) sections.push({ title: 'Part of life', items: [{ text: area().name }] });
    const tame = [];
    if (state.obvious.trim()) tame.push({ label: 'Where it’s headed', text: state.obvious.trim() });
    if (state.boring.trim()) tame.push({ label: '…but it feels boring because', text: state.boring.trim() });
    if (state.rule.trim()) tame.push({ label: 'The rule keeping it tame', text: state.rule.trim() });
    if (tame.length) sections.push({ title: 'The tame version', items: tame });
    if (c) {
      const items = [{ text: c.name }, { label: 'Ask yourself', text: c.question }];
      if (state.creatureNote.trim()) items.push({ label: `What I'm channelling from the ${c.nickname}`, text: state.creatureNote.trim() });
      sections.push({ title: 'Your creature', items });
    }

    const pile = sortedIdeas();
    if (pile.length) {
      sections.push({
        title: `My idea pile (${pile.length})`,
        items: pile.map((i) => ({ label: [i.starred ? '★' : '', ideaTags(i).join(' + ')].filter(Boolean).join(' ') || null, text: i.text })),
      });
    }

    const tryIt = [];
    const moveName = moveLabel().replace(/ is…$/, '');
    for (const t of takeaways()) {
      if (t.idea) tryIt.push({ label: 'The idea', text: t.idea.text });
      if (t.move) tryIt.push({ label: moveName, text: t.move, highlight: true });
    }
    if (tryIt.length) sections.push({ title: 'Taking with me', items: tryIt });
    return sections;
  }

  function notesPlainText() {
    const lines = ['FERAL FUTURES: FIELD NOTES', formatDate(state.startedAt), ''];
    for (const section of notesData()) {
      lines.push(section.title.toUpperCase());
      for (const item of section.items) lines.push(item.label ? `${item.label}: ${item.text}` : item.text);
      lines.push('');
    }
    lines.push(`More: ${CONFIG.links.newsletter}`);
    return lines.join('\n');
  }

  function screenNotes() {
    const sections = notesData();
    const body = sections.length
      ? sections.map((s) => `
        <section class="notes__section">
          <h2 class="notes__title">${esc(s.title)}</h2>
          ${s.items.map((item) => `
            <div class="notes__item${item.highlight ? ' notes__item--highlight' : ''}">
              ${item.label ? `<p class="notes__label">${esc(item.label)}</p>` : ''}
              <p class="notes__text">${esc(item.text)}</p>
            </div>`).join('')}
        </section>`).join('')
      : '<p class="note">Nothing here yet. Go back and write a few things down, then come back.</p>';

    return `
      <header class="notes-head">
        <p class="wordmark">Feral Futures</p>
        ${title('Your field notes')}
        <p class="notes-head__date">${esc(formatDate(state.startedAt))}</p>
      </header>
      <article class="notes">${body}</article>
      <div class="notes-actions">
        ${copyButton('notes', 'Copy as text')}
      </div>
      <section class="whats-next" aria-labelledby="next-title">
        <h2 id="next-title">What’s next</h2>
        <ul>
          <li><a href="${esc(CONFIG.links.newsletter)}" target="_blank" rel="noopener noreferrer">Read (Future) in the Making</a>, my newsletter about futures you can actually try.</li>
          <li><a href="${esc(CONFIG.links.deck)}">Get the Feral Futures deck</a> to keep playing at home. <em>(Link coming soon.)</em></li>
        </ul>
      </section>`;
  }

  // Order of screens, which progress part each belongs to (0 = none), and the forward button.
  const SCREENS = {
    welcome: { part: 0, render: screenWelcome, primary: { label: 'Let’s go' } },
    creature: { part: 1, render: screenCreature, primary: { label: 'Next' } },
    area: { part: 1, render: screenArea, primary: { label: 'Next' } },
    headed: { part: 1, render: screenHeaded, primary: { label: 'Next' } },
    tame: { part: 1, render: screenTame, primary: { label: 'Next' } },
    play: { part: 2, render: screenPlay, primary: { label: 'Next' } },
    try: { part: 3, render: screenTry, primary: { label: 'See my field notes' } },
    notes: { part: 3, render: screenNotes, primary: { label: 'Save as PDF', action: 'print' } },
  };
  const ORDER = Object.keys(SCREENS);

  /* ------------------------------------------------------------------ fields */

  // Text fields map to a key on state ('obvious', 'rule', 'draft', …) or one level down ('moves.<ideaId>').
  function getField(path) {
    const [key, sub] = path.split(/\.(.+)/);
    return sub ? state[key]?.[sub] ?? '' : state[key];
  }

  function setField(path, value) {
    const [key, sub] = path.split(/\.(.+)/);
    if (sub) state[key] = { ...state[key], [sub]: value };
    else state[key] = value;
    saveState();
  }

  /* ------------------------------------------------------------------ render */

  const app = document.getElementById('app');

  function render({ navigated = false } = {}) {
    const active = document.activeElement;
    const focusKey = active && (active.dataset?.key || active.id);
    const scrollY = window.scrollY;

    const screen = SCREENS[state.screen];
    app.innerHTML = `
      <header class="topbar">
        ${['welcome', 'notes'].includes(state.screen) ? '' : '<p class="wordmark">Feral Futures</p>'}
        ${progress(screen.part)}
      </header>
      ${storageOk ? '' : '<p class="warning" role="alert">Your browser isn’t letting this page save. Your answers will be lost if you refresh, so keep this tab open.</p>'}
      <main id="main" class="screen screen--${state.screen}">${screen.render()}</main>
      ${footer()}
      ${actionBar(state.screen)}`;

    if (navigated) {
      window.scrollTo(0, 0);
      document.getElementById('screen-title')?.focus({ preventScroll: true });
    } else {
      window.scrollTo(0, scrollY);
      const target = focusKey
        ? app.querySelector(`[data-key="${CSS.escape(focusKey)}"]`) || document.getElementById(focusKey)
        : null;
      target?.focus({ preventScroll: true });
    }

    if (ui.justDrew) {
      const flip = app.querySelector(`[data-flip="${ui.justDrew}"]`);
      ui.justDrew = null;
      if (flip) {
        void flip.offsetWidth; // force layout with the back showing, so the flip transition runs
        flip.classList.add('is-flipped');
      }
    }
    ui.justAdded = null; // the "just landed" pop only plays once
  }

  function footer() {
    return `<footer class="sitefoot">
      ${ui.confirmReset
        ? `<div class="reset-confirm" role="group" aria-label="Start over">
            <p>Clear all your answers and start again?</p>
            <button type="button" class="btn btn--danger" data-action="reset-yes" data-key="reset-yes">Yes, clear everything</button>
            <button type="button" class="btn btn--ghost" data-action="reset-no" data-key="reset-no">Keep my answers</button>
          </div>`
        : '<button type="button" class="linkish" data-action="reset-ask" data-key="reset-ask">Start over</button>'}
    </footer>`;
  }

  /* -------------------------------------------------------------- navigation */

  // The URL hash mirrors the screen, so the browser's own back button works too.
  function go(screenId) {
    if (!SCREENS[screenId]) return;
    ui.confirmReset = false;
    ui.lastRemoved = null;
    state.screen = screenId;
    saveState();
    if (location.hash !== `#${screenId}`) location.hash = screenId; // triggers onHashChange
    else render({ navigated: true });
  }

  function onHashChange() {
    const raw = location.hash.slice(1);
    const id = SCREEN_ALIASES[raw] || raw;
    if (!SCREENS[id]) return;
    if (id !== raw) { history.replaceState(null, '', `#${id}`); }
    closeCreature({ instant: true }); // e.g. browser back while a card is enlarged
    if (id !== state.screen) {
      state.screen = id;
      saveState();
    }
    render({ navigated: true });
  }

  /* ----------------------------------------------------------------- actions */

  function setStatus(name, message, { clearAfter = 0 } = {}) {
    const el = app.querySelector(`[data-status="${name}"]`);
    if (!el) return;
    el.textContent = message;
    if (clearAfter) {
      clearTimeout(el._timer);
      el._timer = setTimeout(() => { el.textContent = ''; }, clearAfter);
    }
  }

  function drawWorld() {
    const all = cards.worlds.map((w) => w.id);
    let pool = all.filter((id) => !state.seenWorlds.includes(id));
    if (!pool.length) {
      // Everyone's seen every world: reshuffle, but don't hand back the one on the table.
      state.seenWorlds = [];
      pool = all.filter((id) => id !== state.table.worldId);
    }
    const id = pool[Math.floor(Math.random() * pool.length)];
    state.seenWorlds.push(id);
    state.table.worldId = id;
    afterDraw('world');
  }

  // A random twist that isn't already on the table. Replaces whatever twist(s) were there.
  function drawTwist() {
    const pool = cards.twists.filter((t) => !state.table.twistIds.includes(t.id));
    state.table.twistIds = [pool[Math.floor(Math.random() * pool.length)].id];
    afterDraw('twist');
  }

  function afterDraw(deck) {
    ui.justDrew = deck;
    saveState();
    render();
    app.querySelector(`[data-key="redraw-${deck}"]`)?.focus({ preventScroll: true });
  }

  const findIdea = (id) => state.ideas.find((i) => i.id === id);

  function addIdea() {
    const text = state.draft.trim();
    const draft = () => app.querySelector('#f-draft');
    if (!text) {
      setStatus('pile', 'Write something first. Anything.', { clearAfter: 3000 });
      draft()?.focus();
      return;
    }
    const idea = { id: newId(), text, worldId: state.table.worldId, twistIds: [...state.table.twistIds], starred: false, createdAt: new Date().toISOString() };
    state.ideas.push(idea);
    state.draft = '';
    ui.justAdded = idea.id;
    ui.lastRemoved = null;
    saveState();
    render();
    draft()?.focus({ preventScroll: true });
    setStatus('pile', `On the pile. That's ${state.ideas.length}.`, { clearAfter: 4000 });
  }

  const actions = {
    go: (el) => go(el.dataset.to),
    next: () => go(ORDER[Math.min(ORDER.indexOf(state.screen) + 1, ORDER.length - 1)]),
    back: () => go(ORDER[Math.max(ORDER.indexOf(state.screen) - 1, 0)]),
    print: () => window.print(),

    'open-creature': (el) => openCreature(el.dataset.id),
    'close-creature': () => closeCreature(),
    'choose-creature': (el) => {
      state.creatureId = el.dataset.id;
      saveState();
      closeCreature({
        afterClose: () => {
          render();
          // The "You're the…" box sits under the grid, so bring it into view.
          app.querySelector('.callout')?.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
        },
      });
    },

    'pick-area': (el) => {
      state.areaId = el.dataset.id;
      saveState();
      render();
    },

    'draw-world': drawWorld,
    'draw-twist': drawTwist,

    'toggle-twist': (el) => {
      const ids = state.table.twistIds;
      const id = el.dataset.id;
      if (ids.includes(id)) ids.splice(ids.indexOf(id), 1);
      else if (ids.length >= 2) {
        setStatus('twist', 'Two is the limit. Tap one of yours to take it off first.');
        return;
      } else ids.push(id);
      saveState();
      render();
    },

    'add-idea': addIdea,
    'star-idea': (el) => {
      const idea = findIdea(el.dataset.id);
      if (!idea) return;
      idea.starred = !idea.starred;
      saveState();
      render();
    },
    'remove-idea': (el) => {
      const index = state.ideas.findIndex((i) => i.id === el.dataset.id);
      if (index < 0) return;
      const [idea] = state.ideas.splice(index, 1);
      state.picked = state.picked.filter((id) => id !== idea.id);
      ui.lastRemoved = { idea, index };
      saveState();
      render();
      app.querySelector('[data-key="undo-remove"]')?.focus({ preventScroll: true });
    },
    'undo-remove': () => {
      if (!ui.lastRemoved) return;
      const { idea, index } = ui.lastRemoved;
      state.ideas.splice(index, 0, idea);
      ui.lastRemoved = null;
      saveState();
      render();
      app.querySelector(`[data-key="star-${CSS.escape(idea.id)}"]`)?.focus({ preventScroll: true });
    },
    'pick-idea': (el) => {
      const id = el.dataset.id;
      if (state.picked.includes(id)) state.picked = state.picked.filter((x) => x !== id);
      else if (state.picked.length >= 2) {
        setStatus('pick', 'Two is plenty. Tap one to let it go first.', { clearAfter: 4000 });
        return;
      } else state.picked.push(id);
      saveState();
      render();
    },

    copy: async (el) => {
      const what = el.dataset.copy;
      const text = { move: moveCopyText, notes: notesPlainText }[what]();
      if (!text) {
        setStatus(what, 'Write something first.', { clearAfter: 3000 });
        return;
      }
      const ok = await copyText(text);
      el.focus({ preventScroll: true });
      if (ok) setStatus(what, 'Copied', { clearAfter: 3000 });
      else showManualCopy(el, text);
    },

    'reset-ask': () => { ui.confirmReset = true; render(); },
    'reset-no': () => { ui.confirmReset = false; render(); },
    'reset-yes': () => {
      try { localStorage.removeItem(CONFIG.storageKey); } catch (err) { /* nothing saved anyway */ }
      state = freshState();
      ui.confirmReset = false;
      go('welcome');
    },
  };

  const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* --------------------------------------------------------------- clipboard */

  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        // Some browsers leave the promise hanging when permission is blocked, so give up after a moment.
        const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1500));
        await Promise.race([navigator.clipboard.writeText(text), timeout]);
        return true;
      }
    } catch (err) { /* fall through to the old way */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (err) {
      return false;
    }
  }

  // Last resort: show the text selected so people can copy it themselves.
  function showManualCopy(button, text) {
    const row = button.closest('.copy-row');
    row.querySelector('.manual-copy')?.remove();
    const wrap = document.createElement('div');
    wrap.className = 'manual-copy';
    const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
    wrap.innerHTML = `<label for="manual-copy-${button.dataset.copy}">Your browser blocked copying. Press ${isMac ? '⌘' : 'Ctrl'}+C to copy:</label>
      <textarea id="manual-copy-${button.dataset.copy}" readonly rows="4"></textarea>`;
    wrap.querySelector('textarea').value = text;
    row.after(wrap);
    const ta = wrap.querySelector('textarea');
    ta.focus();
    ta.select();
  }

  /* ------------------------------------------------------------------ events */

  // Shared by #app and the enlarged creature card (which lives outside #app).
  function onClick(event) {
    const el = event.target.closest('[data-action]');
    if (!el) return;
    const action = actions[el.dataset.action];
    if (action) {
      event.preventDefault();
      action(el);
    }
  }
  app.addEventListener('click', onClick);

  app.addEventListener('input', (event) => {
    const path = event.target.dataset?.field;
    if (path) setField(path, event.target.value);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && focus) closeCreature();
    // Cmd/Ctrl + Enter in the idea box adds it to the pile.
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && event.target.id === 'f-draft') {
      event.preventDefault();
      addIdea();
    }
  });

  // Remember whether the twist chooser is open, so re-renders don't snap it shut.
  app.addEventListener('toggle', (event) => {
    if (event.target.matches?.('[data-chooser]')) ui.twistChooserOpen = event.target.open;
    if (event.target.matches?.('[data-rest]')) ui.restOpen = event.target.open;
  }, true);

  window.addEventListener('hashchange', onHashChange);

  /* -------------------------------------------------------------------- init */

  async function init() {
    try {
      cards = await loadCards();
    } catch (err) {
      app.innerHTML = '<p class="loading">Couldn’t load the cards. Check that cards.json (or cards.js) is next to index.html.</p>';
      return;
    }
    indexCards();
    state = loadState();

    // A screen in the URL wins (e.g. a shared link to #world); otherwise resume where they were.
    const rawHash = location.hash.slice(1);
    const fromHash = SCREEN_ALIASES[rawHash] || rawHash;
    if (SCREENS[fromHash]) state.screen = fromHash;
    saveState();
    history.replaceState(null, '', `#${state.screen}`);
    render({ navigated: false });
  }

  init();
})();
