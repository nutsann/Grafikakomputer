
// ============================================================
//  BAGIAN 1: KONFIGURASI GLOBAL
// ============================================================

const MAP_W  = 1400;   // Lebar peta dalam piksel (lebih besar dari viewport)
const MAP_H  = 1100;   // Tinggi peta dalam piksel

const ROAD_W = 18;     // Lebar jalan utama (piksel)
const CAR_SPEED = 120; // Kecepatan mobil piksel/detik

// Berapa banyak segmen jalan digenerate
const NUM_NODES      = 28;   // Jumlah node persimpangan
const NUM_EXTRA_CONN = 14;   // Koneksi tambahan agar graph lebih lebat

// Batasan zona — jalan tidak dibuat di tepi peta
const MARGIN = 80;

// ============================================================
//  BAGIAN 2: STATE APLIKASI
// ============================================================

// Graph jalan (vektor):
//   nodes[i] = { id, x, y }                    — titik persimpangan
//   edges[i] = { id, a, b, pts, length, type }  — segmen jalan
//     pts   = array titik [{x,y}] untuk animasi (disampling dari kurva)
//     type  = 'straight' | 'diagonal' | 'curve'
let nodes = [];
let edges = [];

// Adjacency list untuk pathfinding
//   adjList[nodeId] = [ {nodeId, edgeId, reversed}, ... ]
let adjList = {};

// Start & End node id
let startId = null;
let endId   = null;

// Path hasil Dijkstra: array { edgeId, reversed }
let pathEdges = [];
// Path titik-titik halus untuk animasi
let pathPoints = [];   // [{x,y}]

// State animasi
let animRunning  = false;
let animPaused   = false;
let animFrame    = null;
let carPtIndex   = 0;
let carX = 0, carY = 0;
let carAngle = 0;
let lastTime = 0;

// State peta
let mapReady = false;
let posReady = false;

// Kamera
let camOffX  = 0;
let camOffY  = 0;
let camScale = 1.0;
let SCALE_MIN  = 0.25;
const SCALE_MAX  = 4.0;
const SCALE_STEP = 0.1;

// Drag
let isDragging  = false;
let dragStartX  = 0;
let dragStartY  = 0;
let camOffXSnap = 0;
let camOffYSnap = 0;

// ============================================================
//  BAGIAN 3: REFERENSI DOM
// ============================================================

const bgCanvas    = document.getElementById('bgCanvas');
const bgCtx       = bgCanvas.getContext('2d');
const fgCanvas    = document.getElementById('fgCanvas');
const fgCtx       = fgCanvas.getContext('2d');
const roadSVG     = document.getElementById('roadSVG');
const wrapper     = document.getElementById('canvasWrapper');
const hint        = document.getElementById('canvasHint');
const btnStart    = document.getElementById('btnStartPause');
const btnLabel    = document.getElementById('btnLabel');
const iconPlay    = document.getElementById('iconPlay');
const iconPause   = document.getElementById('iconPause');
const zoomLabel   = document.getElementById('zoomLabel');
const infoStatus  = document.getElementById('infoStatus');
const infoPathLen = document.getElementById('infoPathLen');
const infoRoadSegs= document.getElementById('infoRoadSegs');
const infoProgress= document.getElementById('infoProgress');
const progressBar = document.getElementById('progressBar');

// ============================================================
//  BAGIAN 4: INISIALISASI LAYER
//  Tiga layer (bgCanvas, roadSVG, fgCanvas) pakai ukuran sama
// ============================================================

function initLayers() {
  [bgCanvas, fgCanvas].forEach(c => {
    c.width  = MAP_W;
    c.height = MAP_H;
  });
  roadSVG.setAttribute('width',  MAP_W);
  roadSVG.setAttribute('height', MAP_H);
  roadSVG.setAttribute('viewBox', `0 0 ${MAP_W} ${MAP_H}`);

  // Pusatkan kamera
  const ww = wrapper.clientWidth;
  const wh = wrapper.clientHeight;
  camOffX = (ww - MAP_W * camScale) / 2;
  camOffY = (wh - MAP_H * camScale) / 2;
  updateMinScale();
}

function applyTransform() {
  clampCamera();
  const t = `translate(${camOffX}px, ${camOffY}px) scale(${camScale})`;

  bgCanvas.style.transform = t;
  roadSVG.style.transform  = t;
  fgCanvas.style.transform = t;

  zoomLabel.textContent = Math.round(camScale * 100) + '%';
}

function updateMinScale() {
  const ww = wrapper.clientWidth;
  const wh = wrapper.clientHeight;

  const scaleX = ww / MAP_W;
  const scaleY = wh / MAP_H;

  SCALE_MIN = 0.35;

  if (camScale < SCALE_MIN) {
    camScale = SCALE_MIN;
  }

  camOffX = (ww - MAP_W * camScale) / 2;
  camOffY = (wh - MAP_H * camScale) / 2;

  applyTransform();
}

function clampCamera() {
  const ww = wrapper.clientWidth;
  const wh = wrapper.clientHeight;

  const mapWidth  = MAP_W * camScale;
  const mapHeight = MAP_H * camScale;

  if (mapWidth <= ww) {
    camOffX = (ww - mapWidth) / 2;
  } else {
    const minX = ww - mapWidth;
    const maxX = 0;
    camOffX = Math.min(maxX, Math.max(minX, camOffX));
  }

  if (mapHeight <= wh) {
    camOffY = (wh - mapHeight) / 2;
  } else {
    const minY = wh - mapHeight;
    const maxY = 0;
    camOffY = Math.min(maxY, Math.max(minY, camOffY));
  }
}

// ============================================================
//  BAGIAN 5: GENERATE MAP — Graph Berbasis Vektor
//
//  Algoritma:
//  1. Scatter node-node persimpangan secara acak (dengan grid jitter
//     agar tidak terlalu menumpuk)
//  2. Bangun Minimum Spanning Tree (Prim) agar semua terhubung
//  3. Tambahkan koneksi extra untuk membuat loop dan variasi rute
//  4. Untuk setiap edge, tentukan tipe jalan:
//       - diagonal  : jika sudut ~45° (bukan 0°/90°)
//       - curve     : lengkung Bezier kubik dengan kontrol acak
//       - straight  : hanya sebagian kecil (<10%)
//  5. Sample titik-titik sepanjang kurva untuk pathfinding & animasi
// ============================================================

// ============================================================
//  GENERATE MAP MODEL "ROAD LOOP CITY"
//  Jalan saling terhubung seperti contoh gambar
// ============================================================

// ============================================================
//  GENERATE MAP MODEL "ROAD LOOP CITY"
//  Jalan saling terhubung seperti contoh gambar
// ============================================================

