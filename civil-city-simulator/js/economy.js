/* ============================================
   economy.js - 経済システム
   予算・税収・維持管理費・地価・経済効果の計算
   ============================================ */

import { BuildingTypes, BuildingData, GameConfig } from './data.js';

class Economy {
  constructor() {
    this.budget = GameConfig.INITIAL_BUDGET;
    this.taxRate = GameConfig.TAX_RATE;
    this.lastIncome = 0;
    this.lastExpense = 0;
    this.totalMaintenance = 0;
    this.landValue = 100; // 平均地価（指数）
    this.economicEffect = 0; // 経済効果（累積）
  }

  // 建設費の支払い（予算不足ならfalse）
  pay(cost) {
    if (this.budget < cost) return false;
    this.budget -= cost;
    return true;
  }

  // 収入を加算
  earn(amount) {
    this.budget += amount;
  }

  // ターンごとの経済計算
  processTurn(map, population) {
    let income = 0;
    let maintenance = 0;

    for (let y = 0; y < map.size; y++) {
      for (let x = 0; x < map.size; x++) {
        const cell = map.grid[y][x];
        if (cell.type === BuildingTypes.EMPTY) continue;
        const data = BuildingData[cell.type];
        if (!data) continue;

        // 税収（商業・工業）
        if (data.taxIncome) {
          income += data.taxIncome;
        }
        // 維持管理費（老朽化するほど増加）
        if (data.maintenance) {
          const ageFactor = 1 + Math.min(cell.age * 0.01, 1.0); // 老朽化で最大2倍
          maintenance += data.maintenance * ageFactor;
        }
      }
    }

    // 住民税（人口 × 税率）
    income += Math.floor(population * this.taxRate * 10);

    maintenance = Math.floor(maintenance);
    this.lastIncome = income;
    this.lastExpense = maintenance;
    this.totalMaintenance = maintenance;
    this.budget += income - maintenance;

    // 経済効果の累積（収入ベース）
    this.economicEffect += income;

    return { income, maintenance };
  }

  // 地価の計算（公園・駅・学校などで上昇）
  calculateLandValue(map) {
    let total = 0;
    let count = 0;
    for (let y = 0; y < map.size; y++) {
      for (let x = 0; x < map.size; x++) {
        const cell = map.grid[y][x];
        if (cell.type === BuildingTypes.EMPTY || cell.type === BuildingTypes.WATER) continue;
        let value = 100;
        // 周辺に地価上昇施設があるか
        for (const n of map.getNeighbors(cell.x, cell.y)) {
          const nData = BuildingData[n.type];
          if (nData && nData.landValue) {
            value += nData.landValue;
          }
        }
        // 老朽化で地価下落
        value -= Math.min(cell.age * 0.5, 30);
        total += value;
        count++;
      }
    }
    this.landValue = count > 0 ? Math.round(total / count) : 100;
    return this.landValue;
  }

  // B/C（費用便益比）の計算
  // 便益 = 経済効果、費用 = 投資額 + 維持管理費累計
  calculateBC(totalInvestment, totalMaintenancePaid) {
    const cost = totalInvestment + totalMaintenancePaid;
    if (cost === 0) return 0;
    return (this.economicEffect / cost).toFixed(2);
  }

  serialize() {
    return {
      budget: this.budget,
      taxRate: this.taxRate,
      economicEffect: this.economicEffect,
      landValue: this.landValue,
    };
  }

  deserialize(data) {
    this.budget = data.budget ?? GameConfig.INITIAL_BUDGET;
    this.taxRate = data.taxRate ?? GameConfig.TAX_RATE;
    this.economicEffect = data.economicEffect ?? 0;
    this.landValue = data.landValue ?? 100;
  }
}

export { Economy };
