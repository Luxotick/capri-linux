# Capri Desktop — Linux & Hyprland

Linux & Hyprland adaptation of [mochiiwuff/capri-desktop](https://github.com/mochiiwuff/capri-desktop) (licensed under `PolyForm-Noncommercial-1.0.0`).

## What's Included for Linux / Hyprland

- **Hyprland Overlay & Focus Control (`src/main/main.js`, `src/main/windows.js`):**
  - Global cursor polling via Hyprland `.socket.sock` (`cursorpos`).
  - Dynamic click-through toggling via Hyprland `no_focus` window property (`hl.dsp.window.set_prop`), keeping underlying windows fully interactive (clicks, scroll, drag) while allowing Capri hover, drag, and context menu.
  - Silent workspace synchronization (`follow = false`) across Hyprland workspaces.
  - Hyprland window watcher (`startHyprlandWatch`) via `.socket.sock` and `.socket2.sock`.
- **Linux Desktop Tools (`src/main/launch.js`, `src/main/apps.js`, `src/main/system.js`, `src/main/files.js`):**
  - App & Steam game launching (`.desktop` entries via `gtk-launch` + Linux Steam libraries).
  - Media controls (`playerctl`) and PipeWire volume (`wpctl`).
  - Window listing & closing on Hyprland.
  - System info (battery via `/sys/class/power_supply`, disk via `/`, RAM, IP), region screenshot (`grim` + `slurp` + `wl-copy`), power actions (`loginctl` / `systemctl`), and local file search.

## Hyprland Window Rules

Add these rules to your Hyprland config (e.g. `~/.config/hypr/custom/rules.lua` for Hyprland 0.57+ Lua config):

```lua
hl.window_rule({match = {class = "^(capri-desktop)$" }, float = true})
hl.window_rule({match = {class = "^(capri-desktop)$" }, pin = true})
hl.window_rule({match = {class = "^(capri-desktop)$" }, border_size = 0})
hl.window_rule({match = {class = "^(capri-desktop)$" }, rounding = 0})
hl.window_rule({match = {class = "^(capri-desktop)$" }, no_shadow = true})
hl.window_rule({match = {class = "^(capri-desktop)$" }, no_blur = true})
hl.window_rule({match = {class = "^(capri-desktop)$" }, no_initial_focus = true})
hl.window_rule({match = {class = "^(capri-desktop)$" }, no_follow_mouse = true})
hl.window_rule({match = {class = "^(capri-desktop)$" }, no_focus = true})
hl.window_rule({match = {class = "^(capri-desktop)$" }, suppress_event = "maximize"})
```

## Optional Dependencies (Arch Linux)

- `playerctl` (media playback control)
- `wireplumber` (`wpctl` for volume control)
- `grim`, `slurp`, `wl-copy` (region snipping to clipboard)
- `gtk3` (`gtk-launch` for `.desktop` app launching)
