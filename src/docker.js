import { METRICS_CMD } from './metrics.js';
// Thin wrapper over the docker CLI running on the remote host.
const SAFE = /^[\w][\w.\-:/@]*$/;

function arg(v) {
  if (!SAFE.test(v)) throw new Error(`Unsafe argument: ${v}`);
  return v;
}

function jsonLines(text) {
  return text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l));
}

export class Docker {
  constructor(ssh, cfg) {
    this.ssh = ssh;
    this.cfg = cfg;
    this.bin = cfg.sudo ? 'sudo -n docker' : 'docker';
  }

  async run(args, opts) {
    const r = await this.ssh.exec(`${this.bin} ${args} 2>&1`, opts);
    if (r.code !== 0) throw new Error(r.stdout.trim() || `docker exited with ${r.code}`);
    return r.stdout;
  }

  async containers() {
    const [ps, stats] = await Promise.all([
      this.run(`ps -a --format '{{json .}}'`),
      this.run(`stats --no-stream --format '{{json .}}'`, { timeout: 45000 }).catch(() => ''),
    ]);
    const byId = new Map(jsonLines(stats).map((s) => [s.ID, s]));
    return jsonLines(ps).map((c) => {
      const s = byId.get(c.ID) || {};
      return {
        id: c.ID,
        name: c.Names,
        image: c.Image,
        state: c.State,
        status: c.Status,
        ports: c.Ports,
        cpu: s.CPUPerc || '-',
        mem: s.MemUsage ? s.MemUsage.split('/')[0].trim() : '-',
        memPct: parseFloat(s.MemPerc) || 0,
      };
    }).sort((a, b) => a.name.localeCompare(b.name));
  }

  async images() {
    return jsonLines(await this.run(`images --format '{{json .}}'`)).map((i) => ({
      id: i.ID, repo: i.Repository, tag: i.Tag, size: i.Size, created: i.CreatedSince,
    }));
  }

  start(id) { return this.run(`start ${arg(id)}`); }
  stop(id) { return this.run(`stop ${arg(id)}`, { timeout: 90000 }); }
  restart(id) { return this.run(`restart ${arg(id)}`, { timeout: 90000 }); }
  remove(id) { return this.run(`rm -f ${arg(id)}`); }
  removeImage(id) { return this.run(`rmi ${arg(id)}`); }
  pruneImages() { return this.run(`image prune -f`); }
  inspect(id) { return this.run(`inspect ${arg(id)}`); }
  logsCmd(id) { return `${this.bin} logs -f --tail 200 ${arg(id)} 2>&1`; }
  diskUsage() { return this.run(`system df`); }

  // ---- compose ----
  compose(args, opts) {
    const dir = this.cfg.composeDir;
    if (!dir) throw new Error('composeDir is not set in config.json');
    return this.ssh.exec(`cd '${dir.replace(/'/g, `'\''`)}' && ${this.bin} compose ${args} 2>&1`, opts)
      .then((r) => {
        if (r.code !== 0) throw new Error(r.stdout.trim() || `compose exited with ${r.code}`);
        return r.stdout;
      });
  }

  // ---- host ----
  async metrics() {
    const r = await this.ssh.exec(METRICS_CMD, { timeout: 10000 });
    if (r.code !== 0 && !r.stdout) throw new Error(r.stderr.trim() || 'metrics failed');
    return r.stdout;
  }

  async host() {
    const r = await this.ssh.exec(
      `hostname; echo; uptime; echo; echo '== Memory =='; free -h; echo; echo '== Disk =='; df -h -x tmpfs -x devtmpfs -x overlay 2>/dev/null; echo; echo '== Docker =='; ${this.bin} version --format 'Server {{.Server.Version}}' 2>&1; ${this.bin} system df 2>&1`,
    );
    return r.stdout;
  }
}
