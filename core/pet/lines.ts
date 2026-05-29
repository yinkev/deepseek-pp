// 悬浮宠物台词词典。
// 多数台词转译自 Claude Code CLI 的 SPINNER_VERBS（90 词），
// 保留其拟人、俏皮的风骨；success/error/sleepy 三类原表无对应词，为原创。

export type PetState =
  | 'idle'
  | 'thinking'
  | 'speaking'
  | 'working'
  | 'confused'
  | 'success'
  | 'error'
  | 'sleepy';

export const PET_LINES: Record<PetState, readonly string[]> = {
  thinking: [
    '沉思中…',
    '推敲中…',
    '反复琢磨',
    '揣摩中',
    '冥想中…',
    '斟酌中',
    '凝神思考',
    '揣度中',
    '解谜中',
    '用脑中',
    '推理中',
    '综合分析',
    '哲学时刻',
    '高谈阔论',
    '判断中',
    '破译中',
    '考虑中',
    '唤起灵感',
  ],
  working: [
    '工作中',
    '精雕细琢',
    '创造中',
    '锻造中',
    '成型中',
    '生成中',
    '加紧赶工',
    '嘎吱嘎吱',
    '运转中',
    '干活中',
    '显化中',
    '驯服中',
    '孵化中',
    '施法中',
    '摆弄中',
    '调配中',
    '嗡嗡运转',
    '计算中',
    '演算中',
    '处理中',
    '嬗变中',
    '搬运中',
    '编织中',
    '凝聚中',
    '萌芽中',
    '烘焙中',
    '慢炖中',
    '文火慢煨',
    '酝酿中',
    '腌制中',
  ],
  speaking: [
    '通灵中',
    '阐释中',
    '徐徐展开',
    '一一解开',
    '灵感涌现',
    '想象中',
    '描绘中',
    '占卜中',
    '施咒中',
    '小鲸鱼工作中…',
  ],
  idle: [
    '嬉戏中',
    '戳一戳',
    '漫步中',
    '闲庭信步',
    '慢悠悠溜达',
    '放空中',
    '摇摆中',
    '扭一扭',
    '瞎忙活',
    '哼哼曲子',
  ],
  confused: [
    '大脑乱码',
    '重新整理中',
    '喋喋不休',
    '晃来晃去',
    '进洞找路',
  ],
  success: [
    '大功告成',
    '落地完成',
    '搞定！',
    '完美！',
    '收工！',
    '漂亮！',
    '办妥了！',
  ],
  error: [
    '卡壳了…',
    '出岔子了',
    '撞墙了',
    '逻辑跑路',
    '翻车了…',
    '系统打嗝',
  ],
  sleepy: [
    'Zzz…',
    '困了…',
    '打个盹',
    '神游中',
    '钻被窝里',
  ],
};

/**
 * 从指定状态的台词桶中随机取一句，尽量避开最近用过的几句以减少复读感。
 * @param state 当前宠物状态
 * @param recent 最近展示过的台词（用于去重）
 */
export function pickPetLine(state: PetState, recent: readonly string[] = []): string {
  const pool = PET_LINES[state];
  if (!pool || pool.length === 0) return '';

  const fresh = pool.filter((line) => !recent.includes(line));
  const candidates = fresh.length > 0 ? fresh : pool;
  const index = Math.floor(Math.random() * candidates.length);
  return candidates[index];
}
