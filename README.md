# docker-ssh-tui

A modern terminal UI for monitoring and managing Docker containers on a remote server over SSH.
Nothing is installed on the server: it only needs SSH access and the `docker` CLI. Containers are
discovered automatically.

- **Dashboard**: live CPU / RAM / swap / disk gauges, CPU/RAM/network history charts, per-core bars, top containers
- **Container cards**: one card per container with CPU/MEM bars, status and ports
- **Actions**: start, stop, restart, delete, live logs, inspect
- **Images, Host info, Docker Compose** (`up -d`, `down`, `pull`, `restart`, `build`)
- **Colour alerts** when CPU/RAM/disk or a container crosses a threshold (header turns yellow/red, optional terminal bell)
- Auto-refresh and automatic reconnect

## Requirements

- Node.js 18+
- SSH access to the server (key, ssh-agent, or password) and permission to run `docker`
- A terminal with 256 colours (Windows Terminal, iTerm2, GNOME Terminal, ...)

## Install

```bash
git clone https://github.com/YOUR_USER/docker-ssh-tui.git
cd docker-ssh-tui
npm install
cp config.example.json config.json   # then edit it
npm start
```

## Configuration

`config.json` (ignored by git):

| Key | Description |
|---|---|
| `host`, `port`, `username` | SSH target |
| `privateKey` | Path to a key. If empty, `~/.ssh/id_ed25519`, `id_rsa`, `id_ecdsa` are tried, then ssh-agent, then a password prompt |
| `passphrase` | Passphrase of the key, if any |
| `sudo` | Run docker as `sudo -n docker` (needs passwordless sudo) |
| `composeDir` | Compose project directory on the server (enables the Compose tab) |
| `refreshSeconds` | Refresh interval for lists |
| `title` | Title shown in the header |
| `alerts` | `{ "warn": 70, "crit": 90, "beep": true }` thresholds in percent |

Environment overrides: `DOCKER_TUI_CONFIG`, `DOCKER_TUI_HOST`, `DOCKER_TUI_USER`, `DOCKER_TUI_PASSWORD`.

## Keys

| Key | Action |
|---|---|
| `1`-`5`, `F9`, `[` `]` | Switch tab |
| `Tab` / arrows / mouse | Select a container card (on the Containers tab) |
| `F1` | Help |
| `F2` / `F3` / `F4` | Start / Stop / Restart (Up / Down / Restart on Compose) |
| `F5` | Refresh |
| `F6` / `F7` / `F8` | Logs / Inspect / Delete (Pull / Build on Compose; Prune / Delete on Images) |
| `Enter` | Logs of the selected container |
| `F10` | Exit |

## Security notes

Anyone who can run `docker` on a host effectively has root on it. Use a dedicated SSH user, prefer keys over
passwords, and never commit `config.json`. Container names are validated before being passed to the remote shell.

## License

MIT, see [LICENSE](LICENSE).
