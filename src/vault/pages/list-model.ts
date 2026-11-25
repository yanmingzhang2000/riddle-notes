/**
 * 列表页的纯逻辑:搜索和分组。
 * 搜索词只在组件 state 里,不写进 URL(§6.2),所以这里只有函数,没有任何持久化。
 */
import { VAULT_RECORD_TYPES, type VaultRecordType, type VaultSummary } from '../types';

export type SummaryGroupKey = VaultRecordType | 'unreadable';

export interface SummaryGroup {
  key: SummaryGroupKey;
  items: VaultSummary[];
}

const normalize = (text: string) => text.normalize('NFKC').toLowerCase();

/**
 * 按标题和标签搜索,大小写不敏感,全角半角不敏感。空搜索词返回全部。
 * 解不开的记录(unreadable)没有标题可以匹配,有搜索词时不显示;没有搜索词时仍然显示,否则用户没法删除它们。
 */
export function filterSummaries(summaries: readonly VaultSummary[], query: string): VaultSummary[] {
  const needle = normalize(query.trim());
  if (needle === '') return [...summaries];
  return summaries.filter(
    summary =>
      !summary.unreadable &&
      (normalize(summary.title).includes(needle) || (summary.tags ?? []).some(tag => normalize(tag).includes(needle)))
  );
}

const byTitle = (a: VaultSummary, b: VaultSummary) => a.title.localeCompare(b.title, 'zh-CN') || a.id.localeCompare(b.id);

/**
 * 按类型分组,顺序固定为 VAULT_RECORD_TYPES,空组不出现,解不开的放在最后。
 * 保证不丢记录:类型字段不认识的(库被改过)也归到"解不开"那一组,而不是悄悄消失。
 */
export function groupSummaries(summaries: readonly VaultSummary[]): SummaryGroup[] {
  const known = new Set<string>(VAULT_RECORD_TYPES);
  const readable = summaries.filter(summary => !summary.unreadable && known.has(summary.type));
  const rest = summaries.filter(summary => summary.unreadable || !known.has(summary.type));

  const groups: SummaryGroup[] = [];
  for (const type of VAULT_RECORD_TYPES) {
    const items = readable.filter(summary => summary.type === type).sort(byTitle);
    if (items.length > 0) groups.push({ key: type, items });
  }
  if (rest.length > 0) groups.push({ key: 'unreadable', items: [...rest].sort((a, b) => a.id.localeCompare(b.id)) });
  return groups;
}
