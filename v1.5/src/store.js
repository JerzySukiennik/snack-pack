// Creature save slots. localStorage is always written; the cloud copy (Firebase,
// anonymous account) is best-effort and wins on load when it is newer.

import { getFirebase } from './net/firebase.js';

const KEY = 'snackpack.v1';
export const SLOTS = 6;

function read() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    return {};
  }
}

function write(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch (e) {
    console.warn('[store] local save failed', e.message);
  }
}

export const store = {
  cloud: 'idle',

  profile() {
    const d = read();
    return { name: d.name || '', slot: d.slot || 0 };
  },

  setProfile(patch) {
    write({ ...read(), ...patch });
    if (patch.name !== undefined) this._cloud((fb) => fb.db.set(fb.ref(`users/${fb.uid}/name`), patch.name));
  },

  slots() {
    const d = read();
    return Array.from({ length: SLOTS }, (_, i) => (d.creatures && d.creatures[i]) || null);
  },

  save(slot, spec) {
    const d = read();
    d.creatures = d.creatures || {};
    const entry = { t: Date.now(), spec };
    d.creatures[slot] = entry;
    d.slot = slot;
    write(d);
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this._cloud((fb) => fb.db.set(fb.ref(`users/${fb.uid}/creatures/s${slot}`), { t: entry.t, json: JSON.stringify(spec) })), 2500);
  },

  remove(slot) {
    const d = read();
    if (d.creatures) delete d.creatures[slot];
    write(d);
    this._cloud((fb) => fb.db.remove(fb.ref(`users/${fb.uid}/creatures/s${slot}`)));
  },

  async pull() {
    try {
      const fb = await getFirebase();
      const snap = await fb.db.get(fb.ref(`users/${fb.uid}/creatures`));
      const val = snap.val() || {};
      const d = read();
      d.creatures = d.creatures || {};
      let changed = false;
      for (const k in val) {
        const i = +k.slice(1);
        if (!d.creatures[i] || d.creatures[i].t < val[k].t) {
          d.creatures[i] = { t: val[k].t, spec: JSON.parse(val[k].json) };
          changed = true;
        }
      }
      if (changed) write(d);
      this.cloud = 'ok';
      return changed;
    } catch (e) {
      this.cloud = 'off';
      return false;
    }
  },

  async _cloud(fn) {
    try {
      await fn(await getFirebase());
      this.cloud = 'ok';
    } catch (e) {
      this.cloud = 'off';
    }
    if (this.onCloud) this.onCloud(this.cloud);
  },

  async share(spec) {
    const fb = await getFirebase();
    const code = Math.random().toString(36).slice(2, 8).toUpperCase();
    await fb.db.set(fb.ref(`shared/${code}`), { owner: fb.uid, t: fb.db.serverTimestamp(), json: JSON.stringify(spec) });
    return code;
  },

  async importShared(code) {
    const fb = await getFirebase();
    const snap = await fb.db.get(fb.ref(`shared/${code.trim().toUpperCase()}`));
    if (!snap.exists()) throw new Error('No creature with that code');
    return JSON.parse(snap.val().json);
  },
};
