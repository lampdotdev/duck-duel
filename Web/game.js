// Duck Duel — squirt your friends' rubber ducks in a bathtub, a pond or a swimming pool. Water and light adapted from CAUSTIC//VOLUME by ScottieFox (MIT).
import * as THREE from 'three';
import { game, BUTTON, STICK, TRIGGER, fixedStep, sound, log, random, save, load, pendingRestore } from './lamp-game.js';
import { createWater, STAGES, LEVEL } from './water.js';
import { prepareDuck, DUCKS } from './duck.js';
import { makeSounds, S } from './audio.js';
import { Match, KILLS_TO_WIN } from './play.js';
import { Hud } from './hud.js';

// What each action is on the pad; the words and badges shown to the player come from these.
const CONTROLS = { fire: BUTTON.A, dash: BUTTON.X, pause: BUTTON.MENU, back: BUTTON.B, move: STICK.LEFT, aim: STICK.RIGHT, fireTrigger: TRIGGER.RT };
const MIN_DUCKS = 4;

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
let water, match, hud, physics;
let mode = 'title', playT = 0, countT = 0, overT = 0, count = 0, soundOn = true;
// The camera keeps one angle and slides over the water: `back` is the way from what it watches to the camera.
const ELEVATION = 1.05, FOLLOW = 5.3, FOV_TAN = Math.tan(21 * Math.PI / 180), ASPECT = 16 / 9;
const back = new THREE.Vector3(0, Math.sin(ELEVATION), Math.cos(ELEVATION));
const cam = { x: 0, z: 0, dist: FOLLOW };
let stageAt = 0, stickX = 0;
const humans = new Map();   // an input ('p0'…'p3' for pads, 'm1'… for phones) → the duck slot it steers
const phones = new Map();   // phone player number → what it's holding
// Ducks a snapshot gave back to their players: each is held for its player for a moment, since a page opened again hears
// its phones only once they've found it. A player the game hears has left lets theirs go at once.
const returning = new Set();
let returnT = 0;
let startPressed = false, backPressed = false, dashPressed = false, phonePressed = false, helpOpen = false, quitArm = false, phaseT = 0, lastPhase = '';
const isMenu = (m) => m === 'title' || m === 'stage' || m === 'join';
const sent = new Map();

// ---------------------------------------------------------------- phones
function setupPhones() {
    const C = window.Lamp && window.Lamp.controllers;
    if (!C) { hud.setLink(null); return; }
    try {
        C.onLink((url) => hud.setLink(url));
        // Called again for a phone already here when the game's code runs again. Its buttons come from f.phones (`readPhones`).
        C.onJoin((n) => {
            returning.delete('m' + n);
            if (!phones.has(n)) phones.set(n, { mx: 0, mz: 0, fire: false, dash: false });
            log(`phone ${n} joined`);
        });
        C.onLeave((n) => { phones.delete(n); returning.delete('m' + n); sent.delete('m' + n); log(`phone ${n} left`); });
        C.onAxis((n, name, x, y) => { const p = phones.get(n); if (p && name === 'stick') { p.mx = x; p.mz = -y; } });
        C.onError((m) => log('phones: ' + m));
        const started = C.start();
        if (started && started.catch) started.catch((e) => { log('phones unavailable: ' + (e && e.message || e)); hud.setLink(null); });
    } catch (e) { log('phones unavailable: ' + (e && e.message || e)); hud.setLink(null); }
}
function tellPhone(key, d, buzz) {
    if (key[0] !== 'm' || !window.Lamp || !window.Lamp.controllers) return;
    const n = +key.slice(1), last = sent.get(key), now = d.name + d.hp + (d.dead ? 'x' : '');
    if (last === now && !buzz) return;
    sent.set(key, now);
    try { window.Lamp.controllers.send(n, { name: d.name, color: DUCKS[d.i].css, hp: d.dead ? 0 : d.hp, buzz }); } catch (e) {}
}

