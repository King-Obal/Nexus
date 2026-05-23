/**
 * Test helpers: API client + game flow navigation for forge-api card tests.
 * Requires Node 18+ (built-in fetch).
 */

const BASE = 'http://localhost:4567';
const TEST_DECK_NAME = '__nexus_test_deck__';
const POLL_INTERVAL = 400; // ms
const POLL_TIMEOUT = 60_000; // ms

// ── HTTP client ─────────────────────────────────────────────────────────────

async function api(method, path, body = null) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body !== null) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) throw new Error(`HTTP ${res.status} ${method} ${path}: ${text}`);
  return json;
}

const GET  = (path) => api('GET', path);
const POST = (path, body) => api('POST', path, body);
const DEL  = (path) => api('DELETE', path);

// ── Test deck management ─────────────────────────────────────────────────────

async function ensureTestDeck() {
  // 60-card constructed deck of basic Forests — just needs to be a valid deck
  const mainboard = Array.from({ length: 60 }, () => ({ name: 'Forest', qty: 1 }));
  // Collapse to single entry
  const deck = { name: TEST_DECK_NAME, format: 'Constructed', mainboard: [{ name: 'Forest', qty: 60 }] };
  await POST('/api/decks/import', deck);
}

async function cleanupTestDeck() {
  try { await DEL(`/api/decks?name=${encodeURIComponent(TEST_DECK_NAME)}&format=constructed`); } catch {}
}

// ── Game lifecycle ────────────────────────────────────────────────────────────

async function startDebugGame(opts = {}) {
  const body = {
    deck1: TEST_DECK_NAME,
    deck2: TEST_DECK_NAME,
    format: 'Constructed',
    debug: true,
    goFirstPlayerIndex: 0,
    ...opts,
  };
  return POST('/api/game/start', body);
}

async function getState(id) {
  return GET(`/api/game/${id}/state`);
}

async function respond(id, body) {
  return POST(`/api/game/${id}/respond`, body);
}

async function addCard(id, card, zone = 'battlefield', player = 0) {
  return POST(`/api/game/${id}/debug/add-card`, { card, zone, player });
}

async function concedeGame(id) {
  try { await POST(`/api/game/${id}/concede`, { player: 0 }); } catch {}
}

// ── Polling ───────────────────────────────────────────────────────────────────

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Poll state until predicate returns truthy or timeout.
 * @param {string} id - game id
 * @param {(state) => any} predicate - returns falsy to keep waiting
 * @param {number} timeout - ms
 */
async function waitFor(id, predicate, timeout = POLL_TIMEOUT) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const state = await getState(id);
    if (state.gameOver) throw new Error(`Game ended unexpectedly. Winner: ${state.winner}`);
    const result = predicate(state);
    if (result) return state;
    await sleep(POLL_INTERVAL);
  }
  const state = await getState(id);
  const dec = state.pendingDecision;
  throw new Error(`Timeout waiting for condition. Last decision: ${dec ? JSON.stringify({ type: dec.type, phase: state.phase }) : 'none'}`);
}

/** Wait until there's a pending decision of the given type. */
async function waitForDecision(id, type, timeout = POLL_TIMEOUT) {
  return waitFor(id, s => s.pendingDecision && s.pendingDecision.type === type, timeout);
}

// ── Game navigation ───────────────────────────────────────────────────────────

/**
 * Navigate the game automatically, calling `onDecision` for each step.
 * `onDecision(state, decision)` should return a response object to send,
 * or null to use the default auto-handler.
 *
 * Default auto-handlers:
 *   MULLIGAN           → keep
 *   CHOOSE_ACTION      → pass (unless in target phase)
 *   CONFIRM_TRIGGER    → yes
 *   CONFIRM_ACTION     → yes
 *   CHOOSE_OPTION      → first option
 *   CHOOSE_NUMBER      → min
 *
 * Returns when `onDecision` throws `StopNavigation` or game ends.
 */
class StopNavigation {
  constructor(state) { this.state = state; }
}

