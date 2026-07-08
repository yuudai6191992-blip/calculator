/* ============================================
   ui.js - UIシステム
   建設メニュー・KPIパネル・イベントログの管理
   ============================================ */

import { BuildingData, GameConfig } from './data.js';

class UI {
  constructor() {
    this.logEntries = [];
    this.onToolSelect = null;
    this.onNextTurn = null;
    this.onSpeedChange = null;
  }

  // 建設メニューの描画
  renderBuildMenu(availableBuildings, selectedTool) {
    const container = document.getElementById('build-menu');
    container.innerHTML = '';

    // カテゴリごとにグループ化
    const categories = {
      basic: { title: '基本施設', items: [] },
      transport: { title: '交通', items: [] },
      public: { title: '公共施設', items: [] },
      disaster: { title: '防災', items: [] },
      advanced: { title: '産業', items: [] },
    };

    for (const type of availableBuildings) {
      const data = BuildingData[type];
      if (data && categories[data.category]) {
        categories[data.category].items.push({ type, data });
      }
    }

    for (const [key, cat] of Object.entries(categories)) {
      if (cat.items.length === 0) continue;

      const section = document.createElement('div');
      section.className = 'sidebar-section';
      section.innerHTML = `<div class="sidebar-title">${cat.title}</div>`;

      const grid = document.createElement('div');
      grid.className = 'build-grid';

      for (const { type, data } of cat.items) {
        const item = document.createElement('div');
        item.className = `build-item${selectedTool === type ? ' active' : ''}`;
        item.dataset.tool = type;
        item.innerHTML = `
          <div class="build-icon">${data.icon}</div>
          <div class="build-name">${data.name}</div>
          <div class="build-cost">¥${data.cost}M</div>
        `;
        item.addEventListener('click', () => {
          if (this.onToolSelect) this.onToolSelect(type);
        });
        grid.appendChild(item);
      }

      section.appendChild(grid);
      container.appendChild(section);
    }

    // 撤去ツール
    const demolishSection = document.createElement('div');
    demolishSection.className = 'sidebar-section';
    demolishSection.innerHTML = `<div class="sidebar-title">ツール</div>`;
    const demolishGrid = document.createElement('div');
    demolishGrid.className = 'build-grid';
    const demolishItem = document.createElement('div');
    demolishItem.className = `build-item demolish${selectedTool === 'demolish' ? ' active' : ''}`;
    demolishItem.dataset.tool = 'demolish';
    demolishItem.innerHTML = `
      <div class="build-icon">🚧</div>
      <div class="build-name">撤去</div>
      <div class="build-cost">¥10M</div>
    `;
    demolishItem.addEventListener('click', () => {
      if (this.onToolSelect) this.onToolSelect('demolish');
    });
    demolishGrid.appendChild(demolishItem);
    demolishSection.appendChild(demolishGrid);
    container.appendChild(demolishSection);

    // ツール情報表示
    this.renderToolInfo(selectedTool);
  }

  // 選択中ツールの情報表示
  renderToolInfo(selectedTool) {
    const container = document.getElementById('build-menu');
    const existing = container.querySelector('.tool-info');
    if (existing) existing.remove();

    if (!selectedTool || selectedTool === 'demolish') {
      if (selectedTool === 'demolish') {
        const info = document.createElement('div');
        info.className = 'tool-info';
        info.innerHTML = `
          <div class="tool-info-title">🚧 撤去モード</div>
          <div class="tool-info-desc">クリックした建物を撤去します（費用: ¥10M）</div>
        `;
        container.appendChild(info);
      }
      return;
    }

    const data = BuildingData[selectedTool];
    if (!data) return;

    const info = document.createElement('div');
    info.className = 'tool-info';
    info.innerHTML = `
      <div class="tool-info-title">${data.icon} ${data.name}</div>
      <div class="tool-info-desc">
        ${data.description}<br>
        建設費: ¥${data.cost}M / 維持費: ¥${data.maintenance}M/ターン
      </div>
    `;
    container.appendChild(info);
  }

  // ヘッダーの統計表示更新
  updateHeader(kpi) {
    document.getElementById('stat-turn').textContent = kpi.turn;
    document.getElementById('stat-budget').textContent = `¥${kpi.budget.toLocaleString()}M`;
    document.getElementById('stat-population').textContent = kpi.population.toLocaleString();

    // 予算がマイナスなら赤色警告
    const budgetEl = document.getElementById('stat-budget');
    budgetEl.style.color = kpi.budget < 0 ? 'var(--danger)' : '';
  }