function generateMap() {

  stopAnimation();

  mapReady = false;
  posReady = false;

  startId = null;
  endId   = null;

  pathEdges  = [];
  pathPoints = [];

  nodes = [];
  edges = [];
  adjList = {};

  // =========================================================
  // 1. BUAT NODE GRID ORGANIK
  // =========================================================

  const COLS = 6;
  const ROWS = 5;

  const spacingX =
    (MAP_W - MARGIN * 2) / (COLS - 1);

  const spacingY =
    (MAP_H - MARGIN * 2) / (ROWS - 1);

  for (let r = 0; r < ROWS; r++) {

    for (let c = 0; c < COLS; c++) {

      const jitterX =
        (Math.random() - 0.5) * 90;

      const jitterY =
        (Math.random() - 0.5) * 90;

      nodes.push({

        id: nodes.length,

        x:
          MARGIN +
          c * spacingX +
          jitterX,

        y:
          MARGIN +
          r * spacingY +
          jitterY
      });
    }
  }

  // adjacency
  nodes.forEach(n => {
    adjList[n.id] = [];
  });

  // =========================================================
  // 2. KONEKSI HORIZONTAL
  // =========================================================

  for (let r = 0; r < ROWS; r++) {

    for (let c = 0; c < COLS - 1; c++) {

      const a = r * COLS + c;
      const b = r * COLS + c + 1;

      addLoopRoad(a, b);
    }
  }

  // =========================================================
  // 3. KONEKSI VERTICAL
  // =========================================================

  for (let c = 0; c < COLS; c++) {

    for (let r = 0; r < ROWS - 1; r++) {

      const a = r * COLS + c;
      const b = (r + 1) * COLS + c;

      addLoopRoad(a, b);
    }
  }

  // =========================================================
  // 4. TAMBAHAN LOOP ORGANIK
  // =========================================================

  for (let r = 0; r < ROWS - 1; r++) {

    for (let c = 0; c < COLS - 1; c++) {

      if (Math.random() < 0.45) {

        const a = r * COLS + c;
        const b = (r + 1) * COLS + (c + 1);

        addLoopRoad(a, b);
      }
    }
  }

  // =========================================================
  // 5. TAMBAHAN RANDOM ROAD
  // =========================================================

  for (let i = 0; i < 10; i++) {

    const a =
      Math.floor(Math.random() * nodes.length);

    const b =
      Math.floor(Math.random() * nodes.length);

    if (a === b) continue;

    if (isDirectlyConnected(a, b)) continue;

    if (getNodeDegree(a) >= 4) continue;
    if (getNodeDegree(b) >= 4) continue;

    const d = dist(nodes[a], nodes[b]);

    if (d < 320) {
      addLoopRoad(a, b);
    }
  }

  // =========================================================
  // 6. STATISTIK
  // =========================================================

  const types =
    edges.map(e => e.type);

  const nStraight =
    types.filter(
      t => t === 'straight'
    ).length;

  const pct =
    Math.round(
      (nStraight / edges.length) * 100
    );

  infoRoadSegs.textContent =
    `${edges.length} (${pct}% lurus)`;

  // =========================================================
  // 7. RENDER
  // =========================================================

  drawBackground();
  drawRoadsSVG();
  drawForeground();

  mapReady = true;

  hint.classList.add('hidden');

  setStatus(
    'Map Ready',
    'status-ready'
  );

  updateUI();
}


// ============================================================
//  ROAD KHUSUS MODEL ORGANIK LOOP
// ============================================================

function addLoopRoad(aId, bId) {

  const na = nodes[aId];
  const nb = nodes[bId];

  if (isDirectlyConnected(aId, bId)) return;

  if (getNodeDegree(aId) >= 4) return;
  if (getNodeDegree(bId) >= 4) return;

  const dx = nb.x - na.x;
  const dy = nb.y - na.y;

  const len =
    Math.sqrt(dx * dx + dy * dy);

  const mx = (na.x + nb.x) / 2;
  const my = (na.y + nb.y) / 2;

  // vektor tegak lurus
  const nx = -dy / len;
  const ny = dx / len;

  // kelengkungan natural
  const bend =
    (Math.random() * 0.25 + 0.08) *
    len *
    (Math.random() < 0.5 ? 1 : -1);

  const cp1 = {

    x:
      na.x +
      dx * 0.25 +
      nx * bend,

    y:
      na.y +
      dy * 0.25 +
      ny * bend
  };

  const cp2 = {

    x:
      na.x +
      dx * 0.75 +
      nx * bend,

    y:
      na.y +
      dy * 0.75 +
      ny * bend
  };

  const pts =
    sampleCurve(
      na,
      nb,
      cp1,
      cp2,
      'curve'
    );

  let length = 0;

  for (let i = 1; i < pts.length; i++) {

    length += dist(
      pts[i - 1],
      pts[i]
    );
  }

  const edgeId = edges.length;

  const edge = {

    id: edgeId,

    a: aId,
    b: bId,

    cp1,
    cp2,

    pts,
    length,

    type: 'curve'
  };

  edges.push(edge);

  adjList[aId].push({

    nodeId: bId,
    edgeId,
    reversed: false
  });

  adjList[bId].push({

    nodeId: aId,
    edgeId,
    reversed: true
  });
}
// -------- Helper: tambah edge antara node a dan b --------
function addEdge(aId, bId) {

  const na = nodes[aId], nb = nodes[bId];

  // Tentukan tipe jalan berdasarkan sudut
  const dx = nb.x - na.x;
  const dy = nb.y - na.y;
  const angle = Math.abs(Math.atan2(dy, dx) * 180 / Math.PI);
  // angle ~0 atau ~180 = horizontal, ~90 = vertikal → straight
  // angle ~45 atau ~135 → diagonal
  const isHV = (angle < 18 || angle > 162 || (angle > 72 && angle < 108));

  let type;
  const r = Math.random();
  if (isHV && r < 0.15) {
    // Hanya 15% dari jalan H/V yang benar-benar lurus
    type = 'straight';
  } else if (!isHV && r < 0.35) {
    // Jalan diagonal (tidak diberi lengkung, sudut alami)
    type = 'diagonal';
  } else {
    // Mayoritas: lengkung Bezier
    type = 'curve';
  }

  // Buat titik kontrol kurva Bezier (untuk tipe 'curve')
  let cp1 = null, cp2 = null;
  if (type === 'curve') {
    // Kontrol acak: geser tegak lurus dari midpoint
    const mx = (na.x + nb.x) / 2;
    const my = (na.y + nb.y) / 2;
    const len = dist(na, nb);
    // Vektor tegak lurus
    const nx_ = -dy / len, ny_ = dx / len;
    const bend = (Math.random() * 0.35 + 0.1) * len * (Math.random() < 0.5 ? 1 : -1);
    // Dua kontrol point terpisah agar lebih organik
    const split = 0.3 + Math.random() * 0.4;
    cp1 = {
      x: na.x + (mx - na.x) * split * 2 + nx_ * bend * 0.6,
      y: na.y + (my - na.y) * split * 2 + ny_ * bend * 0.6
    };
    cp2 = {
      x: nb.x - (nb.x - mx) * (1 - split) * 2 + nx_ * bend * 0.9,
      y: nb.y - (nb.y - my) * (1 - split) * 2 + ny_ * bend * 0.9
    };
  }

  // Sample titik sepanjang kurva untuk animasi & panjang
  const pts = sampleCurve(na, nb, cp1, cp2, type);
  let length = 0;
  for (let i = 1; i < pts.length; i++) length += dist(pts[i-1], pts[i]);

  const edgeId = edges.length;

const edge = {
  id: edgeId,
  a: aId,
  b: bId,
  cp1,
  cp2,
  pts,
  length,
  type
};

edges.push(edge);

adjList[aId].push({ nodeId: bId, edgeId, reversed: false });
adjList[bId].push({ nodeId: aId, edgeId, reversed: true });
}
// -------- Helper: cek apakah dua node sudah langsung terhubung --------
function getNodeDegree(nodeId) {
  return adjList[nodeId] ? adjList[nodeId].length : 0;
}

