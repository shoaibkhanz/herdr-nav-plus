# herdr-nav-plus

herdr moves between panes with `prefix+h/j/k/l`, and switching to another
workspace means opening the picker (`prefix+w`) — a different key and a mode
switch. **herdr-nav-plus** gives you direct vim-style `Ctrl+h/j/k/l` that flows
straight from pane to workspace: one chord, no prefix, no mode switch. The
vertical walk **wraps**, so `Ctrl+j` past the last workspace loops to the first
and `Ctrl+k` past the first loops to the last.

Same chords, same muscle memory, one more layer of reach.

```
                     hold  Ctrl  +

       ┌─────┐   ┌─────┐   ┌─────┐   ┌─────┐
       │  H  │   │  J  │   │  K  │   │  L  │
       └─────┘   └─────┘   └─────┘   └─────┘
          ◄         ▼         ▲         ►

       ┌╌╌╌╌╌┐   ┌╌╌╌╌╌┐   tab cycling — a herdr built-in (optional,
       ╎  P  ╎   ╎  N  ╎   separate from nav-plus): prefix+p / prefix+n,
       └╌╌╌╌╌┘   └╌╌╌╌╌┘   or opt-in direct Ctrl+P / Ctrl+N
        prev       next
```

| Chord | Within a pane grid | At the grid edge |
|-------|--------------------|------------------|
| `Ctrl+H` | focus pane to the **left** | stop (pane-only) |
| `Ctrl+L` | focus pane to the **right** | stop (pane-only) |
| `Ctrl+J` | focus pane **below** | **next workspace**, wrapping to the first ↻ |
| `Ctrl+K` | focus pane **above** | **previous workspace**, wrapping to the last ↻ |

Workspaces live on the **vertical** sidebar axis, so only `Ctrl+J` / `Ctrl+K`
extend into them; `Ctrl+H` / `Ctrl+L` stay pane-only. `↻` = wraps around, so the
list is a single cycle you can walk forever in either direction.

