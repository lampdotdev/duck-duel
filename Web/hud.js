// Everything drawn over the water: title, stage choice, joining, scoreboard, name tags, pause and results.
// Look: a bath-toy label. Chunky yellow letters outlined in deep teal, tile-white cards with a thick teal edge and a hard
// shadow, buttons that press down like rubber, and everything that floats bobs on the water.
import * as THREE from 'three';
import { glyph, onInput, WIDTH, HEIGHT } from './lamp-game.js';
import { qrCanvas } from './qr.js';
import { DUCKS } from './duck.js';
import { LEVEL, STAGES } from './water.js';
import { KILLS_TO_WIN, MAX_HP } from './play.js';

const CSS = `
:root { --ink: #0b3347; --tile: #f3fbfc; --duck: #ffc21a; --beak: #ff7a1a; --water: #1d8fb0; }
#duel, #front { color: #fff; font-family: ui-rounded, "SF Pro Rounded", -apple-system, system-ui, sans-serif; }
#duel { position: fixed; width: ${WIDTH}px; height: ${HEIGHT}px; transform-origin: 0 0; pointer-events: none; z-index: 4; text-shadow: 0 2px 6px rgba(0,30,45,.45); }
.dd-btn { display: inline-flex; align-items: center; gap: 14px; padding: 12px 26px; border-radius: 20px; background: var(--tile); color: var(--ink); text-shadow: none;
  border: 5px solid var(--ink); box-shadow: 0 8px 0 var(--ink); font-size: 36px; font-weight: 900; cursor: pointer; pointer-events: auto; transition: transform .08s, box-shadow .08s; white-space: nowrap; }
.dd-btn:active { transform: translateY(6px); box-shadow: 0 2px 0 var(--ink); }
.dd-btn.main { background: var(--duck); font-size: 52px; padding: 16px 40px; animation: bob 2.6s ease-in-out infinite; }
.dd-btn.quiet { font-size: 28px; padding: 8px 20px; box-shadow: 0 6px 0 var(--ink); background: rgba(243,251,252,.9); }
@keyframes bob { 50% { transform: translateY(-8px); } }
@keyframes float { 0%,100% { transform: translateY(0) rotate(var(--r,0deg)); } 50% { transform: translateY(-9px) rotate(calc(var(--r,0deg) + 2deg)); } }
.dd-card { background: var(--tile); color: var(--ink); text-shadow: none; border: 6px solid var(--ink); border-radius: 34px; box-shadow: 0 12px 0 var(--ink), 0 24px 50px rgba(0,30,45,.35); }

/* in play */
#duel .score { position: absolute; top: 20px; left: 0; right: 0; display: flex; justify-content: center; gap: 14px; align-items: flex-start; }
#duel .card { display: flex; flex-direction: column; gap: 6px; padding: 8px 18px 10px 12px; border-radius: 22px; background: rgba(11,51,71,.78); border: 4px solid rgba(255,255,255,.25);
  -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); box-shadow: 0 6px 0 rgba(6,30,44,.55); }
#duel .card .top { display: flex; align-items: center; gap: 10px; font-size: 34px; font-weight: 900; line-height: 1; }
#duel .card .dot { width: 30px; height: 30px; border-radius: 50%; border: 3px solid #fff; }
#duel .card .top small { font-size: 17px; font-weight: 800; opacity: .8; }
#duel .card .pips { display: flex; gap: 4px; }
#duel .card .pips i { width: 11px; height: 11px; border-radius: 50%; background: rgba(255,255,255,.2); }
#duel .card.lead { border-color: var(--duck); transform: translateY(-3px); }
#duel .card.out { opacity: .55; }
#duel .card.goal { justify-content: center; font-size: 19px; font-weight: 800; background: rgba(11,51,71,.6); border-color: transparent; }
#duel .tag { padding: 3px 12px 4px; border-radius: 16px; background: rgba(11,51,71,.72); position: absolute; left: 0; top: 0; transform: translate(-50%, -100%); font-size: 22px; font-weight: 900; text-align: center; white-space: nowrap; }
#duel .tag .hp { display: block; font-size: 22px; color: #ff6b81; letter-spacing: 2px; line-height: 1; }
#duel .tag .pw { display: block; font-size: 16px; color: #ffe27a; }
#duel .tag.far { opacity: .85; font-size: 18px; }
#duel .feed { position: absolute; left: 0; right: 0; bottom: 36px; display: flex; flex-direction: column; align-items: center; gap: 8px; }
#duel .toast { padding: 8px 22px; border-radius: 16px; background: rgba(11,51,71,.82); font-size: 28px; font-weight: 800; animation: rise 3.2s ease forwards; }
@keyframes rise { 0% { opacity: 0; transform: translateY(14px) scale(.9); } 8% { opacity: 1; transform: none; } 80% { opacity: 1; } 100% { opacity: 0; } }
#duel .big { position: absolute; left: 0; right: 0; top: 320px; text-align: center; font-size: 210px; font-weight: 900; letter-spacing: .02em; color: var(--duck);
  -webkit-text-stroke: 16px var(--ink); paint-order: stroke fill; text-shadow: 0 12px 0 rgba(11,51,71,.5); display: none; }
#duel .big.pop { display: block; animation: pop .55s cubic-bezier(.2,1.5,.4,1); }
#duel .big small { display: block; font-size: 46px; letter-spacing: 0; margin-top: -14px; }
@keyframes pop { from { transform: scale(.4); opacity: 0; } to { transform: none; opacity: 1; } }
#duel .panel { position: absolute; display: none; }
#duel .panel.on { display: block; }
#duel .legend { left: 36px; bottom: 36px; padding: 14px 22px; border-radius: 22px; background: rgba(11,51,71,.78); font-size: 25px; font-weight: 800; line-height: 1.9; border: 4px solid rgba(255,255,255,.2); }
.keyrow { display: flex; align-items: center; gap: 14px; }
.keyrow .k { min-width: 120px; display: inline-flex; }

/* pause and results */
#duel .sheet { left: 50%; top: 50%; transform: translate(-50%, -50%); padding: 34px 54px 40px; min-width: 760px; text-align: center; pointer-events: auto; }
#duel .sheet h2 { margin: 0 0 6px; font-size: 84px; font-weight: 900; color: var(--duck); -webkit-text-stroke: 12px var(--ink); paint-order: stroke fill; letter-spacing: .02em; }
#duel .sheet.on { display: block; animation: sheetin .35s cubic-bezier(.2,1.4,.4,1) both; }
@keyframes sheetin { from { transform: translate(-50%, -50%) scale(.85); } to { transform: translate(-50%, -50%); opacity: 1; } }
#duel .sheet .sub { font-size: 28px; font-weight: 800; opacity: .75; margin-bottom: 18px; }
#duel .sheet .acts { display: flex; flex-direction: column; align-items: stretch; gap: 20px; margin-top: 24px; }
#duel .sheet .acts .dd-btn { justify-content: flex-start; }
#duel .sheet .help { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 36px; text-align: left; font-size: 26px; font-weight: 800; margin: 8px 0 0; }
#duel .sheet .warn { margin-top: 22px; font-size: 28px; font-weight: 900; color: #c2381f; }
#duel .rows { display: flex; flex-direction: column; gap: 10px; margin-top: 14px; text-align: left; }
#duel .rrow { display: flex; align-items: center; gap: 16px; padding: 8px 18px; border-radius: 18px; background: #dcf0f4; font-size: 32px; font-weight: 900; }
#duel .rrow.win { background: var(--duck); transform: scale(1.04); }
#duel .rrow .rk { width: 40px; font-size: 30px; text-align: center; }
#duel .rrow .dot { width: 30px; height: 30px; border-radius: 50%; border: 4px solid var(--ink); flex: none; }
#duel .rrow .nm { flex: 1; }
#duel .rrow .nm small { font-size: 20px; opacity: .7; margin-left: 8px; }
#duel .rrow .pips { display: flex; gap: 4px; }
#duel .rrow .pips i { width: 12px; height: 12px; border-radius: 50%; background: rgba(11,51,71,.18); }
#duel .rrow .n { min-width: 120px; text-align: right; }

/* the screens before play: title, stage, joining, help */
#front { position: fixed; left: 0; top: 0; display: none; box-sizing: border-box; transform-origin: 0 0; pointer-events: none; z-index: 4; text-shadow: 0 2px 6px rgba(0,30,45,.45); }
#front.on { display: block; }
#front .scr { position: absolute; inset: 0; display: none; flex-direction: column; align-items: center; justify-content: center; padding: 30px 60px; box-sizing: border-box; gap: 28px; }
#front[data-s=title] .s-title, #front[data-s=stage] .s-stage, #front[data-s=join] .s-join { display: flex; }
#front .scrim { position: absolute; inset: 0; background: radial-gradient(70% 70% at 50% 50%, rgba(8,40,58,.0), rgba(8,40,58,.45)); }
#front h1 { margin: 0; line-height: .86; text-align: center; font-weight: 900; font-size: 210px; letter-spacing: .02em; color: var(--duck);
  -webkit-text-stroke: 26px var(--ink); paint-order: stroke fill; text-shadow: 0 14px 0 rgba(11,51,71,.55); }
#front h1 span { display: inline-block; animation: float 3.2s ease-in-out infinite; }
#front h1 .l2 { display: block; font-size: 190px; color: #fff; margin-top: 8px; }
#front h1 .l2 span { --r: -2deg; }
#front .tagline { padding: 8px 26px; border-radius: 16px; background: var(--ink); font-size: 32px; font-weight: 800; text-shadow: none; }
#front .menu { display: flex; flex-direction: column; align-items: center; gap: 22px; margin-top: 8px; }
#front .head { font-size: 76px; font-weight: 900; color: #fff; -webkit-text-stroke: 12px var(--ink); paint-order: stroke fill; letter-spacing: .02em; text-shadow: 0 8px 0 rgba(11,51,71,.5); text-align: center; line-height: 1; }
#front .foot { display: flex; gap: 28px; align-items: center; justify-content: center; }
#front .stages { display: flex; gap: 34px; justify-content: center; pointer-events: auto; }
#front .stage { position: relative; width: 430px; padding: 16px 16px 20px; text-align: center; cursor: pointer; transition: transform .12s; }
#front .stage:not(.sel) { opacity: .88; transform: scale(.94); }
#front .stage.sel { background: #fff7d1; border-color: var(--ink); box-shadow: 0 12px 0 var(--ink), 0 0 0 12px var(--duck), 0 24px 50px rgba(0,30,45,.35); animation: bob 2.6s ease-in-out infinite; }
#front .stage b { display: block; font-size: 42px; font-weight: 900; margin-top: 12px; }
#front .stage small { display: block; font-size: 24px; font-weight: 700; opacity: .75; }
#front .stage .pick { position: absolute; right: -14px; top: -18px; padding: 4px 16px; border-radius: 14px; background: var(--duck); border: 4px solid var(--ink); font-size: 24px; font-weight: 900; display: none; transform: rotate(5deg); }
#front .stage.sel .pick { display: block; }
.thumb { position: relative; height: 190px; border-radius: 18px; border: 4px solid var(--ink); overflow: hidden; }
.thumb::before, .thumb::after { content: ""; position: absolute; }
.t-tub { background: #bfe2ea; }
.t-tub::before { inset: 26px 34px; border-radius: 30px 30px 70px 70px / 30px 30px 60px 60px; border: 9px solid #fff; background: linear-gradient(#6fd0e8, #2b8fb3); box-shadow: 0 0 0 4px #9ac9d4; }
.t-tub::after { left: 50%; top: 4px; width: 18px; height: 34px; margin-left: -9px; background: #9aa7ad; border-radius: 4px 4px 9px 9px; }
.t-pond { background: #7c9a45; }
.t-pond::before { inset: 20px 26px; border-radius: 50%; background: radial-gradient(#3fa6b8, #1d6f86); box-shadow: 0 0 0 7px #5e7a30; }
.t-pond::after { left: 0; top: 0; width: 100%; height: 100%;
  background: radial-gradient(circle at 34% 40%, #4fbf5f 0 15px, transparent 16px), radial-gradient(circle at 62% 62%, #4fbf5f 0 19px, transparent 20px), radial-gradient(circle at 70% 34%, #66d070 0 12px, transparent 13px), radial-gradient(circle at 48% 74%, #ffc2de 0 7px, transparent 8px); }
.t-pool { background: #dff2f5; }
.t-pool::before { inset: 14px; border: 7px solid #fff; border-radius: 6px; background: repeating-linear-gradient(0deg, transparent 0 22px, rgba(255,255,255,.55) 22px 24px), repeating-linear-gradient(90deg, transparent 0 30px, rgba(255,255,255,.55) 30px 32px), linear-gradient(#4cc3de, #1f8fc0); }
.t-pool::after { left: 18px; right: 18px; top: 50%; height: 6px; margin-top: -3px; background: repeating-linear-gradient(90deg, #ff5f6d 0 18px, #fff 18px 36px); border-radius: 3px; opacity: .9; }
#front .join-wrap { display: flex; gap: 44px; align-items: stretch; }
#front .roster { width: 760px; padding: 24px 28px 26px; }
#front .roster h3, #front .qr h3 { margin: 0 0 12px; font-size: 38px; font-weight: 900; }
#front .roster .slot { display: flex; align-items: center; gap: 16px; padding: 8px 16px; border-radius: 16px; background: #dcf0f4; margin-top: 8px; font-size: 30px; font-weight: 900; }
#front .roster .slot.open { background: transparent; border: 4px dashed rgba(11,51,71,.35); color: rgba(11,51,71,.6); }
#front .roster .slot .dot { width: 30px; height: 30px; border-radius: 50%; border: 4px solid var(--ink); flex: none; }
#front .roster .slot .who { margin-left: auto; font-size: 22px; font-weight: 800; padding: 3px 12px; border-radius: 12px; background: var(--ink); color: #fff; }
#front .roster .slot .who.bot { background: transparent; color: rgba(11,51,71,.6); border: 3px solid rgba(11,51,71,.3); }
#front .qr { width: 400px; padding: 24px 24px 22px; text-align: center; display: flex; flex-direction: column; align-items: center; }
#front .qr canvas { width: 280px; height: 280px; border-radius: 12px; image-rendering: pixelated; border: 4px solid var(--ink); }
#front .titleqr { position: absolute; right: 48px; bottom: 48px; width: 280px; padding: 16px 16px 14px; box-sizing: border-box; text-align: center; font-size: 24px; font-weight: 900; display: flex; flex-direction: column; align-items: center; gap: 10px; }
#front .titleqr:empty { display: none; }
#front .titleqr canvas { width: 220px; height: 220px; border-radius: 8px; image-rendering: pixelated; }
#front .qr p { margin: 12px 0 0; font-size: 22px; font-weight: 700; opacity: .8; line-height: 1.3; }
#front .stagechip { padding: 6px 22px; border-radius: 14px; background: var(--ink); font-size: 28px; font-weight: 800; text-shadow: none; }
#front .credit { position: absolute; left: 0; right: 0; bottom: 10px; text-align: center; font-size: 16px; opacity: .7; font-weight: 600; }
@media (prefers-reduced-motion: reduce) { #front *, #duel *, .dd-btn { animation: none !important; transition: none !important; } }
`;

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const hearts = (n) => '<span style="margin-left:8px;color:#ff6b81;letter-spacing:1px">' + '♥'.repeat(Math.max(0, n)) + '<span style="opacity:.35">' + '♥'.repeat(Math.max(0, MAX_HP - Math.max(0, n))) + '</span></span>';
const pips = (n, color, cls) => `<span class="pips">${Array.from({ length: KILLS_TO_WIN }, (_, i) => `<i style="${i < n ? 'background:' + color : ''}"></i>`).join('')}</span>`;
const isMenu = (m) => m === 'title' || m === 'stage' || m === 'join';
const whoIs = (d) => !d.src ? 'Bot' : d.src === 'p0' ? 'Keyboard / pad' : d.src[0] === 'p' ? 'Pad ' + (+d.src.slice(1) + 1) : 'Phone';

