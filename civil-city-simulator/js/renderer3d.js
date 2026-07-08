/* ============================================
   renderer3d.js - フォトリアル3D都市レンダラー (Three.js)
   「リアル都市」を目指した最高品質のグラフィック:
   - 物理ベースの大気散乱スカイ(Sky shader) + 環境反射(PMREM)
   - ACESフィルミックトーンマッピング + ブルーム後処理
   - ゴールデンアワーの太陽光とソフトシャドウ(4K shadow map)
   - 道路を走行する自動車AI・街路灯・流れる雲
   - 法線マップでゆらめく水面(空を反射)
   - ディテールの高いプロシージャル建物(煙突・給水塔・ガラスタワー)
   ============================================ */

import * as THREE from './lib/three.module.js';
import { OrbitControls } from './lib/OrbitControls.js';
import { Sky } from './lib/objects/Sky.js';
import { EffectComposer } from './lib/postprocessing/EffectComposer.js';
import { RenderPass } from './lib/postprocessing/RenderPass.js';
import { UnrealBloomPass } from './lib/postprocessing/UnrealBloomPass.js';
import { OutputPass } from './lib/postprocessing/OutputPass.js';
import { BuildingTypes } from './data.js';

// ---------------------------------------------
// プロシージャルテクスチャ生成
// ---------------------------------------------

/** 疑似乱数(シード付き・決定的) */
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** ビル壁面(窓)テクスチャ: 通常マップ + 発光マップのペアを生成 */
function makeFacadeTextures(baseColor, cols, rows, seed, litRatio = 0.4) {
  const rnd = mulberry32(seed);
  const W = 256, H = 384;
  const cDiff = document.createElement('canvas');
  cDiff.width = W; cDiff.height = H;
  const cEmis = document.createElement('canvas');
  cEmis.width = W; cEmis.height = H;
  const gd = cDiff.getContext('2d');
  const ge = cEmis.getContext('2d');

  // 外壁(縦方向に微妙なグラデーションで立体感)
  const grad = gd.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, baseColor);
  grad.addColorStop(1, shadeColor(baseColor, -18));
  gd.fillStyle = grad;
  gd.fillRect(0, 0, W, H);
  ge.fillStyle = '#000000';
  ge.fillRect(0, 0, W, H);

  const wx = W / cols, wy = H / rows;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const px = x * wx + wx * 0.18, py = y * wy + wy * 0.2;
      const pw = wx * 0.64, ph = wy * 0.55;
      // 窓枠(暗)
      gd.fillStyle = 'rgba(20,26,34,0.95)';
      gd.fillRect(px - 2, py - 2, pw + 4, ph + 4);
      const lit = rnd() < litRatio;
      if (lit) {
        // 点灯した窓(暖色)
        const warm = ['#ffd98c', '#ffe4ad', '#ffc46b'][Math.floor(rnd() * 3)];
        gd.fillStyle = warm;
        gd.fillRect(px, py, pw, ph);
        ge.fillStyle = warm;
        ge.fillRect(px, py, pw, ph);
      } else {
        // 空を映すガラス(上ほど明るい)
        const sky = gd.createLinearGradient(0, py, 0, py + ph);
        sky.addColorStop(0, '#9db8c9');
        sky.addColorStop(1, '#3d5468');
        gd.fillStyle = sky;
        gd.fillRect(px, py, pw, ph);
      }
    }
  }
  const diff = new THREE.CanvasTexture(cDiff);
  diff.colorSpace = THREE.SRGBColorSpace;
  const emis = new THREE.CanvasTexture(cEmis);
  emis.colorSpace = THREE.SRGBColorSpace;
  return { diff, emis };
}

/** カラー明度調整ヘルパー */
function shadeColor(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, (n >> 16) + amt));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 0xff) + amt));
  const b = Math.max(0, Math.min(255, (n & 0xff) + amt));
  return `rgb(${r},${g},${b})`;
}