> [!NOTE]
> **Credit.** The Vim/Neovim foreground detection and the editor-callback pattern
> are adapted from
> [`vim-herdr-navigation`](https://github.com/paulbkim-dev/vim-herdr-navigation)
> by paulbkim-dev (itself a port of
> [`vim-tmux-navigator`](https://github.com/christoomey/vim-tmux-navigator)).
> This is an independent plugin, not affiliated with or endorsed by that project;
> it reuses that technique and adds the workspace layer.

## The idea

herdr's sidebar is a flat vertical list of **workspaces** (each row rolls up the
status of the agents inside it — see herdr's
[concepts docs](https://herdr.dev/docs/concepts/#workspace)). This plugin makes
the vertical navigation chord flow off the pane grid and into that list:

```
Vim split  →  herdr pane  →  workspace (sidebar)  ↻ wraps
   ^ Ctrl+j / Ctrl+k, one press per hop
```

Navigation is deterministic and positional: each press moves to the adjacent
workspace in sidebar order, never to a "most urgent" or priority target. Because
the list forms a single cycle, you can keep moving in either direction.

On each hop the plugin does two things so you always see where you landed:

1. **Focus it** — `herdr workspace focus`, so herdr's own sidebar highlights the
   focused row.
2. **Toast it** — a top-right notification names the target and your position in
   the walk, e.g. `▸ my-project` / `workspace 2/6`.

## Install

Requires **herdr `>= 0.7.0`** and **Node.js** on your `PATH`. Plain JavaScript,
no dependencies, no build step.

**From GitHub** (recommended once published):

```bash
herdr plugin install shoaibkhanz/herdr-nav-plus
```

**Local development** (a working copy you edit in place):

```bash
herdr plugin link /path/to/herdr-nav-plus
```

Confirm it registered and inspect its actions:

```bash
herdr plugin list
herdr plugin action list --plugin herdr-nav-plus
```

## Configure

This plugin ships **no keybinding of its own** — you bind the four direct chords
yourself, then reload the config:

```bash
herdr server reload-config
```

> [!NOTE]
> These four `[[keys.command]]` entries bind `Ctrl+h/j/k/l` to the plugin. Like
> any vim-style navigator, that means `Ctrl+L` / `Ctrl+K` drive navigation rather
> than shell clear-screen / kill-line inside non-Vim panes — swap `ctrl+` for
> `alt+` if you'd rather keep those. Already bind these keys to another nav
> plugin? Just replace those entries.

Add to `~/.config/herdr/config.toml`:

```toml
[[keys.command]]
key = "ctrl+h"
type = "plugin_action"
command = "herdr-nav-plus.left"
description = "navigate left (vim/pane)"

[[keys.command]]
key = "ctrl+j"
type = "plugin_action"
command = "herdr-nav-plus.down"
description = "navigate down (vim/pane/workspace)"

[[keys.command]]
key = "ctrl+k"
type = "plugin_action"
command = "herdr-nav-plus.up"
description = "navigate up (vim/pane/workspace)"

[[keys.command]]
key = "ctrl+l"
type = "plugin_action"
command = "herdr-nav-plus.right"
description = "navigate right (vim/pane)"
```

You can also invoke an action without a key:

```bash
herdr plugin action invoke down --plugin herdr-nav-plus
```

### Editor integration (recommended — for Vim → workspace too)

The keybindings above already give you pane → workspace from any non-Vim pane.
To also cross out of **Neovim/Vim** at a split edge into a workspace (when the
Vim pane is itself at the pane-grid edge), wire your editor to the `edge-*`
actions. Load only **one** herdr navigation editor map.

**Neovim** — drop the map in `after/plugin` so it wins over other `<C-h/j/k/l>`:

```bash
cp editor/nvim.lua ~/.config/nvim/after/plugin/herdr_nav.lua
```

or, with lazy.nvim, fold it into the `vim-tmux-navigator` spec:

```lua
{
  "christoomey/vim-tmux-navigator",
  lazy = false,
  init = function()
    vim.g.tmux_navigator_no_mappings = 1
  end,
  config = function()
    dofile(vim.fn.expand("/path/to/herdr-nav-plus/editor/nvim.lua"))
  end,
}
```

**Vim** — from your `vimrc`:

```vim
source /path/to/herdr-nav-plus/editor/vim.vim
```

The `edge-*` actions skip the Vim-forward step, so the chord never bounces back
into Vim.

### Pass-through for other full-screen TUIs

`HERDR_NAV_PASSTHROUGH_RE` is an anchored regex (matched on the lower-cased
foreground process name) of non-Vim TUIs that own `Ctrl+h/j/k/l` themselves
(e.g. `lazygit`, `k9s`). Matching panes get the chord forwarded instead of
moving focus. Empty (the default) forwards only Vim. Set it where you launch
herdr:

```bash
export HERDR_NAV_PASSTHROUGH_RE='^(lazygit|k9s)$'
```

## How it works

herdr's focus always lives *on a pane*; there is no "focus is in the sidebar"
state to read. So the plugin keeps a tiny cursor recording where you are in the
workspace ring and the pane it last landed you on (under
`HERDR_PLUGIN_STATE_DIR`, the directory herdr provides for plugin state). On each
press:

1. If the focused pane runs Vim/Neovim, the chord is forwarded so Vim moves its
   own split (borrowed foreground detection — see credit above).
2. Otherwise, if there is a pane in that direction (`herdr pane edges`), herdr's
   pane focus moves.
3. Otherwise, at a **vertical** pane-grid edge, it walks the ring with `herdr
   workspace focus`, wrapping at both ends.

If you move focus by any other means (a click, `prefix+w`, the picker), the next
press notices the focused pane no longer matches the cursor and **resyncs to the
live focused workspace** — so the walk always resumes from where you actually are.

## Why not vim-herdr-navigation (or a built-in)?

| Axis of motion            | vim-herdr-navigation | herdr built-ins                     | **herdr-nav-plus**                 |
|---------------------------|----------------------|-------------------------------------|------------------------------------|
| Vim split ↔ herdr pane    | yes                  | pane focus keys                     | yes (preserved)                    |
| Pane → workspace at edge  | —                    | picker `prefix+w` (its own key)     | yes (same chord, fall-through)     |
| Wraps around the list     | —                    | depends                             | yes (single cycle, both ends)      |
| Model                     | vim/pane only        | separate keys, no fall-through      | one chord flows pane → workspace   |

The built-ins solve part of this on **their own keys**: the workspace picker
(`prefix+w`) and session navigator (`prefix+g`) open a selection surface, and
`next_workspace` / `previous_workspace` step through workspaces once you bind them
(both unset by default). The point here is a single directional chord that flows
pane → workspace with no mode switch and no extra key.

## Notes

- **Panes take precedence at every step.** If the focused workspace has more than
  one pane, `Ctrl+j` there moves between those panes *before* crossing into the
  next workspace — the same rule that keeps pane navigation intact everywhere.
- **Shell/readline shadowing.** In non-Vim panes, `Ctrl+L` (clear screen) and
  `Ctrl+K` (kill-line) are shadowed by navigation. This is inherent to any direct
  `Ctrl+h/j/k/l` navigator. If you want them back, bind navigation to
  `alt+h/j/k/l` instead (change each `key = "ctrl+…"` above to `key = "alt+…"`).
- **Ordering.** Workspaces walk by their herdr `number` (the sidebar order), with
  `workspace_id` as the tiebreak.
- **Single workspace = no-op.** With only one workspace there is nowhere to walk,
  so at a vertical edge the chord simply stops.

### Optional: cycling tabs

Tab cycling is **not part of this plugin** and needs no setup — herdr already
cycles tabs within a workspace out of the box with `prefix+n` / `prefix+p` (the
built-in `next_tab` / `previous_tab`). Behind the prefix they conflict with
nothing, so this is the recommended way and there is nothing to configure.

If you specifically want *prefix-free* direct chords to match the `Ctrl+h/j/k/l`
flow, you can rebind them — but `Ctrl+N` / `Ctrl+P` collide with Neovim's
`<C-n>` / `<C-p>` completion and shell/fzf history, so treat this as opt-in:

```toml
[keys]
next_tab = "ctrl+n"      # or "alt+n" to avoid the conflicts above
previous_tab = "ctrl+p"  # or "alt+p"
```

> [!NOTE]
> Rebinding a built-in action is a startup-only setting, so reattach the client
> (`<prefix> q`, then `herdr`) after editing rather than just reloading. If the
> keys still do nothing, your terminal may be intercepting `Ctrl+N` / `Ctrl+P` —
> use `alt+n` / `alt+p` instead.

To cycle *panes* rather than tabs, use herdr's `cycle_pane_next` /
`cycle_pane_previous` (defaults `prefix+tab` / `prefix+shift+tab`).

## Development

The walk logic is a set of pure functions — `selectTarget(ring, opts)`,
`describeTarget(ring, index)`, and the ordering/ring builders — separated from
the herdr I/O in `main()`. The end-to-end orchestration is tested against a fake
`herdr` through the `HERDR_BIN_PATH` seam the plugin already accepts, so the full
chain is covered with no real herdr binary and no mocks. Run it with Node's
built-in test runner:

```bash
node --test
```

## License

MIT — see [LICENSE](LICENSE).
