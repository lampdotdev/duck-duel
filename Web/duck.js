// The rubber duck's shape and mesh, from CAUSTIC//LITE by ScottieFox (MIT), adapted for Duck Duel.
// Ellipsoids and a sphere blended by a smooth minimum make the body; a naive surface-nets pass turns the
// distance function into triangles once, at the start.
import * as THREE from 'three';

export const DS = 0.42;   // metres per duck unit (body length 1)
const ell = (x, y, z, a, b, c) => { x /= a; y /= b; z /= c; const k0 = Math.sqrt(x * x + y * y + z * z), k1 = Math.sqrt(x * x / (a * a) + y * y / (b * b) + z * z / (c * c)); return k0 * (k0 - 1) / k1; };
const smin = (a, b, k) => { const h = Math.min(Math.max(0.5 + 0.5 * (b - a) / k, 0), 1); return b + (a - b) * h - k * h * (1 - h); };
const box = (x, y, z, a, b, c, r) => { const qx = Math.abs(x) - a + r, qy = Math.abs(y) - b + r, qz = Math.abs(z) - c + r, ux = Math.max(qx, 0), uy = Math.max(qy, 0), uz = Math.max(qz, 0);
  return Math.sqrt(ux * ux + uy * uy + uz * uz) + Math.min(Math.max(qx, qy, qz), 0) - r; };
const TIP = [Math.cos(0.55), Math.sin(0.55), Math.cos(0.25), Math.sin(0.25), Math.cos(0.1), -Math.sin(0.1)];   // how the tail, wings and beak are tipped
function duckBody(x, y, z) {   // as duckShape() in the shaders
  const tx = x + 0.4, ty = y - 0.46, wx = x + 0.04, wy = y - 0.37, hx = x - 0.25, hy = y - 0.8;
  let d = ell(x, y - 0.28, z, 0.5, 0.3, 0.37);                                                         // body
  d = smin(d, ell(tx * TIP[0] + ty * TIP[1], ty * TIP[0] - tx * TIP[1], z, 0.2, 0.13, 0.15), 0.12);    // tail
  d = smin(d, ell(x - 0.22, y - 0.3, z, 0.3, 0.26, 0.31), 0.1);                                        // chest
  d = smin(d, Math.sqrt(hx * hx + hy * hy + z * z) - 0.25, 0.14);                                      // head
  d = smin(d, ell(wx * TIP[2] + wy * TIP[3], wy * TIP[2] - wx * TIP[3], Math.abs(z) - 0.29, 0.27, 0.12, 0.08), 0.05);   // wings
  return Math.max(d, box(x, y - 0.6, z, 1.2, 0.58, 1.2, 0.03));                                        // flat base
}
function duckBeak(x, y, z) {
  const bx = x - 0.53, by = y - 0.73;
  return Math.max(ell(bx * TIP[4] + by * TIP[5], by * TIP[4] - bx * TIP[5], z, 0.18, 0.065, 0.14), -box(x - 0.64, y - 0.725, z, 0.12, 0.007, 0.2, 0));
}
const EYE = [0.41, 0.9, 0.15, 0.055];

