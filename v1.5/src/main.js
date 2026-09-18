// Snack Pack v1 entry point: boots the garage, wires the creature editor, the shared
// room and the save slots together.

import * as THREE from 'three';
import { Stage, PODIUM_X, PODIUM_Y, PODIUM_Z, FLOOR } from './render/stage.js';
import { Library } from './creature/library.js';
import { Creature } from './creature/creature.js';
import { starterSpec, sanitizeSpec, canBeReady, cloneSpec } from './creature/spec.js';
import { Editor } from './editor/editor.js';
import { recordVoice, playVoice, audioContext } from './editor/voice.js';
import { renderBuild, renderInspector, renderPaint, renderVoice, renderWalk, h } from './ui/panels.js';
import { openRoom } from './net/room.js';
import { store, SLOTS } from './store.js';
import { World } from './game/visuals.js';
import { Game } from './game/game.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

const stage = new Stage($('view'));
const lib = new Library();
const remotes = new Map();
const keys = new Set();
const undo = [];

let me = null;
let editor = null;
let room = null;
let mode = 'build';
let category = 'body';
let slot = 0;
let ready = false;
let starting = false;
let recAbort = null;
let recButton = null;
let texDirty = false;
let game = null;
let lastGen = 0;
const world = new World();
let worldReady = null;

function toast(text, ms = 2200) {
  const t = $('toast');
  t.textContent = text;
  t.classList.add('on');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('on'), ms);
}

function cleanSpec() {
  const s = cloneSpec(me.spec);
  s.parts = s.parts.filter((p) => !p.id.startsWith('__'));
  return s;
}

function podium(i, out = new THREE.Vector3()) {
  return out.set(PODIUM_X[Math.max(0, i) % 4], PODIUM_Y, PODIUM_Z);
}

function bodyTop(c) {
  const box = c.bodyMesh.geometry.boundingBox;
  return (c.rideY + (box ? box.max.y : 0.5)) * c.spec.body.size;
}

function focusMe(instant) {
  const size = me.spec.body.size;
  const target = me.root.position.clone();
  target.y += me.rideY * size;
  stage.focus(target, mode === 'walk' ? 6.5 + size * 1.5 : 3.6 + size * 2.4, instant);
}

let publishTimer = 0;
let saveTimer = 0;
function changed(kind) {
  if (kind === 'select') return renderRight();
  if (kind === 'tex') texDirty = true;
  if (kind === 'spec') pushUndo();
  if (kind === 'drag') return;
  updateReadyUI();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persist, 700);
}

function persist() {
  if (texDirty) {
    me.spec.tex = me.exportTex();
    texDirty = false;
  }
  const spec = cleanSpec();
  store.save(slot, spec);
  clearTimeout(publishTimer);
  publishTimer = setTimeout(() => room && room.publishCreature(JSON.stringify(spec)), 150);
}

function pushUndo() {
  const s = cleanSpec();
  delete s.tex;
  delete s.voice;
  const json = JSON.stringify(s);
  if (undo[undo.length - 1] === json) return;
  undo.push(json);
  if (undo.length > 60) undo.shift();
}

function doUndo() {
  if (undo.length < 2) return;
  undo.pop();
  const s = JSON.parse(undo[undo.length - 1]);
  s.tex = me.spec.tex;
  s.voice = me.spec.voice;
  me.setSpec(s);
  editor.select(null);
  renderLeft();
  changed('restore');
}

function loadSpec(spec) {
  me.setSpec(sanitizeSpec(spec, lib));
  $('creatureName').value = me.spec.name;
  undo.length = 0;
  pushUndo();
  editor.select(null);
  renderLeft();
  focusMe();
  changed('restore');
}

