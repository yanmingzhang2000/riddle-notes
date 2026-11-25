/**
 * 下载 Recovery Key 的 .txt 文件。
 *
 * 文件头的警示不能省:Recovery Key 不需要主密码就能打开保险箱,
 * 如果和加密备份放在一起,备份文件的保护就形同虚设。
 */

/** 技术方案 Task 3.1 规定的文件头警示 */
export const RECOVERY_KEY_FILE_WARNING = '此文件无需主密码即可打开你的保险箱，请勿与加密备份放在同一位置。';

const pad2 = (n: number) => String(n).padStart(2, '0');

/** 用本地时间:文件里的时间和用户的时钟一致 */
function localDate(now: Date): string {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

export function recoveryKeyFileName(now: Date = new Date()): string {
  return `riddle-notes-recovery-key-${localDate(now)}.txt`;
}

export function buildRecoveryKeyFile(recoveryKey: string, now: Date = new Date()): string {
  return [
    'Riddle Notes 保险箱恢复密钥',
    `生成日期：${localDate(now)}`,
    '',
    RECOVERY_KEY_FILE_WARNING,
    '请把它保存在离线或可信的地方，例如打印后锁进抽屉，或存入你的密码管理器。',
    '如果主密码和这把恢复密钥同时丢失，保险箱里的内容将永久无法找回。',
    '',
    '恢复密钥：',
    recoveryKey,
    '',
    '使用方法：在保险箱的解锁页选择“使用恢复密钥”，输入上面的整串字符。大小写和连字符不影响。',
    '',
  ].join('\n');
}

/** 触发浏览器下载。文件头带 BOM,让较旧的 Windows 记事本也按 UTF-8 显示中文 */
export function downloadRecoveryKeyFile(recoveryKey: string, now: Date = new Date()): void {
  const blob = new Blob(['\uFEFF', buildRecoveryKeyFile(recoveryKey, now)], {
    type: 'text/plain;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = recoveryKeyFileName(now);
  link.click();
  // 稍后再释放,避免下载还没开始地址就失效
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
