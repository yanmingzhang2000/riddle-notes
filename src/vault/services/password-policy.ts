/**
 * 主密码强度策略。技术方案 §6.2:长度 ≥ 12,且 zxcvbn 得分 ≥ 3。
 *
 * 为什么放在服务层而不是 UI:备份文件的离线防护主要靠主密码强度(R7),
 * 改密码和 Recovery 恢复也会设置新的主密码,只在初始化页面检查等于留了两个后门。
 * UI 的强度指示器调用同一个 evaluate(),避免"指示器说合格,服务层却拒绝"。
 *
 * 已知局限(不要把 score ≥ 3 当成对所有语言都有效的保证):
 *   zxcvbn 的字典以英文为主。中文短语(「我的密码是一二三四五六七八」)、无声调拼音加日期
 *   (「wangxiaoming1234」「zhangsan19900101」)这类密码会被高估成 4 分。
 *   实测过 @zxcvbn-ts/language-zh,它的拼音字典带声调,对用户实际键入的无声调拼音几乎匹配不上,
 *   在 ≥3 的门槛下没有改变任何放行/拒绝的决定,所以没有带上(多 660 KiB)。
 *   score 3 的区间是约 1e8–1e10 次猜测(zxcvbn 的说法是"对离线慢哈希场景有中等保护"),≥ 1e10 才是 4,
 *   所以这条门槛是底线不是目标。
 */
import type { PasswordEvaluation, PasswordIssue } from '../types';

export const MIN_PASSWORD_LENGTH = 12;
export const MIN_PASSWORD_SCORE = 3;
/** zxcvbn 的耗时随输入变长而增加;只评估前 100 个码点,更长的部分不拿来加分 */
const MAX_SCORED_CODE_POINTS = 100;

export interface PasswordPolicy {
  /**
   * 评估,不抛错(估算器加载失败除外)。
   * 返回里没有密码内容,也没有 zxcvbn 的反馈文案。
   */
  evaluate(password: string): Promise<PasswordEvaluation>;
}

type ScoreFn = (password: string) => PasswordEvaluation['score'];

/** 估算器只加载一次;加载失败时清掉缓存,下次调用可以重试 */
let scorerPromise: Promise<ScoreFn> | null = null;

async function loadScorer(): Promise<ScoreFn> {
  // 动态 import:字典约 233 KiB(gzip),不该进 Side Panel 的主包,只在设置密码时才下载
  const [core, common] = await Promise.all([
    import('@zxcvbn-ts/core'),
    import('@zxcvbn-ts/language-common'),
  ]);
  // Vite 走 ESM 入口,具名导出就在模块上;Node/Vitest 按 CommonJS 加载时,导出挂在 default 上
  const coreModule = (core.ZxcvbnFactory ? core : (core as unknown as { default: typeof core }).default);
  const commonModule = (common.dictionary
    ? common
    : (common as unknown as { default: typeof common }).default);

  const factory = new coreModule.ZxcvbnFactory({
    graphs: commonModule.adjacencyGraphs,
    dictionary: commonModule.dictionary,
  });
  return password => factory.check(password).score;
}

function getScorer(): Promise<ScoreFn> {
  if (!scorerPromise) {
    scorerPromise = loadScorer().catch(error => {
      scorerPromise = null;
      throw error;
    });
  }
  return scorerPromise;
}

/** 与 KDF 看到的密码一致:先做 NFKC。全角字母、组合字符在这里被统一,不能靠它们凑长度 */
function toCodePoints(password: string): string[] {
  return Array.from(password.normalize('NFKC'));
}

export function createDefaultPasswordPolicy(): PasswordPolicy {
  return {
    async evaluate(password: string): Promise<PasswordEvaluation> {
      const points = toCodePoints(password);
      // 估算器加载失败时直接抛出,不退回"只看长度":宁可暂时设置不了密码,也不放行弱密码
      const score = (await getScorer())(points.slice(0, MAX_SCORED_CODE_POINTS).join(''));

      const issues: PasswordIssue[] = [];
      if (points.length < MIN_PASSWORD_LENGTH) issues.push('too-short');
      if (score < MIN_PASSWORD_SCORE) issues.push('too-weak');

      return { score, length: points.length, ok: issues.length === 0, issues };
    },
  };
}

export const DEFAULT_PASSWORD_POLICY: PasswordPolicy = createDefaultPasswordPolicy();
