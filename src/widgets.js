// Dashboard + container-card widgets. Everything is drawn with background-coloured spaces
// (no block/braille glyphs) so it renders identically in any terminal font.
import blessed from 'blessed';

export function human(bytes) {
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${u[i]}`;
}

function duration(sec) {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${d ? d + 'd ' : ''}${h}h ${m}m`;
}

const num = (v) => parseFloat(String(v).replace('%', '')) || 0;
const fit = (s, n) => {
  s = String(s ?? '');
  return s.length > n ? s.slice(0, Math.max(0, n - 1)) + '…' : s.padEnd(n);
};

export function makeTheme(C, A = { warn: 70, crit: 90 }) {
  const f = (color, s) => `{${color}-fg}${s}{/}`;
  const level = (p) => (p < A.warn ? C.green : p < A.crit ? C.yellow : C.red);

  /** Solid bar made of coloured spaces. */
  const bar = (pct, w, color) => {
    w = Math.max(1, w);
    let n = Math.round((Math.min(100, Math.max(0, pct)) / 100) * w);
    if (n === 0 && pct > 0) n = 1;
    return (n ? `{${color || level(pct)}-bg}${' '.repeat(n)}{/}` : '') + (w - n ? `{${C.track}-bg}${' '.repeat(w - n)}{/}` : '');
  };

  /** Multi-row column chart. Returns an array of `rows` strings, each `w` cells wide. */
  const chart = (data, w, rows, max, colorFor) => {
    const vals = data.slice(-w);
    const top = max || Math.max(1, ...vals);
    const out = [];
    for (let r = 0; r < rows; r++) {
      const need = rows - r; // a cell on this row is lit when the column height reaches it
      let s = ' '.repeat(Math.max(0, w - vals.length));
      let runColor = null;
      let run = '';
      const flush = () => {
        if (!run) return;
        s += runColor ? `{${runColor}-bg}${run}{/}` : run;
        run = '';
      };
      for (const v of vals) {
        const h = Math.ceil((v / top) * rows - 1e-9);
        const color = h >= need ? colorFor(v) : null;
        if (color !== runColor) { flush(); runColor = color; }
        run += ' ';
      }
      flush();
      out.push(s);
    }
    return out;
  };

  return { f, level, bar, chart };
}

const mkCard = (parent, C, opts) => blessed.box({
  parent, tags: true, border: 'line', padding: { left: 1, right: 1 },
  style: { fg: C.fg, bg: C.panel, border: { fg: C.muted }, label: { fg: C.accent } },
  ...opts,
});

export function createDashboard(parent, C, A) {
  const { f, level, bar, chart } = makeTheme(C, A);
  const tint = (card, color) => { card.style.border.fg = color; card.style.label.fg = color; };
  const root = blessed.box({ parent, top: 0, left: 0, width: '100%-2', height: '100%-2', hidden: true, style: { bg: C.panel } });

  const gaugeNames = ['CPU', 'RAM', 'SWAP', 'DISK /'];
  const gauges = gaugeNames.map((name, i) => mkCard(root, C, { top: 0, left: `${i * 25}%`, width: i === 3 ? '25%+1' : '25%', height: 5, label: ` ${name} ` }));
  const cpuHist = mkCard(root, C, { top: 5, left: 0, width: '33%', height: 9, label: ' CPU history ' });
  const ramHist = mkCard(root, C, { top: 5, left: '33%', width: '34%+1', height: 9, label: ' RAM history ' });
  const netHist = mkCard(root, C, { top: 5, left: '67%', width: '33%+1', height: 9, label: ' Network ' });
  const cores = mkCard(root, C, { top: 14, left: 0, bottom: 0, width: '40%', label: ' Cores ' });
  const top = mkCard(root, C, { top: 14, left: '40%', bottom: 0, width: '60%+1', label: ' Top containers (CPU) ' });

  const inner = (el) => Math.max(8, el.width - 4);

  function update({ monitor, containers }) {
    const s = monitor.snap;
    if (!s || s.cpu == null) {
      gauges[0].setContent('Collecting data...');
      return;
    }
    const data = [
      { pct: s.cpu, detail: `load ${s.load.map((x) => x.toFixed(2)).join(' ')}` },
      { pct: s.mem.pct, detail: `${human(s.mem.used)} / ${human(s.mem.total)}` },
      { pct: s.swap.pct, detail: s.swap.total ? `${human(s.swap.used)} / ${human(s.swap.total)}` : 'none' },
      { pct: s.disk.pct, detail: `${human(s.disk.used)} / ${human(s.disk.size)}` },
    ];
    data.forEach((d, i) => {
      const c = level(d.pct);
      tint(gauges[i], c === C.green ? C.muted : c);
      gauges[i].setContent(`{bold}${f(c, d.pct.toFixed(1) + '%')}{/bold}  ${f(C.muted, d.detail)}\n${bar(d.pct, inner(gauges[i]))}`);
    });

    tint(cpuHist, level(s.cpu) === C.green ? C.muted : level(s.cpu));
    tint(ramHist, level(s.mem.pct) === C.green ? C.muted : level(s.mem.pct));
    const hist = (card, series, color, max, label) => {
      const w = inner(card);
      const lines = chart(series, w, 6, max, color);
      card.setContent(`${label}\n${lines.join('\n')}`);
    };
    const peak = (a) => (a.length ? Math.max(...a) : 0);
    hist(cpuHist, monitor.hist.cpu, (v) => level(v), 100,
      `${f(C.muted, 'now')} ${f(level(s.cpu), s.cpu.toFixed(1) + '%')}  ${f(C.muted, 'peak ' + peak(monitor.hist.cpu).toFixed(0) + '%')}`);
    hist(ramHist, monitor.hist.mem, (v) => level(v), 100,
      `${f(C.muted, 'now')} ${f(level(s.mem.pct), s.mem.pct.toFixed(1) + '%')}  ${f(C.muted, 'peak ' + peak(monitor.hist.mem).toFixed(0) + '%')}`);

    const w = inner(netHist);
    const rxLines = chart(monitor.hist.rx, w, 3, 0, () => C.green);
    const txLines = chart(monitor.hist.tx, w, 3, 0, () => C.purple);
    netHist.setContent(`${f(C.green, '↓ ' + human(s.rx) + '/s')}  ${f(C.purple, '↑ ' + human(s.tx) + '/s')}\n${rxLines.join('\n')}\n${txLines.join('\n')}`);

    // Cores: one bar per line
    const cw = inner(cores);
    const bw = Math.max(4, cw - 9);
    cores.setContent(s.cores.map((p, i) => `${f(C.muted, String(i).padStart(2))} ${bar(p, bw)} ${f(level(p), (p.toFixed(0) + '%').padStart(4))}`).join('\n'));

    // Top containers
    const running = containers.filter((c) => c.state === 'running').sort((a, b) => num(b.cpu) - num(a.cpu));
    const tw = inner(top);
    const nameW = Math.min(24, Math.max(10, Math.floor(tw * 0.3)));
    const tail = 8 + 11;
    const tbw = Math.max(4, tw - nameW - tail - 2);
    top.setContent(running.length
      ? running.map((c) => {
        const p = num(c.cpu);
        return `${blessed.escape(fit(c.name, nameW))} ${bar(Math.min(100, p), tbw, level(Math.min(100, p)))} ${f(level(Math.min(100, p)), c.cpu.padStart(7))} ${f(C.muted, String(c.mem).padStart(10))}`;
      }).join('\n')
      : f(C.muted, 'No running containers (or stats not loaded yet)'));
  }

  return { el: root, update };
}

