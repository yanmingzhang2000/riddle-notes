/**
 * 编辑页的表单模型:表单状态、校验、转成服务层的输入。纯函数。
 * 服务层只检查类型,"标题和秘密不能为空"是界面的规则,写在这里。
 */
import { VAULT_TYPE_FIELDS } from '../components/record-types';
import type { VaultRecordInput, VaultRecordType, VaultSecret } from '../types';

export interface EditorForm {
  type: VaultRecordType;
  title: string;
  secret: string;
  username: string;
  url: string;
  notes: string;
  /** 用逗号分隔的原始输入 */
  tags: string;
}

export interface EditorErrors {
  title?: string;
  secret?: string;
}

export function emptyForm(type: VaultRecordType = 'password'): EditorForm {
  return { type, title: '', secret: '', username: '', url: '', notes: '', tags: '' };
}

export function formFromSecret(secret: VaultSecret): EditorForm {
  return {
    type: secret.type,
    title: secret.title,
    secret: secret.secret,
    username: secret.username ?? '',
    url: secret.url ?? '',
    notes: secret.notes ?? '',
    tags: (secret.tags ?? []).join(', '),
  };
}

/** 逗号(半角、全角)、顿号和换行都当分隔符;去掉空的和重复的(不区分大小写,保留先出现的写法) */
export function parseTags(input: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const raw of input.split(/[,，、\n]/)) {
    const tag = raw.trim();
    const key = tag.normalize('NFKC').toLowerCase();
    if (tag === '' || seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }
  return tags;
}

export function validateForm(form: EditorForm): EditorErrors {
  const errors: EditorErrors = {};
  if (form.title.trim() === '') errors.title = '请填写标题';
  // 秘密不 trim:密码首尾的空格可能是有意义的
  if (form.secret.length === 0) errors.secret = `请填写${VAULT_TYPE_FIELDS[form.type].secretLabel}`;
  return errors;
}

/**
 * 转成服务层的输入。当前类型没有的字段一律丢掉(例如先填了用户名、又把类型改成安全笔记),
 * 空的可选字段也不写,这样详情页不会显示一堆空行。
 */
export function toRecordInput(form: EditorForm): VaultRecordInput {
  const fields = VAULT_TYPE_FIELDS[form.type];
  const input: VaultRecordInput = {
    type: form.type,
    title: form.title.trim(),
    secret: form.secret,
  };
  const username = form.username.trim();
  const url = form.url.trim();
  const tags = parseTags(form.tags);
  if (fields.usernameLabel && username !== '') input.username = username;
  if (fields.urlLabel && url !== '') input.url = url;
  if (fields.notes && form.notes.trim() !== '') input.notes = form.notes;
  if (tags.length > 0) input.tags = tags;
  return input;
}
