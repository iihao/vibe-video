export const styles = [
  {
    id: 'cosmos',
    name: '宇宙叙事',
    en: 'COSMIC CINEMA',
    description: '星尘、引力与电影感',
    color: '#edb783',
    category: '科学',
    icon: 'orbit',
  },
  {
    id: 'blueprint',
    name: '理性蓝图',
    en: 'BLUEPRINT',
    description: '网格、线条与精密秩序',
    color: '#91bfdb',
    category: '科技',
    icon: 'grid',
  },
  {
    id: 'editorial',
    name: '复古手札',
    en: 'THE EDITORIAL',
    description: '纸张、墨色与人文温度',
    color: '#d7c69e',
    category: '人文',
    icon: 'book',
  },
  {
    id: 'minimal',
    name: '极简几何',
    en: 'LESS IS MORE',
    description: '克制的形状，清晰的表达',
    color: '#b2c8a2',
    category: '思维',
    icon: 'shapes',
  },
  {
    id: 'pixel',
    name: '像素方格',
    en: 'PIXEL KNOWLEDGE',
    description: '8-bit 方块、复古调色与街机节奏',
    color: '#7de2bd',
    category: '游戏',
    icon: 'pixel',
  },
  {
    id: 'claude',
    name: 'Claude 灵感',
    en: 'CLAUDE-INSPIRED',
    description: 'Claude 风 · 暖纸、陶土橘与清晰留白',
    color: '#c66d4f',
    category: '人文',
    icon: 'book',
  },
];

export const references = [
  {
    title: '从噪声到世界',
    author: 'worlds3',
    category: '科技',
    style: 'blueprint',
    label: 'Canvas · 浏览器导出',
    url: 'https://github.com/worlds3/vibe-knowledge',
    description: '从 GAN 到世界模型，用时间线串起 AI 视觉的演进。',
    takeaway: '借鉴：时间线叙事、BGM 卡点、概念间的形态转场。',
  },
  {
    title: '何时该停下',
    author: 'worlds3',
    category: '思维',
    style: 'minimal',
    label: '最优停止 · 概率',
    url: 'https://github.com/worlds3/vibe-knowledge/tree/main/stop-37',
    description: '把最优停止问题变成一个观众可以在心里作答的选择。',
    takeaway: '借鉴：先提问，再用可视化实验逐步揭晓答案。',
  },
  {
    title: '控制错觉',
    author: 'LuZhong-Li',
    category: '心理',
    style: 'cosmos',
    label: '7 幕结构 · 无旁白',
    url: 'https://github.com/LuZhong-Li/vibe-knowledge-video-skill',
    description: '用金球、骰子和对照实验，把抽象的心理概念变成画面。',
    takeaway: '借鉴：图形先行、留白、标题卡回归与文献片尾。',
  },
  {
    title: '你从未真正「记住」过任何事',
    author: 'xxjj2024',
    category: '科学',
    style: 'editorial',
    label: '记忆再巩固 · 完整案例',
    url: 'https://github.com/xxjj2024/Vibe-Knowledge-Awards-Video-Production',
    description: '从文案、分镜到单 HTML 和成片，公开记录完整制作过程。',
    takeaway: '借鉴：用故事引出机制，把事实来源保留到发布包。',
  },
];

export const defaultConfig = {
  topic: '为什么引力，能让时间变慢？',
  style: 'cosmos',
  duration: 60,
  aspect: '16:9',
  music: 'ambient',
  sfxStyle: 'cinematic',
  references: '',
};

export function makeDemo(config = defaultConfig) {
  const d = config.duration;
  const scenes = [
    {
      title: '你的「一秒」，和别人不一样长。',
      subtitle: '在卫星上的时钟，每天会比地面快 45 微秒。这不是错觉。',
      visual: 'clock',
      art: { kind: 'clock' },
      note: '以"45微秒"这个反直觉数字建立钩子。数值源自 GPS 相对论修正的公开资料。',
      label: '一个反直觉的数字',
    },
    {
      title: '引力越强，时间越慢。',
      subtitle: '靠近大质量天体，时钟走得比远处更慢。',
      visual: 'balance',
      art: { kind: 'balance', left: 0, right: 0, text: '强引力 ↔ 慢时间' },
      note: '用天平表达"引力 vs 时间"的反向关系。画面是概念示意。',
      label: '认识引力时间膨胀',
    },
    {
      title: '不是钟坏了，是时空弯了。',
      subtitle: '质量让时空凹陷，时间也随之被拉伸。',
      visual: 'grid',
      note: '用下陷网格解释时空曲率；网格仅为二维类比。',
      label: '看见背后的机制',
    },
    {
      title: '你的导航，每天都在修正时间。',
      subtitle: 'GPS 卫星必须同时计入引力与速度的两种相对论修正。',
      visual: 'orbits',
      note: '用卫星轨道把抽象理论落到生活。',
      label: '它就在你手机里',
    },
    {
      title: '我们共享宇宙，各自经历时间。',
      subtitle: '时间不是背景，它本身就是宇宙故事的一部分。',
      visual: 'particles',
      note: '星尘聚合，回到主题，留出阅读与思考的时间。',
      label: '带走一个新视角',
    },
  ].map((s, i) => ({ ...s, id: `scene-${i + 1}`, start: (d * i) / 5, end: (d * (i + 1)) / 5 }));
  return {
    id: 'demo-gravity',
    title: '时间，并不平等。',
    topic: defaultConfig.topic,
    ...config,
    topic: defaultConfig.topic,
    scenes,
    mode: 'demo',
    createdAt: new Date().toISOString(),
    sources: [
      {
        title: 'Einstein Online · Relativity and satellite navigation',
        url: 'https://www.einstein-online.info/en/spotlight/relativity-satellite-navigation/',
        status: 'reference',
      },
      {
        title: 'GPS.gov · GPS Overview',
        url: 'https://www.gps.gov/gps-overview',
        status: 'reference',
      },
    ],
    caption:
      '你以为每个人的一秒，都一样长吗？\n从引力到卫星导航，看见时间的另一面。\n#Vibe知识大赏 #物理 #广义相对论 #知识可视化',
  };
}