// ---------------------------------------------------------------- who is in the bath
function syncRoster(f) {
    const present = ['p0'];
    for (let i = 1; i < 4; i++) if (f.pads[i] && f.pads[i].connected) present.push('p' + i);
    for (const n of phones.keys()) present.push('m' + n);
    returnT -= f.dt;
    for (const [key, slot] of [...humans]) if (!present.includes(key)) {   // someone left: a bot swims on in their place
        if (returning.has(key) && returnT > 0) continue;
        returning.delete(key);
        humans.delete(key);
        const d = match.ducks[slot];
        if (d.src === key) { d.bot = true; d.src = null; d.tag = ''; }
    }
    for (const key of present) {
        if (humans.has(key)) continue;
        const taken = new Set(humans.values());
        let slot = -1;
        const order = key === 'p0' ? [0, 1, 2, 3, 4, 5] : [1, 2, 3, 4, 5, 0];
        for (const s of order) if (!match.ducks[s].active && !taken.has(s)) { slot = s; break; }
        if (slot < 0) for (const s of order.slice().reverse()) if (match.ducks[s].bot && !taken.has(s)) { slot = s; break; }
        if (slot < 0) continue;
        humans.set(key, slot);
        match.activate(slot, { bot: false, src: key, tag: 'P' + (humans.size) });
        log(`${key} is ${match.ducks[slot].name}`);
        if (mode === 'play') hud.toast(`${match.ducks[slot].name} jumped in!`, DUCKS[slot].css);
    }
    // always a few ducks to play with, and no more bots than that needs
    let total = match.count();
    for (let i = 0; i < 6 && total < MIN_DUCKS; i++) if (!match.ducks[i].active) { match.activate(i, { bot: true }); total++; }
    for (let i = 5; i >= 0 && total > Math.max(MIN_DUCKS, humans.size); i--) { const d = match.ducks[i]; if (d.active && d.bot) { match.deactivate(i); total--; } }
    // humans are renumbered by who is where
    let n = 1;
    for (const [key, slot] of humans) match.ducks[slot].tag = 'P' + n++;
}

// Phones' buttons, read here because a press heard between frames would be wiped at the top of the next one. A tap
// over before this frame still squirts for the frame.
function readPhones(f) {
    for (const { player, down, pressed } of f.phones) {
        const p = phones.get(player); if (!p) continue;
        p.fire = !!(down.a || pressed.a);
        if (pressed.a) startPressed = phonePressed = true;
        if (pressed.x) p.dash = true;
    }
}
function readInputs(f) {
    readPhones(f);
    for (const [key, slot] of humans) {
        const d = match.ducks[slot], I = d.in;
        if (key[0] === 'p') {
            const pad = f.pads[+key[1]];
            I.mx = pad.lx; I.mz = -pad.ly; I.ax = pad.rx; I.az = -pad.ry;
            I.fire = !!(pad.down & CONTROLS.fire) || pad.rt > 0.4;
            if (pad.pressed & CONTROLS.dash) { I.dash = true; dashPressed = true; }
            if (pad.pressed & CONTROLS.fire) startPressed = true;
        } else {
            const p = phones.get(+key.slice(1));
            if (!p) continue;
            I.mx = p.mx; I.mz = p.mz; I.ax = I.az = 0; I.fire = p.fire;
            if (p.dash) { I.dash = true; p.dash = false; dashPressed = true; }
        }
        if (isMenu(mode)) { I.fire = false; I.dash = false; I.mx = I.mz = 0; }
        tellPhone(key, d);
    }
    const p0 = f.pads[0];
    if (p0.pressed & CONTROLS.back) backPressed = true;
}

// ---------------------------------------------------------------- the stage and the camera
function pickStage(i) {
    stageAt = (i + STAGES.length) % STAGES.length;
    match.setStage(STAGES[stageAt]);
    match.reset();
    hud.showStages(stageAt);
    save('stage', STAGES[stageAt].id);
    sound.play(S.select);
}
// on the title anyone's stick picks the stage, one step at a time
function pickWithStick(f) {
    let x = f.pads[0].lx;
    for (const pad of f.pads) if (pad.connected && Math.abs(pad.lx) > Math.abs(x)) x = pad.lx;
    for (const p of phones.values()) if (Math.abs(p.mx) > Math.abs(x)) x = p.mx;
    const side = x > 0.5 ? 1 : x < -0.5 ? -1 : 0;
    if (side && side !== stickX) pickStage(stageAt + side);
    stickX = side;
}
// how far back the camera must be to see half-widths hw (across) and hd (up the screen)
const distFor = (hw, hd) => Math.max(hw / (FOV_TAN * ASPECT), hd * Math.sin(ELEVATION) / FOV_TAN);
function aimCamera(dt) {
    const stage = match.stage;
    let x = 0, z = 0, dist = distFor(stage.x + 0.5, stage.z + 0.5);
    if (!isMenu(mode) && mode !== 'over') {
        // follow the players' ducks; with several, far enough back to keep them all in view
        let lo = [1e9, 1e9], hi = [-1e9, -1e9], any = false;
        for (const slot of humans.values()) {
            const d = match.ducks[slot];
            if (!d.active || d.dead) continue;
            any = true;
            lo = [Math.min(lo[0], d.x), Math.min(lo[1], d.z)]; hi = [Math.max(hi[0], d.x), Math.max(hi[1], d.z)];
        }
        if (any) {
            const need = distFor((hi[0] - lo[0]) / 2 + 1.6, (hi[1] - lo[1]) / 2 + 1.1);
            dist = Math.min(dist, Math.max(FOLLOW, need));
            // it stops short of showing much beyond the water
            const roomX = Math.max(0, stage.x - 0.7 * dist * FOV_TAN * ASPECT), roomZ = Math.max(0, stage.z - 0.7 * dist * FOV_TAN / Math.sin(ELEVATION));
            x = Math.max(-roomX, Math.min(roomX, (lo[0] + hi[0]) / 2)); z = Math.max(-roomZ, Math.min(roomZ, (lo[1] + hi[1]) / 2));
        } else { x = cam.x; z = cam.z; dist = cam.dist; }   // everyone's sunk: it waits where they went down
    }
    const k = 1 - Math.exp(-(isMenu(mode) ? 2.5 : 5) * dt);
    cam.x += (x - cam.x) * k; cam.z += (z - cam.z) * k; cam.dist += (dist - cam.dist) * k;
    const shake = match.shake * 0.05;
    water.camera.position.set(cam.x + back.x * cam.dist + (random() - 0.5) * shake, LEVEL + back.y * cam.dist + (random() - 0.5) * shake, cam.z + back.z * cam.dist + (random() - 0.5) * shake);
}

