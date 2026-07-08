/* ============================================
   data.js - ゲームデータ定義
   建物タイプ、コスト、効果などの定数
   ============================================ */

// 建物タイプの定義
const BuildingTypes = {
  EMPTY: 'empty',
  RESIDENTIAL: 'residential',
  COMMERCIAL: 'commercial',
  ROAD: 'road',
  PARK: 'park',
  INDUSTRIAL: 'industrial',
  PUBLIC_FACILITY: 'public-facility',
  WATER: 'water',
  BRIDGE: 'bridge',
  STATION: 'station',
  BUS_STOP: 'bus-stop',
  HOSPITAL: 'hospital',
  SCHOOL: 'school',
  FIRE_STATION: 'fire-station',
  LEVEE: 'levee',
  RETENTION_BASIN: 'retention-basin',
  SHELTER: 'shelter',
  DISASTER_PARK: 'disaster-park',
};

// 建物データ
const BuildingData = {
  [BuildingTypes.RESIDENTIAL]: {
    name: '住宅',
    icon: '🏠',
    cost: 100,
    maintenance: 5,
    population: 10,
    happiness: 2,
    description: '住民が暮らす住宅地。人口が増加します。',
    category: 'basic',
  },
  [BuildingTypes.COMMERCIAL]: {
    name: '商業施設',
    icon: '🏪',
    cost: 200,
    maintenance: 10,
    taxIncome: 30,
    happiness: 3,
    jobs: 8,
    description: '税収を生み出す商業エリア。雇用も創出します。',
    category: 'basic',
  },
  [BuildingTypes.ROAD]: {
    name: '道路',
    icon: '🛣️',
    cost: 30,
    maintenance: 2,
    description: '建物同士を接続する道路。交通の基盤です。',
    category: 'basic',
  },
  [BuildingTypes.PARK]: {
    name: '公園',
    icon: '🌳',
    cost: 80,
    maintenance: 3,
    happiness: 5,
    landValue: 10,
    description: '周辺の幸福度と地価を上昇させます。',
    category: 'basic',
  },
  [BuildingTypes.INDUSTRIAL]: {
    name: '工業施設',
    icon: '🏭',
    cost: 300,
    maintenance: 15,
    taxIncome: 50,
    happiness: -3,
    jobs: 15,
    co2: 10,
    description: '高い税収と雇用を生みますが、環境に負荷をかけます。',
    category: 'advanced',
  },
  [BuildingTypes.HOSPITAL]: {
    name: '病院',
    icon: '🏥',
    cost: 500,
    maintenance: 30,
    happiness: 8,
    description: '周辺住民の健康と幸福度を向上させます。',
    category: 'public',
  },
  [BuildingTypes.SCHOOL]: {
    name: '学校',
    icon: '🏫',
    cost: 400,
    maintenance: 25,
    happiness: 6,
    description: '教育レベルを向上させ、地価が上昇します。',
    category: 'public',
  },
  [BuildingTypes.FIRE_STATION]: {
    name: '消防署',
    icon: '🚒',
    cost: 350,
    maintenance: 20,
    happiness: 2,
    description: '災害リスクを軽減します。',
    category: 'public',
  },
  [BuildingTypes.STATION]: {
    name: '駅',
    icon: '🚉',
    cost: 800,
    maintenance: 40,
    happiness: 5,
    landValue: 20,
    description: '交通利便性を大幅に向上させます。',
    category: 'transport',
  },
  [BuildingTypes.BUS_STOP]: {
    name: 'バス停',
    icon: '🚏',
    cost: 100,
    maintenance: 5,
    happiness: 2,
    description: '公共交通のアクセスを改善します。',
    category: 'transport',
  },
  [BuildingTypes.BRIDGE]: {
    name: '橋梁',
    icon: '🌉',
    cost: 500,
    maintenance: 25,
    description: '河川を横断する橋。定期的な維持管理が必要です。',
    category: 'transport',
  },
  [BuildingTypes.LEVEE]: {
    name: '堤防',
    icon: '🧱',
    cost: 200,
    maintenance: 8,
    description: '河川の氾濫から街を守ります。',
    category: 'disaster',
  },
  [BuildingTypes.RETENTION_BASIN]: {
    name: '調整池',
    icon: '💧',
    cost: 400,
    maintenance: 15,
    description: '洪水リスクを軽減する雨水調整施設。',
    category: 'disaster',
  },
  [BuildingTypes.SHELTER]: {
    name: '避難所',
    icon: '⛑️',
    cost: 300,
    maintenance: 10,
    happiness: 1,
    description: '災害時の避難場所。防災力を向上させます。',
    category: 'disaster',
  },
  [BuildingTypes.DISASTER_PARK]: {
    name: '防災公園',
    icon: '🏕️',
    cost: 250,
    maintenance: 8,
    happiness: 4,
    description: '平時は公園、災害時は避難場所として機能します。',
    category: 'disaster',
  },
};

// Phase 1で使用可能な建物
const Phase1Buildings = [
  BuildingTypes.RESIDENTIAL,
  BuildingTypes.COMMERCIAL,
  BuildingTypes.ROAD,
  BuildingTypes.PARK,
];

// ゲーム初期設定
const GameConfig = {
  MAP_SIZE: 20,
  INITIAL_BUDGET: 5000,
  TAX_RATE: 0.1,
  BASE_HAPPINESS: 50,
  TURN_INTERVAL: 3000,
  MAX_LOG_ENTRIES: 50,
};

// イベント定義（Phase 1用）
const GameEvents = [
  {
    id: 'population_boom',
    name: '人口増加',
    message: '住環境の良さが評判を呼び、転入者が増加しました！',
    effect: { population: 20, happiness: 3 },
    probability: 0.1,
    condition: (state) => state.happiness > 60,
  },
  {
    id: 'economic_growth',
    name: '経済成長',
    message: '商業施設の集積効果で経済が成長しています。',
    effect: { budget: 500 },
    probability: 0.08,
    condition: (state) => state.commercialCount > 3,
  },
  {
    id: 'park_festival',
    name: '公園祭り',
    message: '公園で市民フェスティバルが開催され、幸福度が上昇！',
    effect: { happiness: 5 },
    probability: 0.1,
    condition: (state) => state.parkCount > 2,
  },
  {
    id: 'budget_crisis',
    name: '財政危機',
    message: '維持管理費が増大し、財政が圧迫されています。',
    effect: { happiness: -5 },
    probability: 0.05,
    condition: (state) => state.budget < 500,
  },
  {
    id: 'road_deterioration',
    name: '道路劣化',
    message: '一部の道路が劣化しています。修繕が必要です。',
    effect: { happiness: -2, budget: -100 },
    probability: 0.07,
    condition: (state) => state.roadCount > 10,
  },
];

// 評価ランク
const RatingThresholds = {
  S: 90,
  A: 75,
  B: 60,
  C: 45,
  D: 30,
  E: 0,
};

export {
  BuildingTypes,
  BuildingData,
  Phase1Buildings,
  GameConfig,
  GameEvents,
  RatingThresholds,
};