export class Hud {
  // act(name, arg) is how a click reaches the game: the same choices the pad makes.
  constructor(camera, controls, act) {
    this.camera = camera; this.C = controls; this.act = act;
    const style = document.createElement('style'); style.textContent = CSS; document.head.append(style);
    const root = this.root = el('div'); root.id = 'duel';
    this.score = el('div', 'score');
    this.tags = DUCKS.map(() => { const t = el('div', 'tag'); t.style.display = 'none'; return t; });
    this.feed = el('div', 'feed');
    this.bigEl = el('div', 'big');
    this.legend = el('div', 'panel legend');
    this.over = el('div', 'panel sheet dd-card');
    this.pause = el('div', 'panel sheet dd-card');
    this.help = el('div', 'panel sheet dd-card');
    root.append(this.score, ...this.tags, this.feed, this.bigEl, this.legend, this.over, this.pause, this.help);

    // title
    const title = el('div', 'scr s-title');
    title.append(el('div', 'scrim'),
      el('h1', null, '<span>D</span><span style="animation-delay:-.4s">U</span><span style="animation-delay:-.8s">C</span><span style="animation-delay:-1.2s">K</span><span class="l2"><span>D</span><span style="animation-delay:-.6s">U</span><span style="animation-delay:-1.1s">E</span><span style="animation-delay:-1.7s">L</span></span>'),
      el('div', 'tagline', `Squirt the other ducks. First to pop ${KILLS_TO_WIN} wins.`));
    this.menu = el('div', 'menu'); title.append(this.menu);
    this.titleQr = el('div', 'titleqr dd-card'); title.append(this.titleQr);
    // stage
    const stage = el('div', 'scr s-stage');
    this.stageCards = STAGES.map((S, i) => {
      const c = el('div', 'stage dd-card', `<span class="pick">Your pick</span><div class="thumb t-${S.id}"></div><b>${S.name}</b><small>${S.blurb}</small>`);
      c.addEventListener('pointerdown', () => this.act('stage', i));
      return c;
    });
    const stages = el('div', 'stages'); stages.append(...this.stageCards);
    this.stageFoot = el('div', 'foot');
    stage.append(el('div', 'scrim'), el('div', 'head', 'Pick your water'), stages, this.stageFoot);
    // joining
    const join = el('div', 'scr s-join');
    this.roster = el('div', 'roster dd-card'); this.qr = el('div', 'qr dd-card');
    const jw = el('div', 'join-wrap'); jw.append(this.roster, this.qr);
    this.joinChip = el('div', 'stagechip');
    this.joinFoot = el('div', 'foot');
    join.append(el('div', 'scrim'), el('div', 'head', 'Who’s swimming?'), jw, this.joinFoot);
    const front = this.front = el('div'); front.id = 'front';
    front.append(title, stage, join, el('div', 'credit', 'Water and light adapted from CAUSTIC//VOLUME by ScottieFox (MIT license)'));
    document.body.append(root, front);
    this.keys = {}; this.link = undefined; this.linkNote = '';
    this.mode = 'title';
    window.addEventListener('resize', () => this.layout()); this.layout();
    this.v = new THREE.Vector3();
    this.setLink(null);
    onInput(() => this.drawPrompts());
  }
  layout() {
    const s = Math.min(innerWidth / WIDTH, innerHeight / HEIGHT);
    Object.assign(this.root.style, { left: (innerWidth - WIDTH * s) / 2 + 'px', top: (innerHeight - HEIGHT * s) / 2 + 'px', transform: `scale(${s})` });
    // the pre-play screens flow inside the window, scaled by a smaller height so a short window stays readable
    const fs = Math.min(innerWidth / 1920, innerHeight / 780);
    Object.assign(this.front.style, { width: innerWidth / fs + 'px', height: innerHeight / fs + 'px', transform: `scale(${fs})` });
  }

