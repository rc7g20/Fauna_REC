/* 3D 骨骼模型檢視與 zone 塗色元件（three.js r160，離線檔案在 lib/）
   每個三角面記錄一個 zone（0＝未分區，1–8）；面的順序就是 PLY 檔中的順序，所以模型重新簡化後，舊的 zone 設定會失效。
   用法：const v = await Zone3D.create(容器, { url, mirror, labels, mode, style, onChange, onPick, onTool })
   style："fill"（各 zone 填色）或 "outline"（骨頭原色＋虛線界線＋zone 號碼；setHighlight 的 zone 才填色） */
import * as THREE from "./lib/three.module.min.js";
import { OrbitControls } from "./lib/OrbitControls.js";
import { PLYLoader } from "./lib/PLYLoader.js";

const ZONE_COLORS = ["#e8dcc4", "#e15759", "#f28e2b", "#edc948", "#59a14f", "#76b7b2", "#4e79a7", "#b07aa1", "#ff9da7"];
const COLS = ZONE_COLORS.map((c) => new THREE.Color(c));
const DIM = COLS.map((c, i) => (i ? c.clone().lerp(COLS[0], 0.78) : c.clone()));

async function create(container, opt = {}) {
  const src = await new PLYLoader().loadAsync(opt.url);
  src.computeVertexNormals(); // 在共用頂點的網格上算法向量，表面才會平滑
  const geo = src.index ? src.toNonIndexed() : src;
  if (geo !== src) src.dispose();
  geo.computeBoundingBox();
  const ctr = geo.boundingBox.getCenter(new THREE.Vector3());
  geo.translate(-ctr.x, -ctr.y, -ctr.z);
  geo.computeBoundingSphere();
  const R = geo.boundingSphere.radius;
  const nF = geo.attributes.position.count / 3;
  let labels = opt.labels && opt.labels.length === nF ? Uint8Array.from(opt.labels) : new Uint8Array(nF);

  // 每個面的中心點與法向量（塗色時用）
  const P = geo.attributes.position.array, cen = new Float32Array(nF * 3), nrm = new Float32Array(nF * 3);
  for (let f = 0; f < nF; f++) {
    const o = f * 9;
    const ax = P[o], ay = P[o + 1], az = P[o + 2], bx = P[o + 3], by = P[o + 4], bz = P[o + 5], cx = P[o + 6], cy = P[o + 7], cz = P[o + 8];
    cen[f * 3] = (ax + bx + cx) / 3; cen[f * 3 + 1] = (ay + by + cy) / 3; cen[f * 3 + 2] = (az + bz + cz) / 3;
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
    nrm[f * 3] = uy * vz - uz * vy; nrm[f * 3 + 1] = uz * vx - ux * vz; nrm[f * 3 + 2] = ux * vy - uy * vx;
  }
  const colors = new Float32Array(nF * 9), alphas = new Float32Array(nF * 3);
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.setAttribute("alpha", new THREE.BufferAttribute(alphas, 1));
  let highlight = null; // Set：只亮顯這些 zone（記錄時用）；null＝全部顯示
  let colorFn = null;   // 自訂每個面的顏色（設定工具的區塊顯示用），回傳 {r,g,b}
  // style：fill＝各 zone 填色（實心）；outline＝X 光式透明骨骼，只看得到輪廓，zone 之間畫虛線、區塊中心標號碼，highlight 的 zone 半透明填色
  let style = opt.style || "fill";
  const colorFace = (f) => {
    const z = labels[f], on = style === "outline" && z && highlight && highlight.has(z);
    const c = colorFn ? colorFn(f)
      : style === "outline" ? COLS[0]
      : highlight ? (highlight.has(z) ? COLS[z] : DIM[z]) : COLS[z];
    // outline：選取的區塊由下面的實心網格畫，X 光層在這些面上不畫（alpha＝-1）
    for (let k = 0; k < 3; k++) { const o = f * 9 + k * 3; colors[o] = c.r; colors[o + 1] = c.g; colors[o + 2] = c.b; alphas[f * 3 + k] = on ? -1 : 0; }
  };
  /* outline 樣式中選取的 zone：實心、有光影；和 X 光層共用頂點。
     預設單一顏色（opt.hlColor）；hlColors 可以讓個別 zone 用別的顏色（例如切砍痕的位置用紅色） */
  const hlGeo = new THREE.BufferGeometry(), hlCols = new Float32Array(nF * 9);
  hlGeo.setAttribute("position", geo.attributes.position); hlGeo.setAttribute("normal", geo.attributes.normal);
  hlGeo.setAttribute("color", new THREE.BufferAttribute(hlCols, 3));
  const hlMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0, side: THREE.DoubleSide });
  const hlMesh = new THREE.Mesh(hlGeo, hlMat); hlMesh.visible = false;
  const hlDefault = new THREE.Color(opt.hlColor ?? 0xd99a4e);
  let hlColors = new Map();   // zone → THREE.Color
  const updateHL = () => {
    if (style !== "outline" || !highlight || !highlight.size) { hlMesh.visible = false; return; }
    const idx = [];
    for (let f = 0; f < nF; f++) {
      const z = labels[f]; if (!z || !highlight.has(z)) continue;
      idx.push(f * 3, f * 3 + 1, f * 3 + 2);
      const c = hlColors.get(z) || hlDefault;
      for (let k = 0; k < 3; k++) { const o = f * 9 + k * 3; hlCols[o] = c.r; hlCols[o + 1] = c.g; hlCols[o + 2] = c.b; }
    }
    hlGeo.setIndex(idx); hlGeo.attributes.color.needsUpdate = true; hlMesh.visible = idx.length > 0;
  };
  const recolor = () => { for (let f = 0; f < nF; f++) colorFace(f); geo.attributes.color.needsUpdate = true; geo.attributes.alpha.needsUpdate = true; updateHL(); };
  recolor();

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf6f3ee);
  const solidMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  /* X 光材質：正對視線的面幾乎透明，越接近輪廓（側面）越不透明，所以只看得到骨頭的外形輪廓 */
  const xrayMat = new THREE.ShaderMaterial({
    vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { rim: { value: new THREE.Color(0x5b4a38) } },
    vertexShader: `attribute float alpha; varying vec3 vN; varying vec3 vV; varying vec3 vC; varying float vA;
      void main() { vC = color; vA = alpha; vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = -mv.xyz; vN = normalMatrix * normal; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 rim; varying vec3 vN; varying vec3 vV; varying vec3 vC; varying float vA;
      void main() { if (vA < 0.0) discard;   // 選取的區塊由實心網格畫
        float f = 1.0 - abs(dot(normalize(vN), normalize(vV))); float r = pow(f, 2.5);
        gl_FragColor = vec4(mix(vC, rim, r), XRAY_BASE + r * 0.8); }`,
    defines: { XRAY_BASE: "0.16" },   // 正對視線的骨面不透明度（0＝全透明，1＝不透明）
  });
  const mesh = new THREE.Mesh(geo, style === "outline" ? xrayMat : solidMat);
  if (opt.mirror) mesh.scale.x = -1; // 右側＝左側模型的鏡像
  mesh.add(hlMesh);
  scene.add(mesh);

  /* ---------- 虛線界線與 zone 號碼 ---------- */
  // 非索引網格中位置相同的頂點視為同一點：fv＝每個角的頂點編號；edges＝邊 → 兩側的面
  let W = null;
  const weld = () => {
    if (W) return W;
    const key = new Map(), fv = new Int32Array(nF * 3), first = [];
    for (let i = 0; i < nF * 3; i++) {
      const k = P[i * 3] + "," + P[i * 3 + 1] + "," + P[i * 3 + 2];
      let id = key.get(k); if (id === undefined) { id = first.length; key.set(k, id); first.push(i); }
      fv[i] = id;
    }
    const nv = first.length, edges = new Map();
    for (let f = 0; f < nF; f++) for (let k = 0; k < 3; k++) {
      const a = fv[f * 3 + k], b = fv[f * 3 + ((k + 1) % 3)], e = Math.min(a, b) * nv + Math.max(a, b);
      const s = edges.get(e); if (s) s.push(f); else edges.set(e, [f]);
    }
    const vs = new Int32Array(nv + 1); for (const v of fv) vs[v + 1]++;
    for (let i = 0; i < nv; i++) vs[i + 1] += vs[i];
    const vf = new Int32Array(nF * 3), pos = vs.slice(0, nv);
    for (let i = 0; i < nF * 3; i++) vf[pos[fv[i]]++] = (i / 3) | 0;
    return (W = { fv, first, nv, edges, vs, vf });
  };
  const overlay = new THREE.Group(); overlay.renderOrder = 2; mesh.add(overlay);
  // 骨骼是透明的，界線與號碼不做深度測試，前後都看得到
  const lineMat = new THREE.LineDashedMaterial({ color: 0x3b2f25, dashSize: R * 0.03, gapSize: R * 0.02, depthTest: false, transparent: true, opacity: 0.9 });
  /* 號碼標籤：圓圈裡是 zone 號碼，右邊可以接小標記（例如紅色「切」、藍色「咬」） */
  const tex = new Map();
  let marks = {};   // zone → [{ text, color }]
  const numTex = (z, ms = []) => {
    const key = z + "|" + ms.map((m) => m.text + m.color).join(",");
    if (tex.has(key)) return tex.get(key);
    const c = document.createElement("canvas"); c.width = 128 + ms.length * 60; c.height = 128;
    const g = c.getContext("2d");
    g.beginPath(); g.arc(64, 64, 52, 0, Math.PI * 2); g.fillStyle = "rgba(255,255,255,.92)"; g.fill();
    g.lineWidth = 6; g.strokeStyle = "#3b2f25"; g.stroke();
    g.fillStyle = "#24211d"; g.font = "bold 68px system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(String(z), 64, 68);
    ms.forEach((m, i) => {
      const x = 128 + i * 60 + 26;
      g.beginPath(); g.arc(x, 64, 28, 0, Math.PI * 2); g.fillStyle = m.color; g.fill();
      g.fillStyle = "#fff"; g.font = "bold 34px system-ui, sans-serif"; g.fillText(m.text, x, 66);
    });
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.userData = { w: c.width }; tex.set(key, t); return t;
  };
  /* 讓標籤的圓圈（號碼）維持在區塊中心，右邊的小標記往外延伸 */
  const setLabel = (sp) => {
    const t = numTex(sp.userData.zone, marks[sp.userData.zone] || []), w = t.userData.w / 128;
    sp.material.map = t; sp.material.needsUpdate = true;
    sp.scale.set(R * 0.09 * w, R * 0.09, 1); sp.center.set(0.5 / w, 0.5);
  };
  /* 切面：兩個 zone 之間的切割面，畫成半透明的淺色面。和號碼一起依前後距離排序，
     切面後方的號碼會被蓋上一層而變淡，前方的號碼維持清楚，比較容易分辨前後 */
  const capMat = new THREE.MeshBasicMaterial({ color: 0xd9cbb0, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false, depthTest: false });
  /* 兩側的 zone 都被選取（保存）時，中間的切面不顯示 */
  const updateCaps = () => { for (const o of overlay.children) if (o.userData.pair) o.visible = !(highlight && highlight.has(o.userData.pair[0]) && highlight.has(o.userData.pair[1])); };
  const buildCaps = (pts) => {
    const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
    const byPair = new Map();
    for (const p of pts) { const l = byPair.get(p.pair); if (l) l.push(p); else byPair.set(p.pair, [p]); }
    const loops = [];
    for (const [pair, ps] of byPair) {
      // 封閉的環（例如骨幹的一圈）各自是一個切面；不封閉的線（例如縱切面兩側的邊）依端點遠近接成一圈
      for (const p of ps.filter((x) => x.closed)) { const l = p.slice(0, -1); l.pair = pair; loops.push(l); }
      const open = ps.filter((x) => !x.closed);
      if (!open.length) continue;
      const loop = open.shift().slice(); loop.pair = pair;
      while (open.length) {
        const end = loop[loop.length - 1];
        let bi = 0, rev = false, bd = Infinity;
        open.forEach((p, i) => { const a = d2(end, p[0]), b = d2(end, p[p.length - 1]); if (a < bd) { bd = a; bi = i; rev = false; } if (b < bd) { bd = b; bi = i; rev = true; } });
        const p = open.splice(bi, 1)[0];
        loop.push(...(rev ? p.slice().reverse() : p));
      }
      loops.push(loop);
    }
    for (const loop0 of loops) {
      const loop = loop0.filter((p, i) => i === 0 || d2(p, loop0[i - 1]) > 1e-12); loop.pair = loop0.pair;
      if (loop.length < 3) continue;
      // 用 Newell 法求這一圈的平面；偏離平面太多（不是平面切出來的界線）就不畫切面
      const c = [0, 0, 0], n = [0, 0, 0];
      for (const p of loop) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; }
      c[0] /= loop.length; c[1] /= loop.length; c[2] /= loop.length;
      for (let i = 0; i < loop.length; i++) {
        const a = loop[i], b = loop[(i + 1) % loop.length];
        n[0] += (a[1] - b[1]) * (a[2] + b[2]); n[1] += (a[2] - b[2]) * (a[0] + b[0]); n[2] += (a[0] - b[0]) * (a[1] + b[1]);
      }
      const N = new THREE.Vector3(...n); if (N.lengthSq() < 1e-12) continue;
      N.normalize();
      let ext = 0, off = 0;
      for (const p of loop) { ext = Math.max(ext, Math.sqrt(d2(p, c))); off = Math.max(off, Math.abs((p[0] - c[0]) * N.x + (p[1] - c[1]) * N.y + (p[2] - c[2]) * N.z)); }
      if (off > ext * 0.3) continue;
      const U = new THREE.Vector3(1, 0, 0); if (Math.abs(N.x) > 0.9) U.set(0, 1, 0);
      U.sub(N.clone().multiplyScalar(U.dot(N))).normalize();
      const Vv = new THREE.Vector3().crossVectors(N, U);
      const flat = loop.map((p) => { const d = new THREE.Vector3(p[0] - c[0], p[1] - c[1], p[2] - c[2]); return new THREE.Vector2(d.dot(U), d.dot(Vv)); });
      let tris;
      try { tris = THREE.ShapeUtils.triangulateShape(flat, []); } catch (e) { continue; }
      if (!tris.length) continue;
      const pos = new Float32Array(loop.length * 3);
      loop.forEach((p, i) => pos.set([p[0] - c[0], p[1] - c[1], p[2] - c[2]], i * 3));
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setIndex(tris.flat());
      const m = new THREE.Mesh(g, capMat);
      m.position.set(c[0], c[1], c[2]);   // 物件位置設在切面中心，透明物件才能依前後距離正確排序
      m.renderOrder = 2; m.userData.pair = [Math.floor(loop.pair / 16), loop.pair % 16];   // 這片切面兩側的 zone
      overlay.add(m);
    }
  };
  const clearOverlay = () => { for (const o of [...overlay.children]) { overlay.remove(o); if (o.geometry) o.geometry.dispose(); if (o.material && o.material !== lineMat && o.material !== capMat) o.material.dispose(); } };
  const buildOverlay = () => {
    clearOverlay();
    if (style !== "outline") return;
    const w = weld();
    // 界線：兩側 zone 不同的邊
    // 每一小段記下兩側是哪兩個 zone（例如 4|5）
    const segs = [];
    for (const [e, fs] of w.edges) {
      const a = labels[fs[0]], b = fs.length === 2 ? labels[fs[1]] : a;
      if (a !== b) segs.push({ v: [Math.floor(e / w.nv), e % w.nv], pair: Math.min(a, b) * 16 + Math.max(a, b) });
    }
    // 把小段接成連續的線（虛線的間隔才會連貫）：只接同一對 zone 的界線，遇到三個以上 zone 的交會點就斷開，
    // 交會點當作線的端點，平滑時固定不動，各條界線才會準確在交會點接起來
    const at = new Map();
    segs.forEach((s, i) => { for (const v of s.v) { const l = at.get(v); if (l) l.push(i); else at.set(v, [i]); } });
    const junction = (v) => (at.get(v) || []).length !== 2;
    const used = new Uint8Array(segs.length), lines = [];
    const extend = (line, v, pair) => {
      for (;;) {
        if (junction(v)) return;
        const nx = at.get(v).find((i) => !used[i] && segs[i].pair === pair); if (nx === undefined) return;
        used[nx] = 1; v = segs[nx].v[0] === v ? segs[nx].v[1] : segs[nx].v[0]; line.push(v);
      }
    };
    for (let i = 0; i < segs.length; i++) {
      if (used[i]) continue;
      used[i] = 1;
      const [a, b] = segs[i].v, p = segs[i].pair;
      const fwd = [a, b]; extend(fwd, b, p);
      const back = [a]; extend(back, a, p);
      const l = back.slice(1).reverse().concat(fwd); l.pair = p;
      lines.push(l);
    }
    // 平滑：界線原本沿著三角形的邊走，是鋸齒狀；用前後點的座標平均重複幾次，變成平順的線
    const smooth = (l) => {
      const closed = l.length > 3 && l[0] === l[l.length - 1];
      let p = (closed ? l.slice(0, -1) : l).map((v) => { const i = w.first[v] * 3; return [P[i], P[i + 1], P[i + 2]]; });
      const n = p.length, K = Math.min(3, Math.floor(n / 4));
      if (K >= 1) for (let it = 0; it < 4; it++) {
        const q = p.map((a) => a.slice());
        for (let i = 0; i < n; i++) {
          if (!closed && (i === 0 || i === n - 1)) continue;   // 不封閉的線：兩端固定
          let sx = 0, sy = 0, sz = 0, c = 0;
          for (let k = -K; k <= K; k++) {
            let j = i + k;
            if (closed) j = (j + n) % n; else if (j < 0 || j >= n) continue;
            sx += p[j][0]; sy += p[j][1]; sz += p[j][2]; c++;
          }
          q[i] = [sx / c, sy / c, sz / c];
        }
        p = q;
      }
      return closed ? p.concat([p[0]]) : p;
    };
    const pts = lines.map((l) => { const p = smooth(l); p.pair = l.pair; p.closed = l.length > 3 && l[0] === l[l.length - 1]; return p; });
    const nSeg = pts.reduce((a, l) => a + l.length - 1, 0);
    if (nSeg) {
      const pos = new Float32Array(nSeg * 6), dist = new Float32Array(nSeg * 2);
      let j = 0;
      for (const l of pts) {
        let d = 0, a = l[0];
        for (let k = 1; k < l.length; k++) {
          const b = l[k], len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
          pos.set(a, j * 6); pos.set(b, j * 6 + 3); dist[j * 2] = d; d += len; dist[j * 2 + 1] = d; j++; a = b;
        }
      }
      const lg = new THREE.BufferGeometry();
      lg.setAttribute("position", new THREE.BufferAttribute(pos, 3)); lg.setAttribute("lineDistance", new THREE.BufferAttribute(dist, 1));
      const ls = new THREE.LineSegments(lg, lineMat); ls.renderOrder = 2; overlay.add(ls);
    }
    buildCaps(pts); updateCaps();
    // 號碼：每個 zone 的每一塊相連區域（太小的略過，但每個 zone 至少標一次）
    const seen = new Uint8Array(nF), comps = [];
    for (let f0 = 0; f0 < nF; f0++) {
      const z = labels[f0]; if (!z || seen[f0]) continue;
      const comp = [f0]; seen[f0] = 1;
      for (let q = 0; q < comp.length; q++) {
        const f = comp[q];
        for (let k = 0; k < 3; k++) { const v = w.fv[f * 3 + k]; for (let t = w.vs[v]; t < w.vs[v + 1]; t++) { const g = w.vf[t]; if (!seen[g] && labels[g] === z) { seen[g] = 1; comp.push(g); } } }
      }
      comps.push({ z, comp });
    }
    comps.sort((a, b) => b.comp.length - a.comp.length);
    const done = new Set();
    for (const { z, comp } of comps) {
      if (done.has(z) && comp.length < nF * 0.01) continue;
      done.add(z);
      // 區塊中心：以面積加權的平均位置（例如骨幹的一段，中心會在骨頭的軸心上）
      let x = 0, y = 0, s = 0, A = 0;
      for (const f of comp) { const a = Math.hypot(nrm[f * 3], nrm[f * 3 + 1], nrm[f * 3 + 2]); x += cen[f * 3] * a; y += cen[f * 3 + 1] * a; s += cen[f * 3 + 2] * a; A += a; }
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ depthWrite: false, depthTest: false }));
      sp.position.set(x / A, y / A, s / A);
      sp.renderOrder = 2; sp.userData.zone = z;   // 和切面同一層，依前後距離排序
      setLabel(sp);
      overlay.add(sp);
    }
  };
  buildOverlay();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7a66, 1.1));
  const camera = new THREE.PerspectiveCamera(35, 1, R / 200, R * 30);
  const lamp = new THREE.DirectionalLight(0xffffff, 1.6); lamp.position.set(0.4, 0.6, 1); camera.add(lamp); scene.add(camera);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.domElement.style.cssText = "display:block;width:100%;height:100%;touch-action:none";
  container.appendChild(renderer.domElement);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.rotateSpeed = 0.9;

  let raf = 0;
  let disposed = false;
  const render = () => { if (!raf && !disposed) raf = requestAnimationFrame(() => { raf = 0; if (!disposed) renderer.render(scene, camera); }); };
  controls.addEventListener("change", render);
  const resetView = () => {
    // 讓模型最長的方向橫放
    const s = geo.boundingBox.getSize(new THREE.Vector3());
    mesh.rotation.set(0, 0, 0);
    if (s.y >= s.x && s.y >= s.z) mesh.rotation.z = Math.PI / 2; else if (s.z >= s.x && s.z >= s.y) mesh.rotation.y = Math.PI / 2;
    camera.position.set(0, 0, R * 2.9); camera.up.set(0, 1, 0); controls.target.set(0, 0, 0); controls.update(); render();
  };
  const fit = () => {
    const w = container.clientWidth || 300, h = container.clientHeight || 300;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); render();
  };
  const ro = new ResizeObserver(fit); ro.observe(container);
  fit(); resetView();

  // 模式：rotate＝單指／左鍵旋轉；paint＝單指／左鍵塗色，雙指／右鍵旋轉；
  //       pick＝單指／左鍵拖曳旋轉，點一下（沒有拖曳）選 zone（記錄工具用）
  let mode = "rotate", zone = 1, brush = 0.06;
  const setMode = (m) => {
    mode = m;
    const free = m === "rotate" || m === "pick";
    controls.mouseButtons = { LEFT: free ? THREE.MOUSE.ROTATE : null, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: free ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE };
    controls.touches = { ONE: free ? THREE.TOUCH.ROTATE : null, TWO: free ? THREE.TOUCH.DOLLY_PAN : THREE.TOUCH.DOLLY_ROTATE };
    renderer.domElement.style.cursor = m === "paint" || m === "tool" ? "crosshair" : m === "pick" ? "pointer" : "grab";
  };
  setMode(opt.mode || "rotate");

  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const hitAt = (x, y) => {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    return ray.intersectObject(mesh, false)[0] || null;
  };
  const undo = [];
  let changed = false;
  /* 筆刷範圍內、朝向鏡頭的面（避免塗到骨頭另一側） */
  const brushFaces = (x, y) => {
    const hit = hitAt(x, y); if (!hit) return [];
    const p = mesh.worldToLocal(hit.point.clone()), cam = mesh.worldToLocal(camera.position.clone());
    const rr = (brush * R) ** 2, out = [];
    for (let f = 0; f < nF; f++) {
      const i = f * 3, dx = cen[i] - p.x, dy = cen[i + 1] - p.y, dz = cen[i + 2] - p.z;
      if (dx * dx + dy * dy + dz * dz > rr) continue;
      if ((cam.x - cen[i]) * nrm[i] + (cam.y - cen[i + 1]) * nrm[i + 1] + (cam.z - cen[i + 2]) * nrm[i + 2] <= 0) continue;
      out.push(f);
    }
    return out;
  };
  const paintAt = (x, y) => {
    let n = 0;
    for (const f of brushFaces(x, y)) if (labels[f] !== zone) { labels[f] = zone; colorFace(f); n++; }
    if (n) { changed = true; geo.attributes.color.needsUpdate = true; render(); }
  };
  /* 畫面上的一條線 → 經過鏡頭與這條線的切面（模型座標）：{ n: 法向量, d }，面中心 c 在 n·c > d 的一側 */
  const linePlane = (x0, y0, x1, y1) => {
    const r = renderer.domElement.getBoundingClientRect();
    const dir = (x, y) => { ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera); return ray.ray.direction.clone(); };
    mesh.updateMatrixWorld();
    const inv = mesh.matrixWorld.clone().invert();
    const eye = camera.position.clone().applyMatrix4(inv);
    const a = camera.position.clone().add(dir(x0, y0)).applyMatrix4(inv).sub(eye);
    const b = camera.position.clone().add(dir(x1, y1)).applyMatrix4(inv).sub(eye);
    const n = a.cross(b); if (n.lengthSq() < 1e-20) return null;
    n.normalize();
    return { n: n.toArray(), d: n.dot(eye) };
  };

  // 觸控時先等一下：如果第二根手指也放上來（旋轉／縮放），就取消這一筆塗色
  const ptrs = new Map();
  let stroke = null;
  const el = renderer.domElement;
  const endStroke = (commit) => {
    if (!stroke) return;
    clearTimeout(stroke.timer);
    if (!commit) { labels = stroke.before; recolor(); render(); }
    else if (changed) { undo.push(stroke.before); if (undo.length > 30) undo.shift(); opt.onChange && opt.onChange(); }
    stroke = null; changed = false;
  };
  // tool 模式：單指／左鍵的事件交給呼叫端（設定工具的選取、切割、筆刷）；雙指時送出 cancel
  let tool = null;
  const toolEv = (type, e, extra) => opt.onTool && opt.onTool({ type, x: e ? e.clientX : 0, y: e ? e.clientY : 0, ...extra });
  el.addEventListener("pointerdown", (e) => {
    ptrs.set(e.pointerId, e);
    if (mode === "tool") {
      if (ptrs.size > 1) { if (tool) { tool = null; toolEv("cancel"); } return; }
      if (e.pointerType === "mouse" && e.button !== 0) return;
      tool = { x: e.clientX, y: e.clientY, moved: false }; toolEv("down", e);
      return;
    }
    if (ptrs.size > 1) { endStroke(false); return; }
    if (mode === "rotate" || (e.pointerType === "mouse" && e.button !== 0)) return;
    stroke = { x: e.clientX, y: e.clientY, live: e.pointerType === "mouse", moved: false, before: labels.slice() };
    if (mode === "paint") {
      if (stroke.live) paintAt(e.clientX, e.clientY);
      else stroke.timer = setTimeout(() => { if (stroke && ptrs.size === 1) { stroke.live = true; paintAt(stroke.x, stroke.y); } }, 90);
    }
  });
  el.addEventListener("pointermove", (e) => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId, e);
    if (tool) { if (ptrs.size === 1) { if (Math.hypot(e.clientX - tool.x, e.clientY - tool.y) > 6) tool.moved = true; toolEv("move", e, { moved: tool.moved, x0: tool.x, y0: tool.y }); } return; }
    if (!stroke || ptrs.size > 1) return;
    if (Math.hypot(e.clientX - stroke.x, e.clientY - stroke.y) > 6) stroke.moved = true;
    if (mode === "paint" && (stroke.live || stroke.moved)) { if (!stroke.live) { stroke.live = true; paintAt(stroke.x, stroke.y); } paintAt(e.clientX, e.clientY); }
  });
  const up = (e) => {
    if (!ptrs.delete(e.pointerId)) return;
    if (tool) { const t = tool; tool = null; toolEv("up", e, { moved: t.moved, x0: t.x, y0: t.y }); return; }
    if (!stroke) return;
    if (mode === "paint") { if (!stroke.live) paintAt(stroke.x, stroke.y); endStroke(true); }
    else if (mode === "pick") {
      const s = stroke; endStroke(true);
      if (!s.moved && opt.onPick) { const hit = hitAt(s.x, s.y); if (hit) opt.onPick({ zone: labels[hit.faceIndex], face: hit.faceIndex, point: mesh.worldToLocal(hit.point.clone()).toArray() }); }
    }
  };
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", (e) => { ptrs.delete(e.pointerId); endStroke(false); if (tool) { tool = null; toolEv("cancel"); } });

  return {
    faces: nF, radius: R,
    setMode, getMode: () => mode,
    setZone: (z) => { zone = z; },
    setBrush: (b) => { brush = b; },
    getLabels: () => labels.slice(),
    setLabels: (u8) => { if (u8 && u8.length === nF) { labels = Uint8Array.from(u8); recolor(); buildOverlay(); render(); } },
    setStyle: (s) => { style = s; mesh.material = s === "outline" ? xrayMat : solidMat; recolor(); buildOverlay(); render(); },
    getStyle: () => style,
    undo: () => { if (!undo.length) return false; labels = undo.pop(); recolor(); render(); opt.onChange && opt.onChange(); return true; },
    canUndo: () => undo.length > 0,
    counts: () => { const c = new Array(9).fill(0); for (let f = 0; f < nF; f++) c[labels[f]]++; return c; },
    // set：要填色的 zone；colors：個別 zone 的顏色 { zone: 0xRRGGBB }（沒有列出的用預設顏色）
    setHighlight: (set, colors) => {
      highlight = set ? new Set(set) : null;
      hlColors = new Map(Object.entries(colors || {}).map(([z, c]) => [+z, new THREE.Color(c)]));
      recolor(); updateCaps(); render();
    },
    // 號碼旁的小標記：{ zone: [{ text: "切", color: "#c0392b" }, …] }
    setMarks: (m) => { marks = m || {}; for (const o of overlay.children) if (o.isSprite) setLabel(o); render(); },
    // zone 之間的相鄰關係：Map(zone → Set(相鄰的 zone))
    zoneAdj: () => { const w = weld(), adj = new Map(); for (const fs of w.edges.values()) { if (fs.length < 2) continue; const a = labels[fs[0]], b = labels[fs[1]]; if (a && b && a !== b) { (adj.get(a) || adj.set(a, new Set()).get(a)).add(b); (adj.get(b) || adj.set(b, new Set()).get(b)).add(a); } } return adj; },
    resetView,
    // 設定工具用：面的位置資料、點選、筆刷、切面、自訂顏色
    positions: P, centers: cen, normals: nrm,
    pickFace: (x, y) => { const h = hitAt(x, y); return h ? h.faceIndex : -1; },
    brushFaces, linePlane,
    setColorFn: (fn) => { colorFn = fn; recolor(); render(); },
    refresh: (faces) => { if (faces) faces.forEach(colorFace); else for (let f = 0; f < nF; f++) colorFace(f); geo.attributes.color.needsUpdate = true; render(); },
    canvas: el,
    dispose: () => {
      disposed = true; if (raf) cancelAnimationFrame(raf);   // 已排定的重畫不再執行
      ro.disconnect(); controls.dispose(); clearOverlay(); lineMat.dispose(); capMat.dispose(); for (const t of tex.values()) t.dispose();
      geo.dispose(); hlGeo.dispose(); hlMat.dispose(); solidMat.dispose(); xrayMat.dispose();
      renderer.dispose(); renderer.forceContextLoss(); el.remove();
    },
  };
}

window.Zone3D = { create, ZONE_COLORS };
window.dispatchEvent(new Event("zone3d-ready"));
