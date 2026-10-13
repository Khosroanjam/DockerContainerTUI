#!/usr/bin/env node
import { loadConfig } from './config.js';
import { Ssh } from './ssh.js';
import { Docker } from './docker.js';
import { startUi } from './ui.js';

function askHidden(prompt) {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    const stdin = process.stdin;
    let buf = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (ch) => {
      for (const c of ch) {
        if (c === '\r' || c === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener('data', onData);
          process.stdout.write('\n');
          return resolve(buf);
        }
        if (c === '\u0003') process.exit(130);
        if (c === '\u007f' || c === '\b') buf = buf.slice(0, -1);
        else buf += c;
      }
    };
    stdin.on('data', onData);
  });
}

const cfg = loadConfig();
if (!cfg.host) {
  console.error('No host configured. Copy config.example.json to config.json and set "host" and "username"\n(or set DOCKER_TUI_HOST / DOCKER_TUI_USER).');
  process.exit(1);
}
console.log(`Connecting to ${cfg.username}@${cfg.host}:${cfg.port} ...`);

let ssh = new Ssh(cfg);
try {
  await ssh.connect();
} catch (err) {
  if (/authentication/i.test(err.message) && !cfg.password && process.stdin.isTTY) {
    cfg.password = await askHidden(`Password for ${cfg.username}@${cfg.host}: `);
    ssh = new Ssh(cfg);
    try {
      await ssh.connect();
    } catch (e) {
      console.error(`Connection failed: ${e.message}`);
      process.exit(1);
    }
  } else {
    console.error(`Connection failed: ${err.message}`);
    process.exit(1);
  }
}

startUi({ cfg, ssh, docker: new Docker(ssh, cfg) });
