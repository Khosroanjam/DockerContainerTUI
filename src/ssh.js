import fs from 'node:fs';
import { Client } from 'ssh2';

function agentPath() {
  const sock = process.env.SSH_AUTH_SOCK;
  if (process.platform !== 'win32') return sock;
  // Git Bash exports a cygwin socket path that ssh2 can't use; fall back to the Windows OpenSSH agent pipe.
  return sock && sock.startsWith('\\\\.\\pipe\\') ? sock : '\\\\.\\pipe\\openssh-ssh-agent';
}

export class Ssh {
  constructor(cfg) {
    this.cfg = cfg;
    this.client = null;
    this.ready = false;
    this.onState = () => {};
  }

  cd(dir) {
    return `cd '${dir.split("'").join("'\\''")}'`;
  }

  connect() {
    const { cfg } = this;
    const opts = {
      host: cfg.host,
      port: cfg.port,
      username: cfg.username,
      readyTimeout: 15000,
      keepaliveInterval: 10000,
    };
    if (cfg.privateKey) {
      opts.privateKey = fs.readFileSync(cfg.privateKey);
      if (cfg.passphrase) opts.passphrase = cfg.passphrase;
    }
    if (cfg.password) opts.password = cfg.password;
    if (!opts.privateKey && !opts.password) {
      opts.agent = agentPath();
    }

    return new Promise((resolve, reject) => {
      const client = new Client();
      let settled = false;
      client.on('ready', () => {
        this.client = client;
        this.ready = true;
        this.onState(true);
        settled = true;
        resolve();
      });
      client.on('error', (err) => {
        if (!settled) { settled = true; reject(err); }
      });
      client.on('close', () => {
        if (this.client === client) {
          this.ready = false;
          this.client = null;
          this.onState(false);
        }
      });
      client.connect(opts);
    });
  }

  /** Run a command, collect output. */
  exec(cmd, { timeout = 30000 } = {}) {
    return new Promise((resolve, reject) => {
      if (!this.ready) return reject(new Error('Not connected'));
      this.client.exec(cmd, (err, stream) => {
        if (err) return reject(err);
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => {
          stream.close();
          reject(new Error(`Command timed out: ${cmd}`));
        }, timeout);
        stream.on('data', (d) => { stdout += d; });
        stream.stderr.on('data', (d) => { stderr += d; });
        stream.on('close', (code) => {
          clearTimeout(timer);
          resolve({ code, stdout, stderr });
        });
      });
    });
  }

  /** Run a long-lived command (e.g. logs -f). Returns { close }. */
  stream(cmd, onData, onEnd) {
    let handle = null;
    let closed = false;
    if (!this.ready) { onEnd?.(new Error('Not connected')); return { close() {} }; }
    this.client.exec(cmd, { pty: false }, (err, stream) => {
      if (err) return onEnd?.(err);
      if (closed) return stream.close();
      handle = stream;
      stream.on('data', (d) => onData(d.toString()));
      stream.stderr.on('data', (d) => onData(d.toString()));
      stream.on('close', () => onEnd?.());
    });
    return {
      close() {
        closed = true;
        try { handle?.signal?.('TERM'); handle?.close(); } catch { /* ignore */ }
      },
    };
  }

  end() {
    this.client?.end();
  }
}