// ---------------------------------------------------------------- the flow: title, countdown, play, over
function begin() {
    match.reset(); match.frozen = true; match.events.length = 0;
    mode = 'count'; countT = 0; count = 4;
    helpOpen = false; hud.showScreen(null); hud.showOver(null); cam.x = cam.z = 0; hud.showPause(false); hud.showLegend(true); hud.legendOn = true; playT = 0;
    sound.music(S.fight, 0.28);
    sound.play(S.select);
}
function toTitle() {
    mode = 'title'; match.frozen = false; match.over = -1; match.reset();
    enterMenu('title'); hud.showOver(null); hud.showPause(false); hud.bigOff();
    sound.music(S.lobby, 0.3);
}
function enterMenu(m) { mode = m; helpOpen = false; hud.showScreen(m); hud.showHelp(false); }
function goStage() { enterMenu('stage'); sound.play(S.select); }
function goJoin() { enterMenu('join'); sound.play(S.select); }
function toggleHelp() { helpOpen = !helpOpen; hud.showHelp(helpOpen); sound.play(S.select); }
function resume() { mode = 'play'; quitArm = false; hud.showPause(false); sound.play(S.select); }
function quit() { quitArm = false; hud.showPause(false); toTitle(); }
// a click on a button does what the pad's button for it does
function act(name, arg) {
    if (name === 'stage') { if (mode === 'stage') pickStage(arg); return; }
    if (name === 'help') { if (mode === 'title') toggleHelp(); return; }
    if (name === 'play') { if (mode === 'title') goStage(); }
    else if (name === 'next') { if (mode === 'stage') goJoin(); }
    else if (name === 'start' || name === 'rematch') { if (mode === 'join' || mode === 'over') begin(); }
    else if (name === 'change') { if (mode === 'over') { hud.showOver(null); enterMenu('stage'); } }
    else if (name === 'resume') { if (mode === 'paused') resume(); }
    else if (name === 'sound') { if (mode === 'paused') { setSound(!soundOn); hud.showPause(true, soundOn, quitArm); } }
    else if (name === 'quit') { if (mode === 'paused') { if (quitArm) quit(); else { quitArm = true; hud.showPause(true, soundOn, true); } } }
    else if (name === 'back') { if (mode === 'stage') toTitle(); else if (mode === 'join') goStage(); }
}
function setSound(on) { soundOn = on; sound.volume(on ? 1 : 0, on ? 1 : 0); save('sound', on); }

function handleEvents() {
    for (const e of match.events) {
        if (e.type === 'kill') {
            const v = match.ducks[e.victim], k = e.killer >= 0 ? match.ducks[e.killer] : null;
            if (mode !== 'title') hud.toast(k ? `${k.name} popped ${v.name}!` : `${v.name} popped!`, DUCKS[k ? k.i : v.i].css);
            if (v.src) tellPhone(v.src, v, [200, 60, 200]);
        } else if (e.type === 'hit') { const v = match.ducks[e.victim]; if (v.src) tellPhone(v.src, v, [60]); }
        else if (e.type === 'pickup' && mode !== 'title') hud.toast(`${match.ducks[e.duck].name}: ${e.text}`, DUCKS[e.duck].css);
        else if (e.type === 'win' && mode === 'play') {
            const w = match.ducks[e.winner];
            hud.big(`<span style="color:${DUCKS[w.i].css}">${w.name}</span> wins!`, '', 1);
            sound.music(null); sound.play(S.win, { volume: 0.9 }); sound.play(S.quack, { volume: 0.7, pitch: 1.3 });
            overT = 2.2; mode = 'ending';
        }
    }
    match.events.length = 0;
}

