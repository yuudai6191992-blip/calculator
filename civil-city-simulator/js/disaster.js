/* ============================================
   disaster.js - 防災シミュレーション
   豪雨・洪水・地震・土砂災害・避難所・ハザードマップ
   ============================================ */

import { BuildingTypes, BuildingData } from './data.js';

class Disaster {
  constructor(map) {
    this.map = map;
    this.disasterRisk = 0;    // 総合災害リスク 0-100
    this.floodRisk = 0;       // 浸水リスク 0-100
    this.landslideRisk = 0;   // 土砂災害リスク 0-100
    this.shelterCoverage = 0; // 避難所カバー率 0-100
    this.hazardMode = false;  // ハザードマップ表示モード
    this.lastDisaster = null;
    this.onDisaster = null;   // 災害発生時コールバック
  }

  // ターンごとのリスク計算と災害判定
  processTurn(turn) {
    this.calculateFloodRisk();
    this.calculateLandslideRisk();
    this.calculateShelterCoverage();
    this.calculateTotalRisk();

    // 10ターン目以降、確率で災害発生
    if (turn >= 10) {
      this.rollDisaster(turn);
    }

    return {
      disasterRisk: this.disasterRisk,
      floodRisk: this.floodRisk,
      landslideRisk: this.landslideRisk,
      shelterCoverage: this.shelterCoverage,
    };
  }

  // 浸水リスク：川の近くに堤防・調整池がないと高リスク
  calculateFloodRisk() {
    let riskCells = 0;
    let exposedCells = 0;
    const counts = this.map.getBuildingCounts();

    for (let y = 0; y < this.map.size; y++) {
      for (let x = 0; x < this.map.size; x++) {
        const cell = this.map.grid[y][x];
        if (cell.type === BuildingTypes.EMPTY || cell.type === BuildingTypes.WATER) continue;

        // 川から2セル以内は浸水想定区域
        if (this.isNearWater(x, y, 2)) {
          exposedCells++;
          // 堤防が近くにあればリスク軽減
          const hasLevee = this.hasNearby(x, y, BuildingTypes.LEVEE, 2);
          if (!hasLevee) riskCells++;
        }
      }
    }

    let risk = exposedCells > 0 ? (riskCells / Math.max(1, exposedCells)) * 80 : 0;
    // 調整池でマップ全体のリスク軽減（1つにつき-8%）
    risk -= (counts[BuildingTypes.RETENTION_BASIN] || 0) * 8;
    this.floodRisk = Math.max(0, Math.min(100, Math.round(risk * (exposedCells > 0 ? 1 : 0))));
  }

