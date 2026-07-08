/* ============================================
   map.js - マップシステム
   20×20グリッドの管理・描画・操作
   ============================================ */

import { BuildingTypes, BuildingData, GameConfig } from './data.js';

class GameMap {
  constructor(size = GameConfig.MAP_SIZE) {
    this.size = size;
    this.grid = [];
    this.selectedTool = null;
    this.onCellClick = null;
    this.hoveredCell = null;
    this.init();
  }

  // マップの初期化
  init() {
    this.grid = Array.from({ length: this.size }, (_, y) =>
      Array.from({ length: this.size }, (_, x) => ({
        x,
        y,
        type: BuildingTypes.EMPTY,
        age: 0,
        level: 1,
      }))
    );
  }

  // マップの描画(3Dレンダラーに委譲)
  // this.renderer は main.js で Renderer3D が代入される
  render() {
    if (this.renderer) {
      this.renderer.buildScene();
    }
  }

  // セルクリック処理(レンダラーから呼ばれる)
  handleCellClick(x, y) {
    if (this.onCellClick) {
      this.onCellClick(x, y, this.selectedTool);
    }
  }

  // セルホバー処理(レンダラーから呼ばれる)
  handleCellHover(x, y) {
    this.hoveredCell = { x, y };
    const cell = this.grid[y][x];
    const coordsEl = document.querySelector('.map-coords');
    if (coordsEl) {
      let info = `(${x}, ${y})`;
      if (cell.type !== BuildingTypes.EMPTY) {
        const data = BuildingData[cell.type];
        if (data) {
          info += ` ${data.name}`;
        }
      }
      coordsEl.textContent = info;
    }
  }

  // セルに建物を配置
  placeBuilding(x, y, type) {
    if (x < 0 || x >= this.size || y < 0 || y >= this.size) return false;

    const cell = this.grid[y][x];

    if (type === 'demolish') {
      if (cell.type === BuildingTypes.EMPTY) return false;
      cell.type = BuildingTypes.EMPTY;
      cell.age = 0;
      cell.level = 1;
      this.updateCell(x, y);
      return true;
    }

    if (cell.type !== BuildingTypes.EMPTY) return false;

    cell.type = type;
    cell.age = 0;
    cell.level = 1;
    this.updateCell(x, y);
    return true;
  }

  // 個別セルの3D表示更新
  updateCell(x, y) {
    if (this.renderer) {
      this.renderer.updateCell(x, y);
    }
  }

  // マップ上の建物カウント
  countBuildings(type) {
    let count = 0;
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        if (this.grid[y][x].type === type) count++;
      }
    }
    return count;
  }

  // 全建物のカウントを取得
  getBuildingCounts() {
    const counts = {};
    for (const type of Object.values(BuildingTypes)) {
      counts[type] = 0;
    }
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        counts[this.grid[y][x].type]++;
      }
    }
    return counts;
  }

  // 隣接セルを取得
  getNeighbors(x, y) {
    const neighbors = [];
    const directions = [
      { dx: 0, dy: -1 },
      { dx: 1, dy: 0 },
      { dx: 0, dy: 1 },
      { dx: -1, dy: 0 },
    ];
    for (const { dx, dy } of directions) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && nx < this.size && ny >= 0 && ny < this.size) {
        neighbors.push(this.grid[ny][nx]);
      }
    }
    return neighbors;
  }

  // 道路接続判定（BFS）
  isConnectedByRoad(x1, y1, x2, y2) {
    if (this.grid[y1][x1].type !== BuildingTypes.ROAD ||
        this.grid[y2][x2].type !== BuildingTypes.ROAD) {
      return false;
    }

    const visited = new Set();
    const queue = [{ x: x1, y: y1 }];
    visited.add(`${x1},${y1}`);

    while (queue.length > 0) {
      const { x, y } = queue.shift();
      if (x === x2 && y === y2) return true;

      for (const neighbor of this.getNeighbors(x, y)) {
        const key = `${neighbor.x},${neighbor.y}`;
        if (!visited.has(key) && neighbor.type === BuildingTypes.ROAD) {
          visited.add(key);
          queue.push({ x: neighbor.x, y: neighbor.y });
        }
      }
    }
    return false;
  }

  // 道路に隣接しているか判定
  isAdjacentToRoad(x, y) {
    return this.getNeighbors(x, y).some(n => n.type === BuildingTypes.ROAD);
  }

  // 建物の老朽化を進行
  ageBuildings() {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        const cell = this.grid[y][x];
        if (cell.type !== BuildingTypes.EMPTY) {
          cell.age++;
        }
      }
    }
  }

  // マップデータのシリアライズ
  serialize() {
    return {
      size: this.size,
      grid: this.grid.map(row =>
        row.map(cell => ({
          type: cell.type,
          age: cell.age,
          level: cell.level,
        }))
      ),
    };
  }

  // マップデータのデシリアライズ
  deserialize(data) {
    this.size = data.size;
    this.grid = data.grid.map((row, y) =>
      row.map((cell, x) => ({
        x,
        y,
        type: cell.type,
        age: cell.age || 0,
        level: cell.level || 1,
      }))
    );
  }
}

export { GameMap };