  // a button as the player's own input names it: its badge, then what it does
  btn(what, text, cls, name, arg) {
    const b = el('div', 'dd-btn ' + (cls || ''));
    const g = what && glyph(what);
    if (g) b.append(g);
    b.append(document.createTextNode(text));
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); this.act(name, arg); });
    return b;
  }
  drawPrompts() {
    const C = this.C, b = (...a) => this.btn(...a);
    this.menu.replaceChildren(b(C.fire, 'Play', 'main', 'play'), b(C.dash, 'How to play', 'quiet', 'help'));
    this.stageFoot.replaceChildren(b(C.back, 'Back', 'quiet', 'back'), b(C.move, 'Choose', 'quiet', 'noop'), b(C.fire, 'Choose players', 'main', 'next'));
    this.joinFoot.replaceChildren(b(C.back, 'Stage', 'quiet', 'back'), b(C.fire, 'Start the duel', 'main', 'start'));
    const rows = [[C.move, 'Paddle'], [C.aim, 'Aim (or just paddle)'], [C.fire, 'Squirt'], [C.dash, 'Dash'], [C.pause, 'Pause']];
    const keyrow = (what, text) => { const g = what && glyph(what); if (!g) return null; const d = el('div', 'keyrow'); const k = el('span', 'k'); k.append(g); d.append(k, document.createTextNode(text)); return d; };
    this.legend.replaceChildren(...rows.map((r) => keyrow(...r)).filter(Boolean));
    this.drawHelp(); this.drawPause(); this.drawOver();
  }
  drawHelp() {
    const C = this.C, h = this.help;
    const keyrow = (what, text) => { const g = what && glyph(what); if (!g) return null; const d = el('div', 'keyrow'); const k = el('span', 'k'); k.append(g); d.append(k, document.createTextNode(text)); return d; };
    const grid = el('div', 'help');
    grid.append(...[[C.move, 'Paddle'], [C.aim, 'Aim'], [C.fire, 'Squirt'], [C.dash, 'Dash'], [C.pause, 'Pause'], [C.back, 'Back']].map((r) => keyrow(...r)).filter(Boolean));
    const acts = el('div', 'acts'); acts.append(this.btn(C.back, 'Got it', 'main', 'help'));
    h.replaceChildren(el('h2', null, 'How to play'),
      el('div', 'sub', `Pop ${KILLS_TO_WIN} ducks to win. Grab bubbles for triple squirts, rapid fire, turbo or an extra life.`), grid,
      el('div', 'sub', 'On a phone: drag to paddle, tap Squirt.'), acts);
  }
  showHelp(on) { this.help.classList.toggle('on', on); }

  setLink(url, note) {
    if (url === this.link && note === this.linkNote) return;
    this.link = url; this.linkNote = note || '';
    let canvas = null;
    if (url) { try { canvas = qrCanvas(url, 6); } catch (e) { canvas = null; } }
    this.titleQr.replaceChildren();
    if (canvas) this.titleQr.append(el('div', null, 'Scan, then SQUIRT'), qrCanvas(url, 6));
    this.qr.replaceChildren(el('h3', null, 'Join by phone'));
    if (canvas) this.qr.append(canvas, el('p', null, 'Scan with your camera.<br>Same Wi-Fi. Up to six ducks.'));
    else if (url) this.qr.append(el('p', null, 'Open this on your phone:<br>' + String(url).replace(/[<>&]/g, '')));
    else this.qr.append(el('p', null, (note || 'Phones can join when the game is played in the Mac app.') + '<br>Controllers work now: plug in or pair up to three.'));
  }

  // which screen is up before play: 'title', 'stage', 'join' or null
  showScreen(name) {
    this.front.classList.toggle('on', !!name);
    if (name) this.front.dataset.s = name;
    this.legend.classList.remove('on'); this.help.classList.remove('on');
    this.mode = name || this.mode;
    this.keys.roster = null;
  }
  showStages(at) { this.stageCards.forEach((c, i) => c.classList.toggle('sel', i === at)); this.stageName = STAGES[at].name; this.keys.roster = null; }
  showLegend(on) { this.legend.classList.toggle('on', on); }

  big(text, sub, ms) {
    const b = this.bigEl; b.innerHTML = text + (sub ? '<small>' + sub + '</small>' : '');
    b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop');
    this.bigUntil = ms ? 1 : 0;
  }
  bigOff() { this.bigEl.classList.remove('pop'); }

  toast(text, color) {
    const t = el('div', 'toast', text); if (color) t.style.borderLeft = `10px solid ${color}`;
    this.feed.append(t); setTimeout(() => t.remove(), 3300);
    while (this.feed.children.length > 3) this.feed.firstChild.remove();
  }

  drawOver() { if (this.lastOver) this.showOver(this.lastOver.match, this.lastOver.winner); }
  showOver(match, winner) {
    this.lastOver = match ? { match, winner } : null;
    if (!match) { this.over.classList.remove('on'); return; }
    const C = this.C, w = DUCKS[winner];
    const rows = match.ducks.filter((d) => d.active).sort((a, b) => b.kills - a.kills);
    const list = el('div', 'rows');
    rows.forEach((d, i) => list.append(el('div', 'rrow' + (d.i === winner ? ' win' : ''),
      `<span class="rk">${d.i === winner ? '♛' : i + 1}</span><span class="dot" style="background:${DUCKS[d.i].css}"></span><span class="nm">${DUCKS[d.i].name}${d.tag ? `<small>${d.tag}</small>` : ''}</span>${pips(d.kills, DUCKS[d.i].css)}<span class="n">${d.kills} ${d.kills === 1 ? 'pop' : 'pops'}</span>`)));
    const acts = el('div', 'acts'); acts.append(this.btn(C.fire, 'Rematch on the ' + (this.stageName || 'same water'), 'main', 'rematch'), this.btn(C.back, 'Change stage', 'quiet', 'change'));
    const h = el('h2', null, `${w.name} wins!`); h.style.color = w.css;
    this.over.replaceChildren(h, el('div', 'sub', 'Final pops'), list, acts);
    this.over.classList.add('on');
  }
  drawPause() { if (this.pausedOn) this.showPause(true, this.soundOn, this.quitArmed); }
  showPause(on, soundOn, quitArmed) {
    this.pausedOn = on; this.soundOn = soundOn; this.quitArmed = !!quitArmed;
    if (!on) { this.pause.classList.remove('on'); return; }
    const C = this.C, acts = el('div', 'acts');
    acts.append(this.btn(C.fire, 'Resume', 'main', 'resume'), this.btn(C.dash, `Sound: ${soundOn ? 'on' : 'off'}`, 'quiet', 'sound'),
      this.btn(C.back, quietQuit(quitArmed), 'quiet', 'quit'));
    const grid = el('div', 'help');
    for (const [what, text] of [[C.move, 'Paddle'], [C.aim, 'Aim'], [C.fire, 'Squirt'], [C.dash, 'Dash']]) {
      const g = what && glyph(what); if (!g) continue; const d = el('div', 'keyrow'); const k = el('span', 'k'); k.append(g); d.append(k, document.createTextNode(text)); grid.append(d);
    }
    this.pause.replaceChildren(el('h2', null, 'Paused'), grid, acts);
    this.pause.classList.add('on');
  }

  // once a frame
  update(match, mode) {
    const menu = isMenu(mode);
    // scoreboard
    const active = match.ducks.filter((d) => d.active);
    const top = Math.max(0, ...active.map((d) => d.kills));
    const key = active.map((d) => `${d.i}${d.kills}${d.hp}${d.tag}${d.bot}${top === d.kills && top > 0}${d.dead}`).join('|') + (menu ? 'm' : 'g');
    if (key !== this.keys.score) {
      this.keys.score = key;
      this.score.style.display = menu ? 'none' : '';
      this.score.replaceChildren(...active.map((d) => el('div', 'card' + (d.kills === top && top > 0 ? ' lead' : '') + (d.dead ? ' out' : ''),
        `<div class="top"><span class="dot" style="background:${DUCKS[d.i].css}"></span><span>${d.kills}</span>${d.tag ? `<small>${d.tag}</small>` : ''}</div>${pips(d.kills, DUCKS[d.i].css)}`)));
      this.score.append(el('div', 'card goal', `First to<br>${KILLS_TO_WIN} pops`));
    }
    // who's in, while joining
    if (mode === 'join') {
      const rk = active.map((d) => `${d.i}${d.src || 'bot'}${d.tag}`).join('|') + this.stageName;
      if (rk !== this.keys.roster) {
        this.keys.roster = rk;
        const slots = active.map((d) => `<div class="slot"><span class="dot" style="background:${DUCKS[d.i].css}"></span>${DUCKS[d.i].name}<span class="who${d.src ? '' : ' bot'}">${d.src ? (d.tag ? d.tag + ' · ' : '') + whoIs(d) : 'Bot'}</span></div>`);
        if (active.length < DUCKS.length) slots.push('<div class="slot open">Open spot: scan to join</div>');
        this.roster.innerHTML = `<h3>${this.stageName}: ${active.length} ducks</h3>` + slots.join('') + '<div style="margin-top:14px;font-size:22px;font-weight:700;opacity:.7">Bots fill in until at least four are swimming.</div>';
      }
    }
    // tags over the ducks
    for (const d of match.ducks) {
      const t = this.tags[d.i];
      if (menu || !d.active || d.dead) { t.style.display = 'none'; continue; }
      this.v.set(d.x, LEVEL + 0.62, d.z).project(this.camera);
      t.style.display = '';
      // a duck beyond the edge of the view keeps its tag on the edge, so you can see where it is
      const sx = (this.v.x * 0.5 + 0.5) * WIDTH, sy = (-this.v.y * 0.5 + 0.5) * HEIGHT, ex = Math.max(70, Math.min(WIDTH - 70, sx)), ey = Math.max(190, Math.min(HEIGHT - 16, sy));
      t.classList.toggle('far', ex !== sx || ey !== sy);
      t.style.transform = `translate(${ex}px, ${ey}px) translate(-50%, -100%)`;
      const html = `<span style="color:${DUCKS[d.i].css}">${d.tag || d.name}</span>${hearts(d.hp)}${d.power ? '<span class="pw">' + ({ triple: '≋ triple', rapid: '» rapid', speed: '⚡ turbo' })[d.power] + '</span>' : ''}`;
      if (t._h !== html) { t._h = html; t.innerHTML = html; }
    }
  }
}
function quietQuit(armed) { return armed ? 'Press again to quit' : 'Quit to title'; }