function renderLeft() {
  const left = $('left');
  left.classList.toggle('off', false);
  if (mode === 'build') {
    renderBuild(left, {
      lib, spec: me.spec, category, pending: editor.pending,
      onCategory: (c) => { category = c; editor.cancelPending(); renderLeft(); },
      onPick: (kind) => {
        if (editor.pending === kind) editor.cancelPending();
        else editor.beginPlace(kind);
        renderLeft();
      },
      onBodyType: (type) => { me.spec.body.type = type; editor.commit(); renderLeft(); },
      onBodyParam: (k, v, done) => { me.spec.body[k] = v; editor.commit(done ? 'spec' : 'drag'); if (k === 'size') focusMe(); },
      onColor: (role, c, done) => { me.spec.colors[role] = c; me.recolor(); changed(done ? 'spec' : 'drag'); },
    });
  } else if (mode === 'paint') {
    renderPaint(left, editor.brush, { onBrush: () => {}, onClear: () => editor.clearPaint() });
  } else if (mode === 'voice') {
    recButton = renderVoice(left, { has: !!me.spec.voice, pitch: me.spec.pitch }, {
      onRecord: toggleRecord,
      onPlay: talk,
      onPitch: (v, done) => { me.spec.pitch = v; if (done) { talk(); changed('spec'); } },
      onDelete: () => { me.spec.voice = null; renderLeft(); changed('spec'); },
    });
  } else renderWalk(left);
}

function renderRight() {
  const right = $('right');
  const part = editor && mode === 'build' ? editor.selected() : null;
  right.classList.toggle('off', !part);
  if (!part) return;
  const def = lib.parts.get(part.kind === 'limb' ? part.end : part.kind);
  renderInspector(right, part, def, {
    onParam: (k, v, done) => { part[k] = v; editor.commit(done ? 'spec' : 'drag'); },
    onDuplicate: () => editor.duplicateSelected(),
    onDelete: () => editor.removeSelected(),
  });
}

function setMode(next) {
  if (recAbort) recAbort.abort();
  mode = next;
  for (const b of $('tabs').children) b.classList.toggle('on', b.dataset.mode === next);
  editor.setMode(next);
  const p = podium(room ? room.state.slot : 0);
  if (next === 'walk') {
    me.root.position.set(p.x, 0, 3);
    stage.controls.maxPolarAngle = Math.PI * 0.49;
  } else {
    me.root.position.copy(p);
    me.root.rotation.y = 0;
    stage.controls.maxPolarAngle = Math.PI * 0.54;
  }
  me._resetFeet();
  renderLeft();
  renderRight();
  focusMe();
}

async function toggleRecord() {
  if (recAbort) return recAbort.abort();
  recAbort = new AbortController();
  const ring = recButton.querySelector('circle');
  const dot = recButton.querySelector('.dot');
  recButton.classList.add('live');
  try {
    const url = await recordVoice((level, t) => {
      ring.style.strokeDashoffset = String(327 * (1 - Math.min(t, 1)));
      dot.style.transform = `scale(${1 + level * 0.9})`;
    }, recAbort.signal);
    me.spec.voice = url;
    changed('spec');
    talk();
  } catch (e) {
    toast(e.message === 'silent' ? 'Heard nothing. Try again, louder.' : e.name === 'NotAllowedError' ? 'Microphone access was blocked.' : 'Recording failed: ' + e.message, 3200);
  }
  recAbort = null;
  if (mode === 'voice') renderLeft();
}

function talk() {
  me.talk();
  if (me.spec.voice) playVoice(me.spec.voice, me.spec.pitch);
  if (room) room.ping();
}

function updateReadyUI() {
  const ok = canBeReady(me.spec);
  const btn = $('ready');
  btn.disabled = !ok && !ready;
  btn.classList.toggle('on', ready);
  btn.textContent = ready ? 'Ready!' : 'Ready';
  const hint = $('readyHint');
  hint.classList.toggle('hidden', ok);
  hint.textContent = 'Your creature needs an arm, a beak or a trunk to grab things.';
  if (!ok && ready) setReady(false);
}

function setReady(v) {
  ready = v;
  if (v) persist();
  if (room) room.setState({ ready: v });
  updateReadyUI();
}