function isDirectlyConnected(a, b) {
  return adjList[a] && adjList[a].some(e => e.nodeId === b);
}

// -------- Sample titik sepanjang kurva --------
//  Menghasilkan array {x,y} dengan jarak antar titik ~5px
function sampleCurve(na, nb, cp1, cp2, type) {
  const pts = [];
  const STEPS = 60;
  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS;
    let x, y;
    if (type === 'curve' && cp1 && cp2) {
      // Bezier kubik
      const mt = 1 - t;
      x = mt*mt*mt*na.x + 3*mt*mt*t*cp1.x + 3*mt*t*t*cp2.x + t*t*t*nb.x;
      y = mt*mt*mt*na.y + 3*mt*mt*t*cp1.y + 3*mt*t*t*cp2.y + t*t*t*nb.y;
    } else {
      // Linear (straight / diagonal)
      x = na.x + t * (nb.x - na.x);
      y = na.y + t * (nb.y - na.y);
    }
    pts.push({ x, y });
  }
  return pts;
}

// -------- Euclidean distance --------
function dist(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  return Math.sqrt(dx*dx + dy*dy);
}

// ============================================================
//  BAGIAN 6: RENDER LAYER BG — Latar (terrain + gedung + taman)
//
//  Latar digambar dengan Canvas 2D biasa. Karena hanya berisi
//  blok warna / texture statis tanpa garis tipis, pixelation
//  pada zoom tinggi tidak terlihat mengganggu.
// ============================================================

// ============================================================
//  OCCUPANCY GRID — pixel-accurate collision vs actual Bezier curves
// ============================================================
const GRID_RES = 4;
let occ = null;
let OCC_COLS = 0, OCC_ROWS = 0;

function buildOccupancyGrid() {
  OCC_COLS = Math.ceil(MAP_W / GRID_RES) + 2;
  OCC_ROWS = Math.ceil(MAP_H / GRID_RES) + 2;
  occ = new Uint8Array(OCC_COLS * OCC_ROWS);

  // Mark tepi peta sebagai terpakai supaya gedung tidak bisa keluar
  for (let gx = 0; gx < OCC_COLS; gx++) {
    for (let gy = 0; gy < OCC_ROWS; gy++) {
      const px = gx * GRID_RES, py = gy * GRID_RES;
      if (px < 8 || py < 8 || px > MAP_W - 8 || py > MAP_H - 8)
        occ[gy * OCC_COLS + gx] = 1;
    }
  }

  // Buffer jalan: setengah lebar + shadow luar SVG + margin kecil
  const bufPx = ROAD_W / 2 + 6 + 6;  // 9+6+6 = 21px
  const R = Math.ceil(bufPx / GRID_RES);

  for (const e of edges) {
    for (const pt of e.pts) {
      const cx = Math.round(pt.x / GRID_RES);
      const cy = Math.round(pt.y / GRID_RES);
      for (let dy2 = -R; dy2 <= R; dy2++) {
        for (let dx2 = -R; dx2 <= R; dx2++) {
          if (dx2*dx2 + dy2*dy2 > (R+0.5)*(R+0.5)) continue;
          const gx = cx + dx2, gy = cy + dy2;
          if (gx >= 0 && gx < OCC_COLS && gy >= 0 && gy < OCC_ROWS)
            occ[gy * OCC_COLS + gx] = 1;
        }
      }
    }
  }
}

// true = seluruh rect bebas (jalan + tepi peta)
function rectFree(rx, ry, rw, rh) {
  if (!occ) return false;
  // Tolak rect yang menyentuh atau melewati tepi peta
  if (rx < 8 || ry < 8 || rx + rw > MAP_W - 8 || ry + rh > MAP_H - 8) return false;
  const x0 = Math.floor(rx / GRID_RES);
  const y0 = Math.floor(ry / GRID_RES);
  const x1 = Math.ceil((rx + rw) / GRID_RES);
  const y1 = Math.ceil((ry + rh) / GRID_RES);
  for (let gy = y0; gy <= y1; gy++) {
    if (gy < 0 || gy >= OCC_ROWS) return false;
    for (let gx = x0; gx <= x1; gx++) {
      if (gx < 0 || gx >= OCC_COLS) return false;
      if (occ[gy * OCC_COLS + gx]) return false;
    }
  }
  return true;
}

// Tandai rect sebagai terpakai setelah objek ditempatkan
function markRect(rx, ry, rw, rh, pad) {
  pad = pad || 3;
  const x0 = Math.floor((rx - pad) / GRID_RES);
  const y0 = Math.floor((ry - pad) / GRID_RES);
  const x1 = Math.ceil((rx + rw + pad) / GRID_RES);
  const y1 = Math.ceil((ry + rh + pad) / GRID_RES);
  for (let gy = y0; gy <= y1; gy++) {
    if (gy < 0 || gy >= OCC_ROWS) continue;
    for (let gx = x0; gx <= x1; gx++) {
      if (gx < 0 || gx >= OCC_COLS) continue;
      occ[gy * OCC_COLS + gx] = 1;
    }
  }
}