/** 芝生テクスチャ(多階調ノイズ) */
function makeGrassTexture() {
  const S = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#55793f';
  g.fillRect(0, 0, S, S);
  const rnd = mulberry32(1234);
  // 大きな色ムラ
  for (let i = 0; i < 260; i++) {
    const r = 20 + rnd() * 90;
    const grd = g.createRadialGradient(0, 0, 0, 0, 0, r);
    const tone = rnd();
    const col = tone < 0.5 ? '77,110,56' : (tone < 0.8 ? '96,128,66' : '68,98,52');
    grd.addColorStop(0, `rgba(${col},0.35)`);
    grd.addColorStop(1, `rgba(${col},0)`);
    g.save();
    g.translate(rnd() * S, rnd() * S);
    g.fillStyle = grd;
    g.fillRect(-r, -r, r * 2, r * 2);
    g.restore();
  }
  // 細かい草の粒
  for (let i = 0; i < 24000; i++) {
    const t = 0.75 + rnd() * 0.5;
    g.fillStyle = `rgb(${Math.floor(85 * t)},${Math.floor(121 * t)},${Math.floor(63 * t)})`;
    g.fillRect(rnd() * S, rnd() * S, 2, 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** 水面用ノイズ法線マップ */
function makeWaterNormalTexture() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const img = g.createImageData(S, S);
  const rnd = mulberry32(999);
  // 単純な波ノイズ(サイン波の重ね合わせ)から法線を作る
  const height = new Float32Array(S * S);
  const waves = [];
  for (let i = 0; i < 6; i++) {
    waves.push({ fx: 1 + rnd() * 5, fy: 1 + rnd() * 5, ph: rnd() * Math.PI * 2, amp: 0.4 + rnd() * 0.6 });
  }
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let h = 0;
      for (const w of waves) {
        h += Math.sin((x / S) * Math.PI * 2 * w.fx + (y / S) * Math.PI * 2 * w.fy + w.ph) * w.amp;
      }
      height[y * S + x] = h;
    }
  }
  const at = (x, y) => height[((y + S) % S) * S + ((x + S) % S)];
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = at(x + 1, y) - at(x - 1, y);
      const dy = at(x, y + 1) - at(x, y - 1);
      const i = (y * S + x) * 4;
      img.data[i] = 128 + dx * 40;
      img.data[i + 1] = 128 + dy * 40;
      img.data[i + 2] = 255;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** 道路タイルテクスチャ(接続ビットマスク別・高解像度)
    bit: 1=北 2=東 4=南 8=西 */
const roadTexCache = {};
function makeRoadTexture(mask) {
  if (roadTexCache[mask]) return roadTexCache[mask];
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const rnd = mulberry32(mask * 7919 + 17);

  // 歩道(縁)ベース
  g.fillStyle = '#8f959b';
  g.fillRect(0, 0, S, S);
  // 歩道の目地
  g.strokeStyle = 'rgba(0,0,0,0.15)';
  g.lineWidth = 2;
  for (let i = 0; i <= 8; i++) {
    g.beginPath(); g.moveTo((S / 8) * i, 0); g.lineTo((S / 8) * i, S); g.stroke();
    g.beginPath(); g.moveTo(0, (S / 8) * i); g.lineTo(S, (S / 8) * i); g.stroke();
  }

  // 車道(アスファルト)を接続方向に描く
  const mid = S / 2, half = S * 0.32;
  const asphalt = (x, y, w, h) => {
    g.fillStyle = '#33373c';
    g.fillRect(x, y, w, h);
  };
  const conns = [];
  if (mask & 1) conns.push('N');
  if (mask & 2) conns.push('E');
  if (mask & 4) conns.push('S');
  if (mask & 8) conns.push('W');
  // 中央部
  asphalt(mid - half, mid - half, half * 2, half * 2);
  if (mask & 1) asphalt(mid - half, 0, half * 2, mid);
  if (mask & 4) asphalt(mid - half, mid, half * 2, mid);
  if (mask & 8) asphalt(0, mid - half, mid, half * 2);
  if (mask & 2) asphalt(mid, mid - half, mid, half * 2);
  if (conns.length === 0) { asphalt(mid - half, 0, half * 2, S); }

  // アスファルトの荒れ・シミ
  for (let i = 0; i < 500; i++) {
    const x = rnd() * S, y = rnd() * S;
    g.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.08)';
    g.fillRect(x, y, 2 + rnd() * 3, 2 + rnd() * 3);
  }

  // 白の破線(中央線)
  g.strokeStyle = 'rgba(240,240,230,0.9)';
  g.lineWidth = 5;
  g.setLineDash([16, 14]);
  const ends = { N: [mid, 0], E: [S, mid], S: [mid, S], W: [0, mid] };
  if (conns.length >= 3) {
    // 交差点: 横断歩道を描く
    g.setLineDash([]);
    g.fillStyle = 'rgba(240,240,230,0.85)';
    for (const d of conns) {
      for (let i = -3; i <= 3; i++) {
        const off = i * 13;
        if (d === 'N') g.fillRect(mid + off - 4, mid - half - 20, 8, 16);
        if (d === 'S') g.fillRect(mid + off - 4, mid + half + 4, 8, 16);
        if (d === 'W') g.fillRect(mid - half - 20, mid + off - 4, 16, 8);
        if (d === 'E') g.fillRect(mid + half + 4, mid + off - 4, 16, 8);
      }
    }
  } else {
    for (const d of conns.length ? conns : ['N', 'S']) {
      g.beginPath();
      g.moveTo(mid, mid);
      g.lineTo(ends[d][0], ends[d][1]);
      g.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  roadTexCache[mask] = t;
  return t;
}

/** 十字マーク(病院・避難所)テクスチャ */
function makeCrossTexture(bg, cross) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, 128, 128);
  g.fillStyle = cross;
  g.fillRect(52, 24, 24, 80);
  g.fillRect(24, 52, 80, 24);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------
// 共有マテリアル・ジオメトリ
// ---------------------------------------------
const MAT = {
  roofRed: new THREE.MeshStandardMaterial({ color: 0x8e4438, roughness: 0.75 }),
  roofGray: new THREE.MeshStandardMaterial({ color: 0x5f666e, roughness: 0.8 }),
  roofBrown: new THREE.MeshStandardMaterial({ color: 0x6f5340, roughness: 0.8 }),
  roofDark: new THREE.MeshStandardMaterial({ color: 0x3a3f45, roughness: 0.85 }),
  concrete: new THREE.MeshStandardMaterial({ color: 0xb5b9bc, roughness: 0.9 }),
  concreteDark: new THREE.MeshStandardMaterial({ color: 0x878d92, roughness: 0.9 }),
  white: new THREE.MeshStandardMaterial({ color: 0xeceee9, roughness: 0.6 }),
  trunk: new THREE.MeshStandardMaterial({ color: 0x5e4128, roughness: 1.0 }),
  leaf: new THREE.MeshStandardMaterial({ color: 0x3f7a33, roughness: 0.9, flatShading: true }),
  leafLight: new THREE.MeshStandardMaterial({ color: 0x549144, roughness: 0.9, flatShading: true }),
  leafDark: new THREE.MeshStandardMaterial({ color: 0x2c5c26, roughness: 0.9, flatShading: true }),
  glass: new THREE.MeshStandardMaterial({
    color: 0x9fc8e8, roughness: 0.05, metalness: 0.9,
    transparent: true, opacity: 0.65, envMapIntensity: 1.4,
  }),
  glassTower: new THREE.MeshStandardMaterial({
    color: 0x6fa3c8, roughness: 0.08, metalness: 0.95, envMapIntensity: 1.6,
  }),
  red: new THREE.MeshStandardMaterial({ color: 0xa93a2f, roughness: 0.65 }),
  orange: new THREE.MeshStandardMaterial({ color: 0xcf7527, roughness: 0.65 }),
  green: new THREE.MeshStandardMaterial({ color: 0x47823f, roughness: 0.8 }),
  tan: new THREE.MeshStandardMaterial({ color: 0xc4ad85, roughness: 0.8 }),
  levee: new THREE.MeshStandardMaterial({ color: 0x92836b, roughness: 0.95 }),
  tent: new THREE.MeshStandardMaterial({ color: 0xd0781f, roughness: 0.85 }),
  rail: new THREE.MeshStandardMaterial({ color: 0x453d34, roughness: 1 }),
  metal: new THREE.MeshStandardMaterial({ color: 0x9aa2a8, roughness: 0.35, metalness: 0.8 }),
  lampGlow: new THREE.MeshStandardMaterial({
    color: 0xfff3d0, emissive: 0xffe9b0, emissiveIntensity: 2.2, roughness: 0.4,
  }),
  cloud: new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 1, transparent: true, opacity: 0.92, flatShading: true,
  }),
  rock: new THREE.MeshStandardMaterial({ color: 0x6d6a5f, roughness: 1, flatShading: true }),
  mountain: new THREE.MeshStandardMaterial({ color: 0x47663c, roughness: 1, flatShading: true }),
  snow: new THREE.MeshStandardMaterial({ color: 0xf4f7f9, roughness: 0.8, flatShading: true }),
};

const WALL_COLORS = ['#e6dfd0', '#d5ccba', '#ccd5da', '#e0d2be', '#dadada', '#d2c3b0'];
const CAR_COLORS = [0xd6dade, 0x2f3d46, 0x8e2620, 0x1f4d7a, 0xe8e8e8, 0x3f5a52, 0xc7952c];
const CELL = 1;

