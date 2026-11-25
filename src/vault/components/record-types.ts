import type { VaultRecordType } from '../types';

/** 记录类型的显示名。列表分组、编辑页下拉、徽章共用这一份 */
export const VAULT_TYPE_LABELS: Record<VaultRecordType, string> = {
  api_key: 'API Key',
  password: '账号密码',
  database: '数据库',
  secure_note: '安全笔记',
};

/**
 * 每种类型有哪些字段、叫什么。编辑页决定显示哪些输入框,详情页决定显示哪些字段,共用这一份。
 * 没有出现的字段(例如安全笔记没有用户名)在保存时会被丢掉,不会把切换类型之前填的内容悄悄存进去。
 */
export interface VaultTypeFields {
  /** 秘密本身的名字,也是 SecretField 的 label */
  secretLabel: string;
  /** 秘密是多行文本(安全笔记) */
  multiline: boolean;
  usernameLabel?: string;
  urlLabel?: string;
  notes: boolean;
}

export const VAULT_TYPE_FIELDS: Record<VaultRecordType, VaultTypeFields> = {
  api_key: { secretLabel: 'API Key', multiline: false, urlLabel: '接口地址', notes: true },
  password: { secretLabel: '密码', multiline: false, usernameLabel: '用户名', urlLabel: '网址', notes: true },
  database: {
    secretLabel: '密码或连接串',
    multiline: false,
    usernameLabel: '用户名',
    urlLabel: '主机或连接地址',
    notes: true,
  },
  secure_note: { secretLabel: '内容', multiline: true, notes: false },
};
