/**
 * Vault 的错误类型。
 *
 * 错误只带类别,不带任何字段内容、密钥或密文,message 是固定文案。
 * UI 按 kind 选择提示语,见技术方案 §5.3。
 */
export type VaultErrorKind =
  | 'locked'
  | 'auth'
  | 'corrupt'
  | 'recovery-format'
  | 'recovery-checksum'
  | 'conflict'
  | 'already-initialized'
  | 'not-found'
  | 'unsupported-kdf';

export class VaultError extends Error {
  readonly kind: VaultErrorKind;

  constructor(kind: VaultErrorKind, message: string) {
    super(message);
    this.name = 'VaultError';
    this.kind = kind;
  }
}

/** 保险箱未解锁,或操作进行期间被锁定 */
export class VaultLockedError extends VaultError {
  constructor() {
    super('locked', 'Vault is locked');
    this.name = 'VaultLockedError';
  }
}

/**
 * 认证失败。AES-GCM 在密钥错误和密文被篡改时抛的是同一种失败,无法区分,
 * 所以提示只能是"密码错误,或数据已损坏"。
 */
export class AuthError extends VaultError {
  constructor() {
    super('auth', 'Authentication failed');
    this.name = 'AuthError';
  }
}

/** 数据结构不合法:缺字段、IV 或密文长度不对、版本不认识 */
export class CorruptError extends VaultError {
  constructor() {
    super('corrupt', 'Vault data is malformed');
    this.name = 'CorruptError';
  }
}

/** Recovery Key 的格式不对:前缀、长度、字母表、填充位 */
export class RecoveryKeyFormatError extends VaultError {
  constructor() {
    super('recovery-format', 'Recovery key format is invalid');
    this.name = 'RecoveryKeyFormatError';
  }
}

/** Recovery Key 格式正确但校验和不符,通常是输错了字符 */
export class RecoveryKeyChecksumError extends VaultError {
  constructor() {
    super('recovery-checksum', 'Recovery key checksum mismatch');
    this.name = 'RecoveryKeyChecksumError';
  }
}

/** 乐观锁冲突:提交时库里的 revision 或 keyId 已经变了 */
export class ConflictError extends VaultError {
  constructor() {
    super('conflict', 'Vault was modified by another session');
    this.name = 'ConflictError';
  }
}

export class AlreadyInitializedError extends VaultError {
  constructor() {
    super('already-initialized', 'Vault is already initialized');
    this.name = 'AlreadyInitializedError';
  }
}

export class NotFoundError extends VaultError {
  constructor() {
    super('not-found', 'Record not found');
    this.name = 'NotFoundError';
  }
}

/** KDF 算法还没有实现(Argon2id 等待 Task 1.0 spike 的结论) */
export class UnsupportedKdfError extends VaultError {
  constructor() {
    super('unsupported-kdf', 'KDF algorithm is not supported');
    this.name = 'UnsupportedKdfError';
  }
}
