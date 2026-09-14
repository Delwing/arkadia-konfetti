# arkadia-konfetti

A celebration plugin for the [Arkadia Web Client](https://github.com/Delwing/arkadia-web-client-extension).
When `Char.State.improve` reaches the top of the ladder - 15, *niebotyczne* -
the plugin sprays confetti over the main game output.

## Files

- `plugin.ts` — the whole plugin; built into `dist/plugin.js`. Single file on
  purpose: the registry compiles the sources it is given, so the confetti engine
  and the GMCP watcher both live here.
- `plugin.json` — package manifest for the plugin registry (entry point +
  metadata). Keep its `version` in sync with `package.json` and `PLUGIN_VERSION`
  in `plugin.ts`.
- `DESCRIPTION.md` — the plugin's page in the registry, in Polish; published as
  the readme by the release workflow.

## Build

```
yarn install
yarn build
```

Outputs `dist/plugin.js`. Host the `dist/` directory anywhere reachable from the
Arkadia client.

## Develop

```
yarn dev
```

Watches sources and serves `dist/` on `http://localhost:5176`, so the plugin
entry is at `http://localhost:5176/plugin.js`. Add that URL in the client's
plugin manager, or open the client with
`?add-script=http://localhost:5176/plugin.js` once.

Type-check without building:

```
yarn typecheck
```

## How the trigger works

The client's own improve counter reads `improve` off `Char.State` (GMCP) and
treats 0..15 as the ladder from *minimalne* to *niebotyczne*. The plugin watches
the same field and fires only on the **climb into 15**:

- The first reading after login (or after `reset` / `client.disconnect`) is a
  baseline only — logging in already at *niebotyczne* must not throw confetti.
- A value that is not higher than the previous one is the counter resetting
  after the improvements are absorbed, not an achievement.
- So 14 → 15 celebrates, 15 → 15 does not, and 15 → 0 → 15 celebrates again.

## The overlay

One `<canvas data-konfetti>` is appended to `document.body`, positioned `fixed`
with `pointer-events: none` at `z-index: 1105` — above the client's popups
(~1104), below the output context menu (10100). It is pinned to the bounding box
of `#main_text_output_msg_wrapper` (with `#game-output` / `.game-output` as
fallbacks for alternate UIs) and re-synced every frame, so resizes, docked
popups and layout changes mid-flight are all handled. When the last piece falls
out of view the canvas removes itself; the client's own DOM is never touched.

`prefers-reduced-motion: reduce` suppresses the animation by default
(`/konfetti` cannot override that — it is a setting in the saved config).

## Settings

Stored in localStorage under `plugin:konfetti:settings`; cosmetic only, nothing
is ever uploaded and the plugin makes no network requests.

| Key | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | automatic burst on max improve |
| `intensity` | `1` | piece-count multiplier, clamped to 0.25..3 |
| `durationMs` | `3200` | how long pieces keep falling, clamped to 800..12000 |
| `announce` | `true` | print `*** NIEBOTYCZNE! ***` alongside the burst |
| `respectReducedMotion` | `true` | honour the OS reduced-motion setting |

## Commands

`/konfetti` and `/confetti` are the same command.

| Command | Effect |
| --- | --- |
| `/konfetti` | fire a test burst |
| `/konfetti on` / `off` | toggle the automatic burst |
| `/konfetti status` | print the current settings |
| `/konfetti sila <procent>` | intensity, 25–300 |
| `/konfetti czas <sekundy>` | duration, 0.8–12 |
| `/konfetti komunikat on\|off` | toggle the printed line |

## Hosted build

The `master` branch auto-publishes to GitHub Pages:

- Plugin: `https://delwing.github.io/arkadia-konfetti/plugin.js`

## Publishing to the plugin registry

`.github/workflows/publish.yml` publishes to
[Arkadia Plugins](https://arkadia-package-repository.vercel.app) on every `v*`
tag (or via *Run workflow*). It uploads **sources** — a ZIP of `plugin.json` +
`plugin.ts` — and the registry compiles them with esbuild, so the plugin page
shows the real code instead of a build artifact.

Authentication is GitHub OIDC (audience `arkadia-plugins`); there are no secrets
to configure. One-time setup in the registry dashboard:

1. Create the plugin under the slug `konfetti`.
2. Under *Zaufany wydawca*, set repository `Delwing/arkadia-konfetti` and
   workflow `publish.yml`.

Then release with:

```
git tag v1.0.0 && git push origin v1.0.0
```

The version comes out of the package, not out of the tag: the registry rejects a
release whose tag, `plugin.json` and `PluginInfo` disagree, so all three have to
be bumped together. The workflow only checks `package.json` itself, which the
registry never sees.

The registry listing's readme is `DESCRIPTION.md` — the Polish, player-facing
text. `README.md` (this file) is developer documentation and is not published.

## Install in the Arkadia client

1. Open the Arkadia Web Client.
2. In the plugin manager, add a plugin URL pointing to `plugin.js` — the hosted
   build above, or `http://localhost:5176/plugin.js` for local dev.
3. Type `/konfetti` to check that it works.