// Turn a distance function into triangles (naive surface nets): a vertex in every grid cell the surface
// passes through (the average of where it crosses the cell's edges, pulled onto the surface), and a
// quad across every grid edge it crosses. Normals come from the function's gradient, so the shading is
// smooth. Points more than four cells from the surface skip the full evaluation (a coarse pass first).
const EDGES = [];
for (let c = 0; c < 8; c++) for (const b of [1, 2, 4]) if (!(c & b)) EDGES.push(c, c | b);
function surfaceNet(sdf, lo, hi, h, scale) {
  const nx = Math.ceil((hi[0] - lo[0]) / h) + 1, ny = Math.ceil((hi[1] - lo[1]) / h) + 1, nz = Math.ceil((hi[2] - lo[2]) / h) + 1, S = [1, nx, nx * ny];
  const V = new Float32Array(nx * ny * nz), id = new Int32Array(nx * ny * nz).fill(-1), P = [], N = [], I = [];
  const mx = (nx >> 2) + 2, my = (ny >> 2) + 2, C = new Float32Array(mx * my * ((nz >> 2) + 2));
  for (let k = 0, q = 0; q < C.length; k++) for (let j = 0; j < my; j++) for (let i = 0; i < mx; i++, q++) C[q] = sdf(lo[0] + 4 * i * h, lo[1] + 4 * j * h, lo[2] + 4 * k * h);
  for (let k = 0, q = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++, q++) {
    const c = C[(((k + 2) >> 2) * my + ((j + 2) >> 2)) * mx + ((i + 2) >> 2)];
    V[q] = Math.abs(c) > 4 * h ? c : sdf(lo[0] + i * h, lo[1] + j * h, lo[2] + k * h);
  }
  const corner = [0, 1, 2, 3, 4, 5, 6, 7].map((c) => (c & 1) + (c >> 1 & 1) * S[1] + (c >> 2) * S[2]), e = h * 0.05;
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0, q = (k * ny + j) * nx; i < nx - 1; i++, q++) {
    let n = 0, sx = 0, sy = 0, sz = 0;
    for (let a = 0; a < 24; a += 2) {
      const c0 = EDGES[a], c1 = EDGES[a + 1], v0 = V[q + corner[c0]], v1 = V[q + corner[c1]];
      if ((v0 < 0) === (v1 < 0)) continue;
      const t = v0 / (v0 - v1);
      sx += (c0 & 1) + ((c1 & 1) - (c0 & 1)) * t; sy += (c0 >> 1 & 1) + ((c1 >> 1 & 1) - (c0 >> 1 & 1)) * t; sz += (c0 >> 2) + ((c1 >> 2) - (c0 >> 2)) * t; n++;
    }
    if (!n) continue;
    let x = lo[0] + (i + sx / n) * h, y = lo[1] + (j + sy / n) * h, z = lo[2] + (k + sz / n) * h;
    for (let it = 0; it < 2; it++) {   // one step onto the surface, then the normal there
      const d = sdf(x, y, z), gx = sdf(x + e, y, z) - d, gy = sdf(x, y + e, z) - d, gz = sdf(x, y, z + e) - d, l = Math.hypot(gx, gy, gz) || 1;
      if (it) N.push(gx / l, gy / l, gz / l); else { const m = Math.max(-h / 2, Math.min(h / 2, d)) / l; x -= m * gx; y -= m * gy; z -= m * gz; }
    }
    id[q] = P.length / 3; P.push(x * scale, y * scale, z * scale);
  }
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1, q = (k * ny + j) * nx + 1; i < nx - 1; i++, q++) {
    const inside = V[q] < 0;
    for (let a = 0; a < 3; a++) {   // the grid edge from here along axis a crosses the surface: join the four cells around it
      if ((V[q + S[a]] < 0) === inside) continue;
      const b = S[(a + 1) % 3], c = S[(a + 2) % 3], q00 = id[q - b - c], q10 = id[q - c], q11 = id[q], q01 = id[q - b];
      if (q00 < 0 || q10 < 0 || q11 < 0 || q01 < 0) continue;
      if (inside) I.push(q00, q10, q11, q00, q11, q01); else I.push(q00, q11, q10, q00, q01, q11);
    }
  }
  return { P, N, I };
}


// Colours of the six ducks (linear RGB) and their names.
export const DUCKS = [
  { name: 'Quackers', css: '#ffc21a', rgb: [0.92, 0.6, 0.012] },
  { name: 'Rosie',    css: '#ff5fa8', rgb: [0.95, 0.12, 0.38] },
  { name: 'Bluey',    css: '#4db2ff', rgb: [0.06, 0.38, 0.95] },
  { name: 'Minty',    css: '#4be08a', rgb: [0.06, 0.75, 0.3] },
  { name: 'Puddles',  css: '#ff6a3d', rgb: [0.95, 0.17, 0.04] },
  { name: 'Plum',     css: '#b07bff', rgb: [0.42, 0.2, 0.9] },
];

let geos = null;
function geometry({ P, N, I }) {
  const g = new THREE.BufferGeometry().setIndex(I);
  return g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)).setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
}
// Meshes the body and beak once (about a fifth of a second), and shares them between every duck.
export function prepareDuck() {
  if (geos) return;
  geos = {
    body: geometry(surfaceNet(duckBody, [-0.66, -0.02, -0.42], [0.56, 1.08, 0.42], 0.016, DS)),
    beak: geometry(surfaceNet(duckBeak, [0.33, 0.62, -0.16], [0.74, 0.84, 0.16], 0.004, DS)),
    eye: new THREE.SphereGeometry(EYE[3] * DS, 20, 14),
    cap: new THREE.SphereGeometry(EYE[3] * DS * 1.004, 20, 6, 0, 2 * Math.PI, 0, 0.6),
  };
}
const plastic = (r, g, b, roughness) => new THREE.MeshStandardMaterial({ color: new THREE.Color(r, g, b), roughness });
const white = plastic(0.82, 0.82, 0.82, 0.1), black = plastic(0.006, 0.006, 0.006, 0.1), orange = plastic(0.95, 0.2, 0.01, 0.3);
Object.assign(black, { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 });
const up = new THREE.Vector3(0, 1, 0);

// One duck: a group whose origin is the flat base at the waterline. `.body` is its own material, for colour and flashes.
export function makeDuck(rgb) {
  prepareDuck();
  const group = new THREE.Group(), inner = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: new THREE.Color(...rgb), roughness: 0.3 });
  body.emissive.setRGB(rgb[0] * 0.14, rgb[1] * 0.14, rgb[2] * 0.14);   // vinyl lets a little light through
  inner.add(new THREE.Mesh(geos.body, body), new THREE.Mesh(geos.beak, orange));
  for (const sz of [1, -1]) {
    const eye = new THREE.Mesh(geos.eye, white), cap = new THREE.Mesh(geos.cap, black);
    cap.quaternion.setFromUnitVectors(up, new THREE.Vector3(0.03, 0.006, 0.022 * sz).normalize());
    eye.position.set(EYE[0] * DS, EYE[1] * DS, sz * EYE[2] * DS); eye.add(cap); inner.add(eye);
  }
  group.add(inner);
  group.body = body; group.inner = inner; group.baseEmissive = body.emissive.clone();
  return group;
}
