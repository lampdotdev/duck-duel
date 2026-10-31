// The stages: moving water, ripples and caustics. Adapted from CAUSTIC//LITE by ScottieFox (MIT).
// A random sea and a ripple simulation move the surface; every frame each vertex of a fine grid sends a ray of
// sunlight through the water to the tub floor and the caustics texture is redrawn where the rays land.
import * as THREE from 'three';
import { GPUComputationRenderer } from 'three/addons/misc/GPUComputationRenderer.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { DS } from './duck.js';

// ---------------------------------------------------------------- the scene (metres)
export const TOP = 1.25;                        // rim height
// Where the duel can be held. x, z: half-size of the water; oval: its shore is an ellipse; waves: how rough; follow: how
// far the camera sits from the player's duck; kind picks the floor, walls and ground in the shaders.
export const STAGES = [
  { id: 'tub', name: 'Bathtub', icon: '🛁', blurb: 'Close quarters', x: 4.0, z: 2.4, kind: 0, oval: false, waves: 1, pickups: 2, absorb: [0.6, 0.1, 0.055], glow: [1, 1, 1], walls: [0.86, 0.9, 0.92] },
  { id: 'pond', name: 'Pond', icon: '🪷', blurb: 'Lily pads and reeds', x: 6.0, z: 4.0, kind: 1, oval: true, waves: 0.8, pickups: 3, absorb: [0.8, 0.3, 0.5], glow: [1.6, 1.25, 0.55], walls: [0.42, 0.4, 0.26] },
  { id: 'pool', name: 'Swimming pool', icon: '🏊', blurb: 'Huge. Nowhere to hide', x: 8.0, z: 4.5, kind: 2, oval: false, waves: 0.55, pickups: 3, absorb: [0.7, 0.12, 0.05], glow: [0.9, 1.05, 1.2], walls: [0.72, 0.9, 0.96] },
];
export const LEVEL = 1.0, IOR = 1.333;          // water level, refractive index of water
export const DRAFT = 0.125 * DS;                // how deep a duck floats
export const FOOT = [0.43 * DS, 0.32 * DS];     // a duck's waterline (half-axes, m)
export const MAXD = 6;                          // most ducks at once
const RIM = 0.26;                               // width of the tub's rim

// A random sea: 24 waves from 1.2 m down to 12 cm long, heading every which way.
const NW = 24, WAVES = [];
{
  let s = 5;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < NW; i++) {
    const len = 1.2 * 0.1 ** (i / (NW - 1)), k = 2 * Math.PI / len, dir = i * 2.39996 + (rnd() - 0.5) * 0.9;
    WAVES.push({ k, kx: k * Math.cos(dir), kz: k * Math.sin(dir), w: Math.sqrt(9.81 * k + 0.074 * k ** 3), ph: rnd() * 6.283,
      a: 0.55 * Math.min(1, (0.55 / len) ** 2) / (k * k) * (0.6 + 0.8 * rnd()), short: len < 0.3,
      f1: 0.05 + 0.22 * rnd(), f2: 0.09 + 0.3 * rnd(), p1: rnd() * 6.283, p2: rnd() * 6.283 });
  }
}
const waveUniform = new Float32Array(NW * 4), ampUniform = new Float32Array(NW);
WAVES.forEach((W, i) => waveUniform.set([W.kx, W.kz, W.w, W.ph], i * 4));
let seaT = 0;
function waveHeights(t, waves, turb) {
  seaT = t;
  const swing = 0.35 + 0.55 * turb;
  WAVES.forEach((W, i) => { ampUniform[i] = W.a * Math.max(0.1, 1 + swing * (0.6 * Math.sin(W.f1 * t + W.p1) + 0.4 * Math.sin(W.f2 * t + W.p2)))
    * waves * (W.short ? 0.3 + 1.4 * turb : 1); });
}
// the sea at (x, z), as the GPU computes it -> o: height, slope x, slope z, and the water's horizontal velocity
export function seaAt(x, z, o) {
  let h = 0, gx = 0, gz = 0, u = 0, v = 0;
  for (let i = 0; i < NW; i++) {
    const W = WAVES[i], k = W.k, kb = 0.37 * k, sx = -W.kz / k, sz = W.kx / k;
    const pb = kb * (sx * x + sz * z) + 0.9 * seaT + 7.1 * i, ph = W.kx * x + W.kz * z - W.w * seaT + W.ph + 1.6 * Math.sin(pb);
    const a = ampUniform[i], s = a * Math.sin(ph), cp = a * Math.cos(ph), b = 1.6 * kb * Math.cos(pb);
    h += s; gx += cp * (W.kx + b * sx); gz += cp * (W.kz + b * sz); u += s * W.w * W.kx / k; v += s * W.w * W.kz / k;
  }
  o[0] = h; o[1] = gx; o[2] = gz; o[3] = u; o[4] = v;
}