  // 土砂災害リスク：マップ端（山地想定）の開発密度で計算
  calculateLandslideRisk() {
    let developed = 0;
    let total = 0;
    // マップの上端2行を山地エリアと想定
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < this.map.size; x++) {
        const cell = this.map.grid[y][x];
        total++;
        if (cell.type !== BuildingTypes.EMPTY &&
            cell.type !== BuildingTypes.WATER &&
            cell.type !== BuildingTypes.PARK &&
            cell.type !== BuildingTypes.DISASTER_PARK) {
          developed++;
        }
      }
    }
    this.landslideRisk = Math.round((developed / total) * 100);
  }

  // 避難所カバー率：住宅から4セル以内に避難所・防災公園があるか
  calculateShelterCoverage() {
    let covered = 0;
    let total = 0;
    for (let y = 0; y < this.map.size; y++) {
      for (let x = 0; x < this.map.size; x++) {
        const cell = this.map.grid[y][x];
        if (cell.type !== BuildingTypes.RESIDENTIAL) continue;
        total++;
        if (this.hasNearby(x, y, BuildingTypes.SHELTER, 4) ||
            this.hasNearby(x, y, BuildingTypes.DISASTER_PARK, 4) ||
            this.hasNearby(x, y, BuildingTypes.SCHOOL, 4)) {
          covered++;
        }
      }
    }
    this.shelterCoverage = total > 0 ? Math.round((covered / total) * 100) : 100;
  }

  // 総合災害リスク
  calculateTotalRisk() {
    const risk =
      this.floodRisk * 0.4 +
      this.landslideRisk * 0.25 +
      (100 - this.shelterCoverage) * 0.35;
    this.disasterRisk = Math.round(risk);
  }

  // 災害発生判定
  rollDisaster(turn) {
    const roll = Math.random();

    // 豪雨（洪水）: 浸水リスクが高いほど被害大
    if (roll < 0.04) {
      this.triggerFlood();
    }
    // 地震: ランダム発生、老朽建物が被害
    else if (roll < 0.06) {
      this.triggerEarthquake();
    }
    // 土砂災害: 山地開発が進んでいると発生
    else if (roll < 0.08 && this.landslideRisk > 40) {
      this.triggerLandslide();
    }
  }

  // 洪水の発生：川の近くの無防備な建物を破壊
  triggerFlood() {
    const damaged = [];
    for (let y = 0; y < this.map.size; y++) {
      for (let x = 0; x < this.map.size; x++) {
        const cell = this.map.grid[y][x];
        if (cell.type === BuildingTypes.EMPTY ||
            cell.type === BuildingTypes.WATER ||
            cell.type === BuildingTypes.LEVEE) continue;

        if (this.isNearWater(x, y, 2) &&
            !this.hasNearby(x, y, BuildingTypes.LEVEE, 2)) {
          // 浸水リスクに応じた確率で被害
          if (Math.random() < this.floodRisk / 150) {
            damaged.push({ x, y, type: cell.type });
            cell.type = BuildingTypes.EMPTY;
            cell.age = 0;
            this.map.updateCell(x, y);
          }
        }
      }
    }

    this.lastDisaster = { type: 'flood', name: '豪雨・洪水', damaged: damaged.length };
    if (this.onDisaster) this.onDisaster(this.lastDisaster);
  }

  // 地震の発生：老朽化した建物ほど倒壊しやすい
  triggerEarthquake() {
    const damaged = [];
    for (let y = 0; y < this.map.size; y++) {
      for (let x = 0; x < this.map.size; x++) {
        const cell = this.map.grid[y][x];
        if (cell.type === BuildingTypes.EMPTY || cell.type === BuildingTypes.WATER) continue;

        // 老朽化度に応じた倒壊確率
        const collapseChance = Math.min(cell.age * 0.005, 0.3);
        if (Math.random() < collapseChance) {
          damaged.push({ x, y, type: cell.type });
          cell.type = BuildingTypes.EMPTY;
          cell.age = 0;
          this.map.updateCell(x, y);
        }
      }
    }

    this.lastDisaster = { type: 'earthquake', name: '地震', damaged: damaged.length };
    if (this.onDisaster) this.onDisaster(this.lastDisaster);
  }

  // 土砂災害の発生：山地エリア（上端2行）の建物が被害
  triggerLandslide() {
    const damaged = [];
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < this.map.size; x++) {
        const cell = this.map.grid[y][x];
        if (cell.type === BuildingTypes.EMPTY || cell.type === BuildingTypes.WATER) continue;
        if (Math.random() < 0.3) {
          damaged.push({ x, y, type: cell.type });
          cell.type = BuildingTypes.EMPTY;
          cell.age = 0;
          this.map.updateCell(x, y);
        }
      }
    }

    this.lastDisaster = { type: 'landslide', name: '土砂災害', damaged: damaged.length };
    if (this.onDisaster) this.onDisaster(this.lastDisaster);
  }

  // ハザードマップの表示切替
  toggleHazardMap() {
    this.hazardMode = !this.hazardMode;
    this.renderHazardOverlay();
    return this.hazardMode;
  }

  // ハザードマップのオーバーレイ描画
  renderHazardOverlay() {
    for (let y = 0; y < this.map.size; y++) {
      for (let x = 0; x < this.map.size; x++) {
        const cellEl = document.querySelector(`.cell[data-x="${x}"][data-y="${y}"]`);
        if (!cellEl) continue;

        if (this.hazardMode) {
          const cell = this.map.grid[y][x];
          if (cell.type === BuildingTypes.WATER) continue;

          // 浸水想定区域（川から2セル以内・堤防なし）
          if (this.isNearWater(x, y, 2) && !this.hasNearby(x, y, BuildingTypes.LEVEE, 2)) {
            cellEl.style.boxShadow = 'inset 0 0 0 100px rgba(41, 182, 246, 0.45)';
          }
          // 土砂災害警戒区域（上端2行）
          else if (y < 2) {
            cellEl.style.boxShadow = 'inset 0 0 0 100px rgba(255, 193, 7, 0.45)';
          } else {
            cellEl.style.boxShadow = '';
          }
        } else {
          cellEl.style.boxShadow = '';
        }
      }
    }
  }

  // ユーティリティ：水域が半径内にあるか
  isNearWater(x, y, radius) {
    return this.hasNearby(x, y, BuildingTypes.WATER, radius);
  }

  // ユーティリティ：指定タイプが半径内にあるか（マンハッタン距離）
  hasNearby(x, y, type, radius) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.abs(dx) + Math.abs(dy) > radius) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= this.map.size || ny < 0 || ny >= this.map.size) continue;
        if (this.map.grid[ny][nx].type === type) return true;
      }
    }
    return false;
  }
}

export { Disaster };