async function navigate(id, onDecision, timeout = POLL_TIMEOUT) {
  const deadline = Date.now() + timeout;
  let lastState = null;
  while (Date.now() < deadline) {
    const state = await getState(id);
    lastState = state;
    if (state.gameOver) return state;
    const dec = state.pendingDecision;
    if (!dec) { await sleep(POLL_INTERVAL); continue; }

    let response;
    try {
      response = await onDecision(state, dec);
    } catch (e) {
      if (e instanceof StopNavigation) return e.state || state;
      throw e;
    }

    if (response === null || response === undefined) {
      // Default auto-handler
      response = autoHandle(state, dec);
    }
    if (response !== null) {
      await respond(id, response);
    }
    await sleep(100);
  }
  throw new Error(`navigate() timed out. Last phase: ${lastState?.phase}, decision: ${lastState?.pendingDecision?.type}`);
}

function autoHandle(state, dec) {
  switch (dec.type) {
    case 'MULLIGAN':
      return { keep: true };
    case 'CHOOSE_ACTION':
      return { choice: 'pass' };
    case 'CONFIRM_TRIGGER':
      return { choice: 'yes' };
    case 'CONFIRM_ACTION':
      return { choice: 'yes' };
    case 'CHOOSE_OPTION': {
      const opts = dec.data?.options;
      if (opts && opts.length > 0) return { choice: opts[0] };
      return { choice: '' };
    }
    case 'CHOOSE_NUMBER': {
      const min = dec.data?.min ?? 0;
      return { number: min };
    }
    case 'CHOOSE_CARD': {
      // If optional, skip; otherwise pick first
      if (dec.data?.optional) return { cardIds: [] };
      const cards = dec.data?.cards ?? [];
      if (cards.length === 0) return { cardIds: [] };
      return { cardIds: [cards[0].id] };
    }
    case 'CHOOSE_COLOR': {
      const colors = dec.data?.colors ?? [];
      return { color: colors[0] ?? 'Green' };
    }
    default:
      return null;
  }
}

// ── Helpers for CHOOSE_ACTION ─────────────────────────────────────────────────

/** Find a CHOOSE_ACTION option whose description contains `text` (case-insensitive). */
function findOption(options, text) {
  return options.find(o => o.description && o.description.toLowerCase().includes(text.toLowerCase()));
}

/** Find a CHOOSE_ACTION option for a card by name. Returns first match. */
function findCardOption(options, cardName) {
  return options.find(o => o.card && o.card.toLowerCase() === cardName.toLowerCase());
}

/**
 * Find ALL options for a given card name (there may be multiple SAs).
 * Prefers the one whose description contains "Add" for mana abilities.
 */
function findManaOption(options, cardName) {
  const forCard = options.filter(o => o.card && o.card.toLowerCase() === cardName.toLowerCase());
  const mana = forCard.find(o => o.description && o.description.toLowerCase().includes('add'));
  return mana || forCard[0] || null;
}

// ── Assertions ────────────────────────────────────────────────────────────────

function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function assertMana(state, playerIdx, expected) {
  const pool = state.players[playerIdx]?.manaPool;
  assert(pool, `No mana pool for player ${playerIdx}`);
  for (const [color, amount] of Object.entries(expected)) {
    const actual = pool[color] ?? 0;
    assert(actual >= amount,
      `Mana pool: expected ${color}>=${amount}, got ${actual}. Pool: ${JSON.stringify(pool)}`);
  }
}

function assertCardTypeContains(state, playerIdx, cardName, typeSubstring) {
  const bf = state.players[playerIdx]?.battlefield ?? [];
  const card = bf.find(c => c.name === cardName);
  assert(card, `Card "${cardName}" not found on battlefield of player ${playerIdx}`);
  assert(card.type && card.type.includes(typeSubstring),
    `Card "${cardName}" type "${card.type}" does not contain "${typeSubstring}"`);
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  ensureTestDeck, cleanupTestDeck,
  startDebugGame, getState, respond, addCard, concedeGame,
  waitFor, waitForDecision, navigate,
  StopNavigation, autoHandle,
  findOption, findCardOption, findManaOption,
  assert, assertMana, assertCardTypeContains,
  sleep,
};