function syncPlayers() {
  const list = $('playerList');
  list.replaceChildren();
  const sorted = [...room.players.entries()].sort((a, b) => a[1].slot - b[1].slot);
  for (const [id, p] of sorted) {
    list.append(h('li', { class: p.ready ? 'rdy' : '' }, h('i'), (p.name || 'Player') + (id === room.selfId ? ' (you)' : '')));
    if (id === room.selfId) continue;
    let r = remotes.get(id);
    if (!r) {
      const raw = room.creatures.get(id);
      r = { creature: new Creature(lib, sanitizeSpec(raw ? JSON.parse(raw) : starterSpec(), lib)), tag: h('div', { class: 'tag' }) };
      stage.scene.add(r.creature.root);
      $('labels').append(r.tag);
      remotes.set(id, r);
    }
    if (!game) {
      r.creature.root.position.copy(podium(p.slot));
      r.creature.root.rotation.y = 0;
      r.creature._resetFeet();
    }
    r.tag.textContent = p.name || 'Player';
    r.tag.classList.toggle('rdy', !!p.ready);
  }
  for (const [id, r] of remotes) {
    if (room.players.has(id)) continue;
    stage.scene.remove(r.creature.root);
    r.creature.dispose();
    r.tag.remove();
    remotes.delete(id);
  }
  const all = sorted.length > 0 && sorted.every(([, p]) => p.ready);
  if (all && !starting && !game && sorted[0][0] === room.selfId) {
    setTimeout(() => {
      const still = [...room.players.values()].every((p) => p.ready);
      if (still && !starting && !game) room.start({ host: room.selfId, gen: Date.now() });
    }, 900);
  }
}

function onRemoteCreature(id, json) {
  const r = remotes.get(id);
  if (!r || !json) return;
  try {
    r.creature.setSpec(sanitizeSpec(JSON.parse(json), lib));
  } catch (e) {
    console.warn('[room] bad creature payload from', id);
  }
}

const GARAGE_UI = ['tabs', 'dock', 'roomchip', 'left', 'right', 'readyHint'];

function runStart(info) {
  if (starting || game || !info || info.gen === lastGen) return;
  lastGen = info.gen;
  if (Math.abs(Date.now() - info.gen) > 120000) {
    if (info.host === room.selfId && room.unstart) room.unstart();
    return;
  }
  starting = true;
  if (mode !== 'build') setMode('build');
  editor.enabled = false;
  editor.select(null);
  const door = stage.garage.getObjectByName('garage_door');
  const glow = new THREE.PointLight('#fff2d0', 0, 22, 1.4);
  glow.position.set(0, 2.2, -3.6);
  stage.garageGroup.add(glow);
  stage.focus(new THREE.Vector3(0, 1.6, 0), 13);
  for (const r of [me, ...[...remotes.values()].map((x) => x.creature)]) r.talk();
  const t0 = performance.now();
  const anim = () => {
    const t = Math.min((performance.now() - t0) / 1800, 1);
    const e = t * t * (3 - 2 * t);
    door.position.y = e * 4.1;
    glow.intensity = e * 28;
    if (t < 1) return requestAnimationFrame(anim);
    stage.garageGroup.remove(glow);
    enterTruck(info);
  };
  anim();
}

async function enterTruck(info) {
  const fade = $('fade');
  fade.classList.add('on');
  await new Promise((r) => setTimeout(r, 450));
  try {
    await worldReady;
    for (const id of GARAGE_UI) $(id).classList.add('hidden');
    game = new Game({ stage, world, room, me, remotes, hostId: info.host, gen: info.gen, onExit: leaveTruck });
    await game.start();
  } catch (e) {
    console.error(e);
    toast('Could not start the shift: ' + e.message, 5000);
    if (game) leaveTruck('error');
    else { for (const id of GARAGE_UI) $(id).classList.remove('hidden'); backToGarage(); }
  }
  fade.classList.remove('on');
}

function backToGarage() {
  starting = false;
  editor.enabled = true;
  stage.garage.getObjectByName('garage_door').position.y = 0;
  me.root.position.copy(podium(room.state.slot));
  me.root.rotation.y = 0;
  me._resetFeet();
  setReady(false);
  syncPlayers();
  renderLeft();
  renderRight();
  focusMe(true);
}

function leaveTruck(reason) {
  if (!game) return;
  const wasHost = game.isHost;
  game.stop();
  game = null;
  for (const id of GARAGE_UI) $(id).classList.remove('hidden');
  if (wasHost && room.unstart) room.unstart();
  backToGarage();
  if (reason === 'host-left') toast('The host closed the truck.', 4000);
}

