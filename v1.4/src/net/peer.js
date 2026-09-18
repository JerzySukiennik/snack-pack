// Game links between the host and its clients. One contract, two backends:
// WebRTC DataChannels signalled over the room's RTDB branch, or BroadcastChannel
// for same-browser rooms.
//
// link: { id, send(obj, reliable = true), onmessage(obj), onclose(), close(), open }
// hostLinks(room, gen, onLink) -> { close() }      joinHost(room, hostId, gen) -> Promise<link>

const ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];

function gathered(pc, ms = 3500) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    pc.addEventListener('icegatheringstatechange', () => {
      if (pc.iceGatheringState === 'complete') { clearTimeout(t); resolve(); }
    });
  });
}

function rtcLink(id, pc) {
  const link = { id, open: false, onmessage: null, onclose: null, act: null, state: null, _closed: false };
  const recv = (e) => {
    if (typeof e.data !== 'string' || e.data.length > 200000) return;
    try { link.onmessage && link.onmessage(JSON.parse(e.data)); } catch (err) { console.warn('[peer] bad message', err.message); }
  };
  link.attach = (ch) => {
    if (ch.label === 'act') link.act = ch; else link.state = ch;
    ch.onmessage = recv;
    const opened = () => {
      if (link.act && link.act.readyState === 'open' && !link.open) { link.open = true; link.onopen && link.onopen(); }
    };
    ch.onopen = opened;
    ch.onclose = () => link.close();
    opened();
  };
  link.send = (obj, reliable = true) => {
    const ch = reliable || !link.state || link.state.readyState !== 'open' ? link.act : link.state;
    if (!ch || ch.readyState !== 'open') return;
    if (!reliable && ch.bufferedAmount > 262144) return;
    try { ch.send(JSON.stringify(obj)); } catch (err) { console.warn('[peer] send failed', err.message); }
  };
  link.close = () => {
    if (link._closed) return;
    link._closed = true;
    link.open = false;
    try { pc.close(); } catch (e) { /* already closed */ }
    link.onclose && link.onclose();
  };
  pc.addEventListener('connectionstatechange', () => {
    if (pc.connectionState === 'failed' || pc.connectionState === 'closed') link.close();
  });
  return link;
}

function whenOpen(link, ms) {
  return new Promise((resolve, reject) => {
    if (link.open) return resolve(link);
    const t = setTimeout(() => { link.close(); reject(new Error('Could not reach the host (connection timed out)')); }, ms);
    link.onopen = () => { clearTimeout(t); resolve(link); };
  });
}

function localLink(ch, selfId, otherId) {
  const link = { id: otherId, open: true, onmessage: null, onclose: null };
  link.send = (obj) => { if (link.open) ch.postMessage({ to: otherId, from: selfId, d: obj }); };
  link.close = () => { if (!link.open) return; link.open = false; ch.postMessage({ to: otherId, from: selfId, bye: 1 }); link.onclose && link.onclose(); };
  return link;
}

export function hostLinks(room, gen, onLink) {
  if (room.backend === 'local') {
    const ch = new BroadcastChannel(`snackpack-game-${room.code}-${gen}`);
    const links = new Map();
    ch.onmessage = (e) => {
      const m = e.data;
      if (!m || m.to !== room.selfId) return;
      let link = links.get(m.from);
      if (m.hello && !link) {
        link = localLink(ch, room.selfId, m.from);
        links.set(m.from, link);
        onLink(link);
        ch.postMessage({ to: m.from, from: room.selfId, welcome: 1 });
      } else if (link && m.bye) { link.open = false; links.delete(m.from); link.onclose && link.onclose(); }
      else if (link && m.d) link.onmessage && link.onmessage(m.d);
    };
    return { close: () => { for (const l of links.values()) l.close(); ch.close(); } };
  }
  const { db, ref } = room.fb;
  const base = `rooms/${room.code}/rtc`;
  const seen = new Set();
  const links = [];
  const handle = async (snap) => {
    const v = snap.val();
    const id = snap.key;
    if (!v || v.gen !== gen || !v.offer || v.answer || seen.has(id) || id === room.selfId) return;
    seen.add(id);
    try {
      const pc = new RTCPeerConnection({ iceServers: ICE });
      const link = rtcLink(id, pc);
      links.push(link);
      pc.ondatachannel = (e) => link.attach(e.channel);
      await pc.setRemoteDescription({ type: 'offer', sdp: v.offer });
      await pc.setLocalDescription(await pc.createAnswer());
      await gathered(pc);
      await db.update(ref(`${base}/${id}`), { answer: pc.localDescription.sdp });
      whenOpen(link, 20000).then(() => onLink(link), (err) => console.warn('[peer]', id, err.message));
    } catch (err) {
      console.warn('[peer] answer failed', err.message);
      seen.delete(id);
    }
  };
  const unsubs = [db.onChildAdded(ref(base), handle), db.onChildChanged(ref(base), handle)];
  return { close: () => { for (const u of unsubs) u(); for (const l of links) l.close(); db.remove(ref(base)).catch(() => {}); } };
}

export async function joinHost(room, hostId, gen) {
  if (room.backend === 'local') {
    const ch = new BroadcastChannel(`snackpack-game-${room.code}-${gen}`);
    const link = localLink(ch, room.selfId, hostId);
    const origClose = link.close;
    link.close = () => { origClose(); ch.close(); };
    await new Promise((resolve, reject) => {
      let tries = 0;
      const hello = () => ch.postMessage({ to: hostId, from: room.selfId, hello: 1 });
      const timer = setInterval(() => { if (++tries > 40) { clearInterval(timer); reject(new Error('Host did not answer')); } else hello(); }, 250);
      ch.onmessage = (e) => {
        const m = e.data;
        if (!m || m.to !== room.selfId || m.from !== hostId) return;
        if (m.welcome) { clearInterval(timer); resolve(); }
        else if (m.bye) { link.open = false; link.onclose && link.onclose(); }
        else if (m.d) link.onmessage && link.onmessage(m.d);
      };
      hello();
    });
    return link;
  }
  const { db, ref } = room.fb;
  const path = `rooms/${room.code}/rtc/${room.selfId}`;
  const pc = new RTCPeerConnection({ iceServers: ICE });
  const link = rtcLink(hostId, pc);
  link.attach(pc.createDataChannel('act'));
  link.attach(pc.createDataChannel('state', { ordered: false, maxRetransmits: 0 }));
  await pc.setLocalDescription(await pc.createOffer());
  await gathered(pc);
  await new Promise((r) => setTimeout(r, 400));
  await db.set(ref(path), { gen, offer: pc.localDescription.sdp });
  const unsub = db.onValue(ref(`${path}/answer`), (snap) => {
    if (!snap.val() || pc.currentRemoteDescription) return;
    pc.setRemoteDescription({ type: 'answer', sdp: snap.val() }).catch((err) => console.warn('[peer] bad answer', err.message));
  });
  try {
    await whenOpen(link, 25000);
  } finally {
    unsub();
  }
  return link;
}