// ---------------------------------------------------------------- shaders
const f = (v) => (Number.isInteger(v) ? v.toFixed(1) : String(v));
const SIM = [512, 320];   // ripple grid
const CAUS = [1024, 640]; // caustics texture
export const PUSH = 420;  // how much of the water a hull moves shows up as ripples (mm per m)

const COMMON = /* glsl */`
uniform float uDay;
uniform vec4 uDucks[${MAXD}];       // x, z, heading, on
uniform vec3 uLight, uLightCol, uAmb, uGlow;
uniform sampler2D uSurf, uCaus;
uniform vec3 TANK, ABSORB, uWalls;   // the stage: half-size and rim height, how the water takes the light, its walls' colour
uniform float uKind;                 // 0 the bathtub, 1 the pond, 2 the swimming pool
const float PI = 3.14159265, LEVEL = ${f(LEVEL)}, IOR = ${f(IOR)}, DS = ${f(DS)}, DRAFT = ${f(DRAFT)}, RIM = ${f(RIM)};

vec3 wave(vec2 p) { return textureLod(uSurf, p / (2.0 * TANK.xz) + 0.5, 0.0).xyz; }
vec3 normalOf(vec3 w) { return normalize(vec3(-w.y, 1.0, -w.z)); }
// how much of the light along a ray from p gets past a duck: 0 in its shadow, soft at the edges
float duckClear(vec3 p, vec3 v, vec4 dk) {
  if (dk.w < 0.5) return 1.0;
  vec2 f = vec2(cos(dk.z), sin(dk.z));
  vec3 q = (p - vec3(dk.x, LEVEL - DRAFT, dk.y)) / DS;
  vec3 o = vec3(dot(q.xz, f), q.y, dot(q.xz, vec2(-f.y, f.x))), e = vec3(dot(v.xz, f), v.y, dot(v.xz, vec2(-f.y, f.x))), R = vec3(0.5, 0.3, 0.37);
  vec3 a = (o - vec3(0.0, 0.28, 0.0)) / R, b = e / R, c = (o - vec3(0.25, 0.8, 0.0)) / 0.25, g = e / 0.25;
  return smoothstep(0.7, 1.35, length(a + b * max(-dot(a, b) / dot(b, b), 0.0)))
       * smoothstep(0.7, 1.35, length(c + g * max(-dot(c, g) / dot(g, g), 0.0)));
}
float fresnel(float c) { return 0.02 + 0.98 * pow(1.0 - clamp(c, 0.0, 1.0), 5.0); }

vec3 sky(vec3 d, float disk) {
  float s = dot(d, uLight), g = max(s, 0.0);
  vec3 c = mix(vec3(0.62, 0.74, 0.86), vec3(0.2, 0.4, 0.75), sqrt(clamp(d.y, 0.0, 1.0))) * uDay;
  return c + uLightCol * (disk * smoothstep(0.99985, 0.99995, s) * 60.0 + (1.0 - disk) * pow(g, 900.0) * 7.0
                          + pow(g, 24.0) * 0.12 + g * g * g * g * 0.05 * (1.0 - abs(d.y)));
}
vec3 look(vec3 p, vec3 d) { return sky(d, 0.0); }
// entry and exit distances of a ray through the tub's box
vec2 box(vec3 ro, vec3 rd) {
  vec3 inv = 1.0 / (rd + vec3(1e-7)), t0 = (vec3(-TANK.x, 0.0, -TANK.z) - ro) * inv, t1 = (TANK - ro) * inv;
  vec3 a = min(t0, t1), b = max(t0, t1);
  return vec2(max(max(a.x, a.y), a.z), min(min(b.x, b.y), b.z));
}
float grain(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5), b = fract(sin(dot(i + vec2(1.0, 0.0), vec2(127.1, 311.7))) * 43758.5),
        c = fract(sin(dot(i + vec2(0.0, 1.0), vec2(127.1, 311.7))) * 43758.5), d = fract(sin(dot(i + vec2(1.0, 1.0), vec2(127.1, 311.7))) * 43758.5);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y); }
// what's around the water: the bathroom's pale tiles (darker where the tub shades them), the pond's grass or the pool's deck
vec3 ground(vec3 p, float px) {
  vec2 u = p.xz / 0.45, g = abs(fract(u) - 0.5);
  float e = 0.5 - max(g.x, g.y), pu = px / 0.45;
  float line = (1.0 - smoothstep(0.012, 0.012 + pu, e)) * min(1.0, 0.03 / pu);
  vec3 alb = mix(vec3(0.5, 0.66, 0.68), vec3(0.58, 0.74, 0.74), mod(floor(u.x) + floor(u.y), 2.0)) * (1.0 - 0.5 * line);
  float ao = 1.0;
  if (uKind < 0.5) { float out_ = length(max(abs(p.xz) - vec2(TANK.x + RIM, TANK.z + RIM), 0.0)); ao = mix(0.5, 1.0, smoothstep(0.0, 0.45, out_)); }
  else if (uKind < 1.5) {
    float n = 0.6 * grain(p.xz * 1.3) + 0.4 * grain(p.xz * 5.0), shore = length(p.xz / (TANK.xz + 0.9));
    alb = mix(vec3(0.17, 0.37, 0.1), vec3(0.34, 0.5, 0.16), n);
    alb = mix(vec3(0.5, 0.42, 0.28), alb, smoothstep(0.92, 1.02, shore + 0.05 * (n - 0.5)));
  } else {
    alb = vec3(0.74, 0.72, 0.66) * (1.0 - 0.3 * line) * (0.94 + 0.08 * grain(p.xz * 4.0));
    float edge = max(abs(p.x) - TANK.x, abs(p.z) - TANK.z);
    alb = mix(alb, vec3(0.93), 1.0 - smoothstep(0.42, 0.45, edge));
  }
  float dist = length(p - cameraPosition);
  vec3 col = alb / PI * (uLightCol * max(uLight.y, 0.0) * ao + uAmb);
  if (uKind > 0.5) col *= 1.5;
  return mix(col, sky(normalize(vec3(p.x - cameraPosition.x, 0.0, p.z - cameraPosition.z)), 0.0), 1.0 - exp(-0.02 * dist));
}
// the inside walls, seen through the water
vec3 wallColor(vec3 q, vec3 n) {
  float depth = max(LEVEL - q.y, 0.0);
  float lit = max(dot(n, uLight), 0.0) * 0.5;
  return uWalls / PI * (uLightCol * lit * exp(-ABSORB * (depth + 0.5)) + uAmb * exp(-ABSORB * depth * 1.5));
}
// the bottom, lit by the caustics texture and the dim light that filters down: the tub's white porcelain and drain, the
// pond's mud and pebbles, the pool's pale tiles and black lane lines
vec3 floorColor(vec3 q) {
  float edge = min(TANK.x - abs(q.x), TANK.z - abs(q.z));
  vec3 alb;
  if (uKind < 0.5) {
    alb = vec3(0.86, 0.9, 0.9) * (0.5 + 0.5 * smoothstep(0.0, 0.3, edge));
    float dr = length(q.xz - vec2(-0.575 * TANK.x, 0.0));
    alb = mix(alb, vec3(0.04, 0.05, 0.06), 1.0 - smoothstep(0.05, 0.065, dr));
    alb = mix(alb, vec3(0.6, 0.62, 0.64), smoothstep(0.065, 0.075, dr) * (1.0 - smoothstep(0.085, 0.095, dr)));
  } else if (uKind < 1.5) {
    float n = 0.6 * grain(q.xz * 1.5) + 0.4 * grain(q.xz * 7.0), peb = smoothstep(0.72, 0.78, grain(q.xz * 11.0));
    alb = mix(vec3(0.24, 0.22, 0.12), vec3(0.42, 0.38, 0.2), n);
    alb = mix(alb, vec3(0.5, 0.48, 0.42), peb * 0.7);
  } else {
    vec2 t = abs(fract(q.xz / 0.3) - 0.5);
    alb = vec3(0.74, 0.9, 0.96) * (1.0 - 0.12 * smoothstep(0.46, 0.49, max(t.x, t.y)));
    float lane = abs(fract(q.z / 1.8) - 0.5) * 1.8;
    if (abs(q.x) < TANK.x - 1.0) alb = mix(alb, vec3(0.06, 0.1, 0.16), 1.0 - smoothstep(0.1, 0.12, lane));
  }
  vec2 uv = q.xz / (2.0 * TANK.xz) + 0.5, o = 0.6 / vec2(${f(CAUS[0])}, ${f(CAUS[1])});
  vec3 caus = 0.25 * (texture(uCaus, uv + o).rgb + texture(uCaus, uv - o).rgb + texture(uCaus, uv + vec2(o.x, -o.y)).rgb + texture(uCaus, uv - vec2(o.x, -o.y)).rgb);
  return alb / PI * (uLightCol * caus + uAmb * exp(-ABSORB * LEVEL * 1.5));
}
// distance along a ray going up inside the water to the wavy surface (or tmax)
float surface(vec3 ro, vec3 rd, float tmax) {
  float t0 = 0.0, f0 = -1e-4, dt = min(tmax, (LEVEL + 0.3 - ro.y) / rd.y) / 10.0;
  for (int i = 1; i <= 10; i++) {
    float t1 = dt * float(i);
    vec3 p = ro + rd * t1;
    float f1 = p.y - LEVEL - wave(clamp(p.xz, -TANK.xz, TANK.xz)).x;
    if (f1 > 0.0) {
      for (int j = 0; j < 3; j++) {
        float tm = t0 + (t1 - t0) * f0 / (f0 - f1);
        vec3 q = ro + rd * tm;
        float fm = q.y - LEVEL - wave(clamp(q.xz, -TANK.xz, TANK.xz)).x;
        if (fm > 0.0) { t1 = tm; f1 = fm; } else { t0 = tm; f0 = fm; }
      }
      return t0 + (t1 - t0) * f0 / (f0 - f1);
    }
    t0 = t1; f0 = f1;
  }
  return 1e9;
}
// a ray inside the water: absorbed and lit as it goes; it ends on the floor or a wall, or leaves through the
// surface, reflecting part of itself back in (all of it past the critical angle)
vec3 water(vec3 p, vec3 d) {
  vec3 col = vec3(0.0), thr = vec3(1.0);
  for (int i = 0; i < 3; i++) {
    float tx = (sign(d.x) * TANK.x - p.x) / (d.x + 1e-7), tz = (sign(d.z) * TANK.z - p.z) / (d.z + 1e-7);
    float tf = d.y < 0.0 ? -p.y / d.y : 1e9, ts = d.y > 0.0 ? surface(p, d, min(tx, tz)) : 1e9;
    float t = min(min(tf, ts), min(tx, tz));
    vec3 T = exp(-ABSORB * t), q = p + d * t;
    col += thr * uGlow * (1.0 - T);
    thr *= T;
    if (t == tf) return col + thr * floorColor(q);
    if (t != ts) return col + thr * wallColor(q, tx < tz ? vec3(-sign(d.x), 0.0, 0.0) : vec3(0.0, 0.0, -sign(d.z)));
    vec3 n = -normalOf(wave(clamp(q.xz, -TANK.xz, TANK.xz)));
    vec3 r = refract(d, n, IOR);
    float F = dot(r, r) < 0.5 ? 1.0 : fresnel(-dot(r, n));
    col += thr * (1.0 - F) * look(q, r);
    thr *= F; p = q + n * 1e-3; d = reflect(d, n);
  }
  return col + thr * uGlow;
}
`;
const VERT = /* glsl */`varying vec3 vPos; varying vec3 vNrm;
void main() { vPos = (modelMatrix * vec4(position, 1.0)).xyz; vNrm = normal; gl_Position = projectionMatrix * viewMatrix * vec4(vPos, 1.0); }`;
const OUT = '#include <tonemapping_fragment>\n#include <colorspace_fragment>\n';

