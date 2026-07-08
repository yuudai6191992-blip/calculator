/* ============================================
   ai.js - 都市診断AI
   KPIとマップを分析してアドバイスを生成
   建設コンサルタントの視点で都市を診断
   ============================================ */

import { BuildingTypes } from './data.js';

class CityAI {
  constructor(map) {
    this.map = map;
  }

  // 都市を診断してアドバイスリストを生成
  diagnose(kpi, extras = {}) {
    const advice = [];
    const counts = this.map.getBuildingCounts();

    // --- 財政診断 ---
    if (kpi.budget < 0) {
      advice.push('⚠️ 財政が赤字です。商業施設を増やして税収を確保してください。');
    } else if (kpi.budget < 500) {
      advice.push('💰 予算が少なくなっています。支出を抑えて税収の安定化を図りましょう。');
    }
    if (kpi.expense > kpi.income && kpi.income > 0) {
      advice.push('📉 維持管理費が税収を上回っています。PPP/PFI導入による効率化が有効です。');
    }

    // --- 人口・住環境診断 ---
    if (counts[BuildingTypes.RESIDENTIAL] === 0) {
      advice.push('🏠 住宅がありません。まず住宅を建設して人口を確保しましょう。');
    }
    if (kpi.happiness < 40) {
      advice.push('😟 幸福度が低下しています。公園や公共施設の整備を推奨します。');
    }
    if (counts[BuildingTypes.PARK] === 0 && counts[BuildingTypes.RESIDENTIAL] > 3) {
      advice.push('🌳 公園が不足しています。緑地整備で幸福度と地価が向上します。');
    }

    // --- 道路接続診断 ---
    const unconnected = this.countUnconnectedBuildings();
    if (unconnected > 0) {
      advice.push(`🛣️ 道路に接続されていない建物が${unconnected}件あります。道路網の整備が必要です。`);
    }

    // --- 交通診断（Phase 2）---
    if (kpi.congestion > 40) {
      advice.push('🚗 交通量が増えています。駅やバス停の整備で公共交通への転換を図りましょう。');
    }
    if (kpi.transportScore < 40 && counts[BuildingTypes.RESIDENTIAL] > 5) {
      advice.push('🚉 交通利便性が低い状態です。駅の設置を検討してください。');
    }

    // --- インフラ老朽化診断（Phase 3）---
    if (kpi.agingRate > 50) {
      advice.push('🏗️ インフラの老朽化が進行しています。計画的な更新（アセットマネジメント）を推奨します。');
    }
    const agingBridges = this.countAgingBridges();
    if (agingBridges > 0) {
      advice.push(`🌉 老朽化した橋梁が${agingBridges}橋あります。橋梁更新を推奨します。`);
    }

    // --- 公共施設診断 ---
    const facilityAdvice = this.diagnoseFacilityDistribution();
    advice.push(...facilityAdvice);

    // --- 防災診断(Phase 5) ---
    if (kpi.floodRisk > 40) {
      advice.push('🌊 浸水リスクが高い状態です。堤防や調整池の整備を推奨します。');
    }
    if (extras.shelterCoverage !== undefined && extras.shelterCoverage < 50 && kpi.population > 100) {
      advice.push('⛑️ 避難所のカバー率が低い状態です。避難所や防災公園の配置を検討してください。');
    }
    if (kpi.landslideRisk > 50) {
      advice.push('⛰️ 山地の開発が進み土砂災害リスクが上昇しています。北側の開発は慎重に。');
    }

    // --- 環境診断 ---
    if (kpi.co2 > 100) {
      advice.push('🌍 CO2排出量が増加しています。公園の整備や公共交通の充実を推奨します。');
    }

    // --- PPP/PFI提案（Phase 4）---
    if (kpi.maintenance > 200 && counts[BuildingTypes.PARK] >= 3) {
      advice.push('🤝 公園の維持費が増大しています。Park-PFI導入で民間活力の活用が有効です。');
    }
    if (parseFloat(kpi.bc) < 1 && kpi.turn > 20) {
      advice.push('📊 B/Cが1を下回っています。投資効果の高い事業への選択と集中を推奨します。');
    }

    // 問題なしの場合
    if (advice.length === 0) {
      advice.push('✅ 都市は良好な状態です。この調子で計画的なまちづくりを進めましょう。');
    }

    // 最大6件まで表示
    return advice.slice(0, 6);
  }

  // 方角ごとの施設不足診断（「北側は病院不足です」のような診断）
  diagnoseFacilityDistribution() {
    const advice = [];
    const half = Math.floor(this.map.size / 2);
    const regions = {
      '北側': { x0: 0, y0: 0, x1: this.map.size, y1: half },
      '南側': { x0: 0, y0: half, x1: this.map.size, y1: this.map.size },
    };

    for (const [name, r] of Object.entries(regions)) {
      let residential = 0;
      let hospital = 0;
      let school = 0;
      for (let y = r.y0; y < r.y1; y++) {
        for (let x = r.x0; x < r.x1; x++) {
          const t = this.map.grid[y][x].type;
          if (t === BuildingTypes.RESIDENTIAL) residential++;
          if (t === BuildingTypes.HOSPITAL) hospital++;
          if (t === BuildingTypes.SCHOOL) school++;
        }
      }
      // 住宅8軒以上で病院がなければ不足と診断
      if (residential >= 8 && hospital === 0) {
        advice.push(`🏥 ${name}は病院不足です。医療施設の整備を推奨します。`);
      }
      if (residential >= 10 && school === 0) {
        advice.push(`🏫 ${name}に学校がありません。教育施設の配置を検討してください。`);
      }
    }
    return advice;
  }

  // 道路未接続の建物数
  countUnconnectedBuildings() {
    let count = 0;
    const needsRoad = [
      BuildingTypes.RESIDENTIAL,
      BuildingTypes.COMMERCIAL,
      BuildingTypes.INDUSTRIAL,
      BuildingTypes.HOSPITAL,
      BuildingTypes.SCHOOL,
    ];
    for (let y = 0; y < this.map.size; y++) {
      for (let x = 0; x < this.map.size; x++) {
        const cell = this.map.grid[y][x];
        if (needsRoad.includes(cell.type) && !this.map.isAdjacentToRoad(x, y)) {
          count++;
        }
      }
    }
    return count;
  }

  // 老朽化した橋梁の数
  countAgingBridges() {
    let count = 0;
    for (let y = 0; y < this.map.size; y++) {
      for (let x = 0; x < this.map.size; x++) {
        const cell = this.map.grid[y][x];
        if (cell.type === BuildingTypes.BRIDGE && cell.age >= 30) count++;
      }
    }
    return count;
  }
}

export { CityAI };
