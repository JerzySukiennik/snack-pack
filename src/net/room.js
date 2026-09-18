// Garage room transport. One contract, two backends: Firebase RTDB for real play and
// BroadcastChannel for same-browser rooms (offline fallback and local testing).
//
// room: { code, selfId, backend, players: Map, creatures: Map, on(evt, fn),
//         setState(patch), publishCreature(json), ping(), start(), leave() }
// events: 'players' (), 'creature' (id, json|null), 'ping' (id), 'start' (), 'closed' (reason)

import { getFirebase } from './firebase.js';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
export const MAX_PLAYERS = 4;

export function makeCode() {
  let s = '';
  for (let i = 0; i < 4; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

class Base {
  constructor(code) {
    this.code = code;
    this.players = new Map();
    this.creatures = new Map();
    this.handlers = {};
    this.closed = false;
  }

  on(evt, fn) {
    (this.handlers[evt] = this.handlers[evt] || []).push(fn);
    return this;
  }

  emit(evt, ...args) {
    for (const fn of this.handlers[evt] || []) fn(...args);
  }

  self() {
    return this.players.get(this.selfId);
  }

  freeSlot() {
    const used = new Set([...this.players.values()].map((p) => p.slot));
    for (let i = 0; i < MAX_PLAYERS; i++) if (!used.has(i)) return i;
    return -1;
  }
}

class LocalRoom extends Base {
  constructor(code, state) {
    super(code);
    this.backend = 'local';
    this.selfId = 'L' + Math.random().toString(36).slice(2, 10);
    this.state = { name: state.name, ready: false, slot: -1 };
    this.creature = null;
    this.ch = new BroadcastChannel('snackpack-room-' + code);
    this.ch.onmessage = (e) => this._recv(e.data);
    this._bye = () => this.leave();
    window.addEventListener('pagehide', this._bye);
  }

  async open() {
    this._send('hello');
    await new Promise((r) => setTimeout(r, 350));
    const slot = this.freeSlot();
    if (slot < 0) { this.leave(); throw new Error('Room is full'); }
    this.state.slot = slot;
    this.players.set(this.selfId, { ...this.state });
    this._send('state', this.state);
    this.emit('players');
    this._beat = setInterval(() => this._send('state', this.state), 4000);
    this._sweep = setInterval(() => {
      const now = Date.now();
      for (const [id, p] of this.players) {
        if (id !== this.selfId && now - p.seen > 10000) this._drop(id);
      }
    }, 3000);
    return this;
  }

  _send(type, data) {
    if (!this.closed) this.ch.postMessage({ type, from: this.selfId, data });
  }

  _drop(id) {
    if (!this.players.delete(id)) return;
    this.creatures.delete(id);
    this.emit('creature', id, null);
    this.emit('players');
  }

  _recv(m) {
    if (!m || m.from === this.selfId) return;
    if (m.type === 'hello') {
      if (this.state.slot >= 0) this._send('state', this.state);
      if (this.creature) this._send('creature', this.creature);
    } else if (m.type === 'state') {
      this.players.set(m.from, { ...m.data, seen: Date.now() });
      this.emit('players');
    } else if (m.type === 'creature') {
      this.creatures.set(m.from, m.data);
      this.emit('creature', m.from, m.data);
    } else if (m.type === 'ping') this.emit('ping', m.from);
    else if (m.type === 'start') this.emit('start');
    else if (m.type === 'bye') this._drop(m.from);
  }

  setState(patch) {
    Object.assign(this.state, patch);
    this.players.set(this.selfId, { ...this.state });
    this._send('state', this.state);
    this.emit('players');
  }

  publishCreature(json) {
    this.creature = json;
    this._send('creature', json);
  }

  ping() {
    this._send('ping');
  }

  start() {
    this._send('start');
    this.emit('start');
  }

  unstart() {}

  leave() {
    if (this.closed) return;
    this._send('bye');
    this.closed = true;
    clearInterval(this._beat);
    clearInterval(this._sweep);
    window.removeEventListener('pagehide', this._bye);
    this.ch.close();
  }
}

class FirebaseRoom extends Base {
  constructor(code, state, fb) {
    super(code);
    this.backend = 'firebase';
    this.fb = fb;
    this.selfId = fb.uid;
    this.state = { name: state.name, ready: false, slot: -1 };
    this.unsubs = [];
    this.base = `rooms/${code}`;
  }

  async open(create) {
    const { db, ref } = this.fb;
    const metaRef = ref(`${this.base}/meta`);
    const meta = (await db.get(metaRef)).val();
    if (create) {
      if (meta && Date.now() - (meta.createdAt || 0) < 6 * 3600 * 1000 && meta.hostUid !== this.selfId) throw new Error('code-taken');
      await db.set(ref(this.base), { meta: { hostUid: this.selfId, createdAt: db.serverTimestamp(), state: 'garage' } });
    } else if (!meta) throw new Error('Room not found');

    let mine = -1;
    for (let i = 0; i < MAX_PLAYERS && mine < 0; i++) {
      const res = await db.runTransaction(ref(`${this.base}/slots/s${i}`), (cur) => (cur === null || cur === this.selfId ? this.selfId : undefined));
      if (res.committed) mine = i;
    }
    if (mine < 0) throw new Error('Room is full');
    this.state.slot = mine;
    const me = ref(`${this.base}/players/${this.selfId}`);
    db.onDisconnect(me).remove();
    db.onDisconnect(ref(`${this.base}/creatures/${this.selfId}`)).remove();
    db.onDisconnect(ref(`${this.base}/slots/s${mine}`)).remove();
    await db.set(me, this.state);

    this.unsubs.push(db.onValue(ref(`${this.base}/players`), (snap) => {
      const val = snap.val() || {};
      this.players = new Map(Object.entries(val));
      this.emit('players');
    }));
    const cRef = ref(`${this.base}/creatures`);
    const onC = (snap) => {
      if (snap.key === this.selfId) return;
      this.creatures.set(snap.key, snap.val());
      this.emit('creature', snap.key, snap.val());
    };
    this.unsubs.push(db.onChildAdded(cRef, onC));
    this.unsubs.push(db.onChildChanged(cRef, onC));
    this.unsubs.push(db.onChildRemoved(cRef, (snap) => {
      this.creatures.delete(snap.key);
      this.emit('creature', snap.key, null);
    }));
    const t0 = Date.now();
    this.unsubs.push(db.onChildChanged(ref(`${this.base}/pings`), (snap) => { if (snap.key !== this.selfId) this.emit('ping', snap.key); }));
    this.unsubs.push(db.onChildAdded(ref(`${this.base}/pings`), (snap) => {
      if (snap.key !== this.selfId && Date.now() - t0 > 1500) this.emit('ping', snap.key);
    }));
    this.unsubs.push(db.onValue(ref(`${this.base}/meta/state`), (snap) => { if (snap.val() === 'started') this.emit('start'); }));
    return this;
  }

  setState(patch) {
    Object.assign(this.state, patch);
    this.fb.db.update(this.fb.ref(`${this.base}/players/${this.selfId}`), patch).catch((e) => this.emit('closed', e.message));
  }

  publishCreature(json) {
    this.fb.db.set(this.fb.ref(`${this.base}/creatures/${this.selfId}`), json).catch((e) => console.warn('[room] creature sync failed', e.message));
  }

  ping() {
    this.fb.db.set(this.fb.ref(`${this.base}/pings/${this.selfId}`), this.fb.db.serverTimestamp()).catch(() => {});
  }

  start() {
    this.fb.db.set(this.fb.ref(`${this.base}/meta/state`), 'started').catch(() => {});
  }

  unstart() {
    this.fb.db.set(this.fb.ref(`${this.base}/meta/state`), 'garage').catch(() => {});
  }

  leave() {
    if (this.closed) return;
    this.closed = true;
    for (const u of this.unsubs) u();
    const { db, ref } = this.fb;
    db.remove(ref(`${this.base}/players/${this.selfId}`)).catch(() => {});
    db.remove(ref(`${this.base}/creatures/${this.selfId}`)).catch(() => {});
    db.remove(ref(`${this.base}/slots/s${this.state.slot}`)).catch(() => {});
  }
}

export async function openRoom({ code, name, forceLocal }) {
  const create = !code;
  let reason = null;
  if (!forceLocal) {
    try {
      const fb = await getFirebase();
      for (let attempt = 0; attempt < 4; attempt++) {
        const c = code || makeCode();
        try {
          return await new FirebaseRoom(c, { name }, fb).open(create);
        } catch (e) {
          if (e.message === 'code-taken' && create) continue;
          throw e;
        }
      }
    } catch (e) {
      if (/full|not found/i.test(e.message)) throw e;
      reason = e.message;
      console.warn('[room] Firebase unavailable, using a local room:', reason);
    }
  }
  const room = await new LocalRoom(code || makeCode(), { name }).open();
  room.fallbackReason = reason;
  return room;
}
