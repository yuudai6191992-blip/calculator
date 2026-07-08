/* ============================================
   renderer3d.js - 3D都市レンダラー (Three.js)
   ローポリでもリアリティのある都市景観を描画する。
   - 太陽光・影・空気遠近(フォグ)
   - 建物はプロシージャル生成(窓テクスチャ・屋根・煙突など)
   - 道路は隣接判定による自動タイル(白線つきアスファルト)
   - マウスで回転/ズーム、セルのホバー&クリック
   ============================================ */

import * as THREE from './lib/three.module.js';
import { OrbitControls } from './lib/OrbitControls.js';
import { BuildingTypes } from './data.js';

// ---------------------------------------------
// テクスチャ生成ユーティリティ(CanvasTexture)
// ---------------------------------------------

/** 窓が並ぶビル壁面テクスチャを生成 */
function makeWindowTexture(base, lit, cols = 4, rows = 6) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 192;
  const g = c.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, c.width, c.height);
  const wx = c.width / cols, wy = c.height / rows;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      // 一部の窓は点灯、他は暗い(ランダム)
      g.fillStyle = Math.random() < 0.35 ? lit : 'rgba(24,36,52,0.9)';
      g.fillRect(x * wx + wx * 0.2, y * wy + wy * 0.2, wx * 0.6, wy * 0.55);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 芝生(微妙な色ムラ)テクスチャ */
function makeGrassTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#4e7a3a';
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 4000; i++) {
    const shade = 0.85 + Math.random() * 0.3;
    g.fillStyle = `rgb(${Math.floor(78 * shade)},${Math.floor(122 * shade)},${Math.floor(58 * shade)})`;
    g.fillRect(Math.random() * 512, Math.random() * 512, 3, 3);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 道路タイルテクスチャ(接続ビットマスクごとに生成してキャッシュ)
    bit: 1=北 2=東 4=南 8=西 */
const roadTexCache = {};
function makeRoadTexture(mask) {
  if (roadTexCache[mask]) return roadTexCache[mask];
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  // アスファルト
  g.fillStyle = '#3d4147';
  g.fillRect(0, 0, S, S);
  // 骨材の粒
  for (let i = 0; i < 350; i++) {
    g.fillStyle = Math.random() < 0.5 ? '#464b52' : '#34383d';
    g.fillRect(Math.random() * S, Math.random() * S, 2, 2);
  }
  // 白の破線(中央線) 接続方向へ描く
  g.strokeStyle = 'rgba(235,235,225,0.85)';
  g.lineWidth = 4;
  g.setLineDash([10, 8]);
  const mid = S / 2;
  const dirs = [
    { bit: 1, x: mid, y: 0 },   // 北
    { bit: 2, x: S, y: mid },   // 東
    { bit: 4, x: mid, y: S },   // 南
    { bit: 8, x: 0, y: mid },   // 西
  ];
  let connected = 0;
  for (const d of dirs) {
    if (mask & d.bit) {
      connected++;
      g.beginPath();
      g.moveTo(mid, mid);
      g.lineTo(d.x, d.y);
      g.stroke();
    }
  }
  // 孤立した道路は縦線だけ描く
  if (connected === 0) {
    g.beginPath();
    g.moveTo(mid, 0);
    g.lineTo(mid, S);
    g.stroke();
  }
  // 歩道(縁)
  g.setLineDash([]);
  g.strokeStyle = '#565c63';
  g.lineWidth = 6;
  g.strokeRect(3, 3, S - 6, S - 6);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  roadTexCache[mask] = t;
  return t;
}

/** 赤十字マーク(病院屋上)テクスチャ */
function makeCrossTexture(bg, cross) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, 64, 64);
  g.fillStyle = cross;
  g.fillRect(26, 12, 12, 40);
  g.fillRect(12, 26, 40, 12);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------
