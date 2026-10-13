import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const defaults = {
  host: '',
  title: 'Docker Admin',
  port: 22,
  username: os.userInfo().username,
  privateKey: '',
  passphrase: '',
  sudo: false,
  composeDir: '',
  refreshSeconds: 5,
  // usage thresholds (percent) for coloured alerts; beep rings the terminal bell on new critical alerts
  alerts: { warn: 70, crit: 90, beep: true },
};

export function loadConfig() {
  const file = process.env.DOCKER_TUI_CONFIG || path.join(root, 'config.json');
  let fromFile = {};
  if (fs.existsSync(file)) fromFile = JSON.parse(fs.readFileSync(file, 'utf8'));
  const cfg = { ...defaults, ...fromFile };
  if (process.env.DOCKER_TUI_HOST) cfg.host = process.env.DOCKER_TUI_HOST;
  if (process.env.DOCKER_TUI_USER) cfg.username = process.env.DOCKER_TUI_USER;
  if (process.env.DOCKER_TUI_PASSWORD) cfg.password = process.env.DOCKER_TUI_PASSWORD;
  if (!cfg.privateKey && !cfg.password) {
    const found = ['id_ed25519', 'id_rsa', 'id_ecdsa']
      .map((n) => path.join(os.homedir(), '.ssh', n))
      .find((p) => fs.existsSync(p));
    if (found) cfg.privateKey = found;
  }
  if (cfg.privateKey?.startsWith('~'))cfg.privateKey = path.join(os.homedir(), cfg.privateKey.slice(1));
  return cfg;
}