// ============================================================
//  GAMBAR SATU GEDUNG DENGAN DETAIL PIXEL PENUH
//  (versi pertama + detail tambahan: AC, tangki air, antena)
// ============================================================
function drawBuilding(ctx, bx, by, bw, bh, rng2) {
  if (bw < 10 || bh < 10) return;

  const hue = 220 + rng2() * 60;

  // Bayangan tipis (efek 3D)
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fillRect(bx + 2, by + 2, bw, bh);

  // Tembok utama
  ctx.fillStyle = `hsl(${hue},25%,22%)`;
  ctx.fillRect(bx, by, bw, bh);

  // Atap (sedikit lebih terang, inset)
  ctx.fillStyle = `hsl(${hue},30%,30%)`;
  const rm = Math.min(4, Math.floor(bw * 0.12), Math.floor(bh * 0.12));
  ctx.fillRect(bx+rm, by+rm, bw-rm*2, bh-rm*2);

  // Garis tepi atap
  ctx.fillStyle = `hsl(${hue},20%,35%)`;
  ctx.fillRect(bx+rm, by+rm, bw-rm*2, 1);
  ctx.fillRect(bx+rm, by+rm, 1, bh-rm*2);

  // Jendela — grid merata, ukuran proporsional bangunan
  if (bw >= 16 && bh >= 16) {
    const wSize = Math.max(3, Math.min(5, Math.floor(bw / 6)));
    const wGap  = wSize + 5;
    const startX = bx + rm + 3;
    const startY = by + rm + 3;
    const endX   = bx + bw - rm - wSize - 1;
    const endY   = by + bh - rm - wSize - 1;

    for (let wy = startY; wy <= endY; wy += wGap) {
      for (let wx = startX; wx <= endX; wx += wGap) {
        if (rng2() > 0.35) {
          // Cahaya nyala (kuning terang)
          ctx.fillStyle = rng2() > 0.3
            ? `rgba(180,220,255,0.7)`   // cahaya putih-biru
            : `rgba(255,230,120,0.6)`;  // cahaya kuning (lampu menyala)
          ctx.fillRect(wx, wy, wSize, wSize);
          // Bingkai jendela
          ctx.fillStyle = `hsl(${hue},15%,40%)`;
          ctx.fillRect(wx - 1, wy - 1, 1, wSize + 2);
          ctx.fillRect(wx - 1, wy - 1, wSize + 2, 1);
        } else {
          // Jendela gelap (tidak menyala)
          ctx.fillStyle = `rgba(10,15,25,0.8)`;
          ctx.fillRect(wx, wy, wSize, wSize);
        }
      }
    }
  }

  // Detail atap — hanya jika cukup besar
  if (bw >= 28 && bh >= 28) {
    const detailR = rng2();

    if (detailR < 0.4) {
      // Tangki air (kotak kecil di atas)
      const tw = Math.max(4, Math.floor(bw * 0.18));
      const th = Math.max(3, Math.floor(bh * 0.12));
      const tx2 = bx + rm + Math.floor(rng2() * (bw - rm*2 - tw - 2));
      const ty2 = by + rm + 1;
      ctx.fillStyle = `hsl(${hue},15%,38%)`;
      ctx.fillRect(tx2, ty2, tw, th);
      ctx.fillStyle = `hsl(${hue},10%,45%)`;
      ctx.fillRect(tx2+1, ty2, tw-2, 2);
    } else if (detailR < 0.7) {
      // Antena / menara kecil
      const ax = bx + bw/2 + (rng2()-0.5) * bw * 0.3;
      const ay = by + rm + 1;
      ctx.fillStyle = `hsl(${hue},10%,50%)`;
      ctx.fillRect(Math.floor(ax) - 1, Math.floor(ay), 2, Math.max(3, Math.floor(bh*0.1)));
      // Lingkaran kecil di ujung antena
      ctx.beginPath();
      ctx.arc(ax, ay, 2, 0, Math.PI*2);
      ctx.fillStyle = `rgba(255,80,80,0.8)`;
      ctx.fill();
    } else {
      // Panel AC (kotak horizontal kecil)
      const aw = Math.max(6, Math.floor(bw * 0.25));
      const ah = Math.max(3, Math.floor(bh * 0.08));
      const acx = bx + bw - rm - aw - 1;
      const acy = by + bh - rm - ah - 2;
      ctx.fillStyle = `hsl(200,30%,35%)`;
      ctx.fillRect(acx, acy, aw, ah);
      ctx.fillStyle = `hsl(200,20%,45%)`;
      for (let li = 0; li < aw; li += 3) ctx.fillRect(acx + li, acy, 1, ah);
    }
  }

  // Outline gedung
  ctx.strokeStyle = `hsl(${hue},20%,40%)`;
  ctx.lineWidth = 1;
  ctx.strokeRect(bx, by, bw, bh);

  // Pintu masuk (di gedung yang cukup besar, di bagian bawah)
  if (bw >= 20 && bh >= 24) {
    const doorW = Math.min(7, Math.floor(bw * 0.2));
    const doorH = Math.min(8, Math.floor(bh * 0.18));
    const doorX = bx + Math.floor((bw - doorW) / 2);
    const doorY = by + bh - doorH;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(doorX, doorY, doorW, doorH);
    // Bingkai pintu
    ctx.fillStyle = `hsl(${hue},15%,42%)`;
    ctx.fillRect(doorX - 1, doorY - 1, 1, doorH + 1);
    ctx.fillRect(doorX + doorW, doorY - 1, 1, doorH + 1);
    ctx.fillRect(doorX - 1, doorY - 1, doorW + 2, 1);
  }
}

function drawBackground() {
  const ctx = bgCtx;
  ctx.clearRect(0, 0, MAP_W, MAP_H);

  // ── Base: tanah / lapangan ───────────────────────────────────
  ctx.fillStyle = '#1a2e1a';
  ctx.fillRect(0, 0, MAP_W, MAP_H);

  // Grid checkerboard rumput halus
  const gs = 50;
  for (let gy = 0; gy < MAP_H; gy += gs) {
    for (let gx = 0; gx < MAP_W; gx += gs) {
      const even = ((gx / gs + gy / gs) % 2 === 0);
      ctx.fillStyle = even ? '#1e3520' : '#1a3018';
      ctx.fillRect(gx, gy, gs, gs);
    }
  }

  if (nodes.length < 2) return;

  // ── 1. Bangun occupancy grid (jalan + border peta) ───────────
  buildOccupancyGrid();

  // ── 2. Blok taman hijau ──────────────────────────────────────
  const rng = seededRand(42);
  for (let i = 0; i < 22; i++) {
    const pw = 60 + rng() * 80;
    const ph = 50 + rng() * 70;
    const px = rng() * (MAP_W - pw - 100) + 50;
    const py = rng() * (MAP_H - ph - 100) + 50;
    const angle = rng() * Math.PI;
    if (!rectFree(px, py, pw, ph)) { rng(); continue; }
    markRect(px, py, pw, ph, 4);
    ctx.fillStyle = `rgba(56,161,105,${0.18 + rng() * 0.12})`;
    ctx.beginPath();
    ctx.ellipse(px + pw/2, py + ph/2, pw/2, ph/2, angle, 0, Math.PI*2);
    ctx.fill();
  }

  // ── 3. GEDUNG — scan sistematis seluruh peta ─────────────────
  //  Scan tiap STEP px. Di tiap slot kosong, coba tumbuhkan gedung.
  //  Ukuran gedung bervariasi (1–4 slot) agar terasa organik.
  const rng2 = seededRand(99);
  const STEP = 22;

  for (let sy = MARGIN / 2; sy < MAP_H - MARGIN / 2; sy += STEP) {
    for (let sx = MARGIN / 2; sx < MAP_W - MARGIN / 2; sx += STEP) {

      // Lewati slot terpakai
      if (!rectFree(sx, sy, STEP - 2, STEP - 2)) { rng2(); rng2(); continue; }

      // Ukuran gedung: 1–4 slot horizontal, 1–4 slot vertikal
      const maxC = Math.floor(rng2() * 4) + 1;
      const maxR2 = Math.floor(rng2() * 4) + 1;

      // Tumbuhkan sebesar mungkin tapi tetap bebas
      let bestW = 0, bestH = 0;
      for (let tc = 1; tc <= maxC; tc++) {
        const tw = tc * STEP - 4;
        const th = maxR2 * STEP - 4;
        if (sx + 2 + tw > MAP_W - 8) break;
        if (sy + 2 + th > MAP_H - 8) break;
        if (rectFree(sx + 2, sy + 2, tw, th)) { bestW = tw; bestH = th; }
        else break;
      }

      if (bestW < 10 || bestH < 10) continue;

      const bx = sx + 2, by = sy + 2;
      markRect(bx, by, bestW, bestH, 3);
      drawBuilding(ctx, bx, by, bestW, bestH, rng2);
    }
  }

  // ── 4. POHON — jauh lebih banyak, di semua area kosong ───────
  //  Pohon diletakkan dengan 3 cara:
  //  a) Di pinggir jalan (mengikuti arah jalan)
  //  b) Di area terbuka yang masih kosong (random scan)
  //  c) Pohon kecil acak di mana saja

  const rng3 = seededRand(77);

  // (a) Pohon di pinggir jalan — rapat
  for (const e of edges) {
    const step = Math.max(1, Math.floor(e.pts.length / 12));
    for (let i = step; i < e.pts.length - step; i += step) {
      for (let side = -1; side <= 1; side += 2) {  // kedua sisi jalan
        if (rng3() > 0.65) continue;
        const pt   = e.pts[i];
        const prev = e.pts[Math.max(0, i - 1)];
        const dx   = pt.x - prev.x;
        const dy   = pt.y - prev.y;
        const len  = Math.sqrt(dx*dx + dy*dy) || 1;
        const nx2  = -dy / len;
        const ny2  =  dx / len;
        const off  = ROAD_W / 2 + 7 + rng3() * 4;
        const tx   = pt.x + nx2 * off * side;
        const ty   = pt.y + ny2 * off * side;
        if (tx < 8 || ty < 8 || tx > MAP_W-8 || ty > MAP_H-8) continue;
        const nearNode = nodes.some(n => dist({x:tx,y:ty}, n) < ROAD_W + 10);
        if (nearNode) continue;
        const ts = 4 + rng3() * 4;
        if (!rectFree(tx-ts, ty-ts, ts*2, ts*2)) continue;
        markRect(tx-ts, ty-ts, ts*2, ts*2, 1);
        drawTree(ctx, tx, ty, ts);
      }
    }
  }

  // (b) Pohon di area kosong — scan lebih padat
  for (let sy2 = 15; sy2 < MAP_H - 15; sy2 += 28) {
    for (let sx2 = 15; sx2 < MAP_W - 15; sx2 += 28) {
      if (rng3() > 0.55) { rng3(); continue; }
      const ts = 5 + rng3() * 5;
      const tx = sx2 + rng3() * 14 - 7;
      const ty = sy2 + rng3() * 14 - 7;
      if (tx < 8 || ty < 8 || tx > MAP_W-8 || ty > MAP_H-8) continue;
      if (!rectFree(tx-ts, ty-ts, ts*2, ts*2)) continue;
      markRect(tx-ts, ty-ts, ts*2, ts*2, 1);
      drawTree(ctx, tx, ty, ts);
    }
  }
}

