/* ============================================
   transportation.js - 交通シミュレーション
   道路接続判定・渋滞・道路評価・交通利便性
   ============================================ */

import { BuildingTypes } from './data.js';

// 交通インフラとして扱うセルタイプ
const ROAD_LIKE = [BuildingTypes.ROAD, BuildingTypes.BRIDGE];

class Transportation {
  constructor(map) {
    this.map = map;
    this.congestion = 0;        // 渋滞度 0-100
    this.transportScore = 0;    // 交通利便性 0-100
    this.roadRating = 'E';      // 道路網評価
    this.trafficMap = [];       // セルごとの交通量
    this.networkCount = 0;      // 道路ネットワーク数（分断されているほど多い）
  }

  // セルが道路系かどうか
  isRoadLike(cell) {
    return ROAD_LIKE.includes(cell.type);
  }

  // ターンごとの交通シミュレーション実行
  processTurn(population) {
    this.analyzeNetwork();
    this.calculateTraffic(population);
    this.calculateTransportScore();
    this.evaluateRoads();
    return {
      congestion: this.congestion,
      transportScore: this.transportScore,
      roadRating: this.roadRating,
    };
  }

  // 道路ネットワークの連結成分を分析（BFS）
  analyzeNetwork() {
    const visited = new Set();
    let networks = 0;

    for (let y = 0; y < this.map.size; y++) {
      for (let x = 0; x < this.map.size; x++) {
        const cell = this.map.grid[y][x];
        const key = `${x},${y}`;
        if (this.isRoadLike(cell) && !visited.has(key)) {
          networks++;
          // BFSでこのネットワーク全体を訪問
          const queue = [{ x, y }];
          visited.add(key);
          while (queue.length > 0) {
            const pos = queue.shift();
            for (const n of this.map.getNeighbors(pos.x, pos.y)) {
              const nKey = `${n.x},${n.y}`;
              if (this.isRoadLike(n) && !visited.has(nKey)) {
                visited.add(nKey);
                queue.push({ x: n.x, y: n.y });
              }
            }
          }
        }
      }
    }
    this.networkCount = networks;
  }

  // 交通量と渋滞の計算
  // 各道路セルの交通量 = 隣接する建物の発生交通量の合計
  calculateTraffic(population) {
    const size = this.map.size;
    this.trafficMap = Array.from({ length: size }, () => new Array(size).fill(0));

    let totalRoads = 0;
    let congestedRoads = 0;

    // 建物ごとの発生交通量（人口・雇用ベース）
    const tripGeneration = {
      [BuildingTypes.RESIDENTIAL]: 10,
      [BuildingTypes.COMMERCIAL]: 15,
      [BuildingTypes.INDUSTRIAL]: 20,
      [BuildingTypes.HOSPITAL]: 8,
      [BuildingTypes.SCHOOL]: 8,
      [BuildingTypes.STATION]: -15,  // 駅は自動車交通を削減
      [BuildingTypes.BUS_STOP]: -5,  // バス停も削減
    };

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const cell = this.map.grid[y][x];
        if (!this.isRoadLike(cell)) continue;
        totalRoads++;

        // 隣接建物からの交通量を集計
        let traffic = 0;
        for (const n of this.map.getNeighbors(x, y)) {
          const gen = tripGeneration[n.type];
          if (gen) traffic += gen;
        }
        traffic = Math.max(0, traffic);

        // 道路の老朽化で容量低下
        const capacity = cell.age >= 40 ? 20 : 30;
        this.trafficMap[y][x] = traffic;

        if (traffic > capacity) congestedRoads++;
      }
    }

    // 渋滞度 = 渋滞道路の割合
    this.congestion = totalRoads > 0
      ? Math.round((congestedRoads / totalRoads) * 100)
      : 0;
  }

  // 交通利便性スコアの計算
  // 住宅から道路・駅・バス停へのアクセスで評価
  calculateTransportScore() {
    let score = 0;
    let residentialCount = 0;
    const counts = this.map.getBuildingCounts();

    for (let y = 0; y < this.map.size; y++) {
      for (let x = 0; x < this.map.size; x++) {
        const cell = this.map.grid[y][x];
        if (cell.type !== BuildingTypes.RESIDENTIAL) continue;
        residentialCount++;

        let cellScore = 0;
        // 道路接続で基礎点
        if (this.map.isAdjacentToRoad(x, y)) cellScore += 40;
        // 駅・バス停への近接（半径3セル以内）
        if (this.hasNearby(x, y, BuildingTypes.STATION, 3)) cellScore += 40;
        if (this.hasNearby(x, y, BuildingTypes.BUS_STOP, 2)) cellScore += 20;

        score += Math.min(100, cellScore);
      }
    }

    let avg = residentialCount > 0 ? score / residentialCount : 0;

    // ネットワーク分断ペナルティ
    if (this.networkCount > 1) {
      avg -= (this.networkCount - 1) * 5;
    }
    // 渋滞ペナルティ
    avg -= this.congestion * 0.2;

    this.transportScore = Math.max(0, Math.min(100, Math.round(avg)));
  }

  // 指定タイプの建物が半径内にあるか
  hasNearby(x, y, type, radius) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= this.map.size || ny < 0 || ny >= this.map.size) continue;
        if (Math.abs(dx) + Math.abs(dy) > radius) continue; // マンハッタン距離
        if (this.map.grid[ny][nx].type === type) return true;
      }
    }
    return false;
  }

  // 道路網の総合評価（S〜E）
  evaluateRoads() {
    let points = 0;
    // 交通利便性が高い
    points += this.transportScore * 0.5;
    // 渋滞が少ない
    points += (100 - this.congestion) * 0.3;
    // ネットワークが一体化している
    points += this.networkCount <= 1 ? 20 : Math.max(0, 20 - (this.networkCount - 1) * 5);

    if (points >= 90) this.roadRating = 'S';
    else if (points >= 75) this.roadRating = 'A';
    else if (points >= 60) this.roadRating = 'B';
    else if (points >= 45) this.roadRating = 'C';
    else if (points >= 30) this.roadRating = 'D';
    else this.roadRating = 'E';
  }

  // 橋梁の状態チェック（老朽化警告用）
  getAgingBridges() {
    const bridges = [];
    for (let y = 0; y < this.map.size; y++) {
      for (let x = 0; x < this.map.size; x++) {
        const cell = this.map.grid[y][x];
        if (cell.type === BuildingTypes.BRIDGE && cell.age >= 30) {
          bridges.push({ x, y, age: cell.age });
        }
      }
    }
    return bridges;
  }
}

export { Transportation };