function renderSlots() {
  const grid = $('slotGrid');
  grid.replaceChildren();
  store.slots().forEach((entry, i) => {
    const name = entry ? entry.spec.name || 'Unnamed' : 'Empty';
    const sub = entry ? new Date(entry.t).toLocaleDateString() + ' · ' + entry.spec.parts.length + ' parts' : 'Start a new creature';
    grid.append(h('button', { class: 'slot' + (i === slot ? ' on' : ''), onclick: () => {
      if (i === slot) return;
      persist();
      slot = i;
      store.setProfile({ slot });
      loadSpec(entry ? entry.spec : starterSpec());
      renderSlots();
    } }, h('b', {}, name), h('span', {}, sub)));
  });
}

async function enter(code) {
  const name = $('nick').value.trim() || 'Player';
  store.setProfile({ name });
  $('startErr').textContent = 'Opening the garage…';
  $('create').disabled = $('join').disabled = true;
  try {
    room = await openRoom({ code, name, forceLocal: params.get('net') === 'local' });
  } catch (e) {
    $('startErr').textContent = e.message;
    $('create').disabled = $('join').disabled = false;
    return;
  }
  audioContext();
  history.replaceState(null, '', `?room=${room.code}${params.get('net') === 'local' ? '&net=local' : ''}`);
  $('roomCode').textContent = room.code;
  $('netNote').textContent = room.backend === 'local' ? 'Offline room: this browser only' : '';
  room.on('players', syncPlayers);
  room.on('creature', onRemoteCreature);
  room.on('ping', (id) => {
    const r = remotes.get(id);
    if (!r) return;
    r.creature.talk();
    if (r.creature.spec.voice) playVoice(r.creature.spec.voice, r.creature.spec.pitch, 0.8);
  });
  room.on('start', runStart);
  me.root.position.copy(podium(room.state.slot));
  me._resetFeet();
  room.publishCreature(JSON.stringify(cleanSpec()));
  syncPlayers();
  for (const [id, json] of room.creatures) onRemoteCreature(id, json);
  $('start').classList.add('off');
  for (const id of ['tabs', 'dock', 'roomchip']) $(id).classList.remove('hidden');
  renderLeft();
  updateReadyUI();
  focusMe();
}