// ---------------------------------------------
// メインクラス
// ---------------------------------------------
class Renderer3D {
  constructor(map, container) {
    this.map = map;
    this.container = container;
    this.onCellClick = null;
    this.onCellHover = null;

    this.cellGroups = [];
    this.hazardGroup = null;
    this.waterMats = [];
    this.cars = [];         // 走行中の車エージェント
    this.carsDirty = true;  // 道路網が変わったら車を再配置
    this.clouds = [];
    this.clock = new THREE.Clock();
    this.waterNormal = makeWaterNormalTexture();
    this.facadeCache = [];

    this.initScene();
    this.initSkyAndLights();
    this.initGround();
    this.initClouds();
    this.initPostprocessing();
    this.initPicking();
    this.animate = this.animate.bind(this);
    requestAnimationFrame(this.animate);
  }

  // --- シーン・カメラ・レンダラー ---
  initScene() {
    this.scene = new THREE.Scene();
    // 空気遠近(遠景は淡いブルーグレーに沈む)
    this.scene.fog = new THREE.Fog(0xc3d3e0, 42, 130);

    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.camera = new THREE.PerspectiveCamera(42, w / h, 0.1, 400);
    this.camera.position.set(13, 13, 19);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // 映画的なトーンマッピング(白飛びを抑え、豊かな階調)
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.78;
    this.container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0, 0);
    this.controls.maxPolarAngle = Math.PI / 2.12;
    this.controls.minDistance = 4;
    this.controls.maxDistance = 60;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;