// 共有マテリアル
// ---------------------------------------------
const MAT = {
  roofRed: new THREE.MeshStandardMaterial({ color: 0x9c4a3c, roughness: 0.8 }),
  roofGray: new THREE.MeshStandardMaterial({ color: 0x6b7178, roughness: 0.85 }),
  roofBrown: new THREE.MeshStandardMaterial({ color: 0x7a5b41, roughness: 0.85 }),
  concrete: new THREE.MeshStandardMaterial({ color: 0xb8bcbf, roughness: 0.9 }),
  concreteDark: new THREE.MeshStandardMaterial({ color: 0x8e9498, roughness: 0.9 }),
  white: new THREE.MeshStandardMaterial({ color: 0xf2f3f0, roughness: 0.7 }),
  trunk: new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 1.0 }),
  leaf: new THREE.MeshStandardMaterial({ color: 0x3e7a34, roughness: 0.9 }),
  leafDark: new THREE.MeshStandardMaterial({ color: 0x2e6329, roughness: 0.9 }),
  water: new THREE.MeshStandardMaterial({
    color: 0x1a6fa8, roughness: 0.15, metalness: 0.35,
    transparent: true, opacity: 0.92,
  }),
  waterDark: new THREE.MeshStandardMaterial({
    color: 0x0f4e78, roughness: 0.2, metalness: 0.3,
    transparent: true, opacity: 0.95,
  }),
  glass: new THREE.MeshStandardMaterial({
    color: 0x8fc3e8, roughness: 0.1, metalness: 0.6,
    transparent: true, opacity: 0.6,
  }),
  red: new THREE.MeshStandardMaterial({ color: 0xb63b30, roughness: 0.7 }),
  orange: new THREE.MeshStandardMaterial({ color: 0xd97b2a, roughness: 0.7 }),
  green: new THREE.MeshStandardMaterial({ color: 0x4c8a45, roughness: 0.8 }),
  tan: new THREE.MeshStandardMaterial({ color: 0xcbb58e, roughness: 0.8 }),
  levee: new THREE.MeshStandardMaterial({ color: 0x9a8a72, roughness: 0.95 }),
  tent: new THREE.MeshStandardMaterial({ color: 0xd9822b, roughness: 0.85 }),
};

// 家の外壁カラーバリエーション
const WALL_COLORS = [0xe8e2d4, 0xd8cfc0, 0xcfd8dc, 0xe3d5c3, 0xdedede, 0xd7c9b8];
// 車のカラーバリエーション
const CAR_COLORS = [0xcfd3d6, 0x37474f, 0x9e2b25, 0x2a5d8f, 0xe0e0e0, 0x4a635d];

const CELL = 1; // 1セル = 1ユニット

// ---------------------------------------------
// メインクラス
// ---------------------------------------------
class Renderer3D {
  constructor(map, container) {
    this.map = map;
    this.container = container;
    this.onCellClick = null;
    this.onCellHover = null;

    this.cellGroups = [];      // セルごとの3Dオブジェクト
    this.hazardGroup = null;   // ハザードマップオーバーレイ
    this.waterMats = [];       // 水面アニメーション用
    this.clock = new THREE.Clock();

    this.initScene();
    this.initLights();
    this.initGround();
    this.initPicking();
    this.animate = this.animate.bind(this);
    requestAnimationFrame(this.animate);
  }

