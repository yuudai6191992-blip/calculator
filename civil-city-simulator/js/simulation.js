/* ============================================
   simulation.js - シミュレーションエンジン
   ターン進行・人口・幸福度・KPIの計算
   ============================================ */

import { BuildingTypes, BuildingData, GameConfig, GameEvents } from './data.js';

class Simulation {
  constructor(map, economy) {
    this.map = map;
    this.economy = economy;
    this.turn = 0;
    this.population = 0;
    this.happiness = GameConfig.BASE_HAPPINESS;
    this.co2 = 0;
    this.totalInvestment = 0;
    this.totalMaintenancePaid = 0;
    this.onEvent = null; // イベント発生時のコールバック
    this.kpi = {}; // 最新KPIキャッシュ
  }

  // 1ターン進行
  nextTurn(extras = {}) {
    this.turn++;
    this.map.ageBuildings();

    // 人口計算
    this.calculatePopulation(extras);

    // 経済計算
    const { income, maintenance } = this.economy.processTurn(this.map, this.population);
    this.totalMaintenancePaid += maintenance;

    // 幸福度計算
    this.calculateHappiness(extras);

    // CO2計算
    this.calculateCO2();

    // 地価計算
    this.economy.calculateLandValue(this.map);

    // ランダムイベント判定
    this.checkEvents();

    // KPI更新
    this.updateKPI(extras);

    return { income, maintenance };
  }

  // 人口計算：住宅数 × 収容人数 × 環境係数
  calculatePopulation(extras = {}) {
    const counts = this.map.getBuildingCounts();
    const residentialCount = counts[BuildingTypes.RESIDENTIAL];
    const basePopulation = residentialCount * BuildingData[BuildingTypes.RESIDENTIAL].population;

    // 幸福度が高いほど定住率が上がる（0.5〜1.5倍）
    const happinessFactor = 0.5 + this.happiness / 100;

    // 交通利便性ボーナス（Phase 2以降）
    const transportBonus = extras.transportScore ? 1 + extras.transportScore / 200 : 1;

    this.population = Math.floor(basePopulation * happinessFactor * transportBonus);
  }

  // 幸福度計算
  calculateHappiness(extras = {}) {
    let happiness = GameConfig.BASE_HAPPINESS;
    const counts = this.map.getBuildingCounts();

    // 各建物の幸福度効果
    for (const [type, count] of Object.entries(counts)) {
      const data = BuildingData[type];
      if (data && data.happiness) {
        happiness += data.happiness * count * 0.5;
      }
    }

    // 住宅が道路に接続されていないとペナルティ
    let unconnected = 0;
    for (let y = 0; y < this.map.size; y++) {
      for (let x = 0; x < this.map.size; x++) {
        const cell = this.map.grid[y][x];
        if (cell.type === BuildingTypes.RESIDENTIAL && !this.map.isAdjacentToRoad(x, y)) {
          unconnected++;
        }
      }
    }
    happiness -= unconnected * 3;

    // 財政悪化ペナルティ
    if (this.economy.budget < 0) happiness -= 10;

    // 渋滞ペナルティ（Phase 2）
    if (extras.congestion) happiness -= extras.congestion * 0.3;

    // 災害リスクペナルティ（Phase 5）
    if (extras.disasterRisk) happiness -= extras.disasterRisk * 0.1;

    this.happiness = Math.max(0, Math.min(100, Math.round(happiness)));
  }

  // CO2排出量の計算
  calculateCO2() {
    let co2 = 0;
    const counts = this.map.getBuildingCounts();
    for (const [type, count] of Object.entries(counts)) {
      const data = BuildingData[type];
      if (data && data.co2) co2 += data.co2 * count;
    }
    // 人口による排出
    co2 += Math.floor(this.population * 0.1);
    // 公園による吸収
    co2 -= counts[BuildingTypes.PARK] * 2;
    co2 -= (counts[BuildingTypes.DISASTER_PARK] || 0) * 2;
    this.co2 = Math.max(0, co2);
  }