    window.addEventListener('resize', () => this.resize());
    new ResizeObserver(() => this.resize()).observe(this.container);
  }

  resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w === 0 || h === 0) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    if (this.composer) this.composer.setSize(w, h);
  }

  // --- 物理ベースの空と太陽 ---
  initSkyAndLights() {
    // 大気散乱シェーダーの空
    this.sky = new Sky();
    this.sky.scale.setScalar(4000);
    this.scene.add(this.sky);

    const u = this.sky.material.uniforms;
    u.turbidity.value = 6;         // 大気の濁り
    u.rayleigh.value = 1.8;        // 青空の強さ
    u.mieCoefficient.value = 0.006;
    u.mieDirectionalG.value = 0.85;

    // 午後の太陽(長い影が落ちるゴールデンアワー寄り)
    const elevation = 28, azimuth = 125;
    const phi = THREE.MathUtils.degToRad(90 - elevation);
    const theta = THREE.MathUtils.degToRad(azimuth);
    this.sunDir = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
    u.sunPosition.value.copy(this.sunDir);

    // 空を環境マップ化(PBR素材のリアルな映り込み)
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const skyScene = new THREE.Scene();
    const skyClone = new Sky();
    skyClone.scale.setScalar(4000);
    skyClone.material.uniforms.turbidity.value = u.turbidity.value;
    skyClone.material.uniforms.rayleigh.value = u.rayleigh.value;
    skyClone.material.uniforms.mieCoefficient.value = u.mieCoefficient.value;
    skyClone.material.uniforms.mieDirectionalG.value = u.mieDirectionalG.value;
    skyClone.material.uniforms.sunPosition.value.copy(this.sunDir);
    skyScene.add(skyClone);
    this.scene.environment = pmrem.fromScene(skyScene, 0.02).texture;
    this.scene.environmentIntensity = 0.7;
    pmrem.dispose();

    // 太陽光(影あり・高解像度シャドウ)
    const sun = new THREE.DirectionalLight(0xffe8c4, 3.4);
    sun.position.copy(this.sunDir).multiplyScalar(60);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    const s = 18;
    sun.shadow.camera.left = -s;
    sun.shadow.camera.right = s;
    sun.shadow.camera.top = s;
    sun.shadow.camera.bottom = -s;
    sun.shadow.camera.near = 10;
    sun.shadow.camera.far = 140;
    sun.shadow.bias = -0.0003;
    sun.shadow.normalBias = 0.02;
    this.scene.add(sun);

    // 空からの拡散光(青みがかった影を演出)
    const hemi = new THREE.HemisphereLight(0xbdd7f0, 0x54663f, 0.5);
    this.scene.add(hemi);
  }

  // --- 後処理(ブルーム: 窓明かりや街路灯がにじむ) ---
  initPostprocessing() {
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    const bloom = new UnrealBloomPass(
      new THREE.Vector2(this.container.clientWidth, this.container.clientHeight),
      0.35,  // strength
      0.5,   // radius
      0.88   // threshold(高輝度のみ)
    );
    this.composer.addPass(bloom);
    this.composer.addPass(new OutputPass());
  }

  // --- 地面・遠景 ---
  initGround() {
    const size = this.map.size;

    // 市街地の地面
    const grass = makeGrassTexture();
    grass.repeat.set(size / 3, size / 3);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshStandardMaterial({ map: grass, roughness: 1.0 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // 郊外の平原
    const outerGrass = makeGrassTexture();
    outerGrass.repeat.set(60, 60);
    const outer = new THREE.Mesh(
      new THREE.PlaneGeometry(500, 500),
      new THREE.MeshStandardMaterial({ map: outerGrass, color: 0xb9c4a8, roughness: 1.0 })
    );
    outer.rotation.x = -Math.PI / 2;
    outer.position.y = -0.02;
    outer.receiveShadow = true;
    this.scene.add(outer);

    // 郊外の畑(パッチワーク)と防風林
    const rnd = mulberry32(4242);
    const fieldColors = [0xa8b06a, 0x8fa15b, 0xc2b478, 0x7f9e59];
    for (let i = 0; i < 26; i++) {
      const fw = 3 + rnd() * 5, fd = 2 + rnd() * 4;
      const ang = rnd() * Math.PI * 2;
      const dist = size * 0.75 + rnd() * 22;
      const field = new THREE.Mesh(
        new THREE.PlaneGeometry(fw, fd),
        new THREE.MeshStandardMaterial({ color: fieldColors[i % 4], roughness: 1 })
      );
      field.rotation.x = -Math.PI / 2;
      field.position.set(Math.cos(ang) * dist, -0.01, Math.sin(ang) * dist);
      field.receiveShadow = true;
      this.scene.add(field);
    }
    // 郊外に点在する樹木
    for (let i = 0; i < 60; i++) {
      const ang = rnd() * Math.PI * 2;
      const dist = size * 0.72 + rnd() * 26;
      const tree = this.buildTree(0.5 + rnd() * 0.7, rnd() < 0.5);
      tree.position.set(Math.cos(ang) * dist, 0, Math.sin(ang) * dist);
      this.scene.add(tree);
    }

    // 北側の山脈(岩肌と残雪つき・多層)
    for (let layer = 0; layer < 2; layer++) {
      for (let i = 0; i < 10; i++) {
        const hgt = (3 + rnd() * 4.5) * (layer === 0 ? 1 : 1.6);
        const rad = 2.5 + rnd() * 3;
        const mtn = new THREE.Mesh(
          new THREE.ConeGeometry(rad, hgt, 7 + Math.floor(rnd() * 3)),
          rnd() < 0.35 ? MAT.rock : MAT.mountain
        );
        mtn.position.set(
          -size / 2 + i * (size / 9) + (rnd() - 0.5) * 3,
          hgt / 2 - 0.05,
          -size / 2 - 4 - layer * 7 - rnd() * 3
        );
        mtn.castShadow = layer === 0;
        this.scene.add(mtn);
        // 高い山には雪帽子
        if (hgt > 5.5) {
          const cap = new THREE.Mesh(new THREE.ConeGeometry(rad * 0.35, hgt * 0.3, 7), MAT.snow);
          cap.position.copy(mtn.position);
          cap.position.y = hgt - hgt * 0.15;
          this.scene.add(cap);
        }
      }
    }

    // ホバーハイライト
    this.hoverMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(CELL * 0.98, CELL * 0.98),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.28, depthWrite: false })
    );
    this.hoverMesh.rotation.x = -Math.PI / 2;
    this.hoverMesh.position.y = 0.05;
    this.hoverMesh.visible = false;
    this.scene.add(this.hoverMesh);
  }

  // --- 流れる雲 ---
  initClouds() {
    const rnd = mulberry32(777);
    for (let i = 0; i < 7; i++) {
      const cloud = new THREE.Group();
      const puffs = 3 + Math.floor(rnd() * 3);
      for (let p = 0; p < puffs; p++) {
        const r = 0.9 + rnd() * 1.6;
        const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), MAT.cloud);
        puff.position.set(p * 1.3 - puffs * 0.6 + rnd(), rnd() * 0.5, rnd() * 1.2 - 0.6);
        puff.scale.y = 0.5;
        cloud.add(puff);
      }
      cloud.position.set(rnd() * 70 - 35, 14 + rnd() * 6, rnd() * 60 - 30);
      cloud.userData.speed = 0.12 + rnd() * 0.2;
      this.clouds.push(cloud);
      this.scene.add(cloud);
    }
  }

  // --- マウスピッキング ---
  initPicking() {
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
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

    el.addEventListener('pointerdown', (e) => { downPos = { x: e.clientX, y: e.clientY }; });
    el.addEventListener('pointerup', (e) => {
      if (!downPos) return;
      const moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
      downPos = null;
      if (moved > 5) return;
      const cell = this.pickCell(e);
      if (cell && this.onCellClick) this.onCellClick(cell.x, cell.y);
    });
  }

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

  cellToWorld(x, y) {
    const size = this.map.size;
    return { x: x - size / 2 + 0.5, z: y - size / 2 + 0.5 };
  }

  // --- シーン全体の構築 ---
  buildScene() {
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
    this.carsDirty = true;
  }

  // --- 個別セルの更新 ---
  updateCell(x, y, animate = true) {
    const old = this.cellGroups[y]?.[x];
    if (old) this.scene.remove(old);

    const cell = this.map.grid[y][x];
    const group = this.buildCellObject(cell);
    if (!group) {
      this.cellGroups[y][x] = null;
    } else {
      const w = this.cellToWorld(x, y);
      group.position.set(w.x, 0, w.z);
      this.scene.add(group);
      this.cellGroups[y][x] = group;
    }

    // 道路の接続に影響するので周囲を更新+車を再配置
    if (cell.type === BuildingTypes.ROAD || cell.type === BuildingTypes.EMPTY ||
        cell.type === BuildingTypes.BRIDGE) {
      this.refreshRoadNeighbors(x, y);
      this.carsDirty = true;
    }

    if (animate && group && cell.type !== BuildingTypes.EMPTY) {
      group.scale.set(0.01, 0.01, 0.01);
      const t0 = performance.now();
      const pop = () => {
        const t = Math.min((performance.now() - t0) / 260, 1);
        const s = 1 + Math.sin(t * Math.PI) * 0.12;
        const k = Math.max(t * s, 0.01);
        group.scale.set(k, k, k);
        if (t < 1) requestAnimationFrame(pop);
        else group.scale.set(1, 1, 1);
      };
      requestAnimationFrame(pop);
    }
  }

  refreshRoadNeighbors(x, y) {
    for (const n of this.map.getNeighbors(x, y)) {
      if (n.type === BuildingTypes.ROAD || n.type === BuildingTypes.BRIDGE) {
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

  roadMask(x, y) {
    const size = this.map.size;
    const at = (xx, yy) => {
      if (xx < 0 || xx >= size || yy < 0 || yy >= size) return false;
      const t = this.map.grid[yy][xx].type;
      return t === BuildingTypes.ROAD || t === BuildingTypes.BRIDGE;
    };
    let mask = 0;
    if (at(x, y - 1)) mask |= 1;
    if (at(x + 1, y)) mask |= 2;
    if (at(x, y + 1)) mask |= 4;
    if (at(x - 1, y)) mask |= 8;
    return mask;
  }

  // ---------------------------------------------
  // 自動車AI(道路網を実際に走行する)
  // ---------------------------------------------
  rebuildCars() {
    for (const car of this.cars) this.scene.remove(car.mesh);
    this.cars = [];

    // 道路セルを収集
    const roads = [];
    for (let y = 0; y < this.map.size; y++) {
      for (let x = 0; x < this.map.size; x++) {
        const t = this.map.grid[y][x].type;
        if (t === BuildingTypes.ROAD || t === BuildingTypes.BRIDGE) roads.push({ x, y });
      }
    }
    if (roads.length < 4) return;

    const count = Math.min(14, Math.floor(roads.length / 3));
    const rnd = mulberry32(20260708);
    for (let i = 0; i < count; i++) {
      const start = roads[Math.floor(rnd() * roads.length)];
      const dirs = this.roadDirections(start.x, start.y);
      if (dirs.length === 0) continue;
      const dir = dirs[Math.floor(rnd() * dirs.length)];
      const mesh = this.buildCar(CAR_COLORS[i % CAR_COLORS.length]);
      this.scene.add(mesh);
      this.cars.push({
        mesh,
        cx: start.x, cy: start.y,   // 現在のセル
        dir,                         // 進行方向 {dx, dy}
        progress: rnd(),             // セル間の進行度 0-1
        speed: 0.55 + rnd() * 0.35,  // セル/秒
      });
    }
  }

  /** そのセルから走行可能な方向リスト */
  roadDirections(x, y) {
    const dirs = [];
    const size = this.map.size;
    for (const d of [{ dx: 0, dy: -1 }, { dx: 1, dy: 0 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }]) {
      const nx = x + d.dx, ny = y + d.dy;
      if (nx < 0 || nx >= size || ny < 0 || ny >= size) continue;
      const t = this.map.grid[ny][nx].type;
      if (t === BuildingTypes.ROAD || t === BuildingTypes.BRIDGE) dirs.push(d);
    }
    return dirs;
  }

  /** 車の毎フレーム更新 */
  updateCars(dt) {
    for (const car of this.cars) {
      car.progress += car.speed * dt;
      while (car.progress >= 1) {
        car.progress -= 1;
        // 次のセルへ移動
        car.cx += car.dir.dx;
        car.cy += car.dir.dy;
        // 次の方向を選ぶ(直進優先・逆走は行き止まりのみ)
        const options = this.roadDirections(car.cx, car.cy)
          .filter(d => !(d.dx === -car.dir.dx && d.dy === -car.dir.dy));
        if (options.length === 0) {
          car.dir = { dx: -car.dir.dx, dy: -car.dir.dy }; // Uターン
        } else {
          const straight = options.find(d => d.dx === car.dir.dx && d.dy === car.dir.dy);
          car.dir = (straight && Math.random() < 0.65)
            ? straight
            : options[Math.floor(Math.random() * options.length)];
        }
      }
      // 位置の補間(車線は進行方向の左側=日本の左側通行)
      const from = this.cellToWorld(car.cx, car.cy);
      const px = from.x + car.dir.dx * car.progress;
      const pz = from.z + car.dir.dy * car.progress;
      const laneX = car.dir.dy * 0.15;   // 進行方向の左側にオフセット
      const laneZ = -car.dir.dx * 0.15;
      // 橋の上なら高さを上げる
      const gx = Math.round(px + this.map.size / 2 - 0.5);
      const gy = Math.round(pz + this.map.size / 2 - 0.5);
      let h = 0.015;
      if (gx >= 0 && gx < this.map.size && gy >= 0 && gy < this.map.size &&
          this.map.grid[gy][gx].type === BuildingTypes.BRIDGE) {
        h = 0.17;
      }
      car.mesh.position.set(px + laneX, h, pz + laneZ);
      car.mesh.rotation.y = Math.atan2(car.dir.dx, car.dir.dy);
    }
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

  box(w, h, d, mat) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }

  // --- 道路(高精細タイル+街路灯+街路樹) ---
  buildRoad(cell) {
    const g = new THREE.Group();
    const mask = this.roadMask(cell.x, cell.y);
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(CELL, CELL),
      new THREE.MeshStandardMaterial({ map: makeRoadTexture(mask), roughness: 0.92 })
    );
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = 0.012;
    plane.receiveShadow = true;
    g.add(plane);

    const h = (cell.x * 73856093 ^ cell.y * 19349663) >>> 0;
    // 街路灯(数セルおき)
    if (h % 5 === 1) {
      const lamp = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.016, 0.5, 6), MAT.metal);
      pole.position.y = 0.25;
      pole.castShadow = true;
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.16, 6), MAT.metal);
      arm.rotation.z = Math.PI / 2;
      arm.position.set(-0.07, 0.5, 0);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 8), MAT.lampGlow);
      bulb.position.set(-0.14, 0.49, 0);
      lamp.add(pole, arm, bulb);
      lamp.position.set(0.42, 0, 0.42);
      g.add(lamp);
    }
    // 街路樹(歩道の角)
    if (h % 7 === 2) {
      const tree = this.buildTree(0.3, false);
      tree.position.set(-0.4, 0, -0.4);
      g.add(tree);
    }
    return g;
  }

  buildCar(color) {
    const car = new THREE.Group();
    const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.25, metalness: 0.7, envMapIntensity: 1.2 });
    const body = this.box(0.15, 0.05, 0.3, paint);
    body.position.y = 0.055;
    const hood = this.box(0.14, 0.03, 0.08, paint);
    hood.position.set(0, 0.045, 0.16);
    const cabin = this.box(0.13, 0.05, 0.15, MAT.glass);
    cabin.position.set(0, 0.1, -0.02);
    car.add(body, hood, cabin);
    const wheelGeo = new THREE.CylinderGeometry(0.028, 0.028, 0.02, 10);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.9 });
    for (const [wx, wz] of [[-0.075, 0.1], [0.075, 0.1], [-0.075, -0.09], [0.075, -0.09]]) {
      const wl = new THREE.Mesh(wheelGeo, wheelMat);
      wl.rotation.z = Math.PI / 2;
      wl.position.set(wx, 0.028, wz);
      car.add(wl);
    }
    car.traverse(o => { if (o.isMesh) o.castShadow = true; });
    return car;
  }

  // --- 水面(空を反射しゆらめく) ---
  buildWater() {
    const g = new THREE.Group();
    const bed = this.box(CELL, 0.14, CELL, new THREE.MeshStandardMaterial({ color: 0x14405e, roughness: 0.6 }));
    bed.position.y = -0.06;
    bed.castShadow = false;
    g.add(bed);

    const mat = new THREE.MeshStandardMaterial({
      color: 0x2274a8,
      roughness: 0.06,
      metalness: 0.1,
      normalMap: this.waterNormal,
      normalScale: new THREE.Vector2(0.35, 0.35),
      envMapIntensity: 1.5,
      transparent: true,
      opacity: 0.94,
    });
    const surf = new THREE.Mesh(new THREE.PlaneGeometry(CELL, CELL), mat);
    surf.rotation.x = -Math.PI / 2;
    surf.position.y = 0.015;
    surf.receiveShadow = true;
    g.add(surf);
    this.waterMats.push(mat);
    return g;
  }

  // --- 住宅(切妻屋根・煙突・生垣・庭木) ---
  buildHouse(cell) {
    const g = new THREE.Group();
    const h = (cell.x * 2654435761 ^ cell.y * 40503) >>> 0;
    const wall = new THREE.MeshStandardMaterial({ color: new THREE.Color(WALL_COLORS[h % WALL_COLORS.length]), roughness: 0.75 });
    const roofMat = [MAT.roofRed, MAT.roofGray, MAT.roofBrown][h % 3];

    // 庭
    const yard = new THREE.Mesh(
      new THREE.PlaneGeometry(CELL * 0.96, CELL * 0.96),
      new THREE.MeshStandardMaterial({ color: 0x628f4c, roughness: 1 })
    );
    yard.rotation.x = -Math.PI / 2;
    yard.position.y = 0.008;
    yard.receiveShadow = true;
    g.add(yard);

    // 生垣(敷地の縁)
    const hedgeMat = MAT.leafDark;
    for (const [px, pz, w, d] of [[0, -0.46, 0.9, 0.05], [-0.46, 0, 0.05, 0.9]]) {
      const hedge = this.box(w, 0.08, d, hedgeMat);
      hedge.position.set(px, 0.04, pz);
      g.add(hedge);
    }

    // 母屋
    const bw = 0.5, bh = 0.28, bd = 0.42;
    const body = this.box(bw, bh, bd, wall);
    body.position.y = bh / 2;
    g.add(body);

    // 切妻屋根(プリズム)
    const roofShape = new THREE.Shape();
    roofShape.moveTo(-bw / 2 - 0.05, 0);
    roofShape.lineTo(bw / 2 + 0.05, 0);
    roofShape.lineTo(0, 0.18);
    roofShape.closePath();
    const roofGeo = new THREE.ExtrudeGeometry(roofShape, { depth: bd + 0.08, bevelEnabled: false });
    const roof = new THREE.Mesh(roofGeo, roofMat);
    roof.position.set(0, bh, -(bd + 0.08) / 2);
    roof.castShadow = true;
    g.add(roof);

    // 煙突
    if (h % 3 === 0) {
      const chimney = this.box(0.06, 0.16, 0.06, MAT.concreteDark);
      chimney.position.set(bw * 0.25, bh + 0.12, -bd * 0.15);
      g.add(chimney);
    }

    // ドアと窓
    const door = this.box(0.09, 0.14, 0.02, MAT.roofBrown);
    door.position.set(0.1, 0.07, bd / 2 + 0.005);
    g.add(door);
    for (const wx of [-0.14, -0.02]) {
      const win = this.box(0.08, 0.08, 0.02, MAT.glass);
      win.position.set(wx, 0.16, bd / 2 + 0.005);
      g.add(win);
    }

    // 庭木
    const tree = this.buildTree(0.3 + (h % 10) / 45, h % 2 === 0);
    tree.position.set(0.33, 0, -0.28);
    g.add(tree);

    g.rotation.y = ((h % 4) * Math.PI) / 2;
    return g;
  }

  // --- 商業ビル(窓明かり付き / 高層はガラスタワー) ---
  buildCommercial(cell) {
    const g = new THREE.Group();
    const h = (cell.x * 83492791 ^ cell.y * 297121507) >>> 0;
    const floors = 3 + (h % 6);          // 3〜8階
    const bh = floors * 0.22;
    const bw = 0.62, bd = 0.62;
    const isGlassTower = floors >= 7;

    if (isGlassTower) {
      // カーテンウォールのガラスタワー(空を反射)
      const body = this.box(bw, bh, bd, MAT.glassTower);
      body.position.y = bh / 2;
      g.add(body);
      // マリオン(縦の桟)
      for (let i = 0; i <= 4; i++) {
        const mull = this.box(0.012, bh, 0.012, MAT.metal);
        mull.position.set(-bw / 2 + (bw / 4) * i, bh / 2, bd / 2 + 0.005);
        g.add(mull);
      }
      // アンテナ
      const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.012, 0.3, 6), MAT.metal);
      ant.position.set(0.1, bh + 0.15, 0.1);
      ant.castShadow = true;
      g.add(ant);
    } else {
      // 窓明かりのオフィス/商業ビル
      const cacheKey = h % 6;
      if (!this.facadeCache[cacheKey]) {
        const bases = ['#7d8a94', '#8d8478', '#6d7a88', '#93867a', '#7a8894', '#847d72'];
        this.facadeCache[cacheKey] = makeFacadeTextures(bases[cacheKey], 4, 12, h, 0.28);
      }
      const { diff, emis } = this.facadeCache[cacheKey];
      const sideMat = new THREE.MeshStandardMaterial({
        map: diff, emissiveMap: emis, emissive: 0xffffff, emissiveIntensity: 0.4, roughness: 0.55,
      });
      const mats = [sideMat, sideMat, MAT.roofDark, MAT.roofDark, sideMat, sideMat];
      const body = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), mats);
      body.castShadow = true;
      body.receiveShadow = true;
      body.position.y = bh / 2;
      g.add(body);

      // 屋上: 給水塔と室外機
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.12, 10), MAT.concrete);
      tank.position.set(-0.15, bh + 0.06, -0.12);
      tank.castShadow = true;
      g.add(tank);
      const ac = this.box(0.15, 0.07, 0.11, MAT.concreteDark);
      ac.position.set(0.14, bh + 0.035, 0.1);
      g.add(ac);

      // 1階の店舗ひさし
      const awning = this.box(bw + 0.06, 0.03, 0.13, [MAT.red, MAT.orange, MAT.green][h % 3]);
      awning.position.set(0, 0.24, bd / 2 + 0.06);
      g.add(awning);
    }
    return g;
  }

  // --- 工業(のこぎり屋根工場+煙突+タンク) ---
  buildIndustrial() {
    const g = new THREE.Group();
    const body = this.box(0.78, 0.32, 0.58, MAT.concreteDark);
    body.position.y = 0.16;
    g.add(body);
    for (let i = 0; i < 3; i++) {
      const saw = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.12, 4), MAT.roofGray);
      saw.rotation.y = Math.PI / 4;
      saw.scale.z = 2.0;
      saw.position.set(-0.24 + i * 0.24, 0.38, 0);
      saw.castShadow = true;
      g.add(saw);
    }
    for (const px of [0.28, 0.17]) {
      const chimney = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.042, 0.55, 10), MAT.concrete);
      chimney.position.set(px, 0.55, -0.2);
      chimney.castShadow = true;
      g.add(chimney);
      // 赤白の帯
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.036, 0.06, 10), MAT.red);
      band.position.set(px, 0.72, -0.2);
      g.add(band);
    }
    // 貯蔵タンク
    const tankBody = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.2, 12), MAT.metal);
    tankBody.position.set(-0.3, 0.1, 0.28);
    tankBody.castShadow = true;
    g.add(tankBody);
    return g;
  }

  // --- 公園(池・遊歩道・多彩な樹木) ---
  buildPark() {
    const g = new THREE.Group();
    const lawn = new THREE.Mesh(
      new THREE.PlaneGeometry(CELL * 0.98, CELL * 0.98),
      new THREE.MeshStandardMaterial({ color: 0x5c9a48, roughness: 1 })
    );
    lawn.rotation.x = -Math.PI / 2;
    lawn.position.y = 0.01;
    lawn.receiveShadow = true;
    g.add(lawn);

    // 遊歩道
    const path = new THREE.Mesh(
      new THREE.PlaneGeometry(0.16, CELL * 0.9),
      new THREE.MeshStandardMaterial({ color: 0xc7b494, roughness: 1 })
    );
    path.rotation.x = -Math.PI / 2;
    path.rotation.z = 0.5;
    path.position.y = 0.014;
    g.add(path);

    // 小さな池
    const pondMat = new THREE.MeshStandardMaterial({
      color: 0x2b7cb0, roughness: 0.08, normalMap: this.waterNormal,
      normalScale: new THREE.Vector2(0.25, 0.25), envMapIntensity: 1.4,
    });
    const pond = new THREE.Mesh(new THREE.CircleGeometry(0.18, 20), pondMat);
    pond.rotation.x = -Math.PI / 2;
    pond.position.set(0.22, 0.016, 0.2);
    g.add(pond);
    this.waterMats.push(pondMat);

    const spots = [[-0.3, -0.28], [0.32, -0.22], [-0.24, 0.3], [0.05, -0.02], [-0.02, 0.36]];
    spots.forEach(([px, pz], i) => {
      const tree = this.buildTree(0.36 + (i % 3) * 0.09, i % 2 === 0);
      tree.position.set(px, 0, pz);
      g.add(tree);
    });

    const bench = this.box(0.14, 0.03, 0.05, MAT.roofBrown);
    bench.position.set(0.1, 0.05, -0.38);
    g.add(bench);
    return g;
  }

  /** 樹木(針葉樹 or 広葉樹・複数の葉ブロブで有機的に) */
  buildTree(height, conifer) {
    const t = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.034, height * 0.42, 6), MAT.trunk);
    trunk.position.y = height * 0.21;
    trunk.castShadow = true;
    t.add(trunk);
    if (conifer) {
      for (let i = 0; i < 3; i++) {
        const cone = new THREE.Mesh(
          new THREE.ConeGeometry(0.15 - i * 0.04, height * 0.4, 7),
          i === 0 ? MAT.leafDark : (i === 1 ? MAT.leaf : MAT.leafLight)
        );
        cone.position.y = height * (0.4 + i * 0.22);
        cone.castShadow = true;
        t.add(cone);
      }
    } else {
      const blobs = [[0, height * 0.62, 0, 0.3], [0.08, height * 0.56, 0.05, 0.22], [-0.09, height * 0.58, -0.04, 0.2]];
      blobs.forEach(([bx, by, bz, br], i) => {
        const crown = new THREE.Mesh(
          new THREE.IcosahedronGeometry(height * br, 1),
          i === 0 ? MAT.leaf : (i === 1 ? MAT.leafLight : MAT.leafDark)
        );
        crown.position.set(bx, by, bz);
        crown.castShadow = true;
        t.add(crown);
      });
    }
    return t;
  }

  // --- 病院 ---
  buildHospital() {
    const g = new THREE.Group();
    const body = this.box(0.7, 0.66, 0.56, MAT.white);
    body.position.y = 0.33;
    g.add(body);
    const wing = this.box(0.3, 0.4, 0.68, MAT.white);
    wing.position.set(0.32, 0.2, 0);
    g.add(wing);
    // 窓の帯(横連窓)
    for (let f = 0; f < 3; f++) {
      const band = this.box(0.72, 0.07, 0.57, MAT.glass);
      band.position.y = 0.18 + f * 0.18;
      band.castShadow = false;
      g.add(band);
    }
    // 屋上ヘリポート
    const helipad = new THREE.Mesh(
      new THREE.CircleGeometry(0.16, 20),
      new THREE.MeshStandardMaterial({ map: makeCrossTexture('#3a4046', '#f2f2f2'), roughness: 0.8 })
    );
    helipad.rotation.x = -Math.PI / 2;
    helipad.position.y = 0.665;
    g.add(helipad);
    // 正面の赤十字看板
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(0.14, 0.14),
      new THREE.MeshStandardMaterial({
        map: makeCrossTexture('#ffffff', '#c62828'),
        emissiveMap: makeCrossTexture('#000000', '#ff5a4e'),
        emissive: 0xffffff, emissiveIntensity: 0.8, roughness: 0.5,
      })
    );
    sign.position.set(0, 0.52, 0.285);
    g.add(sign);
    return g;
  }

  // --- 学校 ---
  buildSchool() {
    const g = new THREE.Group();
    const yard = new THREE.Mesh(
      new THREE.PlaneGeometry(CELL * 0.96, CELL * 0.96),
      new THREE.MeshStandardMaterial({ color: 0xc2a87e, roughness: 1 })
    );
    yard.rotation.x = -Math.PI / 2;
    yard.position.y = 0.008;
    yard.receiveShadow = true;
    g.add(yard);

    const body = this.box(0.8, 0.34, 0.26, MAT.tan);
    body.position.set(0, 0.17, -0.3);
    g.add(body);
    // 窓の列
    for (let i = 0; i < 4; i++) {
      const win = this.box(0.12, 0.1, 0.02, MAT.glass);
      win.position.set(-0.27 + i * 0.18, 0.2, -0.16);
      win.castShadow = false;
      g.add(win);
    }
    // 時計塔
    const tower = this.box(0.12, 0.52, 0.12, MAT.white);
    tower.position.set(0, 0.26, -0.3);
    g.add(tower);
    const towerRoof = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.1, 4), MAT.roofRed);
    towerRoof.rotation.y = Math.PI / 4;
    towerRoof.position.set(0, 0.57, -0.3);
    towerRoof.castShadow = true;
    g.add(towerRoof);
    // 校庭の白線トラック
    const track = new THREE.Mesh(
      new THREE.RingGeometry(0.14, 0.15, 24),
      new THREE.MeshStandardMaterial({ color: 0xf0f0e8, roughness: 1 })
    );
    track.rotation.x = -Math.PI / 2;
    track.position.set(0, 0.012, 0.15);
    g.add(track);
    return g;
  }

  // --- 消防署 ---
  buildFireStation() {
    const g = new THREE.Group();
    const body = this.box(0.66, 0.38, 0.54, MAT.red);
    body.position.y = 0.19;
    g.add(body);
    const stripe = this.box(0.68, 0.06, 0.56, MAT.white);
    stripe.position.y = 0.29;
    g.add(stripe);
    for (const px of [-0.15, 0.15]) {
      const doorM = this.box(0.2, 0.19, 0.02, MAT.metal);
      doorM.position.set(px, 0.105, 0.275);
      g.add(doorM);
    }
    // 望楼
    const towr = this.box(0.1, 0.3, 0.1, MAT.red);
    towr.position.set(-0.24, 0.53, -0.18);
    g.add(towr);
    const truck = this.buildCar(0xc62828);
    truck.position.set(0.15, 0, 0.42);
    g.add(truck);
    return g;
  }

  // --- 駅 ---
  buildStation() {
    const g = new THREE.Group();
    const platform = this.box(0.9, 0.08, 0.46, MAT.concrete);
    platform.position.set(0, 0.04, 0.22);
    g.add(platform);
    // 線路(バラスト+レール)
    const ballast = this.box(0.98, 0.03, 0.2, MAT.rail);
    ballast.position.set(0, 0.015, -0.28);
    g.add(ballast);
    for (const pz of [-0.34, -0.22]) {
      const railBar = this.box(0.98, 0.012, 0.012, MAT.metal);
      railBar.position.set(0, 0.036, pz);
      g.add(railBar);
    }
    // 駅舎
    const body = this.box(0.58, 0.28, 0.28, MAT.white);
    body.position.set(0, 0.22, 0.28);
    g.add(body);
    // 大屋根
    const roof = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.22, 0.92, 14, 1, false, 0, Math.PI),
      MAT.orange
    );
    roof.rotation.z = Math.PI / 2;
    roof.position.set(0, 0.4, 0.12);
    roof.castShadow = true;
    g.add(roof);
    // 停車中の電車
    const trainMat = new THREE.MeshStandardMaterial({ color: 0x2a7f62, roughness: 0.3, metalness: 0.5, envMapIntensity: 1.2 });
    const train = this.box(0.82, 0.13, 0.13, trainMat);
    train.position.set(0, 0.1, -0.28);
    g.add(train);
    // 車両の窓
    for (let i = 0; i < 5; i++) {
      const win = this.box(0.1, 0.05, 0.005, MAT.glass);
      win.position.set(-0.3 + i * 0.15, 0.12, -0.21);
      win.castShadow = false;
      g.add(win);
    }
    return g;
  }

  // --- バス停 ---
  buildBusStop() {
    const g = new THREE.Group();
    const pad = new THREE.Mesh(
      new THREE.PlaneGeometry(0.6, 0.4),
      new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 1 })
    );
    pad.rotation.x = -Math.PI / 2;
    pad.position.y = 0.01;
    pad.receiveShadow = true;
    g.add(pad);
    const roof = this.box(0.4, 0.02, 0.2, MAT.glass);
    roof.position.set(0, 0.28, 0);
    g.add(roof);
    for (const px of [-0.18, 0.18]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.28, 6), MAT.metal);
      pole.position.set(px, 0.14, -0.08);
      g.add(pole);
    }
    const bench = this.box(0.3, 0.02, 0.08, MAT.roofBrown);
    bench.position.set(0, 0.1, -0.05);
    g.add(bench);
    const sign = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.36, 6), MAT.metal);
    sign.position.set(0.26, 0.18, 0.12);
    g.add(sign);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.015, 14), MAT.orange);
    disc.rotation.x = Math.PI / 2;
    disc.position.set(0.26, 0.38, 0.12);
    g.add(disc);
    return g;
  }

  // --- 橋梁 ---
  buildBridge(cell) {
    const g = new THREE.Group();
    const water = this.buildWater();
    g.add(water);

    const mask = this.roadMask(cell.x, cell.y);
    const ew = mask === 10 || mask === 2 || mask === 8;

    const deck = this.box(CELL, 0.05, 0.58, MAT.concrete);
    deck.position.y = 0.14;
    g.add(deck);
    const surf = new THREE.Mesh(
      new THREE.PlaneGeometry(CELL, 0.48),
      new THREE.MeshStandardMaterial({ map: makeRoadTexture(10), roughness: 0.92 })
    );
    surf.rotation.x = -Math.PI / 2;
    surf.position.y = 0.17;
    g.add(surf);
    // 欄干(支柱つき)
    for (const pz of [-0.27, 0.27]) {
      const rail = this.box(CELL, 0.025, 0.02, MAT.metal);
      rail.position.set(0, 0.26, pz);
      g.add(rail);
      for (let i = 0; i < 5; i++) {
        const post = this.box(0.015, 0.09, 0.015, MAT.metal);
        post.position.set(-0.4 + i * 0.2, 0.21, pz);
        g.add(post);
      }
    }
    for (const px of [-0.3, 0.3]) {
      const pier = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.07, 0.25, 10), MAT.concreteDark);
      pier.position.set(px, 0.0, 0);
      g.add(pier);
    }
    if (!ew) g.rotation.y = Math.PI / 2;
    return g;
  }

  // --- 堤防 ---
  buildLevee() {
    const g = new THREE.Group();
    const bank = new THREE.Mesh(
      new THREE.CylinderGeometry(0.26, 0.44, CELL * 0.98, 4, 1),
      MAT.levee
    );
    bank.rotation.z = Math.PI / 2;
    bank.rotation.x = Math.PI / 4;
    bank.scale.set(1, 1, 0.5);
    bank.castShadow = true;
    bank.receiveShadow = true;
    g.add(bank);
    const top = this.box(CELL * 0.98, 0.02, 0.15, MAT.concrete);
    top.position.y = 0.2;
    g.add(top);
    return g;
  }

  // --- 調整池 ---
  buildRetentionBasin() {
    const g = new THREE.Group();
    const rim = 0.08;
    for (const [px, pz, w, d] of [
      [0, -0.45, CELL * 0.95, rim], [0, 0.45, CELL * 0.95, rim],
      [-0.45, 0, rim, CELL * 0.95], [0.45, 0, rim, CELL * 0.95],
    ]) {
      const wall = this.box(w, 0.12, d, MAT.concrete);
      wall.position.set(px, 0.06, pz);
      g.add(wall);
    }
    const mat = new THREE.MeshStandardMaterial({
      color: 0x24688f, roughness: 0.08, normalMap: this.waterNormal,
      normalScale: new THREE.Vector2(0.3, 0.3), envMapIntensity: 1.4,
    });
    const pond = new THREE.Mesh(new THREE.PlaneGeometry(0.82, 0.82), mat);
    pond.rotation.x = -Math.PI / 2;
    pond.position.y = 0.02;
    g.add(pond);
    this.waterMats.push(mat);
    return g;
  }

  // --- 避難所 ---
  buildShelter() {
    const g = new THREE.Group();
    const body = this.box(0.68, 0.32, 0.54, MAT.concrete);
    body.position.y = 0.16;
    g.add(body);
    const roof = this.box(0.72, 0.05, 0.58, MAT.green);
    roof.position.y = 0.35;
    g.add(roof);
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(0.15, 0.15),
      new THREE.MeshStandardMaterial({ map: makeCrossTexture('#ffffff', '#2e7d32'), roughness: 0.6 })
    );
    sign.position.set(0, 0.2, 0.275);
    g.add(sign);
    // 太陽光パネル(防災設備)
    const panel = this.box(0.24, 0.01, 0.16, MAT.glassTower);
    panel.rotation.x = -0.3;
    panel.position.set(0.15, 0.4, 0);
    g.add(panel);
    return g;
  }

  // --- 防災公園 ---
  buildDisasterPark() {
    const g = this.buildPark();
    const tent = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.17, 4), MAT.tent);
    tent.rotation.y = Math.PI / 4;
    tent.position.set(-0.08, 0.085, 0.08);
    tent.castShadow = true;
    g.add(tent);
    const store = this.box(0.2, 0.13, 0.15, MAT.concreteDark);
    store.position.set(0.32, 0.065, -0.05);
    g.add(store);
    return g;
  }

  // ---------------------------------------------
  // ハザードマップオーバーレイ
  // ---------------------------------------------
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
      plane.position.set(w.x, 0.6, w.z);
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
    const dt = Math.min(this.clock.getDelta(), 0.1);
    const t = this.clock.elapsedTime;

    // 水面: 法線マップをスクロールしてゆらめかせる
    this.waterNormal.offset.x = t * 0.02;
    this.waterNormal.offset.y = t * 0.013;

    // 雲の流れ
    for (const cloud of this.clouds) {
      cloud.position.x += cloud.userData.speed * dt;
      if (cloud.position.x > 45) cloud.position.x = -45;
    }

    // 自動車の走行
    if (this.carsDirty) {
      this.carsDirty = false;
      this.rebuildCars();
    }
    this.updateCars(dt);

    this.controls.update();
    this.composer.render();
  }
}

export { Renderer3D };
