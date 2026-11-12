'use strict';

// Closing an app when you ask her to (chat.js), after you've confirmed with a click. The apps with
// a window, by name; closing one the way its own close button does (it can still ask you to save),
// and only if you ask again, forcing it. Windows only.

const path = require('node:path');
const net = require('node:net');
const { execFile } = require('node:child_process');

// never these: the desktop itself, Windows' own pieces, her (Capri), Claude (she watches it) and
// Ollama (she talks through it)
const KEEP = new Set([
  'explorer', 'applicationframehost', 'textinputhost', 'shellexperiencehost', 'startmenuexperiencehost',
  'searchhost', 'searchapp', 'lockapp', 'dwm', 'capri', 'capri-desktop', 'electron', 'claude', 'codex', 'ollama', 'ollama app',
]);

function hyprRequest(cmd) {
  const sig = process.env.HYPRLAND_INSTANCE_SIGNATURE;
  if (!sig) return Promise.reject(new Error('no hyprland'));
  const runtimeDir = process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid()}`;
  const sockPath = path.join(runtimeDir, 'hypr', sig, '.socket.sock');
  return new Promise((resolve, reject) => {
    const client = net.createConnection(sockPath, () => client.write(cmd));
    const chunks = [];
    client.on('data', (d) => chunks.push(d));
    client.on('end', () => resolve(Buffer.concat(chunks).toString()));
    client.on('error', reject);
    setTimeout(() => { client.destroy(); reject(new Error('timeout')); }, 1500);
  });
}

function powershell(script, timeout = 15000) {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      `[Console]::OutputEncoding = [Text.Encoding]::UTF8; ${script}`,
    ], { windowsHide: true, timeout }, (err, out) => (err ? reject(err) : resolve(out.trim())));
  });
}

// [{ name, process, ids }]: one per program with a window open ("AM Music", "Discord"...)
async function list() {
  if (process.platform === 'linux' && process.env.HYPRLAND_INSTANCE_SIGNATURE) {
    const raw = await hyprRequest('j/clients').catch(() => '[]');
    const clients = JSON.parse(raw);
    const apps = new Map();
    for (const c of clients) {
      if (!c.mapped || c.hidden || !c.class) continue;
      if (c.pid === process.pid || KEEP.has(c.class.toLowerCase())) continue;
      const app = apps.get(c.class) || { name: c.class, process: c.class, label: c.title || c.class, ids: [], addresses: [] };
      if (c.pid && !app.ids.includes(c.pid)) app.ids.push(c.pid);
      if (c.address) app.addresses.push(c.address);
      apps.set(c.class, app);
    }
    return [...apps.values()];
  }
  if (process.platform !== 'win32') return [];
  const out = await powershell(
    'Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle } | '
    + 'ForEach-Object { [pscustomobject]@{ id = $_.Id; name = $_.ProcessName; label = $_.Description } } | '
    + 'ConvertTo-Json -Compress',
  );
  const rows = [].concat(out ? JSON.parse(out) : []);
  const apps = new Map();
  for (const { id, name, label } of rows) {
    if (id === process.pid || KEEP.has(name.toLowerCase())) continue;
    const app = apps.get(name) || { name, process: name, label: label || '', ids: [] };
    app.ids.push(id);
    apps.set(name, app);
  }
  return [...apps.values()];
}

const simple = (text) => String(text || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

// The open app that `wanted` names, by its name or its description ("am music", "YouTube Music").
async function find(wanted) {
  const key = simple(wanted);
  if (key.length < 2) return null;
  const apps = await list();
  const score = (app) => {
    const names = [simple(app.name), simple(app.label)].filter(Boolean);
    if (names.includes(key)) return 3;
    if (names.some((n) => n.startsWith(key) || key.startsWith(n))) return 2;
    if (key.length >= 3 && names.some((n) => n.includes(key) || key.includes(n))) return 1;
    return 0;
  };
  const best = apps.map((app) => [score(app), app]).filter(([s]) => s > 0).sort((a, b) => b[0] - a[0])[0];
  return best ? best[1] : null;
}

// Closes it like its close button would; `force` ends it outright (unsaved work is lost).
// Resolves with what's left: { running } (true when it stayed open, or hid in the tray).
async function close(name, { force = false } = {}) {
  const app = (await list()).find((a) => a.process === name);
  if (!app) return { running: false };
  if (process.platform === 'linux' && process.env.HYPRLAND_INSTANCE_SIGNATURE) {
    if (force) {
      for (const pid of app.ids) {
        try { process.kill(pid, 'SIGKILL'); } catch {}
      }
      await new Promise((r) => setTimeout(r, 600));
    } else {
      for (const addr of app.addresses || []) {
        await hyprRequest(`dispatch closewindow address:${addr}`).catch(() => {});
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    const still = (await list()).some((a) => a.process === name);
    return { running: still };
  }
  const ids = app.ids.join(',');
  const out = await powershell(force
    ? `Stop-Process -Id ${ids} -Force -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 600; `
      + `@(Get-Process -Id ${ids} -ErrorAction SilentlyContinue).Count`
    : `foreach ($p in @(Get-Process -Id ${ids} -ErrorAction SilentlyContinue)) { [void]$p.CloseMainWindow() }; `
      + 'Start-Sleep -Milliseconds 2500; '
      + `@(Get-Process -Name '${name.replace(/'/g, "''")}' -ErrorAction SilentlyContinue).Count`);
  return { running: Number(out) > 0 };
}

module.exports = { list, find, close, powershell };