// ---------------------------------------------------------------- the water
export function createWater(renderer) {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.05, 2000);
  const ext = renderer.extensions;
  if (!ext.has('EXT_color_buffer_float') && !ext.has('EXT_color_buffer_half_float')) throw new Error('no float render targets');
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  // The ripple simulation: a height field (mm) on the GPU. Splashes add a bump; every duck's hull, moving and
  // bobbing, pushes the water aside (the difference between where it was and where it is).
  const gpu = new GPUComputationRenderer(SIM[0], SIM[1], renderer).setDataType(THREE.HalfFloatType);
  const sim = gpu.addVariable('heightmap', /* glsl */`
    uniform vec4 uDrops[8], uHullA[${MAXD}], uHullB[${MAXD}];
    uniform vec2 uSize;
    float hull(vec2 p, vec4 d) {
      vec2 q = p - d.xy, f = vec2(cos(d.z), sin(d.z)), u = vec2(dot(q, f), dot(q, vec2(-f.y, f.x))) / vec2(${f(FOOT[0])}, ${f(FOOT[1])});
      float r = max(0.0, 1.0 - dot(u, u)); return d.w * r * r;
    }
    void main() {
      vec2 cell = 1.0 / resolution.xy, uv = gl_FragCoord.xy * cell;
      vec4 c = texture2D(heightmap, uv);
      float nb = texture2D(heightmap, uv + vec2(0.0, cell.y)).r + texture2D(heightmap, uv - vec2(0.0, cell.y)).r
               + texture2D(heightmap, uv + vec2(cell.x, 0.0)).r + texture2D(heightmap, uv - vec2(cell.x, 0.0)).r;
      float h = (nb * 0.5 - c.g) * 0.994;
      vec2 p = (uv - 0.5) * uSize;
      for (int i = 0; i < 8; i++) { vec2 q = (p - uDrops[i].xy) / uDrops[i].z; h += uDrops[i].w * exp(-dot(q, q)); }
      for (int i = 0; i < ${MAXD}; i++) {
        h += ${f(PUSH)} * (hull(p, uHullA[i]) - hull(p, uHullB[i]));
        h *= 1.0 - 0.15 * hull(p, vec4(uHullB[i].xyz, 1.0));   // under a hull there is no free surface
      }
      gl_FragColor = vec4(h, c.r, 0.0, 1.0);
    }`, gpu.createTexture());
  gpu.setVariableDependencies(sim, [sim]);
  sim.minFilter = sim.magFilter = THREE.LinearFilter;
  const dropU = new Float32Array(32);
  const hullA = Array.from({ length: MAXD }, () => new THREE.Vector4()), hullB = Array.from({ length: MAXD }, () => new THREE.Vector4());
  const uSize = { value: new THREE.Vector2(1, 1) };   // the water's whole width and length
  Object.assign(sim.material.uniforms, { uDrops: { value: dropU }, uHullA: { value: hullA }, uHullB: { value: hullB }, uSize });
  const err = gpu.init(); if (err) throw new Error(err);

  const duckU = Array.from({ length: MAXD }, () => new THREE.Vector4());
  const U = { uTime: { value: 0 }, uDay: { value: 1 }, uW: { value: waveUniform }, uA: { value: ampUniform },
    uLight: { value: new THREE.Vector3() }, uLightCol: { value: new THREE.Vector3() }, uAmb: { value: new THREE.Vector3() },
    uGlow: { value: new THREE.Vector3() }, uSim: { value: null }, uSurf: { value: null }, uCaus: { value: null }, uDucks: { value: duckU },
    TANK: { value: new THREE.Vector3() }, ABSORB: { value: new THREE.Vector3() }, uWalls: { value: new THREE.Vector3() }, uKind: { value: 0 }, uTexel: { value: 1 } };

  // Once a frame, the sea's waves plus the ripples, with their slopes, into one texture every shader reads.
  const surfRT = gpu.createRenderTarget(0, 0, THREE.ClampToEdgeWrapping, THREE.ClampToEdgeWrapping, THREE.LinearFilter, THREE.LinearFilter);
  const surfMat = gpu.createShaderMaterial(/* glsl */`
    uniform float uTime;
    uniform vec4 uW[${NW}];
    uniform float uA[${NW}];
    uniform sampler2D uSim;
    uniform vec2 uSize;
    void main() {
      vec2 uv = gl_FragCoord.xy / resolution.xy, e = 1.0 / resolution.xy, p = (uv - 0.5) * uSize;
      vec3 w = vec3(0.0);
      for (int i = 0; i < ${NW}; i++) {
        vec2 kd = uW[i].xy, side = vec2(-kd.y, kd.x) / length(kd);
        float kb = 0.37 * length(kd), pb = kb * dot(side, p) + 0.9 * uTime + 7.1 * float(i);
        float ph = dot(kd, p) - uW[i].z * uTime + uW[i].w + 1.6 * sin(pb);
        w += uA[i] * vec3(sin(ph), cos(ph) * (kd + 1.6 * kb * cos(pb) * side));
      }
      float h = texture2D(uSim, uv).r;
      float hx = texture2D(uSim, uv + vec2(e.x, 0.0)).r - texture2D(uSim, uv - vec2(e.x, 0.0)).r;
      float hz = texture2D(uSim, uv + vec2(0.0, e.y)).r - texture2D(uSim, uv - vec2(0.0, e.y)).r;
      gl_FragColor = vec4(w + 0.001 * vec3(h, hx * resolution.x / (2.0 * uSize.x), hz * resolution.y / (2.0 * uSize.y)), 1.0);
    }`, { uTime: U.uTime, uW: U.uW, uA: U.uA, uSim: U.uSim, uSize });
  const mat = (frag, o = {}) => new THREE.ShaderMaterial(Object.assign({ uniforms: U, vertexShader: VERT, fragmentShader: 'varying vec3 vPos; varying vec3 vNrm;\n' + COMMON + frag }, o));

  // Caustics: every vertex of a fine grid on the surface sends a light ray through the water to the floor, and
  // the grid is drawn where the rays land; a patch that lands on a smaller patch of floor concentrates its light.
  const causRT = new THREE.WebGLRenderTarget(CAUS[0], CAUS[1], { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  const grid = new THREE.PlaneGeometry(2, 2, SIM[0], SIM[1]).rotateX(-Math.PI / 2);   // scaled by TANK in the shaders
  const causScene = new THREE.Scene(), flatCam = new THREE.Camera();
  const causMesh = new THREE.Mesh(grid, new THREE.ShaderMaterial({ uniforms: U, side: THREE.DoubleSide, depthTest: false, depthWrite: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    vertexShader: COMMON + /* glsl */`
      varying vec2 vSurf; varying vec3 vI;
      void main() {
        vec2 at = position.xz * TANK.xz;
        vec3 w = wave(at), P = vec3(at.x, LEVEL + w.x, at.y), n = normalOf(w);
        vec3 Lin = -uLight;
        vec3 r = refract(Lin, n, 1.0 / IOR);
        float t = P.y / max(-r.y, 0.05);
        vec3 F = P + r * t;
        vI = max(-Lin.y, 0.0) * (1.0 - fresnel(dot(-Lin, n))) * exp(-ABSORB * t);
        float clear = 1.0;
        for (int i = 0; i < ${MAXD}; i++) clear *= duckClear(P, uLight, uDucks[i]) * duckClear(P, r, uDucks[i]);
        vI *= mix(0.2, 1.0, clear);                                   // the ducks' shadows
        vec3 s = P + uLight * ((TANK.y - P.y) / uLight.y);            // the tub's rim shades the water on the sunny side
        vI *= smoothstep(-0.03, 0.07, min(TANK.x - abs(s.x), TANK.z - abs(s.z)));
        vSurf = at;
        gl_Position = vec4(F.x / TANK.x, F.z / TANK.z, 0.0, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform float uTexel;
      varying vec2 vSurf; varying vec3 vI;
      void main() {
        vec2 a = dFdx(vSurf), b = dFdy(vSurf);
        gl_FragColor = vec4(vI * min(abs(a.x * b.y - a.y * b.x) / uTexel, 40.0), 1.0);
      }` }));
  causMesh.frustumCulled = false; causScene.add(causMesh);

  // sky, the ground, and the water surface itself
  const skyDome = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), mat('void main() { gl_FragColor = vec4(sky(normalize(vPos - cameraPosition), 1.0), 1.0);\n' + OUT + '}', { side: THREE.BackSide, depthWrite: false }));
  skyDome.renderOrder = -1;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2),
    mat('void main() { gl_FragColor = vec4(ground(vPos, max(fwidth(vPos.x), fwidth(vPos.z))), 1.0);\n' + OUT + '}'));
  const surface = new THREE.Mesh(grid, mat(/* glsl */`
    void main() {
      vec3 n = normalOf(wave(vPos.xz)), d = normalize(vPos - cameraPosition);
      if (dot(d, n) > -0.02) n = normalize(n - d * (dot(d, n) + 0.02));
      float F = fresnel(-dot(d, n));
      gl_FragColor = vec4(F * look(vPos, reflect(d, n)) + (1.0 - F) * water(vPos, refract(d, n, 1.0 / IOR)), 1.0);
      ${OUT}
    }`, { vertexShader: COMMON + /* glsl */`
      varying vec3 vPos; varying vec3 vNrm;
      void main() { vec2 at = position.xz * TANK.xz; vPos = vec3(at.x, LEVEL + wave(at).x, at.y); vNrm = vec3(0.0, 1.0, 0.0);
        gl_Position = projectionMatrix * viewMatrix * vec4(vPos, 1.0); }` }));
  surface.frustumCulled = false;

  const groundMat = floor.material;
  const porcelain = new THREE.MeshStandardMaterial({ color: 0xf2f4f5, roughness: 0.18, metalness: 0.0 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xd5dde0, roughness: 0.15, metalness: 0.25 });
  const H = TOP + 0.04;
  let around = new THREE.Group();   // whatever is round the water: this stage's tub, banks or deck
  const put = (group, geo, material, x, y, z, ry = 0) => { const m = new THREE.Mesh(geo, material); m.position.set(x, y, z); m.rotation.y = ry; group.add(m); return m; };
  // the ground as a slab with the water's shape cut out of it
  function land(group, hole) {
    const shape = new THREE.Shape(); shape.moveTo(-200, -200); shape.lineTo(200, -200); shape.lineTo(200, 200); shape.lineTo(-200, 200); shape.closePath();
    shape.holes.push(hole);
    put(group, new THREE.ExtrudeGeometry(shape, { depth: H, bevelEnabled: false, curveSegments: 96 }).rotateX(-Math.PI / 2), groundMat, 0, 0, 0);
  }
  // the tub: a rim of white porcelain round the water, and a chrome faucet at the back
  function buildTub(g, TX, TZ) {
    const slab = (w, d, x, z) => put(g, new RoundedBoxGeometry(w, H, d, 3, 0.06), porcelain, x, H / 2, z);
    slab(2 * (TX + RIM), RIM, 0, -(TZ + RIM / 2)); slab(2 * (TX + RIM), RIM, 0, TZ + RIM / 2);
    slab(RIM, 2 * TZ + 0.02, -(TX + RIM / 2), 0); slab(RIM, 2 * TZ + 0.02, TX + RIM / 2, 0);
    put(g, new THREE.CylinderGeometry(0.045, 0.045, 0.34, 20), chrome, 0, H + 0.17, -(TZ + RIM / 2));
    put(g, new THREE.CylinderGeometry(0.04, 0.04, 0.3, 20).rotateX(Math.PI / 2), chrome, 0, H + 0.32, -(TZ + RIM / 2) + 0.15);
    for (const sx of [-0.28, 0.28]) put(g, new THREE.SphereGeometry(0.06, 20, 12), chrome, sx, H + 0.03, -(TZ + RIM / 2)).scale.y = 0.8;
  }
  // the pond: a grassy bank, reeds at the shore, rocks, lily pads and a few trees (they're only scenery)
  function buildPond(g, TX, TZ) {
    const hole = new THREE.Path(); hole.absellipse(0, 0, TX, TZ, 0, Math.PI * 2, false); land(g, hole);
    const rock = new THREE.MeshStandardMaterial({ color: 0x8a8c84, roughness: 0.9, flatShading: true }), reed = new THREE.MeshStandardMaterial({ color: 0x5f8f36, roughness: 0.7 }),
      cat = new THREE.MeshStandardMaterial({ color: 0x5a3a20, roughness: 0.8 }), pad = new THREE.MeshStandardMaterial({ color: 0x3f9a4a, roughness: 0.5, side: THREE.DoubleSide }),
      bark = new THREE.MeshStandardMaterial({ color: 0x6a4a2c, roughness: 0.9 }), leaf = new THREE.MeshStandardMaterial({ color: 0x3f8a3a, roughness: 0.8, flatShading: true }),
      petal = new THREE.MeshStandardMaterial({ color: 0xffb7d5, roughness: 0.6 });
    let s = 11; const r = (a = 0, b = 1) => { s = (s * 16807) % 2147483647; return a + (b - a) * s / 2147483647; };
    for (let i = 0; i < 16; i++) {
      const a = r(0, 6.283), k = r(1.0, 1.1), rs = r(0.16, 0.5);
      put(g, new THREE.IcosahedronGeometry(rs, 0), rock, Math.cos(a) * TX * k, H + 0.02, Math.sin(a) * TZ * k, r(0, 6)).scale.y = 0.6;
    }
    for (let i = 0; i < 60; i++) {
      const a = r(0, 6.283), k = r(0.97, 1.12), h = r(0.5, 1.0), x = Math.cos(a) * TX * k, z = Math.sin(a) * TZ * k;
      put(g, new THREE.CylinderGeometry(0.012, 0.018, h, 5), reed, x, H + h / 2 - 0.1, z);
      if (i % 3 === 0) put(g, new THREE.CapsuleGeometry(0.03, 0.14, 3, 6), cat, x, H + h - 0.05, z);
    }
    for (let i = 0; i < 12; i++) {
      const a = r(0, 6.283), k = r(0.35, 0.86), x = Math.cos(a) * TX * k, z = Math.sin(a) * TZ * k;
      put(g, new THREE.CircleGeometry(r(0.17, 0.3), 20, 0.4, 5.9).rotateX(-Math.PI / 2), pad, x, LEVEL + 0.035, z, r(0, 6));
      if (i % 4 === 0) put(g, new THREE.SphereGeometry(0.07, 10, 8), petal, x, LEVEL + 0.09, z).scale.y = 0.6;
    }
    for (let i = 0; i < 14; i++) {
      const a = r(0, 6.283), k = r(1.32, 1.8), x = Math.cos(a) * TX * k, z = Math.sin(a) * TZ * k, h = r(1.2, 2.2);
      put(g, new THREE.CylinderGeometry(0.08, 0.13, h, 7), bark, x, H + h / 2, z);
      put(g, new THREE.IcosahedronGeometry(r(0.7, 1.1), 1), leaf, x, H + h + 0.4, z, r(0, 6));
    }
  }
  // the pool: a deck with a white coping, ladders and a diving board
  function buildPool(g, TX, TZ) {
    const hole = new THREE.Path(); hole.moveTo(-TX, -TZ); hole.lineTo(TX, -TZ); hole.lineTo(TX, TZ); hole.lineTo(-TX, TZ); hole.closePath(); land(g, hole);
    const white = new THREE.MeshStandardMaterial({ color: 0xf4f6f6, roughness: 0.35 }), blue = new THREE.MeshStandardMaterial({ color: 0x2f7fd0, roughness: 0.4 });
    put(g, new RoundedBoxGeometry(1.9, 0.09, 0.5, 2, 0.03), blue, -TX + 0.4, H + 0.42, 0);
    put(g, new THREE.BoxGeometry(0.5, 0.42, 0.5), white, -TX - 0.5, H + 0.21, 0);
    for (const [x, z, ry] of [[TX * 0.55, -TZ, 0], [-TX * 0.55, -TZ, 0], [TX * 0.55, TZ, Math.PI]]) {
      const lad = new THREE.Group(); lad.position.set(x, 0, z); lad.rotation.y = ry; g.add(lad);
      for (const sx of [-0.25, 0.25]) {
        put(lad, new THREE.CylinderGeometry(0.03, 0.03, 0.8, 12), chrome, sx, H + 0.1, 0.03);
        put(lad, new THREE.TorusGeometry(0.16, 0.03, 10, 16, Math.PI), chrome, sx, H + 0.5, -0.13, Math.PI / 2);
      }
      for (const y of [H - 0.2, H - 0.05]) put(lad, new THREE.CylinderGeometry(0.02, 0.02, 0.5, 10).rotateZ(Math.PI / 2), chrome, 0, y, 0.03);
    }
    for (let i = 0; i < 5; i++) {   // loungers along the far side
      const x = -TX * 0.7 + i * TX * 0.35, lounger = new THREE.MeshStandardMaterial({ color: i % 2 ? 0xffd23f : 0xf26b5b, roughness: 0.6 });
      put(g, new RoundedBoxGeometry(0.7, 0.1, 1.8, 2, 0.03), lounger, x, H + 0.2, -TZ - 1.9);
    }
  }
  function setStage(S) {
    const TX = S.x, TZ = S.z;
    U.TANK.value.set(TX, TOP, TZ); U.ABSORB.value.set(...S.absorb); U.uWalls.value.set(...S.walls); U.uKind.value = S.kind;
    U.uTexel.value = 4 * TX * TZ / (CAUS[0] * CAUS[1]); uSize.value.set(2 * TX, 2 * TZ);
    scene.remove(around);
    around.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    around = new THREE.Group();
    floor.visible = S.kind === 0;
    (S.kind === 0 ? buildTub : S.kind === 1 ? buildPond : buildPool)(around, TX, TZ);
    scene.add(around);
    stage = S;
  }
  let stage = STAGES[0];

  const sunLight = new THREE.DirectionalLight(0xffffff, 2.5), hemi = new THREE.HemisphereLight(0xbcd2ea, 0x6f7f84, 1.1);
  scene.add(skyDome, floor, surface, sunLight, hemi);

  // the sun, drifting a little so the rim's shadow and the caustics keep shifting
  function setLight(t) {
    const el = 1.12, az = 3.93 + 0.14 * Math.sin(t * 0.05), I = 3.2, warm = 1, day = 1, glow = 0.35 * I * Math.sin(el) + 0.4 * day;
    U.uLight.value.set(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az));
    U.uLightCol.value.set(I, I * (0.62 + 0.36 * warm), I * (0.38 + 0.56 * warm));
    U.uAmb.value.set(0.3 * day, 0.42 * day, 0.62 * day);
    U.uGlow.value.set(0.012 * glow * stage.glow[0], 0.07 * glow * stage.glow[1], 0.085 * glow * stage.glow[2]);
    U.uDay.value = day;
    sunLight.position.copy(U.uLight.value).multiplyScalar(10);
  }

  return {
    THREE, scene, camera, setStage,
    // One 1/60 s of the ripple simulation: up to 8 waiting splashes ([x, z, radius, mm]), each duck's hull before and after.
    step(drops, before, after) {
      for (let i = 0; i < 8; i++) { const d = drops[i]; if (d) dropU.set(d, i * 4); else dropU.set([0, 0, 1, 0], i * 4); }
      for (let i = 0; i < MAXD; i++) {
        if (before[i]) { hullA[i].set(...before[i]); hullB[i].set(...after[i]); } else { hullA[i].set(0, 0, 0, 0); hullB[i].set(0, 0, 0, 0); }
      }
      gpu.compute();
    },
    // Once a frame: the sea, the surface texture, the caustics, then the whole scene. `ducks`: x, z, heading, shadow on.
    draw(t, ducks) {
      waveHeights(t, stage.waves, 0.45);
      setLight(t);
      for (let i = 0; i < MAXD; i++) { const d = ducks[i]; if (d) duckU[i].set(d[0], d[1], d[2], d[3]); else duckU[i].set(0, 0, 0, 0); }
      U.uTime.value = t;
      U.uSim.value = gpu.getCurrentRenderTarget(sim).texture;
      gpu.doRenderTarget(surfMat, surfRT); U.uSurf.value = surfRT.texture;
      U.uCaus.value = null;
      renderer.setRenderTarget(causRT); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.render(causScene, flatCam);
      renderer.setRenderTarget(null); U.uCaus.value = causRT.texture;
      renderer.render(scene, camera);
    },
    prime(t) { waveHeights(t, stage.waves, 0.45); },
  };
}
