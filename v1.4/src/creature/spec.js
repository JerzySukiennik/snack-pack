// Creature spec: the single serialisable description of a creature. Everything
// (editor, remote display, save slots, network) speaks this format.

export const SPEC_VERSION = 1;

export const BODY_TYPES = ['bean', 'pear', 'egg', 'sausage', 'ball', 'chonk'];

export const BODY_RANGES = {
  size: [0.4, 4, 1],
  length: [0.5, 3, 1.2],
  width: [0.4, 2.5, 1],
  height: [0.4, 2.5, 1],
  taper: [-1, 1, 0],
  bend: [-1.6, 1.6, 0],
  pitch: [0, 1.57, 0],
};

export const PART_RANGES = {
  scale: [0.3, 5, 1],
  twist: [-3.1416, 3.1416, 0],
  len: [0.2, 3, 0.7],
  thick: [0.025, 0.3, 0.07],
};

export const LIMITS = { parts: 80, texChars: 700000, voiceChars: 140000, nameChars: 20 };

let counter = 0;
export function newId() {
  counter += 1;
  return Date.now().toString(36) + counter.toString(36) + Math.floor(Math.random() * 1296).toString(36);
}

export function defaultSpec() {
  const body = { type: 'bean' };
  for (const k in BODY_RANGES) body[k] = BODY_RANGES[k][2];
  return {
    v: SPEC_VERSION,
    name: '',
    body,
    colors: { primary: '#f2a25c', secondary: '#fde7c4', accent: '#f4685c' },
    parts: [],
    tex: null,
    voice: null,
    pitch: 1,
  };
}

export function starterSpec() {
  const s = defaultSpec();
  const add = (kind, p, extra) => s.parts.push({ id: newId(), kind, p, scale: 1, twist: 0, mirror: true, ...extra });
  add('eye_round', [0.2, 0.34, 0.92]);
  add('mouth_smile', [0, 0.02, 1], { mirror: false });
  add('ear_bear', [0.45, 0.85, 0.35]);
  add('limb', [0.45, -0.75, 0.5], { end: 'foot_paw', len: 0.55, thick: 0.08 });
  add('limb', [0.45, -0.75, -0.5], { end: 'foot_paw', len: 0.55, thick: 0.08 });
  add('limb', [0.9, -0.05, 0.55], { end: 'hand_mitten', len: 0.6, thick: 0.06 });
  add('tail_stub', [0, 0.25, -1], { mirror: false });
  return s;
}

const clamp = (v, r) => Math.min(r[1], Math.max(r[0], Number.isFinite(+v) ? +v : r[2]));
const isHex = (c) => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c);

export function sanitizeSpec(raw, catalog) {
  const d = defaultSpec();
  if (!raw || typeof raw !== 'object') return d;
  d.name = String(raw.name || '').slice(0, LIMITS.nameChars);
  const b = raw.body || {};
  d.body.type = BODY_TYPES.includes(b.type) ? b.type : 'bean';
  for (const k in BODY_RANGES) d.body[k] = clamp(b[k], BODY_RANGES[k]);
  for (const k of ['primary', 'secondary', 'accent']) if (raw.colors && isHex(raw.colors[k])) d.colors[k] = raw.colors[k];
  const parts = Array.isArray(raw.parts) ? raw.parts.slice(0, LIMITS.parts) : [];
  for (const p of parts) {
    if (!p || !Array.isArray(p.p) || p.p.length !== 3) continue;
    const isLimb = p.kind === 'limb';
    const kind = isLimb ? p.end : p.kind;
    if (catalog && !catalog.has(kind)) continue;
    const len = Math.hypot(p.p[0], p.p[1], p.p[2]) || 1;
    const out = {
      id: String(p.id || newId()).slice(0, 24),
      kind: isLimb ? 'limb' : kind,
      p: [p.p[0] / len, p.p[1] / len, p.p[2] / len],
      scale: clamp(p.scale, PART_RANGES.scale),
      twist: clamp(p.twist, PART_RANGES.twist),
      mirror: p.mirror !== false,
    };
    if (isLimb) {
      out.end = kind;
      out.len = clamp(p.len, PART_RANGES.len);
      out.thick = clamp(p.thick, PART_RANGES.thick);
    }
    if (p.colors && typeof p.colors === 'object') {
      out.colors = {};
      for (const k of ['primary', 'secondary', 'accent']) if (isHex(p.colors[k])) out.colors[k] = p.colors[k];
    }
    d.parts.push(out);
  }
  if (typeof raw.tex === 'string' && raw.tex.startsWith('data:image/') && raw.tex.length < LIMITS.texChars) d.tex = raw.tex;
  if (typeof raw.voice === 'string' && raw.voice.startsWith('data:audio/wav') && raw.voice.length < LIMITS.voiceChars) d.voice = raw.voice;
  d.pitch = clamp(raw.pitch, [0.4, 2.5, 1]);
  return d;
}

export function isGrasper(part) {
  if (part.kind === 'limb') return part.end.startsWith('hand_');
  return part.kind === 'mouth_beak' || part.kind === 'mouth_trunk';
}

export function canBeReady(spec) {
  return spec.parts.some(isGrasper);
}

export function cloneSpec(spec) {
  return JSON.parse(JSON.stringify(spec));
}