// -------- Gambar pohon pixel-style --------
function drawTree(ctx, px, py, size) {
  const s = size;
  ctx.fillStyle = '#5a3a1a';
  ctx.fillRect(px - s*0.3, py + s*0.4, s*0.6, s*0.9);
  ctx.fillStyle = '#1a4a1a';
  ctx.fillRect(px - s, py + s*0.1, s*2, s*0.8);
  ctx.fillStyle = '#2d7a2d';
  ctx.fillRect(px - s*0.8, py - s*0.3, s*1.6, s*0.8);
  ctx.fillStyle = '#3fa03f';
  ctx.fillRect(px - s*0.5, py - s*0.9, s, s*0.8);
}

// -------- isTooCloseToRoads (dipertahankan) --------
function isTooCloseToRoads(px, py, minDist) {
  for (const e of edges) {
    const step = Math.max(1, Math.floor(e.pts.length / 8));
    for (let i = 0; i < e.pts.length; i += step) {
      if (dist({x:px,y:py}, e.pts[i]) < minDist) return true;
    }
  }
  return false;
}

// ============================================================
//  BAGIAN 7: RENDER LAYER SVG ROADS — Jalan Vektor
//
//  SVG digunakan agar jalan SELALU TAJAM pada semua level zoom.
//  Setiap edge digambar sebagai <path> dengan:
//   - Bayangan aspal (lebar lebih besar, warna gelap)
//   - Aspal utama
//   - Garis tengah putus-putus
// ============================================================

function drawRoadsSVG() {
  // Hapus semua child lama
  while (roadSVG.firstChild) roadSVG.removeChild(roadSVG.firstChild);

  // Buat group layer
  const gShadow = svgEl('g'); // Bayangan/tepi jalan
  const gAspal  = svgEl('g'); // Aspal utama
  const gLines  = svgEl('g'); // Garis tengah
  const gNodes  = svgEl('g'); // Titik persimpangan
  roadSVG.appendChild(gShadow);
  roadSVG.appendChild(gAspal);
  roadSVG.appendChild(gLines);
  roadSVG.appendChild(gNodes);

  for (const e of edges) {
    const d = edgeToSVGPath(e);

    // Bayangan (lebih lebar)
    const shadow = svgEl('path');
    shadow.setAttribute('d', d);
    shadow.setAttribute('fill', 'none');
    shadow.setAttribute('stroke', '#0a0c10');
    shadow.setAttribute('stroke-width', ROAD_W + 8);
    shadow.setAttribute('stroke-linecap', 'round');
    shadow.setAttribute('stroke-linejoin', 'round');
    gShadow.appendChild(shadow);

    // Aspal utama
    const road = svgEl('path');
    road.setAttribute('d', d);
    road.setAttribute('fill', 'none');
    road.setAttribute('stroke', '#2d3340');
    road.setAttribute('stroke-width', ROAD_W);
    road.setAttribute('stroke-linecap', 'round');
    road.setAttribute('stroke-linejoin', 'round');
    gAspal.appendChild(road);

    // Tepi jalan (trotoar)
    const curb = svgEl('path');
    curb.setAttribute('d', d);
    curb.setAttribute('fill', 'none');
    curb.setAttribute('stroke', '#3d4455');
    curb.setAttribute('stroke-width', ROAD_W - 2);
    curb.setAttribute('stroke-linecap', 'round');
    curb.setAttribute('stroke-dasharray', '1 0');
    curb.setAttribute('opacity', '0.4');
    gAspal.appendChild(curb);

    // Garis tengah putus-putus
    const center = svgEl('path');
    center.setAttribute('d', d);
    center.setAttribute('fill', 'none');
    center.setAttribute('stroke', '#e8c840');
    center.setAttribute('stroke-width', 1.5);
    center.setAttribute('stroke-dasharray', '12 8');
    center.setAttribute('stroke-linecap', 'butt');
    center.setAttribute('opacity', '0.7');
    gLines.appendChild(center);
  }

  // Persimpangan (lingkaran kecil di tiap node)
  for (const n of nodes) {
    const c = svgEl('circle');
    c.setAttribute('cx', n.x);
    c.setAttribute('cy', n.y);
    c.setAttribute('r', ROAD_W / 2 + 1);
    c.setAttribute('fill', '#2d3340');
    c.setAttribute('stroke', '#0a0c10');
    c.setAttribute('stroke-width', 3);
    gNodes.appendChild(c);
  }
}

// -------- Konversi edge ke SVG path string --------
function edgeToSVGPath(e) {
  const na = nodes[e.a], nb = nodes[e.b];
  if (e.type === 'curve' && e.cp1 && e.cp2) {
    return `M ${na.x} ${na.y} C ${e.cp1.x} ${e.cp1.y} ${e.cp2.x} ${e.cp2.y} ${nb.x} ${nb.y}`;
  } else {
    return `M ${na.x} ${na.y} L ${nb.x} ${nb.y}`;
  }
}

// -------- Helper: buat elemen SVG --------
function svgEl(tag) {
  return document.createElementNS('http://www.w3.org/2000/svg', tag);
}

