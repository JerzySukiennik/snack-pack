// Side panel renderers. Panels are rebuilt on mode, category or selection changes only;
// sliders mutate the spec through callbacks so a drag never destroys its own input.

import { CATEGORIES } from '../creature/library.js';
import { BODY_RANGES, BODY_TYPES, PART_RANGES } from '../creature/spec.js';

export const SWATCHES = ['#3b2a2a', '#ffffff', '#f4685c', '#f2a25c', '#ffc64a', '#fde7c4', '#8fd36b', '#3fa37a', '#57c4d8', '#4a78d6', '#8a62d9', '#f78fc0', '#a9744f', '#8d8f98'];

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const k in attrs) {
    const v = attrs[k];
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
  return el;
}

function slider(label, range, value, onInput, onDone) {
  const input = h('input', { type: 'range', min: range[0], max: range[1], step: (range[1] - range[0]) / 200, value });
  input.addEventListener('input', () => onInput(+input.value));
  if (onDone) input.addEventListener('change', () => onDone(+input.value));
  return h('div', { class: 'row' }, h('span', {}, label), input);
}

function toggle(label, value, onChange) {
  const sw = h('button', { class: 'switch' + (value ? ' on' : ''), 'aria-label': label });
  sw.addEventListener('click', () => {
    value = !value;
    sw.classList.toggle('on', value);
    onChange(value);
  });
  return h('div', { class: 'toggle' }, h('span', {}, label), sw);
}

function swatches(current, onPick) {
  const wrap = h('div', { class: 'swatches' });
  const mark = (c) => { for (const b of wrap.querySelectorAll('button')) b.classList.toggle('on', b.dataset.c === c); };
  for (const c of SWATCHES) {
    wrap.append(h('button', { 'data-c': c, style: `background:${c}`, class: c === current ? 'on' : '', 'aria-label': c, onclick: () => { mark(c); onPick(c); } }));
  }
  const custom = h('input', { type: 'color', value: current, 'aria-label': 'Custom colour' });
  custom.addEventListener('input', () => { mark(null); onPick(custom.value); });
  wrap.append(custom);
  return wrap;
}

export function renderBuild(root, s) {
  root.replaceChildren();
  const chips = h('div', { class: 'chips' });
  for (const c of CATEGORIES) {
    chips.append(h('button', { class: c.id === s.category ? 'on' : '', onclick: () => s.onCategory(c.id) }, c.label));
  }
  root.append(chips);
  const grid = h('div', { class: 'grid' });
  if (s.category === 'body') {
    for (const type of BODY_TYPES) {
      grid.append(h('button', { class: 'tile' + (s.spec.body.type === type ? ' on' : ''), title: type, onclick: () => s.onBodyType(type) }, h('img', { src: s.lib.thumbs.get('body_' + type), alt: type })));
    }
    root.append(grid);
    root.append(h('h3', { style: 'margin-top:16px' }, 'Shape'));
    const labels = { size: 'Size', length: 'Length', width: 'Width', height: 'Height', taper: 'Taper', bend: 'Curl', pitch: 'Posture' };
    for (const k in labels) root.append(slider(labels[k], BODY_RANGES[k], s.spec.body[k], (v) => s.onBodyParam(k, v, false), (v) => s.onBodyParam(k, v, true)));
    root.append(h('h3', { style: 'margin-top:16px' }, 'Colours'));
    const colors = h('div', { class: 'colors3' });
    for (const [role, label] of [['primary', 'Main'], ['secondary', 'Detail'], ['accent', 'Accent']]) {
      const input = h('input', { type: 'color', value: s.spec.colors[role] });
      input.addEventListener('input', () => s.onColor(role, input.value, false));
      input.addEventListener('change', () => s.onColor(role, input.value, true));
      colors.append(h('label', {}, input, label));
    }
    root.append(colors);
    return;
  }
  for (const def of s.lib.byCategory(s.category)) {
    grid.append(h('button', { class: 'tile' + (s.pending === def.name ? ' on' : ''), title: def.label, onclick: () => s.onPick(def.name) }, h('img', { src: s.lib.thumbs.get(def.name), alt: def.label })));
  }
  root.append(grid);
  root.append(h('p', { class: 'hint' }, s.category === 'hand' || s.category === 'foot'
    ? 'Pick one, then click the body. Every crew member needs at least one arm to work the truck.'
    : 'Pick one, then click the body. Hold Shift to keep placing. Drag a part to slide it around.'));
}