// ---------------- container cards ----------------
export const CARD_W = 36;
export const CARD_H = 8;

export function cardLayout(host) {
  const w = host.width;
  const h = host.height;
  const cols = Math.max(1, Math.floor(w / CARD_W));
  return { cols, rows: Math.max(1, Math.floor(h / CARD_H)), cardW: Math.floor(w / cols) };
}

export function renderCards({ host, containers, sel, firstRow, C, A, onClick }) {
  const { f, level, bar } = makeTheme(C, A);
  host.children.slice().forEach((c) => c.destroy());
  const { cols, rows, cardW } = cardLayout(host);
  const start = firstRow * cols;
  const visible = containers.slice(start, start + cols * rows);

  visible.forEach((c, k) => {
    const idx = start + k;
    const col = k % cols;
    const row = Math.floor(k / cols);
    const running = c.state === 'running';
    const sc = running ? C.green : c.state === 'paused' || c.state === 'restarting' ? C.yellow : C.red;
    const selected = idx === sel;
    const iw = cardW - 6;
    const cpu = running ? num(c.cpu) : 0;
    const memPct = running ? c.memPct || 0 : 0;
    const lines = [
      f(C.muted, blessed.escape(fit(c.image, iw))),
      f(sc, blessed.escape(fit(c.status, iw))),
      `${f(C.accent, 'CPU')} ${bar(Math.min(100, cpu), iw - 12, level(Math.min(100, cpu)))} ${f(C.fg, (running ? c.cpu : '-').padStart(7))}`,
      `${f(C.accent, 'MEM')} ${bar(memPct, iw - 12, level(memPct))} ${f(C.fg, (running ? c.mem : '-').padStart(7))}`,
      f(C.purple, blessed.escape(fit(c.ports ? c.ports.replace(/0\.0\.0\.0:|\[::\]:/g, '') : 'no ports', iw))),
    ];
    const hot = running ? level(Math.max(cpu, memPct)) : C.green;
    const alertColor = hot === C.green ? null : hot;
    const card = blessed.box({
      parent: host, top: row * CARD_H, left: col * cardW, width: cardW - 1, height: CARD_H - 1, tags: true,
      border: 'line', padding: { left: 1, right: 1 }, mouse: true,
      label: ` ${alertColor ? '⚠' : running ? '●' : '○'} ${c.name} `,
      content: lines.join('\n'),
      style: {
        fg: C.fg, bg: selected ? C.sel : C.panel,
        border: { fg: alertColor || (selected ? C.accent : running ? C.muted : C.track) },
        label: { fg: alertColor || (selected ? '#ffffff' : sc), bold: selected || !!alertColor },
      },
    });
    card.on('click', () => onClick(idx));
  });
  return { cols, rows, shown: visible.length };
}