// ============================================================
//  BAGIAN 8: RENDER LAYER FG — Foreground (path, mobil, marker)
//
//  Layer ini di-redraw setiap frame animasi.
//  Juga menggambar path BFS & marker start/end.
// ============================================================

function drawForeground() {
  const ctx = fgCtx;
  ctx.clearRect(0, 0, MAP_W, MAP_H);

  // Gambar path BFS (garis cyan transparan)
  if (pathPoints.length > 1) {
    ctx.beginPath();
    ctx.moveTo(pathPoints[0].x, pathPoints[0].y);
    for (let i = 1; i < pathPoints.length; i++) {
      ctx.lineTo(pathPoints[i].x, pathPoints[i].y);
    }
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.4)';
    ctx.lineWidth = 5;
    ctx.lineCap  = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  }

  // Gambar marker start
  if (startId !== null) {
    const n = nodes[startId];
    drawMarker(ctx, n.x, n.y, '#e74c3c', 'S');
  }

  // Gambar marker end
  if (endId !== null) {
    const n = nodes[endId];
    drawMarker(ctx, n.x, n.y, '#f39c12', 'E');
  }

  // Gambar mobil
  if (posReady) {
    drawCar(ctx, carX, carY, carAngle);
  }
}

// -------- Marker berbentuk pin (S/E) --------
function drawMarker(ctx, x, y, color, label) {
  const R = 14;
  // Lingkaran
  ctx.beginPath();
  ctx.arc(x, y, R, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  // Border putih
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2.5;
  ctx.stroke();
  // Label
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 12px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x, y);
}

// -------- Gambar mobil top-view --------
//  Mobil dirender dengan ctx.save/rotate/restore agar rotasi
//  tidak mempengaruhi elemen lain. Sudut dari Math.atan2(dy,dx).
function drawCar(ctx, cx, cy, angle) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle + Math.PI / 2);

  const W = 12, H = 22;  // Lebar & panjang mobil

  // Bayangan mobil
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur  = 8;
  ctx.shadowOffsetY = 3;

  // Badan utama
  ctx.fillStyle = '#cc2222';
  roundRectPath(ctx, -W/2, -H/2, W, H, 3);
  ctx.fill();

  ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;

  // Garis tepi badan
  ctx.strokeStyle = '#880000';
  ctx.lineWidth = 1;
  roundRectPath(ctx, -W/2, -H/2, W, H, 3);
  ctx.stroke();

  // Atap
  ctx.fillStyle = '#aa1111';
  roundRectPath(ctx, -W*0.35, -H*0.28, W*0.7, H*0.42, 2);
  ctx.fill();

  // Kaca depan
  ctx.fillStyle = 'rgba(136,204,255,0.85)';
  roundRectPath(ctx, -W*0.28, -H*0.25, W*0.56, H*0.18, 2);
  ctx.fill();

  // Kaca belakang
  roundRectPath(ctx, -W*0.28, H*0.08, W*0.56, H*0.16, 2);
  ctx.fill();

  // Lampu depan
  ctx.fillStyle = '#ffffaa';
  ctx.fillRect(-W/2+2, -H/2+2, W*0.22, H*0.09);
  ctx.fillRect( W/2-W*0.22-2, -H/2+2, W*0.22, H*0.09);

  // Roda (4 buah)
  ctx.fillStyle = '#111';
  const wx = W/2 - 1, wy = H/2 - 4;
  ctx.fillRect(-wx-3, -wy,    3, 7);  // Kiri depan
  ctx.fillRect( wx,   -wy,    3, 7);  // Kanan depan
  ctx.fillRect(-wx-3,  wy-7,  3, 7);  // Kiri belakang
  ctx.fillRect( wx,    wy-7,  3, 7);  // Kanan belakang

  ctx.restore();
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x+w, y,   x+w, y+r);
  ctx.lineTo(x+w, y+h-r);
  ctx.quadraticCurveTo(x+w, y+h, x+w-r, y+h);
  ctx.lineTo(x+r, y+h);
  ctx.quadraticCurveTo(x,   y+h, x, y+h-r);
  ctx.lineTo(x, y+r);
  ctx.quadraticCurveTo(x,   y,   x+r, y);
  ctx.closePath();
}

// ============================================================
//  BAGIAN 9: RANDOM POSITION
//  Pilih start & end node secara acak, cari jalur Dijkstra
// ============================================================

function randomPosition() {
  if (!mapReady || nodes.length < 2) return;
  stopAnimation();

  let tries = 0, found = false;
  while (tries < 80 && !found) {
    const a = Math.floor(Math.random() * nodes.length);
    let b   = Math.floor(Math.random() * nodes.length);
    while (b === a) b = Math.floor(Math.random() * nodes.length);

    const result = dijkstra(a, b);
    if (result && result.edgePath.length >= 1) {
      startId    = a;
      endId      = b;
      pathEdges  = result.edgePath;    // [{edgeId, reversed}]
      pathPoints = buildPathPoints(result.edgePath);

      // Set posisi awal mobil
      carX     = nodes[startId].x;
      carY     = nodes[startId].y;
      carPtIndex = 0;
      carAngle = 0;
      animPaused  = false;
      animRunning = false;
      posReady = true;
      found = true;
    }
    tries++;
  }

  if (!found) {
    setStatus('No path found', 'status-idle');
    return;
  }

  infoPathLen.textContent = pathPoints.length + ' pts';
  updateProgressBar(0);
  infoProgress.textContent = '0%';
  setStatus('Ready', 'status-ready');
  updateUI();
  drawForeground();
}

// ============================================================
//  BAGIAN 10: DIJKSTRA PATHFINDING
//
//  Karena peta berbasis graph vektor (bukan tile grid), kita
//  pakai Dijkstra yang mempertimbangkan panjang jalan nyata.
//
//  Cara Kerja:
//  1. Inisialisasi dist[semua] = Infinity, dist[start] = 0
//  2. Masukkan start ke priority queue (min-heap biner)
//  3. Ambil node dengan dist terkecil
//  4. Eksplorasi semua tetangga via adjList
//  5. Jika dist[tetangga] bisa diperkecil, update & masukkan queue
//  6. Rekonstruksi jalur via parentMap saat end ditemukan
// ============================================================
 
// -------- Min-Heap sederhana untuk priority queue Dijkstra --------
// Jauh lebih efisien dari Array.sort() O(n log n) per iterasi.
// Heap insert/extract = O(log n).
class MinHeap {
  constructor() { this._data = []; }
 
  push(item) {
    this._data.push(item);
    this._bubbleUp(this._data.length - 1);
  }
 
  pop() {
    const top  = this._data[0];
    const last = this._data.pop();
    if (this._data.length > 0) {
      this._data[0] = last;
      this._sinkDown(0);
    }
    return top;
  }
 
  get size() { return this._data.length; }
 
  _bubbleUp(i) {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this._data[parent].d <= this._data[i].d) break;
      [this._data[parent], this._data[i]] = [this._data[i], this._data[parent]];
      i = parent;
    }
  }
 
  _sinkDown(i) {
    const n = this._data.length;
    while (true) {
      let smallest = i;
      const l = 2 * i + 1, r = 2 * i + 2;
      if (l < n && this._data[l].d < this._data[smallest].d) smallest = l;
      if (r < n && this._data[r].d < this._data[smallest].d) smallest = r;
      if (smallest === i) break;
      [this._data[smallest], this._data[i]] = [this._data[i], this._data[smallest]];
      i = smallest;
    }
  }
}
 