export function renderInspector(root, part, def, s) {
  root.replaceChildren();
  root.append(h('h3', {}, (part.kind === 'limb' ? (part.end.startsWith('foot_') ? 'Leg · ' : 'Arm · ') : '') + def.label));
  root.append(slider('Size', PART_RANGES.scale, part.scale, (v) => s.onParam('scale', v, false), (v) => s.onParam('scale', v, true)));
  if (part.kind === 'limb') {
    root.append(slider('Length', PART_RANGES.len, part.len, (v) => s.onParam('len', v, false), (v) => s.onParam('len', v, true)));
    root.append(slider('Thickness', PART_RANGES.thick, part.thick, (v) => s.onParam('thick', v, false), (v) => s.onParam('thick', v, true)));
  } else {
    root.append(slider('Twist', PART_RANGES.twist, part.twist, (v) => s.onParam('twist', v, false), (v) => s.onParam('twist', v, true)));
  }
  root.append(toggle('Mirror', part.mirror, (v) => s.onParam('mirror', v, true)));
  root.append(h('div', { class: 'btnrow' },
    h('button', { class: 'btn', onclick: s.onDuplicate }, 'Duplicate'),
    h('button', { class: 'btn danger', onclick: s.onDelete }, 'Delete')));
}

export function renderPaint(root, brush, s) {
  root.replaceChildren();
  root.append(h('h3', {}, 'Brush'));
  root.append(swatches(brush.color, (c) => { brush.color = c; brush.erase = false; s.onBrush(); }));
  root.append(slider('Size', [0.008, 0.16], brush.size, (v) => { brush.size = v; }));
  root.append(toggle('Mirror strokes', brush.mirror, (v) => { brush.mirror = v; }));
  root.append(toggle('Eraser', brush.erase, (v) => { brush.erase = v; }));
  root.append(h('h3', { style: 'margin-top:16px' }, 'Clicking a part fills its'));
  const seg = h('div', { class: 'seg' });
  for (const [role, label] of [['primary', 'Main'], ['secondary', 'Detail'], ['accent', 'Accent']]) {
    seg.append(h('button', { class: brush.role === role ? 'on' : '', onclick: (e) => {
      brush.role = role;
      for (const b of seg.children) b.classList.toggle('on', b === e.currentTarget);
    } }, label));
  }
  root.append(seg);
  root.append(h('div', { class: 'btnrow' }, h('button', { class: 'btn danger', onclick: s.onClear }, 'Wipe paint')));
  root.append(h('p', { class: 'hint' }, 'Drag on the body to paint. Drag on empty space to turn the creature.'));
}

export function renderVoice(root, state, s) {
  root.replaceChildren();
  root.append(h('h3', {}, 'Voice'));
  const rec = h('button', { id: 'rec', 'aria-label': 'Record' });
  rec.innerHTML = '<svg viewBox="0 0 112 112"><circle cx="56" cy="56" r="52"/></svg><span class="dot"></span>';
  rec.addEventListener('click', s.onRecord);
  root.append(rec);
  root.append(h('p', { class: 'hint', style: 'text-align:center;margin:0 0 12px' }, state.has ? 'Press Q any time to make this noise.' : 'Record up to two seconds. Quack, honk, scream.'));
  root.append(slider('Pitch', [0.4, 2.5], state.pitch, (v) => s.onPitch(v, false), (v) => s.onPitch(v, true)));
  root.append(h('div', { class: 'btnrow' },
    h('button', { class: 'btn', disabled: !state.has, onclick: s.onPlay }, 'Play'),
    h('button', { class: 'btn danger', disabled: !state.has, onclick: s.onDelete }, 'Delete')));
  return rec;
}

export function renderWalk(root) {
  root.replaceChildren();
  root.append(h('h3', {}, 'Test walk'));
  root.append(h('p', { class: 'hint', style: 'margin:0' }, 'WASD or arrow keys to walk. Hold Shift to run. Q to talk. Drag to look around.'));
}
