/**
 * Vault 的数据类型。对应技术方案 §2.1、§3。
 *
 * 数据库里不会出现主密码、明文 Vault Key、明文 Recovery Key,
 * 也没有任何明文秘密字段。type 和时间戳是明文,换取列表分类不必先解密。
 */

export const VAULT_RECORD_TYPES = ['api_key', 'password', 'database', 'secure_note'] as const;
export type VaultRecordType = (typeof VAULT_RECORD_TYPES)[number];

export const VAULT_FORMAT_VERSION = 1 as const;

/** 带判别字段的联合类型:加 Argon2id 只加一个分支,调用方不变 */
export type KdfParams =
  | { algorithm: 'PBKDF2-SHA256'; iterations: number; salt: Uint8Array }
  | {
      algorithm: 'Argon2id';
      memoryKiB: number;
      timeCost: number;
      parallelism: number;
      salt: Uint8Array;
    };

/** AES-GCM 加密后的字节:密文带 16 字节认证标签 */
export interface EncryptedBytes {
  iv: Uint8Array;
  data: Uint8Array;
}

export interface WrappedKey {
  wrappedKey: Uint8Array;
  iv: Uint8Array;
}

export interface MasterWrapper extends WrappedKey {
  kdf: KdfParams;
}

/** Recovery Key 有 256 bit 熵,用 HKDF 派生,不需要 KDF 参数 */
export type RecoveryWrapper = WrappedKey;

export interface VaultKeyWrapper {
  master: MasterWrapper;
  recovery: RecoveryWrapper;
  /** HKDF(vaultKey) 的前 8 字节,明文。记录写入前比对,防止写出永远解不开的记录 */
  keyId: Uint8Array;
  /** 每次提交 +1,乐观锁用 */
  revision: number;
  formatVersion: typeof VAULT_FORMAT_VERSION;
}

/** 表 vaultKeys。记录不存在 = 未初始化 */
export interface VaultKeys {
  id: 'singleton';
  wrapper: VaultKeyWrapper;
  recoveryRotationRequired: boolean;
  createdAt: number;
  updatedAt: number;
}

export type AutoLockTimeoutMs = 60_000 | 300_000 | 900_000 | 0;

/** 表 vaultSettings。0 表示 Never */
export interface VaultSettings {
  id: 'singleton';
  autoLockTimeoutMs: number;
}

export const DEFAULT_AUTO_LOCK_TIMEOUT_MS = 300_000;

export interface VaultRecord {
  id: string;
  formatVersion: typeof VAULT_FORMAT_VERSION;
  /** 写入时 Session 的 keyId */
  keyId: Uint8Array;
  type: VaultRecordType;
  createdAt: number;
  updatedAt: number;
  /** { title, tags? },列表页解密 */
  summary: EncryptedBytes;
  /** { secret, username?, url?, notes? },详情页才解密 */
  secret: EncryptedBytes;
}

/** 覆盖导入前的快照,同一时刻只保留一份 */
export interface VaultSnapshot {
  id: 'pre-import';
  createdAt: number;
  keys: VaultKeys;
  settings: VaultSettings | null;
  records: VaultRecord[];
}

export interface VaultSummaryPlain {
  title: string;
  tags?: string[];
}

export interface VaultSecretPlain {
  secret: string;
  username?: string;
  url?: string;
  notes?: string;
}

/** 创建与更新记录的输入。title 与 tags 进 summary 段,其余进 secret 段 */
export interface VaultRecordInput {
  type: VaultRecordType;
  title: string;
  secret: string;
  username?: string;
  url?: string;
  notes?: string;
  tags?: string[];
}

/** 列表项,只解密了 summary。unreadable 表示这一条解不开,其他条目不受影响 */
export interface VaultSummary {
  id: string;
  type: VaultRecordType;
  title: string;
  tags?: string[];
  createdAt: number;
  updatedAt: number;
  unreadable?: true;
}

/** 详情,summary 与 secret 两段都已解密 */
export interface VaultSecret {
  id: string;
  type: VaultRecordType;
  title: string;
  tags?: string[];
  secret: string;
  username?: string;
  url?: string;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

/** 主密码不合格的原因类别。只有类别,不带密码内容,也不带 zxcvbn 的反馈文案 */
export type PasswordIssue = 'too-short' | 'too-weak';

/**
 * 对一个主密码的评估结果。UI 的强度指示器和服务层的强制校验用的是同一份,
 * 所以"指示器显示合格"与"服务层放行"不会不一致。
 */
export interface PasswordEvaluation {
  /** zxcvbn 的 0–4 分。长度不足时也会给出,方便 UI 显示 */
  score: 0 | 1 | 2 | 3 | 4;
  /** NFKC 规范化之后的码点数,与 KDF 实际看到的密码一致 */
  length: number;
  ok: boolean;
  issues: PasswordIssue[];
}

export type RecordSegment = 'summary' | 'secret';

/** 绑定进 AAD 的记录上下文,见 §3.2 */
export interface SegmentContext {
  recordId: string;
  type: VaultRecordType;
  formatVersion: typeof VAULT_FORMAT_VERSION;
  segment: RecordSegment;
}