  // --- シーン・カメラ・レンダラー ---
  initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x9ec8e8); // 空の色
    this.scene.fog = new THREE.Fog(0x9ec8e8, 30, 80);  // 空気遠近

    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 200);
    this.camera.position.set(14, 16, 20);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0, 0);
    this.controls.maxPolarAngle = Math.PI / 2.15; // 地面の下には潜らない
    this.controls.minDistance = 6;
    this.controls.maxDistance = 55;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;

    window.addEventListener('resize', () => this.resize());
    // レイアウト変化(レスポンシブ)にも追従
    new ResizeObserver(() => this.resize()).observe(this.container);
  }

  resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w === 0 || h === 0) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  // --- ライティング(太陽と空) ---
  initLights() {
    // 環境光(空からの拡散光)
    const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x5a6b4a, 0.9);
    this.scene.add(hemi);

    // 太陽(平行光源・影を落とす)
    const sun = new THREE.DirectionalLight(0xfff2dd, 2.2);
    sun.position.set(18, 26, 12);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const s = 16;
    sun.shadow.camera.left = -s;
    sun.shadow.camera.right = s;
    sun.shadow.camera.top = s;
    sun.shadow.camera.bottom = -s;
    sun.shadow.camera.far = 70;
    sun.shadow.bias = -0.0004;
    this.scene.add(sun);
  }

  // --- 地面 ---
  initGround() {
    const size = this.map.size;

    // 市街地の地面(芝生テクスチャ)
    const grass = makeGrassTexture();
    grass.repeat.set(size / 2, size / 2);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshStandardMaterial({ map: grass, roughness: 1.0 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // 周辺の郊外(大きな緑の平原) — 世界の果て感をなくす
    const outer = new THREE.Mesh(
      new THREE.PlaneGeometry(300, 300),
      new THREE.MeshStandardMaterial({ color: 0x46703a, roughness: 1.0 })
    );
    outer.rotation.x = -Math.PI / 2;
    outer.position.y = -0.02;
    outer.receiveShadow = true;
    this.scene.add(outer);

    // 北側の山並み(土砂災害エリアの表現)
    for (let i = 0; i < 9; i++) {
      const hgt = 2.5 + Math.random() * 3.5;
      const mtn = new THREE.Mesh(
        new THREE.ConeGeometry(2.5 + Math.random() * 2.5, hgt, 7),
        new THREE.MeshStandardMaterial({ color: 0x4a6b3f, roughness: 1, flatShading: true })
      );
      mtn.position.set(-size / 2 + i * (size / 8) + (Math.random() - 0.5), hgt / 2 - 0.05, -size / 2 - 3.5 - Math.random() * 3);
      mtn.castShadow = true;
      this.scene.add(mtn);
    }

    // ホバーハイライト(セル選択の目印)
    this.hoverMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(CELL * 0.98, CELL * 0.98),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3, depthWrite: false })
    );
    this.hoverMesh.rotation.x = -Math.PI / 2;
    this.hoverMesh.position.y = 0.04;
    this.hoverMesh.visible = false;
    this.scene.add(this.hoverMesh);
  }

  // --- マウスピッキング(セルのホバー/クリック) ---
  initPicking() {
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    // 判定用の不可視平面
    this.pickPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    const el = this.renderer.domElement;
    let downPos = null;

    el.addEventListener('pointermove', (e) => {
      const cell = this.pickCell(e);
      if (cell) {
        this.hoverMesh.visible = true;
        this.hoverMesh.position.x = cell.wx;
        this.hoverMesh.position.z = cell.wz;
        if (this.onCellHover) this.onCellHover(cell.x, cell.y);
      } else {
        this.hoverMesh.visible = false;
      }
    });

    // ドラッグ(カメラ回転)とクリック(建設)を区別する
    el.addEventListener('pointerdown', (e) => { downPos = { x: e.clientX, y: e.clientY }; });
    el.addEventListener('pointerup', (e) => {
      if (!downPos) return;
      const moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
      downPos = null;
      if (moved > 5) return; // ドラッグは無視
      const cell = this.pickCell(e);
      if (cell && this.onCellClick) this.onCellClick(cell.x, cell.y);
    });
  }

  /** マウスイベントからセル座標を取得 */
  pickCell(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.pickPlane, hit)) return null;
    const size = this.map.size;
    const x = Math.floor(hit.x + size / 2);
    const y = Math.floor(hit.z + size / 2);
    if (x < 0 || x >= size || y < 0 || y >= size) return null;
    return { x, y, wx: x - size / 2 + 0.5, wz: y - size / 2 + 0.5 };
  }

  /** セル座標→ワールド座標 */
  cellToWorld(x, y) {
    const size = this.map.size;
    return { x: x - size / 2 + 0.5, z: y - size / 2 + 0.5 };
  }

  // --- シーン全体の構築 ---
  buildScene() {
    // 既存のセルオブジェクトを破棄
    if (this.cellGroups.length) {
      for (const row of this.cellGroups) {
        for (const g of row) if (g) this.scene.remove(g);
      }
    }
    this.waterMats = [];
    const size = this.map.size;
    this.cellGroups = Array.from({ length: size }, () => new Array(size).fill(null));
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        this.updateCell(x, y, false);
      }
    }
  }

  // --- 個別セルの更新 ---
  updateCell(x, y, animate = true) {
    // 古いオブジェクトを除去
    const old = this.cellGroups[y]?.[x];
    if (old) this.scene.remove(old);

    const cell = this.map.grid[y][x];
    const group = this.buildCellObject(cell);
    if (!group) {
      this.cellGroups[y][x] = null;
      return;
    }
    const w = this.cellToWorld(x, y);
    group.position.set(w.x, 0, w.z);
    this.scene.add(group);
    this.cellGroups[y][x] = group;

    // 隣接する道路のタイル(白線の向き)を更新
    if (cell.type === BuildingTypes.ROAD || cell.type === BuildingTypes.EMPTY ||
        cell.type === BuildingTypes.BRIDGE) {
      this.refreshRoadNeighbors(x, y);
    }

    // 建設アニメーション(ポップ)
    if (animate && cell.type !== BuildingTypes.EMPTY) {
      group.scale.set(0.01, 0.01, 0.01);
      const t0 = performance.now();
      const pop = () => {
        const t = Math.min((performance.now() - t0) / 260, 1);
        const s = 1 + Math.sin(t * Math.PI) * 0.12; // オーバーシュート
        const k = t * s;
        group.scale.set(Math.max(k, 0.01), Math.max(k, 0.01), Math.max(k, 0.01));
        if (t < 1) requestAnimationFrame(pop);
        else group.scale.set(1, 1, 1);
      };
      requestAnimationFrame(pop);
    }
  }

  /** 隣接道路セルの再描画(接続の向きが変わるため) */
  refreshRoadNeighbors(x, y) {
    for (const n of this.map.getNeighbors(x, y)) {
      if (n.type === BuildingTypes.ROAD) {
        const old = this.cellGroups[n.y][n.x];
        if (old) this.scene.remove(old);
        const g = this.buildCellObject(n);
        const w = this.cellToWorld(n.x, n.y);
        g.position.set(w.x, 0, w.z);
        this.scene.add(g);
        this.cellGroups[n.y][n.x] = g;
      }
    }
  }

  /** 道路の接続ビットマスクを計算 */
  roadMask(x, y) {
    const size = this.map.size;
    const at = (xx, yy) => {
      if (xx < 0 || xx >= size || yy < 0 || yy >= size) return false;
      const t = this.map.grid[yy][xx].type;
      return t === BuildingTypes.ROAD || t === BuildingTypes.BRIDGE;
    };
    let mask = 0;
    if (at(x, y - 1)) mask |= 1; // 北
    if (at(x + 1, y)) mask |= 2; // 東
    if (at(x, y + 1)) mask |= 4; // 南
    if (at(x - 1, y)) mask |= 8; // 西
    return mask;
  }

  // ---------------------------------------------
  // セルタイプ別の3Dオブジェクト生成
  // ---------------------------------------------
  buildCellObject(cell) {
    const T = BuildingTypes;
    switch (cell.type) {
      case T.EMPTY: return null;
      case T.ROAD: return this.buildRoad(cell);
      case T.WATER: return this.buildWater();
      case T.RESIDENTIAL: return this.buildHouse(cell);
      case T.COMMERCIAL: return this.buildCommercial(cell);
      case T.INDUSTRIAL: return this.buildIndustrial();
      case T.PARK: return this.buildPark();
      case T.HOSPITAL: return this.buildHospital();
      case T.SCHOOL: return this.buildSchool();
      case T.FIRE_STATION: return this.buildFireStation();
      case T.STATION: return this.buildStation();
      case T.BUS_STOP: return this.buildBusStop();
      case T.BRIDGE: return this.buildBridge(cell);
      case T.LEVEE: return this.buildLevee();
      case T.RETENTION_BASIN: return this.buildRetentionBasin();
      case T.SHELTER: return this.buildShelter();
      case T.DISASTER_PARK: return this.buildDisasterPark();
      default: return null;
    }
  }

  /** box生成のショートハンド(影付き) */
  box(w, h, d, mat) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }

  // --- 道路(自動タイル+たまに駐車車両) ---
  buildRoad(cell) {
    const g = new THREE.Group();
    const mask = this.roadMask(cell.x, cell.y);
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(CELL, CELL),
      new THREE.MeshStandardMaterial({ map: makeRoadTexture(mask), roughness: 0.95 })
    );
    plane.rotation.x = -Math.PI / 2;
    // 東西のみの接続なら90度回転
    if (mask === 10) plane.rotation.z = Math.PI / 2;
    plane.position.y = 0.012;
    plane.receiveShadow = true;
    g.add(plane);

    // セル座標のハッシュで決定的に車を配置(再描画でチラつかない)
    const h = (cell.x * 73856093 ^ cell.y * 19349663) >>> 0;
    if (h % 4 === 0) {
      const car = this.buildCar(CAR_COLORS[h % CAR_COLORS.length]);
      car.position.set(((h >> 3) % 10) / 40 - 0.12, 0, 0.22);
      if (mask === 10) car.rotation.y = Math.PI / 2;
      g.add(car);
    }
    return g;
  }

  /** 簡易な自動車(ボディ+キャビン+車輪) */
  buildCar(color) {
    const car = new THREE.Group();
    const body = this.box(0.16, 0.055, 0.34, new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.5 }));
    body.position.y = 0.06;
    const cabin = this.box(0.14, 0.05, 0.16, MAT.glass);
    cabin.position.set(0, 0.11, -0.02);
    car.add(body, cabin);
    const wheelGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.02, 8);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 });
    for (const [wx, wz] of [[-0.08, 0.1], [0.08, 0.1], [-0.08, -0.1], [0.08, -0.1]]) {
      const wl = new THREE.Mesh(wheelGeo, wheelMat);
      wl.rotation.z = Math.PI / 2;
      wl.position.set(wx, 0.03, wz);
      car.add(wl);
    }
    return car;
  }

  // --- 水面(河川) ---
  buildWater() {
    const g = new THREE.Group();
    // 川底(掘り込み表現)
    const bed = this.box(CELL, 0.12, CELL, MAT.waterDark);
    bed.position.y = -0.05;
    bed.castShadow = false;
    g.add(bed);
    // 水面
    const mat = MAT.water.clone();
    const surf = new THREE.Mesh(new THREE.PlaneGeometry(CELL, CELL), mat);
    surf.rotation.x = -Math.PI / 2;
    surf.position.y = 0.015;
    surf.receiveShadow = true;
    g.add(surf);
    this.waterMats.push(mat);
    return g;
  }

  // --- 住宅(切妻風の家+庭) ---
  buildHouse(cell) {
    const g = new THREE.Group();
    const h = (cell.x * 2654435761 ^ cell.y * 40503) >>> 0;
    const wall = new THREE.MeshStandardMaterial({ color: WALL_COLORS[h % WALL_COLORS.length], roughness: 0.8 });
    const roofMat = [MAT.roofRed, MAT.roofGray, MAT.roofBrown][h % 3];

    // 庭(明るい芝)
    const yard = new THREE.Mesh(
      new THREE.PlaneGeometry(CELL * 0.96, CELL * 0.96),
      new THREE.MeshStandardMaterial({ color: 0x5d8a48, roughness: 1 })
    );
    yard.rotation.x = -Math.PI / 2;
    yard.position.y = 0.008;
    yard.receiveShadow = true;
    g.add(yard);

    // 母屋
    const bw = 0.52, bh = 0.3, bd = 0.44;
    const body = this.box(bw, bh, bd, wall);
    body.position.y = bh / 2;
    g.add(body);

    // 屋根(ピラミッド)
    const roof = new THREE.Mesh(new THREE.ConeGeometry(bw * 0.78, 0.22, 4), roofMat);
    roof.rotation.y = Math.PI / 4;
    roof.position.y = bh + 0.11;
    roof.castShadow = true;
    g.add(roof);

    // ドアと窓
    const door = this.box(0.09, 0.14, 0.02, MAT.roofBrown);
    door.position.set(0.08, 0.07, bd / 2 + 0.005);
    g.add(door);
    const win = this.box(0.1, 0.08, 0.02, MAT.glass);
    win.position.set(-0.12, 0.17, bd / 2 + 0.005);
    g.add(win);

    // 庭木
    const tree = this.buildTree(0.32 + (h % 10) / 40, h % 2 === 0);
    tree.position.set(bw / 2 + 0.14, 0, -0.25);
    g.add(tree);

    // 全体をわずかにランダム回転(街の"揺らぎ")
    g.rotation.y = ((h % 4) * Math.PI) / 2;
    return g;
  }

  // --- 商業ビル(窓明かり付き中層ビル) ---
  buildCommercial(cell) {
    const g = new THREE.Group();
    const h = (cell.x * 83492791 ^ cell.y * 297121507) >>> 0;
    const floors = 3 + (h % 4);           // 3〜6階
    const bh = floors * 0.22;
    const bw = 0.62, bd = 0.62;

    const winTex = makeWindowTexture('#5a7080', '#ffd77a', 4, floors * 2);
    const sideMat = new THREE.MeshStandardMaterial({ map: winTex, roughness: 0.6 });
    const topMat = MAT.concreteDark;
    const mats = [sideMat, sideMat, topMat, topMat, sideMat, sideMat];
    const body = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), mats);
    body.castShadow = true;
    body.receiveShadow = true;
    body.position.y = bh / 2;
    g.add(body);

    // 屋上の設備(室外機・給水塔)
    const ac = this.box(0.16, 0.08, 0.12, MAT.concrete);
    ac.position.set(0.12, bh + 0.04, -0.1);
    g.add(ac);

    // 1階の店舗ひさし
    const awning = this.box(bw + 0.08, 0.03, 0.14, [MAT.red, MAT.orange, MAT.green][h % 3]);
    awning.position.set(0, 0.24, bd / 2 + 0.06);
    g.add(awning);
    return g;
  }

  // --- 工業(工場+煙突) ---
  buildIndustrial() {
    const g = new THREE.Group();
    const body = this.box(0.78, 0.34, 0.6, MAT.concreteDark);
    body.position.y = 0.17;
    g.add(body);
    // のこぎり屋根
    for (let i = 0; i < 3; i++) {
      const saw = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.12, 4), MAT.roofGray);
      saw.rotation.y = Math.PI / 4;
      saw.scale.z = 2.1;
      saw.position.set(-0.24 + i * 0.24, 0.4, 0);
      saw.castShadow = true;
      g.add(saw);
    }
    // 煙突
    for (const px of [0.28, 0.16]) {
      const chimney = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.5, 8), MAT.concrete);
      chimney.position.set(px, 0.55, -0.2);
      chimney.castShadow = true;
      g.add(chimney);
    }
    return g;
  }

  // --- 公園(樹木+池+小道) ---
  buildPark() {
    const g = new THREE.Group();
    const lawn = new THREE.Mesh(
      new THREE.PlaneGeometry(CELL * 0.98, CELL * 0.98),
      new THREE.MeshStandardMaterial({ color: 0x559a44, roughness: 1 })
    );
    lawn.rotation.x = -Math.PI / 2;
    lawn.position.y = 0.01;
    lawn.receiveShadow = true;
    g.add(lawn);

    // 樹木を配置
    const spots = [[-0.28, -0.25], [0.3, -0.18], [-0.2, 0.28], [0.22, 0.3], [0.02, 0.0]];
    spots.forEach(([px, pz], i) => {
      const tree = this.buildTree(0.35 + (i % 3) * 0.08, i % 2 === 0);
      tree.position.set(px, 0, pz);
      g.add(tree);
    });

    // ベンチ
    const bench = this.box(0.14, 0.03, 0.05, MAT.roofBrown);
    bench.position.set(0.05, 0.05, -0.35);
    g.add(bench);
    return g;
  }

  /** 樹木(針葉樹 or 広葉樹) */
  buildTree(height, conifer) {
    const t = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, height * 0.4, 6), MAT.trunk);
    trunk.position.y = height * 0.2;
    trunk.castShadow = true;
    t.add(trunk);
    if (conifer) {
      // 針葉樹(コーンを2段)
      for (let i = 0; i < 2; i++) {
        const cone = new THREE.Mesh(
          new THREE.ConeGeometry(0.14 - i * 0.04, height * 0.45, 7),
          i === 0 ? MAT.leafDark : MAT.leaf
        );
        cone.position.y = height * (0.45 + i * 0.28);
        cone.castShadow = true;
        t.add(cone);
      }
    } else {
      // 広葉樹(球)
      const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(height * 0.32, 0), MAT.leaf);
      crown.position.y = height * 0.62;
      crown.castShadow = true;
      t.add(crown);
    }
    return t;
  }

  // --- 病院(白い建物+赤十字) ---
  buildHospital() {
    const g = new THREE.Group();
    const body = this.box(0.72, 0.66, 0.58, MAT.white);
    body.position.y = 0.33;
    g.add(body);
    const wing = this.box(0.3, 0.4, 0.7, MAT.white);
    wing.position.set(0.32, 0.2, 0);
    g.add(wing);
    // 屋上の赤十字看板
    const cross = new THREE.Mesh(
      new THREE.PlaneGeometry(0.26, 0.26),
      new THREE.MeshStandardMaterial({ map: makeCrossTexture('#ffffff', '#c62828'), roughness: 0.6 })
    );
    cross.rotation.x = -Math.PI / 2;
    cross.position.y = 0.665;
    g.add(cross);
    // 正面看板
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(0.14, 0.14),
      new THREE.MeshStandardMaterial({ map: makeCrossTexture('#ffffff', '#c62828'), roughness: 0.6 })
    );
    sign.position.set(0, 0.5, 0.295);
    g.add(sign);
    return g;
  }

  // --- 学校(校舎+校庭+時計塔) ---
  buildSchool() {
    const g = new THREE.Group();
    // 校庭(土色)
    const yard = new THREE.Mesh(
      new THREE.PlaneGeometry(CELL * 0.96, CELL * 0.96),
      new THREE.MeshStandardMaterial({ color: 0xc9b088, roughness: 1 })
    );
    yard.rotation.x = -Math.PI / 2;
    yard.position.y = 0.008;
    yard.receiveShadow = true;
    g.add(yard);

    const body = this.box(0.8, 0.36, 0.28, MAT.tan);
    body.position.set(0, 0.18, -0.28);
    g.add(body);
    // 時計塔
    const tower = this.box(0.12, 0.55, 0.12, MAT.white);
    tower.position.set(0, 0.275, -0.28);
    g.add(tower);
    const towerRoof = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.1, 4), MAT.roofRed);
    towerRoof.rotation.y = Math.PI / 4;
    towerRoof.position.set(0, 0.6, -0.28);
    towerRoof.castShadow = true;
    g.add(towerRoof);
    return g;
  }

  // --- 消防署(赤い建物+車庫) ---
  buildFireStation() {
    const g = new THREE.Group();
    const body = this.box(0.66, 0.4, 0.56, MAT.red);
    body.position.y = 0.2;
    g.add(body);
    // 白い帯
    const stripe = this.box(0.68, 0.06, 0.58, MAT.white);
    stripe.position.y = 0.3;
    g.add(stripe);
    // 車庫ドア
    for (const px of [-0.15, 0.15]) {
      const doorM = this.box(0.2, 0.2, 0.02, MAT.concrete);
      doorM.position.set(px, 0.11, 0.285);
      g.add(doorM);
    }
    // 消防車
    const truck = this.buildCar(0xc62828);
    truck.position.set(0.15, 0, 0.42);
    g.add(truck);
    return g;
  }

  // --- 駅(プラットフォーム+駅舎) ---
  buildStation() {
    const g = new THREE.Group();
    // ホーム
    const platform = this.box(0.9, 0.08, 0.5, MAT.concrete);
    platform.position.set(0, 0.04, 0.2);
    g.add(platform);
    // 線路(枕木)
    const rail = this.box(0.96, 0.02, 0.16, new THREE.MeshStandardMaterial({ color: 0x4b423a, roughness: 1 }));
    rail.position.set(0, 0.01, -0.3);
    g.add(rail);
    // 駅舎
    const body = this.box(0.6, 0.3, 0.3, MAT.white);
    body.position.set(0, 0.23, 0.25);
    g.add(body);
    // 大屋根(かまぼこ)
    const roof = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.22, 0.92, 12, 1, false, 0, Math.PI),
      MAT.orange
    );
    roof.rotation.z = Math.PI / 2;
    roof.position.set(0, 0.4, 0.1);
    roof.castShadow = true;
    g.add(roof);
    // 電車(シンプルな車両)
    const train = this.box(0.8, 0.14, 0.14, new THREE.MeshStandardMaterial({ color: 0x2a7f62, roughness: 0.4, metalness: 0.4 }));
    train.position.set(0, 0.1, -0.3);
    g.add(train);
    return g;
  }

  // --- バス停(小さな上屋+標識) ---
  buildBusStop() {
    const g = new THREE.Group();
    // 舗装
    const pad = new THREE.Mesh(
      new THREE.PlaneGeometry(0.6, 0.4),
      new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 1 })
    );
    pad.rotation.x = -Math.PI / 2;
    pad.position.y = 0.01;
    pad.receiveShadow = true;
    g.add(pad);
    // 上屋
    const roof = this.box(0.4, 0.02, 0.2, MAT.glass);
    roof.position.set(0, 0.28, 0);
    g.add(roof);
    for (const px of [-0.18, 0.18]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.28, 6), MAT.concreteDark);
      pole.position.set(px, 0.14, -0.08);
      g.add(pole);
    }
    // 標識ポール
    const sign = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.36, 6), MAT.concreteDark);
    sign.position.set(0.26, 0.18, 0.12);
    g.add(sign);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.015, 12), MAT.orange);
    disc.rotation.x = Math.PI / 2;
    disc.position.set(0.26, 0.38, 0.12);
    g.add(disc);
    return g;
  }

  // --- 橋梁(桁橋+欄干) ---
  buildBridge(cell) {
    const g = new THREE.Group();
    // 橋の下にも水面を描く
    const water = this.buildWater();
    g.add(water);

    const mask = this.roadMask(cell.x, cell.y);
    const ew = mask === 10 || mask === 2 || mask === 8; // 東西方向

    // 桁(デッキ)
    const deck = this.box(CELL, 0.05, 0.6, MAT.concrete);
    deck.position.y = 0.14;
    g.add(deck);
    // 路面
    const surf = new THREE.Mesh(
      new THREE.PlaneGeometry(CELL, 0.5),
      new THREE.MeshStandardMaterial({ map: makeRoadTexture(10), roughness: 0.95 })
    );
    surf.rotation.x = -Math.PI / 2;
    surf.rotation.z = Math.PI / 2;
    surf.position.y = 0.17;
    g.add(surf);
    // 欄干
    for (const pz of [-0.28, 0.28]) {
      const rail = this.box(CELL, 0.08, 0.03, MAT.concreteDark);
      rail.position.set(0, 0.22, pz);
      g.add(rail);
    }
    // 橋脚
    for (const px of [-0.3, 0.3]) {
      const pier = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.25, 8), MAT.concreteDark);
      pier.position.set(px, 0.0, 0);
      g.add(pier);
    }
    if (!ew) g.rotation.y = Math.PI / 2;
    return g;
  }

  // --- 堤防(台形の土手) ---
  buildLevee() {
    const g = new THREE.Group();
    const bank = this.box(CELL * 0.96, 0.22, 0.5, MAT.levee);
    bank.position.y = 0.11;
    // 台形風に上をすぼめる
    bank.geometry = new THREE.CylinderGeometry(0.28, 0.42, CELL * 0.96, 4, 1);
    bank.rotation.z = Math.PI / 2;
    bank.rotation.x = Math.PI / 4;
    bank.scale.set(1, 1, 0.5);
    g.add(bank);
    // 天端の通路
    const top = this.box(CELL * 0.96, 0.02, 0.16, MAT.concrete);
    top.position.y = 0.21;
    g.add(top);
    return g;
  }

  // --- 調整池(コンクリート枠+水面) ---
  buildRetentionBasin() {
    const g = new THREE.Group();
    // 外周のコンクリート枠
    const rim = 0.08;
    for (const [px, pz, w, d] of [
      [0, -0.45, CELL * 0.95, rim], [0, 0.45, CELL * 0.95, rim],
      [-0.45, 0, rim, CELL * 0.95], [0.45, 0, rim, CELL * 0.95],
    ]) {
      const wall = this.box(w, 0.12, d, MAT.concrete);
      wall.position.set(px, 0.06, pz);
      g.add(wall);
    }
    // 掘り込み水面
    const mat = MAT.water.clone();
    const pond = new THREE.Mesh(new THREE.PlaneGeometry(0.82, 0.82), mat);
    pond.rotation.x = -Math.PI / 2;
    pond.position.y = 0.02;
    g.add(pond);
    this.waterMats.push(mat);
    return g;
  }

  // --- 避難所(頑丈な建物+マーク) ---
  buildShelter() {
    const g = new THREE.Group();
    const body = this.box(0.7, 0.34, 0.55, MAT.concrete);
    body.position.y = 0.17;
    g.add(body);
    const roof = this.box(0.74, 0.05, 0.6, MAT.green);
    roof.position.y = 0.37;
    g.add(roof);
    // 緑十字(避難所サイン)
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(0.16, 0.16),
      new THREE.MeshStandardMaterial({ map: makeCrossTexture('#ffffff', '#2e7d32'), roughness: 0.6 })
    );
    sign.position.set(0, 0.22, 0.28);
    g.add(sign);
    return g;
  }

  // --- 防災公園(緑地+備蓄倉庫+テント) ---
  buildDisasterPark() {
    const g = this.buildPark();
    // テント
    const tent = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.18, 4), MAT.tent);
    tent.rotation.y = Math.PI / 4;
    tent.position.set(-0.05, 0.09, 0.05);
    tent.castShadow = true;
    g.add(tent);
    // 備蓄倉庫
    const store = this.box(0.22, 0.14, 0.16, MAT.concreteDark);
    store.position.set(0.3, 0.07, -0.02);
    g.add(store);
    return g;
  }

  // ---------------------------------------------
  // ハザードマップオーバーレイ
  // ---------------------------------------------
  /** cells: [{x, y, color}] color: 'flood' | 'landslide' */
  setHazardCells(cells) {
    this.clearHazard();
    if (!cells || cells.length === 0) return;
    this.hazardGroup = new THREE.Group();
    const colors = { flood: 0x29b6f6, landslide: 0xffc107 };
    for (const c of cells) {
      const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(CELL * 0.98, CELL * 0.98),
        new THREE.MeshBasicMaterial({
          color: colors[c.color] || 0xffffff,
          transparent: true, opacity: 0.42, depthWrite: false,
        })
      );
      plane.rotation.x = -Math.PI / 2;
      const w = this.cellToWorld(c.x, c.y);
      plane.position.set(w.x, 0.55, w.z); // 建物の上に浮かせて見やすく
      this.hazardGroup.add(plane);
    }
    this.scene.add(this.hazardGroup);
  }

  clearHazard() {
    if (this.hazardGroup) {
      this.scene.remove(this.hazardGroup);
      this.hazardGroup = null;
    }
  }

  // ---------------------------------------------
  // アニメーションループ
  // ---------------------------------------------
  animate() {
    requestAnimationFrame(this.animate);
    const t = this.clock.getElapsedTime();
    // 水面のきらめき
    for (const m of this.waterMats) {
      m.roughness = 0.12 + Math.sin(t * 1.6) * 0.06;
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}

export { Renderer3D };
