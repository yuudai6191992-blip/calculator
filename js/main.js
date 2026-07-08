/* ============================================
   main.js - ゲームエントリーポイント
   各モジュールの初期化とゲームループの管理
   ============================================ */

import { BuildingTypes, BuildingData, GameConfig } from './data.js';
import { GameMap } from './map.js';
import { Economy } from './economy.js';
import { Simulation } from './simulation.js';
import { Transportation } from './transportation.js';
import { Infrastructure } from './infrastructure.js';
import { Disaster } from './disaster.js';
import { CityAI } from './ai.js';
import { UI } from './ui.js';

// 使用可能な建物一覧（全Phase解放済み）
const AvailableBuildings = [
  BuildingTypes.RESIDENTIAL,
  BuildingTypes.COMMERCIAL,
  BuildingTypes.ROAD,
  BuildingTypes.PARK,
  BuildingTypes.INDUSTRIAL,
  BuildingTypes.HOSPITAL,
  BuildingTypes.SCHOOL,
  BuildingTypes.FIRE_STATION,
  BuildingTypes.STATION,
  BuildingTypes.BUS_STOP,
  BuildingTypes.BRIDGE,
  BuildingTypes.LEVEE,
  BuildingTypes.RETENTION_BASIN,
  BuildingTypes.SHELTER,
  BuildingTypes.DISASTER_PARK,
];

class Game {
  constructor() {
    // 各モジュールの初期化
    this.map = new GameMap();
    this.economy = new Economy();
    this.simulation = new Simulation(this.map, this.economy);
    this.transportation = new Transportation(this.map);
    this.infrastructure = new Infrastructure(this.map);
    this.disaster = new Disaster(this.map);
    this.ai = new CityAI(this.map);
    this.ui = new UI();

    this.selectedTool = null;
    this.autoPlayTimer = null;
    this.speed = 'pause'; // pause | 1x | 2x

    // 都市計画政策（Phase 4）
    this.policies = {
      parkPFI: false,   // Park-PFI: 公園維持費半減・税収微増
      pppPFI: false,    // PPP/PFI: 公共施設維持費3割減
    };
  }

  // ゲームの初期化
  init() {
    // 河川の生成
    this.infrastructure.generateRiver();

    // マップ描画
    this.map.render();
    this.map.onCellClick = (x, y, tool) => this.handleBuild(x, y, tool);

    // UIイベント設定
    this.ui.onToolSelect = (tool) => this.selectTool(tool);
    this.ui.renderBuildMenu(AvailableBuildings, this.selectedTool);
    this.ui.initSpeedControl();
    this.ui.onSpeedChange = (speed) => this.setSpeed(speed);

    // ターン進行ボタン
    document.getElementById('btn-next-turn').addEventListener('click', () => this.nextTurn());

    // ハザードマップ切替ボタン
    document.getElementById('btn-hazard').addEventListener('click', () => {
      const on = this.disaster.toggleHazardMap();
      this.ui.addLog(on ? 'ハザードマップを表示しました' : 'ハザードマップを非表示にしました', 'system');
    });

    // 政策ボタン（Phase 4: PPP/PFI）
    document.getElementById('btn-policy').addEventListener('click', () => this.showPolicyModal());

    // シミュレーションイベントのコールバック
    this.simulation.onEvent = (event) => {
      this.ui.addLog(`【${event.name}】${event.message}`, 'warning');
    };

    // 災害発生コールバック
    this.disaster.onDisaster = (disaster) => {
      this.ui.addLog(
        `🚨【${disaster.name}】が発生！ ${disaster.damaged}件の建物が被害を受けました。`,
        'danger'
      );
      if (disaster.damaged > 0) {
        this.ui.showModal(
          `🚨 ${disaster.name}が発生しました`,
          `${disaster.damaged}件の建物が被害を受けました。<br>防災インフラ（堤防・調整池・避難所）の整備で被害を軽減できます。`
        );
      }
      this.refreshUI();
    };

    // 初期UI更新
    this.simulation.updateKPI();
    this.refreshUI();

    this.ui.addLog('Civil City Simulator へようこそ！', 'system');
    this.ui.addLog('あなたは建設コンサルタントとして、この街を改善していきます。', 'system');
    this.ui.addLog('まずは道路と住宅を建設してみましょう。', 'info');
  }