function bindUI() {
  for (const b of $('tabs').children) b.addEventListener('click', () => setMode(b.dataset.mode));
  $('ready').addEventListener('click', () => setReady(!ready));
  $('creatureName').addEventListener('input', (e) => { me.spec.name = e.target.value; changed('name'); });
  $('create').addEventListener('click', () => enter(null));
  $('join').addEventListener('click', () => {
    const code = $('joinCode').value.trim().toUpperCase();
    if (code.length === 4) enter(code);
    else $('startErr').textContent = 'Room codes have four letters.';
  });
  $('joinCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('join').click(); });
  $('copyLink').addEventListener('click', async () => {
    const url = `${location.origin}${location.pathname}?room=${room.code}`;
    try { await navigator.clipboard.writeText(url); toast('Invite link copied'); } catch { toast(url, 5000); }
  });
  $('openSlots').addEventListener('click', () => { renderSlots(); $('slots').classList.remove('off'); editor.enabled = false; });
  $('slotsClose').addEventListener('click', () => { $('slots').classList.add('off'); editor.enabled = true; });
  $('slotDelete').addEventListener('click', () => { store.remove(slot); loadSpec(starterSpec()); renderSlots(); });
  $('shareBtn').addEventListener('click', async () => {
    try {
      persist();
      const code = await store.share(cleanSpec());
      $('shareCode').value = code;
      toast('Creature code: ' + code, 4000);
    } catch (e) { toast('Sharing needs an internet connection.'); }
  });
  $('importBtn').addEventListener('click', async () => {
    try {
      loadSpec(await store.importShared($('shareCode').value));
      toast('Creature imported');
    } catch (e) { toast(e.message || 'Import failed'); }
  });
  window.addEventListener('keydown', (e) => {
    if (/INPUT|TEXTAREA/.test(e.target.tagName) && e.target.type !== 'range') return;
    if (!room) return;
    const k = e.key.toLowerCase();
    if (game || starting) { if (k === 'q' && !e.repeat && game) talk(); return; }
    if ((e.metaKey || e.ctrlKey) && k === 'z') { e.preventDefault(); return doUndo(); }
    if (e.metaKey || e.ctrlKey) return;
    keys.add(k);
    if (k === 'q' && !e.repeat) talk();
  });
  window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  window.addEventListener('blur', () => keys.clear());
  window.addEventListener('pagehide', () => { if (me) persist(); if (game && game.isHost && room.unstart) room.unstart(); if (room) room.leave(); });
}

const fwd = new THREE.Vector3();
const side = new THREE.Vector3();
const move = new THREE.Vector3();
function walk(dt) {
  const x = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0);
  const z = (keys.has('w') || keys.has('arrowup') ? 1 : 0) - (keys.has('s') || keys.has('arrowdown') ? 1 : 0);
  const before = me.root.position.clone();
  if (x || z) {
    stage.camera.getWorldDirection(fwd).setY(0).normalize();
    side.set(-fwd.z, 0, fwd.x);
    move.set(0, 0, 0).addScaledVector(fwd, z).addScaledVector(side, x).normalize();
    const speed = (keys.has('shift') ? 3.6 : 2.0) * Math.sqrt(me.spec.body.size);
    me.root.position.addScaledVector(move, speed * dt);
    me.root.position.x = THREE.MathUtils.clamp(me.root.position.x, FLOOR.minX, FLOOR.maxX);
    me.root.position.z = THREE.MathUtils.clamp(me.root.position.z, FLOOR.minZ + 3.2, FLOOR.maxZ);
    const yaw = Math.atan2(move.x, move.z);
    let d = yaw - me.root.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    me.root.rotation.y += d * (1 - Math.exp(-dt * 10));
  }
  const delta = me.root.position.clone().sub(before);
  stage.controls.target.add(delta);
  stage.camera.position.add(delta);
}

const proj = new THREE.Vector3();
function placeTag(tag, c) {
  proj.copy(c.root.position);
  proj.y += bodyTop(c) + 0.35;
  proj.project(stage.camera);
  const vis = proj.z < 1;
  tag.style.display = vis ? '' : 'none';
  tag.style.left = ((proj.x + 1) / 2) * window.innerWidth + 'px';
  tag.style.top = ((1 - proj.y) / 2) * window.innerHeight + 'px';
}

let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  if (me) {
    if (game) game.update(dt);
    else if (mode === 'walk' && !starting) walk(dt);
    me.update(dt);
    for (const r of remotes.values()) {
      r.creature.update(dt);
      placeTag(r.tag, r.creature);
    }
  }
  stage.render(dt);
  requestAnimationFrame(frame);
}

async function boot() {
  bindUI();
  requestAnimationFrame(frame);
  const profile = store.profile();
  $('nick').value = profile.name;
  if (params.get('room')) $('joinCode').value = params.get('room').toUpperCase().slice(0, 4);
  await Promise.all([lib.load(), stage.loadGarage()]);
  await lib.renderThumbs(starterSpec().colors);
  worldReady = world.load();
  worldReady.catch((e) => console.error('[world]', e));
  store.pull().then((changedCloud) => { if (changedCloud && !$('slots').classList.contains('off')) renderSlots(); });
  slot = Math.min(profile.slot, SLOTS - 1);
  const saved = store.slots()[slot];
  me = new Creature(lib, sanitizeSpec(saved ? saved.spec : starterSpec(), lib));
  me.root.position.copy(podium(1));
  stage.scene.add(me.root);
  editor = new Editor(stage, me, changed);
  editor.enabled = true;
  $('creatureName').value = me.spec.name;
  pushUndo();
  focusMe(true);
  $('startErr').textContent = '';
  $('create').disabled = $('join').disabled = false;
  window.SNACK = { stage, lib, me, editor, world, get room() { return room; }, get game() { return game; }, remotes };
  if (params.get('room') && profile.name) enter(params.get('room').toUpperCase().slice(0, 4));
}

boot().catch((e) => {
  console.error(e);
  $('startErr').textContent = 'Could not start: ' + e.message;
});
