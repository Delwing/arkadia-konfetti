/**
 * Konfetti - a celebration plugin for the Arkadia Web Client.
 *
 * Watches `Char.State.improve` (GMCP) and, the moment it reaches the top of the
 * improve ladder (15 = "niebotyczne"), sprays confetti over the main game
 * output. Everything is drawn on a single throwaway canvas that is pinned to
 * the output's bounding box, sits above it with `pointer-events: none`, and is
 * removed as soon as the last piece falls out of view - the client's own DOM is
 * never touched.
 *
 * `/konfetti` (or `/confetti`) fires a test burst and configures the plugin.
 *
 * See README.md for build / host / publish details.
 */

import type { PluginApi, PluginInfo } from '@arkadia/plugin-types';

const PLUGIN_NAME = 'Konfetti';
const PLUGIN_VERSION = '1.0.0';
const PLUGIN_AUTHOR = 'Dargoth';
const PLUGIN_DESCRIPTION =
  'Konfetti nad glownym oknem gry, kiedy wbijesz niebotyczne postepy. Sterowanie: /konfetti (albo /confetti).';

/**
 * Top of the improve ladder. `Char.State.improve` counts 0..15, where 15 is
 * "niebotyczne" - the state the client's own improve counter labels as the
 * last one before the improvements are absorbed.
 */
const MAX_IMPROVE = 15;

const SETTINGS_KEY = 'plugin:konfetti:settings';

/** Where the confetti is drawn. First selector that resolves wins. */
const OUTPUT_SELECTORS = ['#main_text_output_msg_wrapper', '#game-output', '.game-output'];

/** Above popups (~1104), below the output context menu (10100). */
const OVERLAY_Z_INDEX = 1105;

const COLORS = [
  '#ffd700',
  '#ff6b6b',
  '#4ecdc4',
  '#c77dff',
  '#7ee787',
  '#ffa62b',
  '#5fa8ff',
  '#ff8fab',
  '#f8f8f2',
];

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

interface KonfettiSettings {
  /** Master switch for the automatic burst on max improve. */
  enabled: boolean;
  /** Piece-count multiplier, 0.25..3. */
  intensity: number;
  /** How long pieces keep falling, in milliseconds. */
  durationMs: number;
  /** Print a line in the output alongside the burst. */
  announce: boolean;
  /** Skip the animation when the OS asks for reduced motion. */
  respectReducedMotion: boolean;
}

const DEFAULT_SETTINGS: KonfettiSettings = {
  enabled: true,
  intensity: 1,
  durationMs: 3200,
  announce: true,
  respectReducedMotion: true,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function loadSettings(): KonfettiSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<KonfettiSettings>;
    return {
      enabled: parsed.enabled !== false,
      intensity:
        typeof parsed.intensity === 'number' && Number.isFinite(parsed.intensity)
          ? clamp(parsed.intensity, 0.25, 3)
          : DEFAULT_SETTINGS.intensity,
      durationMs:
        typeof parsed.durationMs === 'number' && Number.isFinite(parsed.durationMs)
          ? clamp(parsed.durationMs, 800, 12000)
          : DEFAULT_SETTINGS.durationMs,
      announce: parsed.announce !== false,
      respectReducedMotion: parsed.respectReducedMotion !== false,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(settings: KonfettiSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Private mode or a full quota - the burst still works, it just forgets.
  }
}

// ---------------------------------------------------------------------------
// Confetti engine
// ---------------------------------------------------------------------------

type Shape = 'rect' | 'ribbon' | 'circle';

interface Piece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  width: number;
  height: number;
  color: string;
  shape: Shape;
  /** Rotation around the piece's own centre, radians. */
  angle: number;
  spin: number;
  /** Phase of the flutter that squashes the piece as it "turns" edge-on. */
  wobble: number;
  wobbleSpeed: number;
  /** Sideways drift amplitude, px per frame at full wobble. */
  drift: number;
  ttl: number;
  age: number;
}

/** One frame at 60 fps, used to keep the physics frame-rate independent. */
const FRAME_MS = 1000 / 60;
const GRAVITY = 0.32;
const AIR_DRAG = 0.985;

