export const sfxStyles = [
  { id: 'cinematic', name: '电影冲击' },
  { id: 'digital', name: '数字脉冲' },
  { id: 'pixel', name: '像素跳切' },
  { id: 'soft', name: '轻柔提示' },
  { id: 'impact', name: '质感撞击' },
  { id: 'off', name: '关闭音效' },
];

export const sfxClips = [
  ['impactBell_heavy_000', '重钟撞击', 'impact'],
  ['impactGlass_medium_000', '玻璃轻撞', 'impact'],
  ['impactMetal_medium_000', '金属撞击', 'impact'],
  ['impactMining_000', '矿石撞击', 'impact'],
  ['impactPlank_medium_000', '木板撞击', 'impact'],
  ['impactPlate_heavy_000', '重板撞击', 'impact'],
  ['impactPunch_medium_000', '拳击冲击', 'impact'],
  ['impactSoft_medium_000', '柔和撞击', 'impact'],
  ['impactTin_medium_000', '薄金属撞击', 'impact'],
  ['impactWood_medium_000', '木质撞击', 'impact'],
  ['back_001', '回弹', 'interface'],
  ['bong_001', '空灵叮声', 'interface'],
  ['click_001', '短促点击', 'interface'],
  ['confirmation_001', '确认提示', 'interface'],
  ['drop_001', '下落提示', 'interface'],
  ['glass_001', '清脆玻璃', 'interface'],
  ['glitch_001', '数字故障', 'interface'],
  ['open_001', '开启提示', 'interface'],
  ['pluck_001', '拨弦提示', 'interface'],
].map(([id, name, category]) => ({
  id,
  name,
  category,
  url: `/sfx/kenney/${category === 'impact' ? 'impact-sounds' : 'interface-sounds'}/${id}.ogg`,
}));

const profiles = {
  cinematic: {
    impact: [
      'impactPlate_heavy_000',
      'impactPunch_medium_000',
      'impactBell_heavy_000',
      'impactMining_000',
    ],
    cue: ['bong_001', 'confirmation_001', 'glass_001'],
  },
  digital: {
    impact: [
      'impactMetal_medium_000',
      'impactGlass_medium_000',
      'impactTin_medium_000',
      'impactMining_000',
    ],
    cue: ['glitch_001', 'glass_001', 'confirmation_001'],
  },
  pixel: {
    impact: ['impactTin_medium_000', 'impactPlank_medium_000', 'impactPunch_medium_000'],
    cue: ['click_001', 'drop_001', 'confirmation_001', 'glitch_001'],
  },
  soft: {
    impact: ['impactSoft_medium_000', 'impactWood_medium_000', 'impactPlank_medium_000'],
    cue: ['pluck_001', 'bong_001', 'back_001', 'glass_001'],
  },
  impact: {
    impact: [
      'impactPunch_medium_000',
      'impactPlate_heavy_000',
      'impactWood_medium_000',
      'impactMetal_medium_000',
    ],
    cue: ['impactGlass_medium_000', 'impactBell_heavy_000', 'impactPlank_medium_000'],
  },
};

export function createSfxEvents(scenes = [], style = 'cinematic') {
  const profile = profiles[style];
  if (!profile) return [];
  const events = [];
  scenes.forEach((scene, index) => {
    const isIntro = index === 0;
    const choices = isIntro ? profile.cue : profile.impact;
    const id = choices[index % choices.length];
    const clip = sfxClips.find((item) => item.id === id);
    if (clip)
      events.push({ ...clip, at: scene.start + (isIntro ? 0.03 : 0), gain: isIntro ? 0.25 : 0.4 });
    if (!isIntro && index % 2 === 1) {
      const cueId = profile.cue[index % profile.cue.length];
      const cue = sfxClips.find((item) => item.id === cueId);
      if (cue) events.push({ ...cue, at: scene.start + 0.12, gain: 0.18 });
    }
  });
  return events;
}