game({
    renderer,
    touch: BUTTON.A | BUTTON.X | BUTTON.MENU,
    async init() {
        const was = pendingRestore();
        prepareDuck();
        makeSounds();
        const s = load('sound'); soundOn = s !== false; sound.volume(soundOn ? 1 : 0, soundOn ? 1 : 0);
        water = createWater(renderer);
        match = new Match(water);
        hud = new Hud(water.camera, CONTROLS, act);
        physics = fixedStep(() => match.step(1 / 60));
        const savedStage = (was && was.match && was.match.stage) || load('stage');
        stageAt = Math.max(0, STAGES.findIndex((st) => st.id === savedStage));
        match.setStage(STAGES[stageAt]);
        hud.showStages(stageAt);
        water.camera.position.set(0, back.y, back.z);
        water.camera.lookAt(0, 0, 0);
        if (was && was.match) {
            match.restore(was.match);
            // Each duck goes back to whoever steered it, in the order they're numbered.
            const steered = match.ducks.filter((d) => d.active && d.src).sort((a, b) => a.tag.slice(1) - b.tag.slice(1));
            for (const d of steered) { humans.set(d.src, d.i); returning.add(d.src); }
            returnT = 8;
            mode = was.mode === 'count' || was.mode === 'ending' ? 'play' : was.mode || 'title';
            match.frozen = false;
        } else {
            for (let i = 0; i < MIN_DUCKS; i++) match.activate(i, { bot: true });
        }
        hud.setLink(null);
        setupPhones();
        if (mode === 'title') toTitle();
        else if (isMenu(mode)) { enterMenu(mode); sound.music(S.lobby, 0.3); }
        else { hud.showLegend(true); sound.music(mode === 'over' ? null : S.fight, 0.28); if (mode === 'over') hud.showOver(match, match.over); }
    },
    frame(f) {
        startPressed = backPressed = dashPressed = phonePressed = false;
        syncRoster(f);
        readInputs(f);
        const menu = f.pads[0].pressed & CONTROLS.pause;
        if (isMenu(mode)) {
            // A phone's duck is in from the moment it joins, so one SQUIRT from it starts the round from any of these.
            if (phonePressed) { hud.showHelp(false); begin(); }
            else if (helpOpen) { if (startPressed || backPressed || dashPressed) toggleHelp(); }
            else if (mode === 'title') { if (startPressed) goStage(); else if (dashPressed) toggleHelp(); }
            else if (mode === 'stage') { pickWithStick(f); if (startPressed) goJoin(); else if (backPressed) toTitle(); }
            else if (mode === 'join') { if (startPressed) begin(); else if (backPressed) goStage(); }
            if (match.over >= 0) { match.over = -1; for (const d of match.ducks) d.kills = 0; }   // the bots' practice bout never ends
        } else if (mode === 'count') {
            const before = Math.floor(countT);
            countT += f.dt;
            const n = Math.floor(countT);
            if (countT === f.dt || n !== before) {
                if (n < 3) { hud.big(String(3 - n)); sound.play(S.beep, { volume: 0.8 }); }
                else if (n === 3) { hud.big('QUACK!'); sound.play(S.go, { volume: 0.8 }); match.frozen = false; }
            }
            if (countT >= 3.7) { mode = 'play'; hud.bigOff(); }
        } else if (mode === 'play') {
            playT += f.dt; if (playT > 12 && hud.legendOn) { hud.showLegend(false); hud.legendOn = false; }
            if (menu) { mode = 'paused'; quitArm = false; hud.showPause(true, soundOn); }
        } else if (mode === 'paused') {
            if (menu || startPressed) resume();
            else if (backPressed) { if (quitArm) quit(); else { quitArm = true; hud.showPause(true, soundOn, true); } }
            else if (quitArm && dashPressed) { quitArm = false; hud.showPause(true, soundOn); }
            else if (dashPressed) { setSound(!soundOn); hud.showPause(true, soundOn, quitArm); }
        } else if (mode === 'ending') {
            overT -= f.dt;
            if (overT <= 0) { mode = 'over'; hud.bigOff(); hud.showOver(match, match.over); }
        } else if (mode === 'over') {
            if (startPressed) begin();
            else if (backPressed) { hud.showOver(null); enterMenu('stage'); }
        }
        // phones are told the phase now and then, so each shows what a press will do
        phaseT -= f.dt;
        if (mode !== lastPhase || phaseT <= 0) {
            lastPhase = mode; phaseT = 1;
            try { if (window.Lamp && window.Lamp.controllers) window.Lamp.controllers.send(0, { phase: mode }); } catch (e) {}
        }
        if (mode !== 'paused') physics(f.dt);
        handleEvents();
        aimCamera(f.dt);
        match.draw();
        hud.update(match, mode);
    },
    snapshot() { return { mode: mode === 'paused' ? 'play' : mode, match: match.snapshot() }; },
    busy() { return mode === 'play' || mode === 'count' || mode === 'paused' || mode === 'ending'; },
});
