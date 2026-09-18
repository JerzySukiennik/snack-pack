// In-game HUD: crosshair, money, clock, order tickets, prompts, customer bubbles,
// pay pop-ups and the end-of-day summary.

import { h } from '../ui/panels.js';

const HOTDOG = '<svg viewBox="0 0 48 28" width="40" height="24"><rect x="3" y="9" width="42" height="15" rx="7.5" fill="#e6a454"/><rect x="0" y="6" width="48" height="9" rx="4.5" fill="#a9522c"/>KETCHUP</svg>';
const ZIG = '<path d="M5 10 l5 -4 l5 4 l5 -4 l5 4 l5 -4 l5 4 l5 -4" fill="none" stroke="#d2201a" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>';
const icon = (ketchup) => HOTDOG.replace('KETCHUP', ketchup ? ZIG : '');

export class Hud {
  constructor(root) {
    this.root = root;
    root.replaceChildren();
    this.cross = h('div', { class: 'cross' });
    this.charge = h('div', { class: 'charge' }, h('i'));
    this.money = h('div', { class: 'stat money' }, '$0');
    this.clock = h('div', { class: 'stat clock' }, '5:00');
    this.tickets = h('div', { class: 'tickets' });
    this.prompt = h('div', { class: 'prompt' });
    this.mini = h('div', { class: 'minihelp hidden' });
    this.bubbles = h('div', { class: 'bubbles' });
    this.pops = h('div', { class: 'bubbles' });
    this.leave = h('button', { class: 'btn leave' }, 'Back to garage');
    this.lock = h('div', { class: 'lockhint' }, 'Click to play');
    this.summary = h('div', { class: 'summary off' });
    this.help = h('div', { class: 'help' },
      h('b', {}, 'How to make a hot dog'),
      h('span', {}, '1. Click the pink-lid crate for a sausage, put it on the grill (black bars) until it turns brown'),
      h('span', {}, '2. Click the cream-lid crate for a bun and put it down anywhere'),
      h('span', {}, '3. Hold the sausage, aim at the bun, click — then follow the mini-game'),
      h('span', {}, '4. Press E at the window to take an order, put the hot dog on the counter'),
      h('i', {}, 'H hides this · Space jumps · Q talks'));
    root.append(this.bubbles, this.pops, this.cross, this.charge, h('div', { class: 'topbar' }, this.money, this.clock), this.tickets, this.prompt, this.mini, this.lock, this.leave, this.help, this.summary);
    this.bubbleMap = new Map();
    this._tk = '';
  }

  toggleHelp() {
    this.help.classList.toggle('hidden');
  }

  setStats(g) {
    this.money.textContent = '$' + g[1];
    const s = g[0];
    this.clock.textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    this.clock.classList.toggle('late', s <= 30);
  }

  setTickets(tk) {
    const key = tk.map((t) => t[0] + ':' + Math.floor(t[2] / 5)).join(',');
    if (key === this._tk) return;
    this._tk = key;
    this.tickets.replaceChildren(...tk.map((t) => {
      const el = h('div', { class: 'ticket' + (t[2] > 40 ? ' old' : '') });
      el.innerHTML = icon(t[1]) + `<span>${t[1] ? 'with ketchup' : 'NO ketchup'}</span>`;
      return el;
    }));
  }

  setPrompt(lines) {
    const text = lines.filter(Boolean).join('   ·   ');
    if (this.prompt.textContent !== text) this.prompt.textContent = text;
    this.prompt.classList.toggle('on', !!text);
  }

  setMini(text) {
    this.mini.classList.toggle('hidden', !text);
    if (text) this.mini.textContent = text;
    this.cross.classList.toggle('hidden', !!text);
  }

  setCharge(v) {
    this.charge.classList.toggle('on', v > 0);
    this.charge.firstChild.style.width = Math.round(v * 100) + '%';
  }

  bubble(id, screen, c) {
    let b = this.bubbleMap.get(id);
    if (!screen) { if (b) { b.remove(); this.bubbleMap.delete(id); } return; }
    if (!b) {
      b = h('div', { class: 'bubble' });
      this.bubbles.append(b);
      this.bubbleMap.set(id, b);
    }
    const key = c.ketchup + ':' + c.taken + ':' + c.mood + ':' + c.state;
    if (b.dataset.k !== key) {
      b.dataset.k = key;
      b.className = 'bubble' + (c.taken ? ' taken' : '') + (c.state === 2 ? (c.mood < 0 ? ' angry' : ' happy') : '');
      b.innerHTML = c.state === 2 ? (c.mood < 0 ? '<b>Hmpf!</b>' : '<b>Yum!</b>') : icon(c.ketchup) + '<i></i>';
    }
    const bar = b.querySelector('i');
    if (bar) { bar.style.width = c.patience + '%'; bar.className = c.patience < 30 ? 'low' : ''; }
    b.style.left = screen.x + 'px';
    b.style.top = screen.y + 'px';
    b.style.display = screen.visible ? '' : 'none';
  }

  pruneBubbles(ids) {
    for (const [id, b] of this.bubbleMap) if (!ids.has(id)) { b.remove(); this.bubbleMap.delete(id); }
  }

  pop(screen, text, good) {
    if (!screen || !screen.visible) return;
    const el = h('div', { class: 'pop ' + (good ? 'good' : 'bad'), style: `left:${screen.x}px;top:${screen.y}px` }, text);
    this.pops.append(el);
    setTimeout(() => el.remove(), 1600);
  }

  showSummary(d, onLeave) {
    this.summary.replaceChildren(h('div', { class: 'card' },
      h('h1', {}, 'Closing time'),
      h('div', { class: 'stars' }, '★'.repeat(d.stars) + '☆'.repeat(Math.max(0, 3 - d.stars))),
      h('div', { class: 'sumgrid' },
        h('div', {}, h('b', {}, '$' + d.money), h('span', {}, 'earned')),
        h('div', {}, h('b', {}, String(d.served)), h('span', {}, 'served')),
        h('div', {}, h('b', {}, String(d.lost)), h('span', {}, 'walked away'))),
      h('button', { class: 'btn primary', onclick: onLeave }, 'Back to garage')));
    this.summary.classList.remove('off');
  }

  destroy() {
    this.root.replaceChildren();
  }
}
