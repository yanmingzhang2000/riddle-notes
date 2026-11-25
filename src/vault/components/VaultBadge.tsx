import { Database, FileText, Key, KeyRound, type LucideIcon } from 'lucide-react';
import type { VaultRecordType } from '../types';
import { VAULT_TYPE_LABELS } from './record-types';

const ICONS: Record<VaultRecordType, LucideIcon> = {
  api_key: Key,
  password: KeyRound,
  database: Database,
  secure_note: FileText,
};

/** 类型字段在库里是明文,数据被改坏时可能出现不认识的值:回退到通用图标和文案,不要让整个列表崩掉 */
function iconFor(type: string): LucideIcon {
  return ICONS[type as VaultRecordType] ?? FileText;
}

export function labelFor(type: string): string {
  return VAULT_TYPE_LABELS[type as VaultRecordType] ?? '未知类型';
}

export function VaultTypeIcon({ type, size = 16 }: { type: VaultRecordType; size?: number }) {
  const Icon = iconFor(type);
  return <Icon size={size} aria-hidden="true" />;
}

/** 记录类型的小徽章 */
export function VaultBadge({ type }: { type: VaultRecordType }) {
  const Icon = iconFor(type);
  return (
    <span className="badge gap-1" data-type={type}>
      <Icon size={12} aria-hidden="true" />
      {labelFor(type)}
    </span>
  );
}