function dijkstra(startNodeId, endNodeId) {
  const distMap   = {};
  const parentMap = {}; // parentMap[nodeId] = { fromNodeId, edgeId, reversed }
  const visited   = new Set();
 
  nodes.forEach(n => { distMap[n.id] = Infinity; });
  distMap[startNodeId] = 0;
 
  const pq = new MinHeap();
  pq.push({ nodeId: startNodeId, d: 0 });
 
  while (pq.size > 0) {
    const { nodeId: cur } = pq.pop();
 
    if (visited.has(cur)) continue;
    visited.add(cur);
 
    if (cur === endNodeId) break;
 
    for (const { nodeId: next, edgeId, reversed } of (adjList[cur] || [])) {
      if (visited.has(next)) continue;
      const newDist = distMap[cur] + edges[edgeId].length;
      if (newDist < distMap[next]) {
        distMap[next]  = newDist;
        parentMap[next] = { fromNodeId: cur, edgeId, reversed };
        pq.push({ nodeId: next, d: newDist });
      }
    }
  }
 
  if (distMap[endNodeId] === Infinity) return null;
 
  // Rekonstruksi jalur edge dari end → start, lalu balik
  const edgePath = [];
  let cur = endNodeId;
  while (cur !== startNodeId) {
    const p = parentMap[cur];
    if (!p) return null;
    edgePath.push({ edgeId: p.edgeId, reversed: p.reversed });
    cur = p.fromNodeId;
  }
  edgePath.reverse();
  return { edgePath, totalDist: distMap[endNodeId] };
}
 
// -------- Bangun array titik halus + tabel jarak kumulatif --------
//
// Mengembalikan array pts (sama seperti versi lama) agar semua
// pemanggil di bagian 9 tidak perlu diubah.
//
// Sebagai efek samping, mengisi variabel global `pathCumDist`:
//   pathCumDist[i] = total jarak dari pts[0] ke pts[i] (piksel)
// Dipakai animLoop untuk menghitung progress bar yang akurat
// berdasarkan jarak tempuh nyata, bukan sekadar indeks titik.
function buildPathPoints(edgePath) {
  const pts = [];
  pathCumDist = [0]; // reset & isi ulang variabel global
 
  for (const { edgeId, reversed } of edgePath) {
    const e      = edges[edgeId];
    const segPts = reversed ? [...e.pts].reverse() : e.pts;
 
    // Hindari duplikat titik di persimpangan
    const startIdx = pts.length > 0 ? 1 : 0;
    for (let i = startIdx; i < segPts.length; i++) {
      if (pts.length > 0) {
        const prev = pts[pts.length - 1];
        const dx   = segPts[i].x - prev.x;
        const dy   = segPts[i].y - prev.y;
        pathCumDist.push(pathCumDist[pathCumDist.length - 1] + Math.sqrt(dx*dx + dy*dy));
      }
      pts.push(segPts[i]);
    }
  }
 
  return pts; // tetap array biasa agar bagian 9 tidak perlu diubah
}
 
// ============================================================
//  BAGIAN 11: ANIMASI MOBIL
//
//  Animasi berbasis titik-titik halus (pathPoints) bukan tile.
//  Mobil meluncur dari satu titik ke titik berikutnya dengan
//  interpolasi berbasis delta time, sehingga kecepatan konstan
//  tanpa tergantung frame rate.
//
//  Sudut rotasi dihitung dari Math.atan2(dy, dx) — mobil selalu
//  menghadap arah jalur (tidak drift).
//
//  Progress bar berbasis jarak kumulatif (cumDist) sehingga
//  akurat dan tidak loncat-loncat.
// ============================================================
 
function startAnimation() {
  if (!posReady || pathPoints.length < 2) return;
 
  if (animPaused) {
    animPaused  = false;
    animRunning = true;
    lastTime    = performance.now();
    animFrame   = requestAnimationFrame(animLoop);
  } else {
    carPtIndex  = 0;
    carX        = pathPoints[0].x;
    carY        = pathPoints[0].y;
    // Arahkan mobil ke titik berikutnya sejak awal agar tidak
    // muncul dengan orientasi default (hadap kanan) lalu berputar.
    if (pathPoints.length >= 2) {
      const dx = pathPoints[1].x - pathPoints[0].x;
      const dy = pathPoints[1].y - pathPoints[0].y;
      carAngle  = Math.atan2(dy, dx);
    }
    animRunning = true;
    animPaused  = false;
    lastTime    = performance.now();
    animFrame   = requestAnimationFrame(animLoop);
  }
  updateUI();
}
 
function pauseAnimation() {
  animRunning = false;
  animPaused  = true;
  if (animFrame) cancelAnimationFrame(animFrame);
  animFrame = null;
  setStatus('Paused', 'status-paused');
  updateUI();
}
 
function stopAnimation() {
  animRunning = false;
  animPaused  = false;
  if (animFrame) cancelAnimationFrame(animFrame);
  animFrame = null;
}
 
function animLoop(timestamp) {
  if (!animRunning) return;
 
  // Cap dt: maks 50ms agar tidak lompat setelah tab di-background
  const dt = Math.min((timestamp - lastTime) / 1000, 0.05);
  lastTime  = timestamp;
 
  // Sudah sampai akhir path
  if (carPtIndex >= pathPoints.length - 1) {
    carX        = pathPoints[pathPoints.length - 1].x;
    carY        = pathPoints[pathPoints.length - 1].y;
    animRunning = false;
    setStatus('Arrived!', 'status-done');
    _updateProgress(100);
    drawForeground();
    updateUI();
    return;
  }
 
  // Gerakkan mobil: konsumsi "jarak" sebesar CAR_SPEED * dt
  let remaining = CAR_SPEED * dt;
 
  while (remaining > 0 && carPtIndex < pathPoints.length - 1) {
    const target = pathPoints[carPtIndex + 1];
    const dx     = target.x - carX;
    const dy     = target.y - carY;
    const d      = Math.sqrt(dx*dx + dy*dy);
 
    if (d < 0.001) { carPtIndex++; continue; }
 
    // Update sudut (arah hadap mobil)
    carAngle = Math.atan2(dy, dx);
 
    if (remaining >= d) {
      carX = target.x;
      carY = target.y;
      carPtIndex++;
      remaining -= d;
    } else {
      carX += (dx / d) * remaining;
      carY += (dy / d) * remaining;
      remaining = 0;
    }
  }
 
  // Progress berbasis jarak kumulatif — akurat meski titik tidak equidistant
  const totalDist = pathCumDist[pathCumDist.length - 1];
  const traveled  = pathCumDist[Math.min(carPtIndex, pathCumDist.length - 1)];
  const pct       = totalDist > 0 ? Math.round((traveled / totalDist) * 100) : 0;
  _updateProgress(pct);
 
  drawForeground();
  animFrame = requestAnimationFrame(animLoop);
}
 
// Helper internal agar tidak duplikasi kode update progress
function _updateProgress(pct) {
  infoProgress.textContent = pct + '%';
  updateProgressBar(pct);
}
 