  // KPIパネルの更新
  updateKPIPanel(kpi) {
    const container = document.getElementById('kpi-grid');
    const kpiDefs = [
      { label: '人口', value: kpi.population.toLocaleString() + '人', color: 'blue' },
      { label: '幸福度', value: kpi.happiness + '%', color: kpi.happiness >= 60 ? 'green' : kpi.happiness >= 40 ? 'orange' : 'red', bar: kpi.happiness },
      { label: '税収/ターン', value: '¥' + kpi.income.toLocaleString() + 'M', color: 'green' },
      { label: '維持費/ターン', value: '¥' + kpi.expense.toLocaleString() + 'M', color: 'orange' },
      { label: 'CO2排出', value: kpi.co2 + 't', color: kpi.co2 > 100 ? 'red' : 'cyan' },
      { label: '地価指数', value: kpi.landValue, color: 'purple' },
      { label: '老朽化率', value: kpi.agingRate + '%', color: kpi.agingRate > 50 ? 'red' : 'cyan', bar: kpi.agingRate },
      { label: '公共施設充足率', value: kpi.publicFacilityRate + '%', color: kpi.publicFacilityRate >= 60 ? 'green' : 'orange', bar: kpi.publicFacilityRate },
      { label: '交通利便性', value: kpi.transportScore + '点', color: 'blue', bar: kpi.transportScore },
      { label: '渋滞度', value: kpi.congestion + '%', color: kpi.congestion > 50 ? 'red' : 'green', bar: kpi.congestion },
      { label: '災害リスク', value: kpi.disasterRisk + '%', color: kpi.disasterRisk > 50 ? 'red' : 'green', bar: kpi.disasterRisk },
      { label: '浸水リスク', value: kpi.floodRisk + '%', color: kpi.floodRisk > 50 ? 'red' : 'cyan', bar: kpi.floodRisk },
      { label: 'B/C', value: kpi.bc, color: parseFloat(kpi.bc) >= 1 ? 'green' : 'orange' },
      { label: '経済効果', value: '¥' + kpi.economicEffect.toLocaleString() + 'M', color: 'purple' },
    ];

    container.innerHTML = kpiDefs.map(def => `
      <div class="kpi-card ${def.color}">
        <div class="kpi-label">${def.label}</div>
        <div class="kpi-value">${def.value}</div>
        ${def.bar !== undefined ? `
          <div class="progress-bar">
            <div class="progress-fill ${def.color}" style="width: ${Math.min(100, def.bar)}%"></div>
          </div>
        ` : ''}
      </div>
    `).join('');
  }

  // AIアドバイスの表示
  updateAIAdvice(adviceList) {
    const container = document.getElementById('ai-advice-content');
    if (!adviceList || adviceList.length === 0) {
      container.innerHTML = `<div class="ai-advice-text">都市データを分析中です...</div>`;
      return;
    }
    container.innerHTML = `
      <ul class="ai-advice-list">
        ${adviceList.map(a => `<li>${a}</li>`).join('')}
      </ul>
    `;
  }

  // イベントログに追加
  addLog(message, type = 'info') {
    const now = new Date();
    const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

    this.logEntries.unshift({ time, message, type });
    if (this.logEntries.length > GameConfig.MAX_LOG_ENTRIES) {
      this.logEntries.pop();
    }

    const container = document.getElementById('log-entries');
    container.innerHTML = this.logEntries.map(entry => `
      <div class="log-entry ${entry.type}">
        <span class="log-time">${entry.time}</span>
        <span>${entry.message}</span>
      </div>
    `).join('');
  }

  // モーダルの表示
  showModal(title, body, actions = []) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-title">${title}</div>
        <div class="modal-body">${body}</div>
        <div class="modal-actions"></div>
      </div>
    `;

    const actionsEl = overlay.querySelector('.modal-actions');
    if (actions.length === 0) {
      actions = [{ label: 'OK', class: 'btn-primary' }];
    }
    for (const action of actions) {
      const btn = document.createElement('button');
      btn.className = `btn ${action.class || 'btn-primary'}`;
      btn.textContent = action.label;
      btn.addEventListener('click', () => {
        overlay.remove();
        if (action.onClick) action.onClick();
      });
      actionsEl.appendChild(btn);
    }

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });

    document.body.appendChild(overlay);
  }

  // スピードコントロールの初期化
  initSpeedControl() {
    const buttons = document.querySelectorAll('.speed-btn');
    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        buttons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        if (this.onSpeedChange) {
          this.onSpeedChange(btn.dataset.speed);
        }
      });
    });
  }
}

export { UI };
