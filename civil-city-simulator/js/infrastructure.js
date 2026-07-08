/* ============================================
   infrastructure.js - 土木インフラシミュレーション
   河川・堤防・調整池・上下水道・老朽化・LCC
   ============================================ */

import { BuildingTypes, BuildingData } from './data.js';

class Infrastructure {
  constructor(map) {
    this.map = map;
    this.waterSupplyRate = 100;   // 上下水道普及率
    this.agingRate = 0;           // インフラ老朽化率
    this.lccTotal = 0;            // LCC累計（建設費+維持費+更新費）
    this.renewalCostEstimate = 0; // 更新費見積り
  }

  // 河川を生成（マップに川を配置）
  generateRiver() {
    const size = this.map.size;
    // 縦方向に蛇行する川を生成
    let riverX = Math.floor(size * 0.65);
    for (let y = 0; y < size; y++) {
      // 蛇行（-1, 0, +1のランダムシフト）
      const shift = Math.floor(Math.random() * 3) - 1;
      riverX = Math.max(2, Math.min(size - 3, riverX + shift));
      this.map.grid[y][riverX].type = BuildingTypes.WATER;
      // 川幅を2セルにする箇所
      if (y % 3 === 0 && riverX + 1 < size) {
        this.map.grid[y][riverX + 1].type = BuildingTypes.WATER;
      }
    }
  }

  // ターンごとのインフラ処理
  processTurn() {
    this.calculateWaterSupply();
    this.calculateAging();
    this.estimateRenewalCost();
    return {
      waterSupplyRate: this.waterSupplyRate,
      agingRate: this.agingRate,
      renewalCostEstimate: this.renewalCostEstimate,
    };
  }

  // 上下水道普及率（道路沿いの建物は水道管が通っている想定）
  calculateWaterSupply() {
    let supplied = 0;
    let total = 0;
    for (let y = 0; y < this.map.size; y++) {
      for (let x = 0; x < this.map.size; x++) {
        const cell = this.map.grid[y][x];
        if (cell.type === BuildingTypes.RESIDENTIAL ||
            cell.type === BuildingTypes.COMMERCIAL ||
            cell.type === BuildingTypes.INDUSTRIAL) {
          total++;
          if (this.map.isAdjacentToRoad(x, y)) supplied++;
        }
      }
    }
    this.waterSupplyRate = total > 0 ? Math.round((supplied / total) * 100) : 100;
  }

  // インフラ（道路・橋梁・堤防など）の老朽化率
  calculateAging() {
    const infraTypes = [
      BuildingTypes.ROAD,
      BuildingTypes.BRIDGE,
      BuildingTypes.LEVEE,
      BuildingTypes.RETENTION_BASIN,
    ];
    let aged = 0;
    let total = 0;
    for (let y = 0; y < this.map.size; y++) {
      for (let x = 0; x < this.map.size; x++) {
        const cell = this.map.grid[y][x];
        if (infraTypes.includes(cell.type)) {
          total++;
          if (cell.age >= 30) aged++;
        }
      }
    }
    this.agingRate = total > 0 ? Math.round((aged / total) * 100) : 0;
  }

  // 更新費の見積り（老朽化した施設の再建設費合計）
  estimateRenewalCost() {
    let cost = 0;
    for (let y = 0; y < this.map.size; y++) {
      for (let x = 0; x < this.map.size; x++) {
        const cell = this.map.grid[y][x];
        if (cell.type === BuildingTypes.EMPTY || cell.type === BuildingTypes.WATER) continue;
        if (cell.age >= 30) {
          const data = BuildingData[cell.type];
          if (data) cost += Math.floor(data.cost * 0.7); // 更新費は新設の7割
        }
      }
    }
    this.renewalCostEstimate = cost;
  }

  // 施設の更新（老朽化リセット）
  renewFacility(x, y, economy) {
    const cell = this.map.grid[y][x];
    if (cell.type === BuildingTypes.EMPTY || cell.type === BuildingTypes.WATER) return false;
    if (cell.age < 30) return false;

    const data = BuildingData[cell.type];
    const cost = Math.floor(data.cost * 0.7);
    if (!economy.pay(cost)) return false;

    cell.age = 0;
    this.lccTotal += cost;
    this.map.updateCell(x, y);
    return true;
  }

  // LCC（ライフサイクルコスト）分析レポート
  getLCCReport(totalInvestment, totalMaintenancePaid) {
    return {
      construction: totalInvestment,
      maintenance: totalMaintenancePaid,
      renewal: this.lccTotal,
      total: totalInvestment + totalMaintenancePaid + this.lccTotal,
    };
  }

  // 川沿いのセルに堤防があるかチェック（洪水リスク計算用）
  getUnprotectedRiverCells() {
    const unprotected = [];
    for (let y = 0; y < this.map.size; y++) {
      for (let x = 0; x < this.map.size; x++) {
        const cell = this.map.grid[y][x];
        if (cell.type !== BuildingTypes.WATER) continue;
        // 川の隣接セルに堤防がなければ無防備
        for (const n of this.map.getNeighbors(x, y)) {
          if (n.type !== BuildingTypes.WATER &&
              n.type !== BuildingTypes.LEVEE &&
              n.type !== BuildingTypes.EMPTY) {
            const hasLevee = this.map.getNeighbors(n.x, n.y)
              .some(nn => nn.type === BuildingTypes.LEVEE);
            if (!hasLevee) {
              unprotected.push({ x: n.x, y: n.y });
            }
          }
        }
      }
    }
    return unprotected;
  }
}

export { Infrastructure };
