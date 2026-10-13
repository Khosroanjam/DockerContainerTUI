// Collects CPU / RAM / disk / network metrics from /proc on the remote host and keeps a rolling history.

export const METRICS_CMD = [
  `grep '^cpu' /proc/stat`, 'echo ---',
  `grep -E '^(MemTotal|MemAvailable|SwapTotal|SwapFree):' /proc/meminfo`, 'echo ---',
  'cat /proc/net/dev', 'echo ---',
  'cat /proc/loadavg', 'echo ---',
  'df -P / | tail -1', 'echo ---',
  'cat /proc/uptime',
].join('; ');

const HISTORY = 300;
// Physical-ish interfaces only (skip loopback, docker bridges, veth pairs)
const SKIP_IFACE = /^(lo|docker\d*|br-|veth|virbr|cni|flannel|cali)/;

export class Monitor {
  constructor() {
    this.prev = null;
    this.snap = null;
    this.hist = { cpu: [], mem: [], rx: [], tx: [] };
  }

  push(key, v) {
    const h = this.hist[key];
    h.push(v);
    if (h.length > HISTORY) h.shift();
  }

  update(raw) {
    const [cpuS, memS, netS, loadS, dfS, upS] = raw.split('---\n');
    const cpus = cpuS.trim().split('\n').map((line) => {
      const [name, ...f] = line.trim().split(/\s+/);
      const n = f.map(Number);
      return { name, total: n.slice(0, 8).reduce((a, b) => a + b, 0), idle: n[3] + (n[4] || 0) };
    });

    const mem = {};
    for (const l of memS.trim().split('\n')) {
      const [k, v] = l.split(/:\s+/);
      mem[k] = parseInt(v, 10) * 1024;
    }

    let rx = 0;
    let tx = 0;
    for (const l of netS.trim().split('\n').slice(2)) {
      const [iface, rest] = l.split(':');
      if (!rest || SKIP_IFACE.test(iface.trim())) continue;
      const f = rest.trim().split(/\s+/).map(Number);
      rx += f[0];
      tx += f[8];
    }

    const load = loadS.trim().split(/\s+/).slice(0, 3).map(Number);
    const d = dfS.trim().split(/\s+/);
    const disk = { size: Number(d[1]) * 1024, used: Number(d[2]) * 1024, pct: parseInt(d[4], 10) };
    const uptime = parseFloat(upS.trim().split(/\s+/)[0]);

    const cur = { cpus, rx, tx, uptime };
    let cpuPct = null;
    let cores = [];
    let rxRate = 0;
    let txRate = 0;
    if (this.prev) {
      const dt = Math.max(0.1, uptime - this.prev.uptime);
      const pct = (a, b) => {
        const dTot = a.total - b.total;
        return dTot > 0 ? Math.max(0, Math.min(100, 100 * (1 - (a.idle - b.idle) / dTot))) : 0;
      };
      cpuPct = pct(cpus[0], this.prev.cpus[0]);
      cores = cpus.slice(1).map((c, i) => pct(c, this.prev.cpus[i + 1]));
      rxRate = Math.max(0, (rx - this.prev.rx) / dt);
      txRate = Math.max(0, (tx - this.prev.tx) / dt);
    }
    this.prev = cur;

    const memUsed = mem.MemTotal - mem.MemAvailable;
    const swapUsed = mem.SwapTotal - mem.SwapFree;
    this.snap = {
      cpu: cpuPct,
      cores,
      mem: { total: mem.MemTotal, used: memUsed, pct: (100 * memUsed) / mem.MemTotal },
      swap: { total: mem.SwapTotal, used: swapUsed, pct: mem.SwapTotal ? (100 * swapUsed) / mem.SwapTotal : 0 },
      disk,
      rx: rxRate,
      tx: txRate,
      load,
      uptime,
    };
    if (cpuPct != null) {
      this.push('cpu', cpuPct);
      this.push('mem', this.snap.mem.pct);
      this.push('rx', rxRate);
      this.push('tx', txRate);
    }
    return this.snap;
  }
}
