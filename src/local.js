import { spawn } from 'node:child_process';

/** Runs commands on the local machine. Same interface as Ssh so the rest of the app doesn't care. */
export class Local {
  constructor() {
    this.ready = true;
    this.onState = () => {};
  }

  connect() {
    return Promise.resolve();
  }

  /** Shell snippet that changes into `dir` before the next command. */
  cd(dir) {
    return process.platform === 'win32' ? `cd /d "${dir}"` : `cd '${dir.split("'").join("'\\''")}'`;
  }

  exec(cmd, { timeout = 30000 } = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(cmd, { shell: true, windowsHide: true });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`Command timed out: ${cmd}`));
      }, timeout);
      child.stdout.on('data', (d) => { stdout += d; });
      child.stderr.on('data', (d) => { stderr += d; });
      child.on('error', (err) => { clearTimeout(timer); reject(err); });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ code, stdout, stderr });
      });
    });
  }

  stream(cmd, onData, onEnd) {
    const child = spawn(cmd, { shell: true, windowsHide: true });
    child.stdout.on('data', (d) => onData(d.toString()));
    child.stderr.on('data', (d) => onData(d.toString()));
    child.on('error', (err) => onEnd?.(err));
    child.on('close', () => onEnd?.());
    return { close() { child.kill(); } };
  }

  end() {}
}
