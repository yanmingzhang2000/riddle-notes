/**
 * 把错误翻译成给用户看的话。技术方案 §5.3。
 *
 * 规则:
 *   - 只按错误的类别(kind)选文案,**永远不显示 error.message**:未知错误的 message 可能带任何东西;
 *   - AES-GCM 分不清"密码错"和"数据被篡改",所以认证失败的提示必须两种可能都说;
 *   - 同一个类别在不同入口措辞略有不同(主密码 / 恢复密钥),但不改变含义。
 */
import { VaultError, WeakPasswordError } from './crypto/errors';
import type { PasswordIssue } from './types';

/**
 * 出错时用户在做什么,决定认证失败时怎么说:
 *   - master:输入主密码(解锁、改密码、导出前验证)
 *   - recovery:输入恢复密钥
 *   - record:打开或读取某一条记录。用户没有输入任何密码,说"密码错误"会误导他
 */
export type ErrorContext = 'master' | 'recovery' | 'record';

const WEAK_PASSWORD_MESSAGES: Record<PasswordIssue, string> = {
  'too-short': '主密码至少需要 12 个字符',
  'too-weak': '这个主密码太容易被猜到，请换一个更长或更随机的口令',
};

export const GENERIC_ERROR_MESSAGE = '操作失败，请重试';

export function describeVaultError(error: unknown, context: ErrorContext = 'master'): string {
  if (!(error instanceof VaultError)) return GENERIC_ERROR_MESSAGE;

  switch (error.kind) {
    case 'corrupt':
      return '保险箱数据已损坏，可导出原始加密备份';
    case 'recovery-format':
    case 'recovery-checksum':
      return '恢复密钥输入有误，请检查';
    case 'auth':
      if (context === 'record') return '这条记录无法解密，数据可能已损坏';
      return context === 'recovery'
        ? '恢复密钥不正确，或数据已损坏'
        : '密码错误，或数据已损坏。可尝试使用恢复密钥';
    case 'weak-password': {
      const issues = error instanceof WeakPasswordError ? error.issues : [];
      const lines = issues.map(issue => WEAK_PASSWORD_MESSAGES[issue]).filter(Boolean);
      return lines.length > 0 ? lines.join('；') : '这个主密码不符合强度要求';
    }
    case 'locked':
      return '保险箱已锁定，请重新解锁';
    case 'conflict':
      return '保险箱刚刚在另一个窗口被修改，请重新操作';
    case 'already-initialized':
      return '保险箱已经创建，请直接解锁';
    case 'not-initialized':
      return '保险箱还没有创建';
    case 'not-found':
      return '找不到这条记录，可能已被删除';
    case 'unsupported-kdf':
      return '这个保险箱使用了当前版本不支持的加密参数，请升级扩展后再试';
    default:
      return GENERIC_ERROR_MESSAGE;
  }
}
