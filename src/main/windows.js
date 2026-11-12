'use strict';

// Feeds the overlay with the position of the other windows (Windows only), so Capri can
// sit on them. A small PowerShell helper does the Win32 calls; we turn its physical pixels
// into the overlay's coordinates. It also says when the window in front is another AI (ChatGPT,
// Gemini…: `ai`, the names it matched; `pages`, the ones whose own page it is in a browser; `dl`,
// a page to download one of them), for her jealousy, and never passes on a title; which game
// is in front, if one (`game`, its folder in Steam's library or another launcher's); and the USB
// sticks plugged in (`usb`, drive letters), and the last device plugged in or out (`plug`).
// close() has it close one of those pages, jealous.

const path = require('node:path');
const readline = require('node:readline');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { screen } = require('electron');

// in the installed app it sits next to the app archive (asarUnpack), where PowerShell can read it
const SCRIPT = path.join(__dirname, 'windows.ps1').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);

function startHyprlandWatch({ overlay, onUpdate, onCapriFocused }) {
  const runtimeDir = process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid()}`;
  const sig = process.env.HYPRLAND_INSTANCE_SIGNATURE;
  if (!sig) return { stop() {}, refresh() {}, close: async () => 'gone' };

  const cmdSock = path.join(runtimeDir, 'hypr', sig, '.socket.sock');
  const eventSock = path.join(runtimeDir, 'hypr', sig, '.socket2.sock');

  let stopped = false;
  let eventClient = null;
  let pollTimer = null;
  let debounceTimer = null;

  function request(cmd) {
    return new Promise((resolve, reject) => {
      const client = net.createConnection(cmdSock, () => client.write(cmd));
      const chunks = [];
      client.on('data', (d) => chunks.push(d));
      client.on('end', () => resolve(Buffer.concat(chunks).toString()));
      client.on('error', reject);
      setTimeout(() => { client.destroy(); reject(new Error('timeout')); }, 1000);
    });
  }

  async function update() {
    if (stopped || !overlay || overlay.isDestroyed()) return;
    try {
      const [clientsRaw, activeRaw, wsRaw] = await Promise.all([
        request('j/clients'),
        request('j/activewindow'),
        request('j/activeworkspace'),
      ]);
      const clients = JSON.parse(clientsRaw);
      const active = JSON.parse(activeRaw);
      const activeWs = JSON.parse(wsRaw);

      const capriWin = clients.find((c) => c.class === 'capri-desktop');
      if (capriWin && activeWs?.id && capriWin.workspace?.id !== activeWs.id) {
        syncCapriWorkspace();
      }
      if (active.class === 'capri-desktop') {
        onCapriFocused?.();
      }

      let fg = active.class === 'capri-desktop' ? null : active.address;
      if (!fg) {
        const sorted = clients
          .filter((c) => c.class !== 'capri-desktop' && (c.workspace?.id === activeWs.id || c.pinned))
          .sort((a, b) => a.focusHistoryID - b.focusHistoryID);
        if (sorted.length > 0) fg = sorted[0].address;
      }

      const bounds = overlay.getBounds();
      const wins = [];
      const ai = [];
      let game = null;

      for (const c of clients) {
        if (!c.mapped || c.hidden || c.class === 'capri-desktop') continue;
        if (c.workspace?.id !== activeWs.id && !c.pinned) continue;

        const x = c.at[0] - bounds.x;
        const y = c.at[1] - bounds.y;
        const w = c.size[0];
        const h = c.size[1];

        if (x < bounds.width && x + w > 0 && y < bounds.height && y + h > 0) {
          wins.push({
            id: c.address,
            x,
            y,
            w,
            h,
            max: c.fullscreen !== 0,
          });
        }

        const cls = (c.class || '').toLowerCase();
        const title = (c.title || '').toLowerCase();
        if (cls.includes('chatgpt') || title.includes('chatgpt')) ai.push('chatgpt');
        if (cls.includes('claude') || title.includes('claude')) ai.push('claude');
        if (cls.includes('gemini') || title.includes('gemini')) ai.push('gemini');
        if (cls.startsWith('steam_app_') || cls.includes('deadlock')) game = c.title;
      }

      onUpdate({
        fg,
        taskbar: false,
        ai,
        pages: [],
        dl: false,
        game,
        usb: [],
        plug: null,
        wins,
      });
    } catch {
      // transient parse error during rapid state change
    }
  }

  function scheduleUpdate() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(update, 50);
  }

  function syncCapriWorkspace() {
    request(
      'dispatch function() local ws = hl.get_active_workspace(); if ws then for _, w in ipairs(hl.get_windows()) do if w.class == "capri-desktop" and w.workspace and w.workspace.id ~= ws.id then hl.dispatch(hl.dsp.window.move({ window = w, workspace = ws.id, follow = false })) end end end end'
    ).catch(() => {});
  }

  function connectEvents() {
    if (stopped) return;
    try {
      eventClient = net.createConnection(eventSock);
      readline.createInterface({ input: eventClient }).on('line', (line) => {
        if (line.startsWith('workspace>>') || line.startsWith('focusedmon>>')) {
          syncCapriWorkspace();
        }
        if (line.startsWith('activewindow>>capri-desktop')) {
          setTimeout(() => onCapriFocused?.(), 40);
        }
        if (
          line.startsWith('workspace>>') ||
          line.startsWith('focusedmon>>') ||
          line.startsWith('activewindow>>') ||
          line.startsWith('movewindow>>') ||
          line.startsWith('openwindow>>') ||
          line.startsWith('closewindow>>') ||
          line.startsWith('fullscreen>>') ||
          line.startsWith('changefloatingmode>>')
        ) {
          scheduleUpdate();
        }
      });
      eventClient.on('error', () => {});
      eventClient.on('close', () => {
        if (!stopped) setTimeout(connectEvents, 2000);
      });
    } catch {
      if (!stopped) setTimeout(connectEvents, 2000);
    }
  }

  connectEvents();
  pollTimer = setInterval(update, 2000);
  update();

  return {
    stop() {
      stopped = true;
      clearTimeout(debounceTimer);
      clearInterval(pollTimer);
      eventClient?.destroy();
    },
    refresh: update,
    async close(id) {
      if (!id) return 'gone';
      try {
        await request(`dispatch closewindow address:${id}`);
        return '';
      } catch {
        return 'gone';
      }
    },
  };
}

function startWindowWatch({ overlay, onUpdate, onCapriFocused }) {
  if (process.platform === 'linux' && process.env.HYPRLAND_INSTANCE_SIGNATURE) {
    return startHyprlandWatch({ overlay, onUpdate, onCapriFocused });
  }
  if (process.platform !== 'win32') return { stop() {}, refresh() {}, close: async () => 'windows' };

  let child = null;
  let stopped = false;
  let restarts = 0;
  let last = null; // the helper's last snapshot: it only speaks when something changes
  let asks = 0;
  const asked = new Map(); // what we asked the helper, waiting for its answer: number -> resolve

  const handle = overlay.getNativeWindowHandle();
  const self = handle.length >= 8 ? handle.readBigUInt64LE(0) : BigInt(handle.readUInt32LE(0));

  const toOverlay = (win, bounds) => {
    const dip = screen.screenToDipRect(null, { x: win.x, y: win.y, width: win.w, height: win.h });
    return { id: win.id, x: dip.x - bounds.x, y: dip.y - bounds.y, w: dip.width, h: dip.height, max: win.max };
  };

  // the snapshot as seen from her window, wherever it is now
  const send = () => {
    if (!last || overlay.isDestroyed()) return;
    const bounds = overlay.getBounds();
    const wins = last.wins
      .map((w) => toOverlay(w, bounds))
      // only what overlaps Capri's screen
      .filter((w) => w.x < bounds.width && w.x + w.w > 0 && w.y < bounds.height && w.y + w.h > 0);
    onUpdate({
      fg: last.fg, taskbar: Boolean(last.taskbar), ai: Array.isArray(last.ai) ? last.ai : [],
      pages: Array.isArray(last.pages) ? last.pages : [], dl: Boolean(last.dl),
      game: last.game || null, usb: Array.isArray(last.usb) ? last.usb : [], plug: last.plug || null, wins,
    });
  };

  const answer = (n, why) => {
    asked.get(n)?.(why);
    asked.delete(n);
  };

  const start = () => {
    child = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', SCRIPT, String(self), String(process.pid),
    ], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });

    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      if ('closed' in msg) return answer(msg.closed, String(msg.why ?? 'error'));
      last = msg;
      send();
    });
    child.stdin.on('error', () => {}); // it went away: its exit says so
    child.stderr.on('data', (d) => console.error('[capri] window watch:', String(d).trim()));
    child.on('exit', () => {
      child = null;
      for (const n of [...asked.keys()]) answer(n, 'gone');
      if (!stopped && restarts++ < 3) setTimeout(start, 3000);
    });
  };

  start();
  return {
    stop() {
      stopped = true;
      child?.kill();
    },
    // her window moved (another screen, the taskbar in it or not): the same windows, from there
    refresh: send,
    // Close the page of AI `key` (a tab, Ctrl+W) in window `id`, if it's still that page and in
    // front: '' once done, else why not ('front', 'browser', 'page', 'keys', 'gone', 'late').
    close(id, key) {
      if (!child) return Promise.resolve('gone');
      const n = ++asks;
      return new Promise((resolve) => {
        asked.set(n, resolve);
        child.stdin.write(`close ${Math.trunc(Number(id)) || 0} ${String(key).replace(/\W/g, '')} ${n}\n`);
        setTimeout(() => answer(n, 'late'), 3000);
      });
    },
  };
}

module.exports = { startWindowWatch };