function pick<T>(values: readonly T[]): T {
  return values[Math.floor(Math.random() * values.length)];
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function findOutput(): HTMLElement {
  for (const selector of OUTPUT_SELECTORS) {
    const element = document.querySelector<HTMLElement>(selector);
    if (element) return element;
  }
  return document.body;
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * A canvas pinned over the game output that runs a single confetti burst and
 * tears itself down when the last piece is gone. Bursts that arrive while one
 * is running just add pieces to it.
 */
class ConfettiOverlay {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private pieces: Piece[] = [];
  private frame: number | null = null;
  private lastTime = 0;
  private width = 0;
  private height = 0;

  /** Sprays `intensity`-scaled confetti for `durationMs`. */
  burst(intensity: number, durationMs: number): void {
    const canvas = this.ensureCanvas();
    if (!canvas) return;
    this.syncToOutput();
    if (this.width <= 0 || this.height <= 0) {
      this.teardown();
      return;
    }

    const count = Math.round(clamp(intensity, 0.25, 3) * 170);
    const ttl = durationMs;

    // Two corner cannons throw the bulk of the pieces up and inwards, and a
    // thin rain from above fills the middle of the window while they fall.
    const perCannon = Math.round(count * 0.4);
    this.spawnCannon(perCannon, 'left', ttl);
    this.spawnCannon(perCannon, 'right', ttl);
    this.spawnRain(count - perCannon * 2, ttl);

    this.start();
  }

  /** Drops everything: pieces, canvas, animation frame. */
  destroy(): void {
    this.pieces = [];
    this.teardown();
  }

  private ensureCanvas(): HTMLCanvasElement | null {
    if (this.canvas) return this.canvas;
    const canvas = document.createElement('canvas');
    canvas.setAttribute('data-konfetti', '');
    canvas.style.position = 'fixed';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = String(OVERLAY_Z_INDEX);
    canvas.style.left = '0';
    canvas.style.top = '0';
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    document.body.appendChild(canvas);
    this.canvas = canvas;
    this.ctx = ctx;
    return canvas;
  }

  /**
   * Matches the canvas to the output's current box. Called every frame so the
   * burst survives a resize, a docked popup, or a layout change mid-flight.
   */
  private syncToOutput(): void {
    const canvas = this.canvas;
    if (!canvas) return;
    const rect = findOutput().getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(0, Math.round(rect.width));
    const height = Math.max(0, Math.round(rect.height));

    canvas.style.transform = `translate(${Math.round(rect.left)}px, ${Math.round(rect.top)}px)`;
    if (width !== this.width || height !== this.height) {
      this.width = width;
      this.height = height;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    this.ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private spawnCannon(count: number, side: 'left' | 'right', ttl: number): void {
    const fromLeft = side === 'left';
    const originX = fromLeft ? -10 : this.width + 10;
    const originY = this.height + 10;
    for (let i = 0; i < count; i++) {
      const speed = randomBetween(11, 20);
      // Aimed at roughly 55 degrees up and inwards, with a wide spread.
      const angle = randomBetween(-1.35, -0.55);
      const dirX = Math.cos(angle) * (fromLeft ? 1 : -1);
      this.pieces.push(
        this.makePiece(originX, originY, dirX * speed, Math.sin(angle) * speed, ttl),
      );
    }
  }

  private spawnRain(count: number, ttl: number): void {
    for (let i = 0; i < count; i++) {
      this.pieces.push(
        this.makePiece(
          randomBetween(0, this.width),
          randomBetween(-this.height * 0.5, -10),
          randomBetween(-2, 2),
          randomBetween(1, 5),
          ttl,
        ),
      );
    }
  }

  private makePiece(x: number, y: number, vx: number, vy: number, ttl: number): Piece {
    const shape = pick<Shape>(['rect', 'rect', 'ribbon', 'circle']);
    const size = randomBetween(6, 12);
    return {
      x,
      y,
      vx,
      vy,
      width: shape === 'ribbon' ? size * 0.45 : size,
      height: shape === 'ribbon' ? size * 1.9 : size * randomBetween(0.55, 1),
      color: pick(COLORS),
      shape,
      angle: randomBetween(0, Math.PI * 2),
      spin: randomBetween(-0.22, 0.22),
      wobble: randomBetween(0, Math.PI * 2),
      wobbleSpeed: randomBetween(0.06, 0.16),
      drift: randomBetween(0.4, 1.6),
      ttl: ttl * randomBetween(0.75, 1.15),
      age: 0,
    };
  }

  private start(): void {
    if (this.frame !== null) return;
    this.lastTime = performance.now();
    this.frame = requestAnimationFrame(this.tick);
  }

  private tick = (now: number): void => {
    this.frame = null;
    // A backgrounded tab hands back a huge delta; cap it so nothing teleports.
    const delta = clamp((now - this.lastTime) / FRAME_MS, 0, 3);
    this.lastTime = now;

    this.syncToOutput();
    const ctx = this.ctx;
    if (!ctx) {
      this.teardown();
      return;
    }
    ctx.clearRect(0, 0, this.width, this.height);

    const alive: Piece[] = [];
    for (const piece of this.pieces) {
      piece.age += delta * FRAME_MS;
      piece.wobble += piece.wobbleSpeed * delta;
      piece.vy = piece.vy * Math.pow(AIR_DRAG, delta) + GRAVITY * delta;
      piece.vx = piece.vx * Math.pow(AIR_DRAG, delta);
      piece.x += (piece.vx + Math.cos(piece.wobble) * piece.drift) * delta;
      piece.y += piece.vy * delta;
      piece.angle += piece.spin * delta;

      const fading = piece.age > piece.ttl;
      // Fade over the last 600 ms rather than blinking out.
      const alpha = fading ? clamp(1 - (piece.age - piece.ttl) / 600, 0, 1) : 1;
      if (alpha <= 0 || piece.y - piece.height > this.height) continue;

      this.draw(ctx, piece, alpha);
      alive.push(piece);
    }
    this.pieces = alive;

    if (this.pieces.length === 0) {
      this.teardown();
      return;
    }
    this.frame = requestAnimationFrame(this.tick);
  };

  private draw(ctx: CanvasRenderingContext2D, piece: Piece, alpha: number): void {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(piece.x, piece.y);
    ctx.rotate(piece.angle);
    // Squashing along Y sells the piece turning edge-on as it flutters.
    ctx.scale(1, Math.abs(Math.cos(piece.wobble)) * 0.8 + 0.2);
    ctx.fillStyle = piece.color;
    if (piece.shape === 'circle') {
      ctx.beginPath();
      ctx.arc(0, 0, piece.width / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillRect(-piece.width / 2, -piece.height / 2, piece.width, piece.height);
    }
    ctx.restore();
  }

  private teardown(): void {
    if (this.frame !== null) {
      cancelAnimationFrame(this.frame);
      this.frame = null;
    }
    this.canvas?.remove();
    this.canvas = null;
    this.ctx = null;
    this.width = 0;
    this.height = 0;
  }
}

// ---------------------------------------------------------------------------
// Plugin entry points
// ---------------------------------------------------------------------------

let overlay: ConfettiOverlay | null = null;
let settings: KonfettiSettings = { ...DEFAULT_SETTINGS };
let aliasIds: string[] = [];
let pluginApi: PluginApi | null = null;
/** Last `Char.State.improve` seen; null until the first reading after login. */
let lastImprove: number | null = null;
/**
 * Event listeners are the one registration the host does not unwind on its own
 * - `PluginApi.cleanup()` tracks aliases, popups and menu entries, but `on()`
 * goes straight to the client - so they are unsubscribed by hand in destroy().
 */
let listeners: Array<() => void> = [];

function fire(): void {
  if (settings.respectReducedMotion && prefersReducedMotion()) return;
  if (!overlay) overlay = new ConfettiOverlay();
  overlay.burst(settings.intensity, settings.durationMs);
}

function announce(api: PluginApi): void {
  const gold = api.colors.fromHex('#ffd700');
  const buffer = new api.AnsiAwareBuffer('*** NIEBOTYCZNE! ***', gold);
  api.output.print(buffer);
}

function status(api: PluginApi): void {
  api.output.print(
    `--- Konfetti: ${settings.enabled ? 'wlaczone' : 'wylaczone'}, sila ${Math.round(
      settings.intensity * 100,
    )}%, czas ${(settings.durationMs / 1000).toFixed(1)}s, komunikat ${
      settings.announce ? 'wlaczony' : 'wylaczony'
    }.`,
  );
}

function handleCommand(api: PluginApi, rawArgs: string | undefined): void {
  const args = (rawArgs ?? '').trim().toLowerCase();

  if (args === '') {
    fire();
    return;
  }

  if (args === 'on' || args === 'wlacz') {
    settings.enabled = true;
    saveSettings(settings);
    api.output.print('--- Konfetti: wlaczone przy niebotycznych.');
    return;
  }

  if (args === 'off' || args === 'wylacz') {
    settings.enabled = false;
    saveSettings(settings);
    api.output.print('--- Konfetti: wylaczone.');
    return;
  }

  if (args === 'status') {
    status(api);
    return;
  }

  const intensity = args.match(/^(?:sila|moc)\s+([0-9]+)$/);
  if (intensity) {
    settings.intensity = clamp(parseInt(intensity[1], 10) / 100, 0.25, 3);
    saveSettings(settings);
    api.output.print(`--- Konfetti: sila ${Math.round(settings.intensity * 100)}%.`);
    return;
  }

  const duration = args.match(/^czas\s+([0-9]+(?:[.,][0-9]+)?)$/);
  if (duration) {
    settings.durationMs = clamp(parseFloat(duration[1].replace(',', '.')) * 1000, 800, 12000);
    saveSettings(settings);
    api.output.print(`--- Konfetti: czas ${(settings.durationMs / 1000).toFixed(1)}s.`);
    return;
  }

  const announceArg = args.match(/^komunikat\s+(on|off|wlacz|wylacz)$/);
  if (announceArg) {
    settings.announce = announceArg[1] === 'on' || announceArg[1] === 'wlacz';
    saveSettings(settings);
    api.output.print(`--- Konfetti: komunikat ${settings.announce ? 'wlaczony' : 'wylaczony'}.`);
    return;
  }

  api.output.print(
    '--- Konfetti: /konfetti [on|off|status|sila <procent>|czas <sekundy>|komunikat on|off]',
  );
}

export async function init(api: PluginApi): Promise<PluginInfo> {
  pluginApi = api;
  settings = loadSettings();
  overlay = new ConfettiOverlay();

  const onState = (raw: unknown): void => {
    const improve = (raw as { improve?: unknown } | null)?.improve;
    if (typeof improve !== 'number') return;

    const previous = lastImprove;
    lastImprove = improve;

    // The first reading after login (or after a character swap) is only a
    // baseline - logging in already at the top must not throw confetti.
    if (previous === null) return;
    // Anything that is not a climb is the counter resetting after absorption.
    if (improve <= previous) return;
    if (previous >= MAX_IMPROVE || improve < MAX_IMPROVE) return;

    if (!settings.enabled) return;
    fire();
    if (settings.announce) announce(api);
  };

  const onReset = (): void => {
    lastImprove = null;
  };

  api.events.on('gmcp.char.state', onState);
  api.events.on('reset', onReset);
  api.events.on('client.disconnect', onReset);
  listeners = [
    () => api.events.off('gmcp.char.state', onState),
    () => api.events.off('reset', onReset),
    () => api.events.off('client.disconnect', onReset),
  ];

  for (const pattern of [/^\/konfetti(?:\s+([\s\S]+))?$/, /^\/confetti(?:\s+([\s\S]+))?$/]) {
    aliasIds.push(
      api.aliases.register(pattern, (matches) => {
        handleCommand(api, matches?.[1]);
        return true;
      }),
    );
  }

  return {
    name: PLUGIN_NAME,
    version: PLUGIN_VERSION,
    author: PLUGIN_AUTHOR,
    description: PLUGIN_DESCRIPTION,
  };
}

export async function destroy(): Promise<void> {
  // The host calls destroy() with no arguments, so use the api captured at init.
  for (const off of listeners) off();
  listeners = [];
  for (const id of aliasIds) pluginApi?.aliases.remove(id);
  aliasIds = [];
  pluginApi = null;
  overlay?.destroy();
  overlay = null;
  lastImprove = null;
}