  // 老朽化率の計算（30ターン以上経過した建物の割合）
  calculateAgingRate() {
    let aged = 0;
    let total = 0;
    for (let y = 0; y < this.map.size; y++) {
      for (let x = 0; x < this.map.size; x++) {
        const cell = this.map.grid[y][x];
        if (cell.type === BuildingTypes.EMPTY || cell.type === BuildingTypes.WATER) continue;
        total++;
        if (cell.age >= 30) aged++;
      }
    }
    return total > 0 ? Math.round((aged / total) * 100) : 0;
  }

  // 公共施設充足率（人口に対する公共施設数）
  calculatePublicFacilityRate() {
    const counts = this.map.getBuildingCounts();
    const publicCount =
      (counts[BuildingTypes.HOSPITAL] || 0) +
      (counts[BuildingTypes.SCHOOL] || 0) +
      (counts[BuildingTypes.FIRE_STATION] || 0) +
      (counts[BuildingTypes.SHELTER] || 0);
    if (this.population === 0) return 100;
    // 人口100人あたり1施設で100%
    const required = Math.max(1, Math.ceil(this.population / 100));
    return Math.min(100, Math.round((publicCount / required) * 100));
  }

  // ランダムイベントの判定と発火
  checkEvents() {
    const counts = this.map.getBuildingCounts();
    const state = {
      happiness: this.happiness,
      budget: this.economy.budget,
      population: this.population,
      commercialCount: counts[BuildingTypes.COMMERCIAL],
      parkCount: counts[BuildingTypes.PARK],
      roadCount: counts[BuildingTypes.ROAD],
    };

    for (const event of GameEvents) {
      if (Math.random() < event.probability && event.condition(state)) {
        // 効果を適用
        if (event.effect.population) this.population += event.effect.population;
        if (event.effect.happiness) {
          this.happiness = Math.max(0, Math.min(100, this.happiness + event.effect.happiness));
        }
        if (event.effect.budget) this.economy.budget += event.effect.budget;

        if (this.onEvent) {
          this.onEvent(event);
        }
        break; // 1ターンに1イベントまで
      }
    }
  }

  // KPIの一括更新
  updateKPI(extras = {}) {
    this.kpi = {
      turn: this.turn,
      population: this.population,
      budget: Math.floor(this.economy.budget),
      income: this.economy.lastIncome,
      expense: this.economy.lastExpense,
      happiness: this.happiness,
      co2: this.co2,
      maintenance: this.economy.totalMaintenance,
      landValue: this.economy.landValue,
      economicEffect: Math.floor(this.economy.economicEffect),
      bc: this.economy.calculateBC(this.totalInvestment, this.totalMaintenancePaid),
      agingRate: this.calculateAgingRate(),
      publicFacilityRate: this.calculatePublicFacilityRate(),
      transportScore: extras.transportScore ?? 0,
      congestion: extras.congestion ?? 0,
      disasterRisk: extras.disasterRisk ?? 0,
      floodRisk: extras.floodRisk ?? 0,
      landslideRisk: extras.landslideRisk ?? 0,
    };
    return this.kpi;
  }

  serialize() {
    return {
      turn: this.turn,
      population: this.population,
      happiness: this.happiness,
      co2: this.co2,
      totalInvestment: this.totalInvestment,
      totalMaintenancePaid: this.totalMaintenancePaid,
    };
  }

  deserialize(data) {
    this.turn = data.turn ?? 0;
    this.population = data.population ?? 0;
    this.happiness = data.happiness ?? GameConfig.BASE_HAPPINESS;
    this.co2 = data.co2 ?? 0;
    this.totalInvestment = data.totalInvestment ?? 0;
    this.totalMaintenancePaid = data.totalMaintenancePaid ?? 0;
  }
}

export { Simulation };