  // ツール選択
  selectTool(tool) {
    this.selectedTool = this.selectedTool === tool ? null : tool;
    this.map.selectedTool = this.selectedTool;
    this.ui.renderBuildMenu(AvailableBuildings, this.selectedTool);
  }

  // 建設・撤去処理
  handleBuild(x, y, tool) {
    if (!this.selectedTool) return;

    const cell = this.map.grid[y][x];

    // 撤去
    if (this.selectedTool === 'demolish') {
      if (cell.type === BuildingTypes.EMPTY) return;
      if (cell.type === BuildingTypes.WATER) {
        this.ui.addLog('河川は撤去できません', 'warning');
        return;
      }
      if (!this.economy.pay(10)) {
        this.ui.addLog('予算が不足しています', 'danger');
        return;
      }
      const name = BuildingData[cell.type]?.name || '建物';
      this.map.placeBuilding(x, y, 'demolish');
      this.ui.addLog(`${name}を撤去しました (${x}, ${y})`, 'info');
      this.refreshKPIOnly();
      return;
    }

    // 建設
    const data = BuildingData[this.selectedTool];
    if (!data) return;

    // 水上には橋のみ建設可能
    if (cell.type === BuildingTypes.WATER) {
      if (this.selectedTool !== BuildingTypes.BRIDGE) {
        this.ui.addLog('水域には橋梁のみ建設できます', 'warning');
        return;
      }
      if (!this.economy.pay(data.cost)) {
        this.ui.addLog(`予算不足です（必要: ¥${data.cost}M）`, 'danger');
        return;
      }
      cell.type = BuildingTypes.BRIDGE;
      cell.age = 0;
      this.map.updateCell(x, y);
      this.simulation.totalInvestment += data.cost;
      this.ui.addLog(`🌉 橋梁を建設しました (${x}, ${y})`, 'success');
      this.refreshKPIOnly();
      return;
    }

    // 橋は水上のみ
    if (this.selectedTool === BuildingTypes.BRIDGE) {
      this.ui.addLog('橋梁は水域にのみ建設できます', 'warning');
      return;
    }

    if (cell.type !== BuildingTypes.EMPTY) {
      this.ui.addLog('すでに建物があります。撤去してから建設してください。', 'warning');
      return;
    }

    if (!this.economy.pay(data.cost)) {
      this.ui.addLog(`予算不足です（必要: ¥${data.cost}M / 残高: ¥${Math.floor(this.economy.budget)}M）`, 'danger');
      return;
    }

    this.map.placeBuilding(x, y, this.selectedTool);
    this.simulation.totalInvestment += data.cost;
    this.ui.addLog(`${data.icon} ${data.name}を建設しました (${x}, ${y})`, 'success');
    this.refreshKPIOnly();
  }

  // ターン進行
  nextTurn() {
    // 交通シミュレーション
    const transport = this.transportation.processTurn(this.simulation.population);
    // インフラシミュレーション
    const infra = this.infrastructure.processTurn();
    // 防災シミュレーション
    const disasterResult = this.disaster.processTurn(this.simulation.turn);

    // 政策効果の適用（Phase 4）
    this.applyPolicies();

    // メインシミュレーション
    const extras = {
      transportScore: transport.transportScore,
      congestion: transport.congestion,
      disasterRisk: disasterResult.disasterRisk,
      floodRisk: disasterResult.floodRisk,
      landslideRisk: disasterResult.landslideRisk,
      shelterCoverage: disasterResult.shelterCoverage,
    };
    const { income, maintenance } = this.simulation.nextTurn(extras);

    this.ui.addLog(
      `── ターン${this.simulation.turn} │ 収入 +¥${income}M / 支出 -¥${maintenance}M`,
      'system'
    );

    // 老朽化橋梁の警告
    const agingBridges = this.transportation.getAgingBridges();
    if (agingBridges.length > 0 && this.simulation.turn % 5 === 0) {
      this.ui.addLog(`⚠️ 老朽化した橋梁が${agingBridges.length}橋あります`, 'warning');
    }

    // 破産チェック
    if (this.economy.budget < -1000) {
      this.setSpeed('pause');
      this.ui.showModal(
        '💸 財政破綻の危機',
        '予算が大幅な赤字です。建物の撤去や税収増加策を検討してください。'
      );
    }

    // ハザードマップ表示中なら再描画
    if (this.disaster.hazardMode) {
      this.disaster.renderHazardOverlay();
    }

    this.refreshUI();
  }