// ============================================================
//  BAGIAN 12: UI UPDATE
// ============================================================
 
function updateUI() {
  if (!posReady) {
    btnStart.disabled        = true;
    btnLabel.textContent     = 'Start';
    iconPlay.style.display   = 'block';
    iconPause.style.display  = 'none';
    btnStart.classList.remove('paused');
  } else if (animRunning) {
    btnStart.disabled        = false;
    btnLabel.textContent     = 'Pause';
    iconPlay.style.display   = 'none';
    iconPause.style.display  = 'block';
    btnStart.classList.add('paused');
  } else {
    btnStart.disabled        = false;
    btnLabel.textContent     = animPaused ? 'Resume' : 'Start';
    iconPlay.style.display   = 'block';
    iconPause.style.display  = 'none';
    btnStart.classList.remove('paused');
  }
}
 
function setStatus(text, cls) {
  infoStatus.textContent = text;
  infoStatus.className   = 'info-value ' + cls;
}
 
function updateProgressBar(pct) {
  progressBar.style.width = pct + '%';
}
 
// ============================================================
//  BAGIAN 13: ZOOM & PAN
//
//  Zoom dilakukan dengan mengubah CSS transform pada semua
//  tiga layer secara bersamaan. Pivot dihitung agar posisi
//  di bawah kursor/tengah layar tidak bergeser.
// ============================================================
 
function zoomAt(pivotX, pivotY, delta) {
  const newScale = Math.min(SCALE_MAX, Math.max(SCALE_MIN, camScale + delta));
  if (newScale === camScale) return;
  const factor = newScale / camScale;
  camOffX  = pivotX - factor * (pivotX - camOffX);
  camOffY  = pivotY - factor * (pivotY - camOffY);
  camScale = newScale;
  applyTransform();
}
 
// ============================================================
//  BAGIAN 14: EVENT LISTENERS
// ============================================================
 
document.getElementById('btnRandomMap').addEventListener('click', () => {
  generateMap();
});
 
document.getElementById('btnRandomPos').addEventListener('click', () => {
  if (!mapReady) { alert('Generate map dulu!'); return; }
  randomPosition();
});
 
btnStart.addEventListener('click', () => {
  if (animRunning) {
    pauseAnimation();
  } else {
    startAnimation();
    // Hanya set status 'Running' jika animasi benar-benar bisa dimulai
    if (animRunning) setStatus('Running', 'status-running');
  }
});
 
document.getElementById('btnReset').addEventListener('click', () => {
  stopAnimation();
  if (posReady && pathPoints.length > 0) {
    carPtIndex = 0;
    carX       = pathPoints[0].x;
    carY       = pathPoints[0].y;
    // Orientasi awal menghadap titik pertama — sama seperti saat start
    if (pathPoints.length >= 2) {
      const dx = pathPoints[1].x - pathPoints[0].x;
      const dy = pathPoints[1].y - pathPoints[0].y;
      carAngle = Math.atan2(dy, dx);
    } else {
      carAngle = 0;
    }
    animPaused = false;
    _updateProgress(0);
    setStatus('Ready', 'status-ready');
    updateUI();
    drawForeground();
  }
});
 
document.getElementById('btnZoomIn').addEventListener('click', () => {
  zoomAt(wrapper.clientWidth / 2, wrapper.clientHeight / 2,  SCALE_STEP);
});
 
document.getElementById('btnZoomOut').addEventListener('click', () => {
  zoomAt(wrapper.clientWidth / 2, wrapper.clientHeight / 2, -SCALE_STEP);
});
 
// Scroll wheel zoom
wrapper.addEventListener('wheel', (e) => {
  e.preventDefault();
  const delta = e.deltaY < 0 ? SCALE_STEP : -SCALE_STEP;
  const rect  = wrapper.getBoundingClientRect();
  zoomAt(e.clientX - rect.left, e.clientY - rect.top, delta);
}, { passive: false });
 
// Mouse drag (pan)
wrapper.addEventListener('mousedown', (e) => {
  isDragging  = true;
  dragStartX  = e.clientX;
  dragStartY  = e.clientY;
  camOffXSnap = camOffX;
  camOffYSnap = camOffY;
});
window.addEventListener('mousemove', (e) => {
  if (!isDragging) return;
  camOffX = camOffXSnap + (e.clientX - dragStartX);
  camOffY = camOffYSnap + (e.clientY - dragStartY);
  applyTransform();
});
window.addEventListener('mouseup', () => { isDragging = false; });
 
// Touch — pan (1 jari) + pinch-to-zoom (2 jari)
let _touchPinchDist = 0; // jarak antar jari saat pinch mulai
 
wrapper.addEventListener('touchstart', (e) => {
  if (e.touches.length === 1) {
    isDragging  = true;
    dragStartX  = e.touches[0].clientX;
    dragStartY  = e.touches[0].clientY;
    camOffXSnap = camOffX;
    camOffYSnap = camOffY;
  } else if (e.touches.length === 2) {
    // Mulai pinch: simpan jarak awal & matikan drag
    isDragging      = false;
    const dx        = e.touches[1].clientX - e.touches[0].clientX;
    const dy        = e.touches[1].clientY - e.touches[0].clientY;
    _touchPinchDist = Math.sqrt(dx*dx + dy*dy);
  }
}, { passive: true });
 
wrapper.addEventListener('touchmove', (e) => {
  if (e.touches.length === 1 && isDragging) {
    camOffX = camOffXSnap + (e.touches[0].clientX - dragStartX);
    camOffY = camOffYSnap + (e.touches[0].clientY - dragStartY);
    applyTransform();
  } else if (e.touches.length === 2 && _touchPinchDist > 0) {
    const dx      = e.touches[1].clientX - e.touches[0].clientX;
    const dy      = e.touches[1].clientY - e.touches[0].clientY;
    const newDist = Math.sqrt(dx*dx + dy*dy);
    const ratio   = newDist / _touchPinchDist;
    _touchPinchDist = newDist;
 
    // Pivot di tengah-tengah dua jari
    const rect   = wrapper.getBoundingClientRect();
    const pivotX = ((e.touches[0].clientX + e.touches[1].clientX) / 2) - rect.left;
    const pivotY = ((e.touches[0].clientY + e.touches[1].clientY) / 2) - rect.top;
    const delta  = (ratio - 1) * camScale;
    zoomAt(pivotX, pivotY, delta);
  }
}, { passive: true });
 
wrapper.addEventListener('touchend', (e) => {
  if (e.touches.length < 2) _touchPinchDist = 0;
  if (e.touches.length === 0) isDragging = false;
});
 
// Resize: perbarui batas skala, TANPA memaksa re-center
// (kamera tetap di posisi terakhir pengguna)
window.addEventListener('resize', () => {
  updateMinScale();
});
 
// ============================================================
//  BAGIAN 15: UTILITY — Seeded Random Number Generator
//
//  Digunakan agar background (gedung, pohon) konsisten
//  setiap render tanpa perlu disimpan.
// ============================================================
 
function seededRand(seed) {
  let s = seed;
  return function() {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}
 
// ============================================================
//  BAGIAN 16: INISIALISASI AWAL
// ============================================================
 
window.addEventListener('load', () => {
  initLayers();
  hint.classList.remove('hidden');
});