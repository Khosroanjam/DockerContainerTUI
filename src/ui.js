import blessed from 'blessed';
import { Monitor } from './metrics.js';
import { createDashboard, renderCards, cardLayout } from './widgets.js';

const TABS = [
  { name: 'Dashboard', icon: '◔' },
  { name: 'Containers', icon: '▣' },
  { name: 'Images', icon: '◈' },
  { name: 'Host', icon: '◉' },
  { name: 'Compose', icon: '❖' },
];

// Tokyo-Night inspired palette
const C = {
  bg: '#1a1b26',
  panel: '#16161e',
  fg: '#c0caf5',
  muted: '#565f89',
  track: '#2b3048',
  accent: '#7aa2f7',
  accentDk: '#3d59a1',
  sel: '#2f3b63',
  green: '#9ece6a',
  yellow: '#e0af68',
  red: '#f7768e',
  cyan: '#7dcfff',
  purple: '#bb9af7',
};

const pad = (s, n) => {
  s = String(s ?? '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s.padEnd(n);
};
const fg = (color, s) => `{${color}-fg}${s}{/}`;
const stateColor = (st) => (st === 'running' ? C.green : st === 'paused' || st === 'restarting' ? C.yellow : C.red);

export function startUi({ cfg, ssh, docker }) {
  const screen = blessed.screen({ smartCSR: true, title: cfg.title, fullUnicode: false });
  const base = { fg: C.fg, bg: C.bg };

  const header = blessed.box({ parent: screen, top: 0, height: 1, width: '100%', tags: true, style: { fg: '#ffffff', bg: C.accentDk } });
  const tabsBar = blessed.box({ parent: screen, top: 1, height: 1, width: '100%', tags: true, style: base });
  const summary = blessed.box({ parent: screen, top: 2, height: 1, width: '100%', tags: true, style: base });

  const panel = blessed.box({
    parent: screen, top: 3, bottom: 2, width: '100%', tags: true,
    border: 'line', label: '', style: { fg: C.fg, bg: C.panel, border: { fg: C.muted }, label: { fg: C.accent } },
  });
  const colHeader = blessed.box({
    parent: panel, top: 0, left: 0, height: 1, width: '100%-2', tags: true, style: { fg: C.cyan, bg: C.panel, bold: true },
  });
  const list = blessed.list({
    parent: panel, top: 1, left: 0, width: '100%-2', height: '100%-3', keys: true, vi: true, mouse: true, tags: true,
    style: { fg: C.fg, bg: C.panel, selected: { bg: C.sel, fg: '#ffffff', bold: true } },
    scrollbar: { ch: '▐', style: { fg: C.muted } },
  });
  const text = blessed.box({
    parent: panel, top: 0, left: 1, width: '100%-4', height: '100%-2', keys: true, vi: true, mouse: true, scrollable: true,
    alwaysScroll: true, tags: true, hidden: true, style: { fg: C.fg, bg: C.panel },
    scrollbar: { ch: '▐', style: { fg: C.muted } },
  });

  const cardsHost = blessed.box({ parent: panel, top: 0, left: 0, width: '100%-2', height: '100%-2', hidden: true, style: { bg: C.panel } });
  const A = { warn: 70, crit: 90, beep: true, ...cfg.alerts };
  const dash = createDashboard(panel, C, A);

  const status = blessed.box({ parent: screen, bottom: 1, height: 1, width: '100%', tags: true, style: base });
  const fbar = blessed.box({ parent: screen, bottom: 0, height: 1, width: '100%', tags: true, style: { bg: C.bg } });

  // Full-screen overlay for logs / inspect output
  const viewer = blessed.log({
    parent: screen, top: 0, left: 0, width: '100%', height: '100%-1', hidden: true, keys: true, vi: true, mouse: true,
    scrollable: true, scrollOnInput: true, border: 'line', label: '', tags: false,
    style: { fg: C.fg, bg: C.panel, border: { fg: C.accent }, label: { fg: C.accent } },
    scrollbar: { ch: '▐', style: { fg: C.muted } },
  });
  const viewerBar = blessed.box({ parent: screen, bottom: 0, height: 1, width: '100%', hidden: true, tags: true, style: { bg: C.bg } });
  viewerBar.setContent(fkeys([['Esc', 'Close'], ['F10', 'Exit'], ['PgUp/PgDn', 'Scroll'], ['g/G', 'Top/Bottom']]));

  const helpBox = blessed.box({
    parent: screen, top: 'center', left: 'center', width: 62, height: 25, hidden: true, tags: true, border: 'line',
    label: ' Keyboard shortcuts ', padding: { left: 2, right: 2 },
    style: { fg: C.fg, bg: C.panel, border: { fg: C.accent }, label: { fg: C.accent } },
    content: [
      fg(C.accent, 'Global'),
      '  F1 Help   F5 Refresh   F9 Next tab   F10 Exit',
      '  1-5 / F9 / [ ]  Switch tab   Shift+R  Refresh',
      '  Tab / arrows  Select card    Enter  Logs   Shift+Q  Quit',
      '',
      fg(C.accent, 'Dashboard (tab 1)'),
      '  Live CPU / RAM / swap / disk gauges, network, history',
      '',
      fg(C.accent, 'Containers'),
      '  F2 / s  Start      F3 / x  Stop       F4 / r  Restart',
      '  F6 / l  Logs       F7 / i  Inspect    F8 / d  Delete',
      '',
      fg(C.accent, 'Images'),
      '  F7 / p  Prune dangling                F8 / d  Delete image',
      '',
      fg(C.accent, 'Compose'),
      '  F2 / u  up -d      F3 / w  down       F4 / r  restart',
      '  F6 / p  pull       F7 / b  build',
      '',
      fg(C.accent, 'Log / Inspect viewer'),
      '  Esc / q  Close   F10  Exit   g / G  Top / Bottom',
      '',
      fg(C.muted, 'Press any key to close'),
    ].join('\n'),
  });

  const monitor = new Monitor();
  const state = { tab: 0, containers: [], images: [], composeOut: '', hostOut: '', viewerStream: null, busy: false, overlay: false, sel: 0, firstRow: 0 };

  const notify = (msg, color = C.green) => {
    status.setContent(` ${fg(color, blessed.escape(msg))}`);
    screen.render();
    clearTimeout(notify.t);
    notify.t = setTimeout(() => { status.setContent(''); screen.render(); }, 6000);
  };

  const isListTab = (t = state.tab) => t === 2;
  const focusMain = () => (isListTab() ? list : text).focus();

  const confirm = (msg) => new Promise((resolve) => {
    state.overlay = true;
    const q = blessed.question({
      parent: screen, border: 'line', height: 'shrink', width: 'half', top: 'center', left: 'center',
      label: ' Confirm ', keys: true, tags: false, padding: { left: 1, right: 1 },
      style: { fg: C.fg, bg: C.panel, border: { fg: C.yellow }, label: { fg: C.yellow } },
    });
    q.ask(`${msg}\n\n[Enter] Yes    [Esc] No`, (_e, ok) => {
      q.destroy();
      state.overlay = false;
      focusMain();
      screen.render();
      resolve(!!ok);
    });
  });

  // ---------- actions (shared by F-keys and letter keys) ----------
  const sel = () => (state.tab === 1 ? state.containers[state.sel] : state.images[list.selected]);

  const act = async (label, fn) => {
    notify(`${label}...`, C.yellow);
    try {
      const out = await fn();
      const last = (out || '').trim().split('\n').pop();
      notify(`✔ ${label}${last && last.length < 80 ? ' - ' + last : ''}`);
    } catch (e) {
      notify(`✘ ${label} failed: ${e.message.split('\n')[0]}`, C.red);
    }
    await refresh();
  };
  const onContainer = (fn) => () => { const c = sel(); if (c) fn(c); };
  const composeRun = (label, args, ask) => async () => {
    if (!cfg.composeDir) return notify('composeDir not set in config.json', C.red);
    if (ask && !(await confirm(`${label}?`))) return;
    act(label, () => docker.compose(args, { timeout: 600000 }));
  };

  const ACTIONS = [
    // Dashboard
    {},
    // Containers
    {
      f2: { label: 'Start', key: 's', run: onContainer((c) => act(`Start ${c.name}`, () => docker.start(c.id))) },
      f3: { label: 'Stop', key: 'x', run: onContainer(async (c) => { if (await confirm(`Stop container ${c.name}?`)) act(`Stop ${c.name}`, () => docker.stop(c.id)); }) },
      f4: { label: 'Restart', key: 'r', run: onContainer(async (c) => { if (await confirm(`Restart container ${c.name}?`)) act(`Restart ${c.name}`, () => docker.restart(c.id)); }) },
      f6: { label: 'Logs', key: 'l', run: onContainer((c) => openViewer(`Logs: ${c.name}`, { streamCmd: docker.logsCmd(c.id) })) },
      f7: {
        label: 'Inspect', key: 'i',
        run: onContainer(async (c) => {
          try { openViewer(`Inspect: ${c.name}`, { content: await docker.inspect(c.id) }); } catch (e) { notify(e.message.split('\n')[0], C.red); }
        }),
      },
      f8: { label: 'Delete', key: 'd', run: onContainer(async (c) => { if (await confirm(`DELETE container ${c.name}? (force)`)) act(`Delete ${c.name}`, () => docker.remove(c.id)); }) },
    },
    // Images
    {
      f7: { label: 'Prune', key: 'p', run: async () => { if (await confirm('Prune dangling images?')) act('Prune images', () => docker.pruneImages()); } },
      f8: {
        label: 'Delete', key: 'd',
        run: async () => {
          const i = sel();
          if (i && await confirm(`Remove image ${i.repo}:${i.tag}?`)) act(`Remove image ${i.repo}:${i.tag}`, () => docker.removeImage(i.id));
        },
      },
    },
    // Host
    {},
    // Compose
    {
      f2: { label: 'Up', key: 'u', run: composeRun('compose up -d', 'up -d') },
      f3: { label: 'Down', key: 'w', run: composeRun('compose down', 'down', true) },
      f4: { label: 'Restart', key: 'r', run: composeRun('compose restart', 'restart', true) },
      f6: { label: 'Pull', key: 'p', run: composeRun('compose pull', 'pull') },
      f7: { label: 'Build', key: 'b', run: composeRun('compose build', 'build') },
    },
  ];

  // ---------- rendering ----------
  function fkeys(items) {
    return items
      .map(([k, label]) => (label
        ? `{white-fg}{${C.accentDk}-bg}${k}{/}{black-fg}{${C.cyan}-bg}${pad(label, 9)}{/}`
        : `{${C.muted}-fg}{${C.panel}-bg}${k}${pad('', 9)}{/}`))
      .join(' ');
  }

  function renderChrome() {
    const conn = ssh.ready ? fg(C.green, '● connected') : fg(C.red, '● disconnected, reconnecting...');
    const clock = new Date().toLocaleTimeString('en-GB');
    const left = ` ◆ ${cfg.title}   ${cfg.label}   ${conn}`;
    const w = screen.width;
    const visible = left.replace(/\{[^}]*\}/g, '').length;
    const worst = state.alerts?.[0]?.level;
    const blink = Math.floor(Date.now() / 1000) % 2 === 0;
    header.style.bg = worst === 'crit' ? (blink ? '#b3263c' : '#6e1a28') : worst === 'warn' ? '#8a6420' : C.accentDk;
    header.setContent(left + ' '.repeat(Math.max(1, w - visible - clock.length - 1)) + clock);

    tabsBar.setContent(' ' + TABS.map((t, i) => (
      i === state.tab
        ? `{black-fg}{${C.accent}-bg} ${t.icon} ${i + 1} ${t.name} {/}`
        : `{${C.muted}-fg} ${t.icon} ${i + 1} ${t.name} {/}`
    )).join(' '));

    const a = ACTIONS[state.tab];
    const items = [['F1', 'Help']];
    ['f2', 'f3', 'f4'].forEach((k) => items.push([k.toUpperCase(), a[k]?.label || '']));
    items.push(['F5', 'Refresh']);
    ['f6', 'f7', 'f8'].forEach((k) => items.push([k.toUpperCase(), a[k]?.label || '']));
    items.push(['F9', 'NextTab'], ['F10', 'Exit']);
    fbar.setContent(fkeys(items));
  }

  // ---------- alerts ----------
  const alertSeen = new Set();
  function computeAlerts() {
    const out = [];
    const lv = (p) => (p >= A.crit ? 'crit' : p >= A.warn ? 'warn' : null);
    const add = (key, p, text) => { const l = lv(p); if (l) out.push({ key, level: l, text }); };
    const s = monitor.snap;
    if (s && s.cpu != null) {
      add('cpu', s.cpu, `CPU ${s.cpu.toFixed(0)}%`);
      add('ram', s.mem.pct, `RAM ${s.mem.pct.toFixed(0)}%`);
      add('disk', s.disk.pct, `DISK ${s.disk.pct}%`);
      if (s.swap.total) add('swap', s.swap.pct, `SWAP ${s.swap.pct.toFixed(0)}%`);
    }
    for (const c of state.containers) {
      if (c.state !== 'running') continue;
      const cpu = parseFloat(c.cpu) || 0;
      add(`c:${c.name}:cpu`, cpu, `${c.name} CPU ${cpu.toFixed(0)}%`);
      add(`c:${c.name}:mem`, c.memPct || 0, `${c.name} MEM ${(c.memPct || 0).toFixed(0)}%`);
    }
    out.sort((a, b) => (a.level === b.level ? 0 : a.level === 'crit' ? -1 : 1));
    const fresh = out.some((a) => a.level === 'crit' && !alertSeen.has(a.key));
    alertSeen.clear();
    out.forEach((a) => a.level === 'crit' && alertSeen.add(a.key));
    if (fresh && A.beep) process.stdout.write('');
    state.alerts = out;
    return out;
  }

  function alertChips() {
    const list = computeAlerts();
    if (!list.length) return '';
    const chips = list.slice(0, 4).map((a) => (a.level === 'crit'
      ? `{white-fg}{${C.red}-bg} ⚠ ${blessed.escape(a.text)} {/}`
      : `{black-fg}{${C.yellow}-bg} ⚠ ${blessed.escape(a.text)} {/}`));
    const more = list.length > 4 ? ` {${C.muted}-fg}+${list.length - 4} more{/}` : '';
    return ' ' + chips.join(' ') + more + '  ';
  }

  function renderSummary() {
    let text0 = '';
    if (state.tab === 0) {
      const s = monitor.snap;
      text0 = (` ${fg(C.muted, 'Live server metrics, sampled every 2s')}${s ? '   ' + fg(C.green, '● ' + state.containers.filter((c) => c.state === 'running').length + ' containers running') : ''}`);
    } else if (state.tab === 1) {
      const run = state.containers.filter((c) => c.state === 'running').length;
      const stopped = state.containers.length - run;
      text0 = (` ${fg(C.green, '● ' + run + ' running')}   ${fg(C.red, '○ ' + stopped + ' stopped')}   ${fg(C.muted, state.containers.length + ' total')}   ${fg(C.cyan, 'Tab / arrows: select   Enter: logs   F2-F8: actions on selected card')}`);
    } else if (state.tab === 2) {
      text0 = (` ${fg(C.muted, state.images.length + ' images')}`);
    } else if (state.tab === 3) {
      text0 = (` ${fg(C.muted, 'Server resources and Docker disk usage')}`);
    } else {
      text0 = (` ${fg(C.muted, cfg.composeDir ? 'Project: ' + cfg.composeDir : 'composeDir is not configured')}`);
    }
    summary.setContent(alertChips() + text0);
  }

  function renderList() {
    const t = state.tab;
    dash.el.hidden = t !== 0;
    cardsHost.hidden = t !== 1;
    list.hidden = colHeader.hidden = t !== 2;
    text.hidden = t < 3;
    panel.setLabel(` ${TABS[t].icon} ${TABS[t].name} `);
    if (t === 0) {
      dash.update({ monitor, containers: state.containers });
    } else if (t === 1) {
      state.sel = Math.min(state.sel, Math.max(0, state.containers.length - 1));
      const { cols, rows } = cardLayout(cardsHost);
      const selRow = Math.floor(state.sel / cols);
      if (selRow < state.firstRow) state.firstRow = selRow;
      if (selRow >= state.firstRow + rows) state.firstRow = selRow - rows + 1;
      state.firstRow = Math.max(0, Math.min(state.firstRow, Math.max(0, Math.ceil(state.containers.length / cols) - rows)));
      renderCards({ host: cardsHost, containers: state.containers, sel: state.sel, firstRow: state.firstRow, C, A, onClick: (i) => { state.sel = i; renderList(); } });
    } else if (t === 2) {
      colHeader.setContent('  ' + pad('REPOSITORY', 40) + pad('TAG', 20) + pad('SIZE', 12) + pad('CREATED', 18) + 'ID');
      const prev = list.selected;
      list.setItems(state.images.map((i) =>
        '  ' + blessed.escape(pad(i.repo, 40)) + fg(C.cyan, blessed.escape(pad(i.tag, 20))) + pad(i.size, 12) +
        fg(C.muted, pad(i.created, 18) + i.id)));
      list.select(Math.min(prev, Math.max(0, state.images.length - 1)));
    } else if (t === 3) {
      text.setContent(blessed.escape(state.hostOut || 'Loading...'));
    } else {
      text.setContent(cfg.composeDir
        ? blessed.escape(state.composeOut || 'Loading...')
        : 'Set "composeDir" in config.json to the project directory on the server (where docker-compose.yml lives).');
    }
    renderSummary();
    renderChrome();
    screen.render();
  }

  function moveSel(dx, dy) {
    if (state.tab !== 1 || !state.containers.length) return;
    const { cols } = cardLayout(cardsHost);
    const next = state.sel + dx + dy * cols;
    if (next < 0 || next >= state.containers.length) return;
    state.sel = next;
    renderList();
  }

  async function refresh(manual = false) {
    if (!ssh.ready || state.busy) return;
    state.busy = true;
    try {
      if (state.tab === 0 || state.tab === 1) state.containers = await docker.containers();
      else if (state.tab === 2) state.images = await docker.images();
      else if (state.tab === 3) state.hostOut = await docker.host();
      else if (cfg.composeDir) state.composeOut = await docker.compose('ps -a');
      renderList();
      if (manual) notify('✔ Refreshed');
    } catch (e) {
      notify(e.message.split('\n')[0], C.red);
    } finally {
      state.busy = false;
    }
  }

  // ---------- viewer ----------
  function openViewer(title, { content, streamCmd }) {
    state.overlay = true;
    viewer.setLabel(` ${title} `);
    viewer.setContent('');
    viewer.show();
    viewerBar.show();
    fbar.hide();
    viewer.focus();
    if (content != null) {
      viewer.log(content);
      viewer.scrollTo(0);
    }
    if (streamCmd) {
      state.viewerStream = ssh.stream(
        streamCmd,
        (d) => viewer.log(d.replace(/\r?\n$/, '')),
        (err) => { if (err) viewer.log(`[stream ended: ${err.message}]`); },
      );
    }
    screen.render();
  }
  function closeViewer() {
    state.viewerStream?.close();
    state.viewerStream = null;
    state.overlay = false;
    viewer.hide();
    viewerBar.hide();
    fbar.show();
    focusMain();
    screen.render();
  }
  viewer.key(['q', 'escape'], closeViewer);
  viewer.key(['g'], () => { viewer.scrollTo(0); screen.render(); });
  viewer.key(['S-g'], () => { viewer.setScrollPerc(100); screen.render(); });

  function openHelp() {
    state.overlay = true;
    helpBox.show();
    helpBox.focus();
    screen.render();
  }
  helpBox.on('keypress', () => {
    helpBox.hide();
    state.overlay = false;
    focusMain();
    screen.render();
  });

  // ---------- keys ----------
  screen.key(['left'], () => !state.overlay && moveSel(-1, 0));
  screen.key(['right'], () => !state.overlay && moveSel(1, 0));
  screen.key(['up'], () => !state.overlay && moveSel(0, -1));
  screen.key(['down'], () => !state.overlay && moveSel(0, 1));
  screen.key(['enter'], () => !state.overlay && state.tab === 1 && ACTIONS[1].f6.run());
  const free = (fn) => (...a) => { if (!state.overlay) fn(...a); };

  function switchTab(n) {
    state.tab = n;
    focusMain();
    renderList();
    refresh();
  }
  const quit = () => {
    state.viewerStream?.close();
    ssh.end();
    screen.destroy();
    process.exit(0);
  };

  [1, 2, 3, 4, 5].forEach((n) => screen.key(String(n), free(() => switchTab(n - 1))));
  const nextTab = (d) => switchTab((state.tab + d + TABS.length) % TABS.length);
  // On the Containers tab Tab / Shift+Tab walk through the cards (wrapping); elsewhere they switch tabs.
  const cycleCard = (d) => {
    const n = state.containers.length;
    if (!n) return;
    state.sel = (state.sel + d + n) % n;
    renderList();
  };
  screen.key(['tab'], free(() => (state.tab === 1 ? cycleCard(1) : nextTab(1))));
  screen.key(['S-tab'], free(() => (state.tab === 1 ? cycleCard(-1) : nextTab(-1))));
  screen.key(['f9', ']'], free(() => nextTab(1)));
  screen.key(['['], free(() => nextTab(-1)));
  screen.key(['S-r', 'f5'], free(() => refresh(true)));
  screen.key(['f1', '?'], free(openHelp));
  screen.key(['f10', 'S-q', 'C-c'], quit);

  for (const k of ['f2', 'f3', 'f4', 'f6', 'f7', 'f8']) {
    screen.key(k, free(() => ACTIONS[state.tab][k]?.run()));
  }
  for (const letter of ['s', 'x', 'r', 'l', 'i', 'd', 'p', 'u', 'w', 'b']) {
    screen.key(letter, free(() => {
      const hit = Object.values(ACTIONS[state.tab]).find((a) => a.key === letter);
      hit?.run();
    }));
  }

  // ---------- connection + timers ----------
  async function reconnect() {
    while (!ssh.ready) {
      await new Promise((r) => setTimeout(r, 5000));
      try {
        await ssh.connect();
        notify('✔ Reconnected');
        refresh();
      } catch { /* retry */ }
    }
  }
  ssh.onState = (up) => {
    renderChrome();
    screen.render();
    if (!up) reconnect();
  };
  setInterval(() => { if (!state.overlay) refresh(); }, Math.max(2, cfg.refreshSeconds) * 1000);
  setInterval(() => { renderSummary(); renderChrome(); screen.render(); }, 1000);
  screen.on('resize', () => renderList());

  let polling = false;
  async function pollMetrics() {
    if (!ssh.ready || polling) return;
    polling = true;
    try {
      monitor.update(await docker.metrics());
      monitor.failed = 0;
      if (state.tab === 0 && !state.overlay) renderList();
    } catch {
      monitor.failed = (monitor.failed || 0) + 1; // transient errors retry on the next tick
    } finally {
      polling = false;
    }
  }
  setInterval(pollMetrics, 2000);
  pollMetrics();

  screen.program.bg = C.bg;
  focusMain();
  renderList();
  refresh();
}