  // 政策効果の適用
  applyPolicies() {
    // Park-PFI: 公園の維持費を実質半減（予算に還元）
    if (this.policies.parkPFI) {
      const parks = this.map.countBuildings(BuildingTypes.PARK) +
                    this.map.countBuildings(BuildingTypes.DISASTER_PARK);
      const saving = Math.floor(parks * BuildingData[BuildingTypes.PARK].maintenance * 0.5);
      this.economy.earn(saving);
    }
    // PPP/PFI: 公共施設の維持費3割減
    if (this.policies.pppPFI) {
      const publicTypes = [
        BuildingTypes.HOSPITAL, BuildingTypes.SCHOOL,
        BuildingTypes.FIRE_STATION, BuildingTypes.SHELTER,
      ];
      let saving = 0;
      for (const t of publicTypes) {
        const data = BuildingData[t];
        saving += this.map.countBuildings(t) * data.maintenance * 0.3;
      }
      this.economy.earn(Math.floor(saving));
    }
  }

  // 政策モーダルの表示（Phase 4: PPP/PFI・Park-PFI）
  showPolicyModal() {
    const parkPFIStatus = this.policies.parkPFI ? '✅ 導入済み' : '未導入';
    const pppStatus = this.policies.pppPFI ? '✅ 導入済み' : '未導入';
    this.ui.showModal(
      '🏛️ 都市経営政策（PPP/PFI）',
      `民間活力を導入して公共施設の維持管理を効率化できます。<br><br>
       <b>Park-PFI</b>（${parkPFIStatus}）: 公園の維持費を50%削減<br>
       導入費: ¥300M<br><br>
       <b>PPP/PFI包括委託</b>（${pppStatus}）: 公共施設の維持費を30%削減<br>
       導入費: ¥500M`,
      [
        {
          label: 'Park-PFI導入',
          class: 'btn-success',
          onClick: () => this.adoptPolicy('parkPFI', 300, 'Park-PFI'),
        },
        {
          label: 'PPP/PFI導入',
          class: 'btn-success',
          onClick: () => this.adoptPolicy('pppPFI', 500, 'PPP/PFI包括委託'),
        },
        { label: '閉じる', class: 'btn-icon' },
      ]
    );
  }

  // 政策の導入
  adoptPolicy(key, cost, name) {
    if (this.policies[key]) {
      this.ui.addLog(`${name}はすでに導入済みです`, 'info');
      return;
    }
    if (!this.economy.pay(cost)) {
      this.ui.addLog(`予算不足で${name}を導入できません（必要: ¥${cost}M）`, 'danger');
      return;
    }
    this.policies[key] = true;
    this.ui.addLog(`🤝 ${name}を導入しました！維持管理費が削減されます。`, 'success');
    this.refreshUI();
  }

  // 速度変更（自動ターン進行）
  setSpeed(speed) {
    this.speed = speed;
    if (this.autoPlayTimer) {
      clearInterval(this.autoPlayTimer);
      this.autoPlayTimer = null;
    }
    if (speed === '1x') {
      this.autoPlayTimer = setInterval(() => this.nextTurn(), GameConfig.TURN_INTERVAL);
    } else if (speed === '2x') {
      this.autoPlayTimer = setInterval(() => this.nextTurn(), GameConfig.TURN_INTERVAL / 2);
    }
    // ボタンのアクティブ状態を同期
    document.querySelectorAll('.speed-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.speed === speed);
    });
  }

  // KPIのみ更新（建設直後など）
  refreshKPIOnly() {
    this.simulation.calculatePopulation();
    this.simulation.calculateHappiness();
    this.simulation.updateKPI({
      transportScore: this.transportation.transportScore,
      congestion: this.transportation.congestion,
      disasterRisk: this.disaster.disasterRisk,
      floodRisk: this.disaster.floodRisk,
      landslideRisk: this.disaster.landslideRisk,
    });
    this.refreshUI();
  }

  // UI全体の更新
  refreshUI() {
    const kpi = this.simulation.kpi;
    this.ui.updateHeader(kpi);
    this.ui.updateKPIPanel(kpi);

    // AI診断
    const advice = this.ai.diagnose(kpi, {
      shelterCoverage: this.disaster.shelterCoverage,
    });
    this.ui.updateAIAdvice(advice);
  }
}

// ゲーム起動
document.addEventListener('DOMContentLoaded', () => {
  const game = new Game();
  game.init();
  // デバッグ用にグローバル公開
  window.game = game;
});
