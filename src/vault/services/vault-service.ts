/**
 * Vault 的业务服务。接口与流程见技术方案 §5.2,Recovery 两步见 §2.4。
 *
 * 所有改写 vaultKeys 的操作统一走 §2.3 的模式:
 *   事务外读取并记下 revision → 事务外做完全部 KDF 与加解密 → 提交前试解新 wrapper
 *   → 短事务内校验 revision 与 keyId 再写入 → 提交后广播。
 * IDB 事务在没有待处理请求时会自动提交,crypto.subtle 的 Promise 不属于 IDB 请求,
 * 所以事务里不能 await 它们。
 *
 * 所有读写记录的方法开头取一次 epoch,每次 await 之后检查,锁定过就丢弃结果(§4.4)。
 * 错误只带类别,这里不打日志,不把任何字段内容放进错误。
 */
import { RiddleVaultDB, isVaultInitialized, vaultDb } from '../../db/vault-schema';
import { equalBytes, wipe } from '../crypto/bytes';
import {
  CryptoService,
  KEY_ID_LENGTH,
  createDefaultKdf,
  kdfNeedsUpgrade,
} from '../crypto/crypto-service';
import {
  AlreadyInitializedError,
  AuthError,
  ConflictError,
  CorruptError,
  NotFoundError,
  NotInitializedError,
} from '../crypto/errors';
import {
  DEFAULT_AUTO_LOCK_TIMEOUT_MS,
  VAULT_FORMAT_VERSION,
  VAULT_RECORD_TYPES,
  type KdfParams,
  type RecordSegment,
  type SegmentContext,
  type VaultKeys,
  type VaultRecord,
  type VaultRecordInput,
  type VaultRecordType,
  type VaultSecret,
  type VaultSecretPlain,
  type VaultSummary,
  type VaultSummaryPlain,
  type WrappedKey,
} from '../types';
import type { VaultSession } from './vault-session';

/** 当前 KDF 策略。测试里注入很小的迭代次数,生产用默认值 */
export interface KdfPolicy {
  create(): KdfParams;
  needsUpgrade(kdf: KdfParams): boolean;
}

export const DEFAULT_KDF_POLICY: KdfPolicy = {
  create: createDefaultKdf,
  needsUpgrade: kdfNeedsUpgrade,
};

export interface VaultServiceOptions {
  session: VaultSession;
  db?: RiddleVaultDB;
  crypto?: CryptoService;
  kdfPolicy?: KdfPolicy;
  now?: () => number;
  newId?: () => string;
}

export type RecoveryKeyCallback = (formatted: string) => Promise<void>;

export class VaultService {
  private readonly session: VaultSession;
  private readonly db: RiddleVaultDB;
  private readonly crypto: CryptoService;
  private readonly policy: KdfPolicy;
  private readonly now: () => number;
  private readonly newId: () => string;
  private readonly background = new Set<Promise<void>>();

  constructor(options: VaultServiceOptions) {
    this.session = options.session;
    this.db = options.db ?? vaultDb;
    this.crypto = options.crypto ?? new CryptoService();
    this.policy = options.kdfPolicy ?? DEFAULT_KDF_POLICY;
    this.now = options.now ?? Date.now;
    this.newId = options.newId ?? (() => crypto.randomUUID());
  }

  // —— 初始化 ——————————————————————————————————————————

  /**
   * 全程在内存里完成,onRecoveryKey 回调 resolve(用户回填校验通过)之后才开事务。
   * 回调抛错(取消)时什么都没写,没有半初始化状态。
   */
  async initialize(masterPassword: string, onRecoveryKey: RecoveryKeyCallback): Promise<void> {
    requirePassword(masterPassword);
    // 早检查只为省掉一次 KDF 和一次白白展示的 Recovery Key,真正的防线是下面事务里的检查
    if (await this.isInitialized()) throw new AlreadyInitializedError();

    const raw = this.crypto.generateVaultKeyBytes();
    const recovery = await this.crypto.generateRecoveryKey();
    try {
      const kdf = this.policy.create();
      const masterWrapKey = await this.crypto.deriveMasterWrapKey(masterPassword, kdf);
      const recoveryWrapKey = await this.crypto.deriveRecoveryWrapKey(recovery.bytes);
      const keyId = await this.crypto.computeKeyId(raw);
      const master = { ...(await this.crypto.wrap(raw, masterWrapKey)), kdf };
      const recoveryWrapper = await this.crypto.wrap(raw, recoveryWrapKey);
      await this.trialUnwrap(master, masterWrapKey, keyId);
      await this.trialUnwrap(recoveryWrapper, recoveryWrapKey, keyId);
      const sessionKey = await this.crypto.importSessionKey(raw);
      // 等用户抄写 Recovery Key 期间,内存里只留不可导出的 CryptoKey 和已加密的 wrapper
      wipe(raw);
      wipe(recovery.bytes);

      await onRecoveryKey(recovery.formatted);

      const now = this.now();
      const keys: VaultKeys = {
        id: 'singleton',
        wrapper: {
          master,
          recovery: recoveryWrapper,
          keyId,
          revision: 1,
          formatVersion: VAULT_FORMAT_VERSION,
        },
        recoveryRotationRequired: false,
        createdAt: now,
        updatedAt: now,
      };

      await this.db.transaction('rw', this.db.vaultKeys, this.db.vaultSettings, async () => {
        if (await this.db.vaultKeys.get('singleton')) throw new AlreadyInitializedError();
        await this.db.vaultKeys.add(keys);
        await this.db.vaultSettings.put({
          id: 'singleton',
          autoLockTimeoutMs: DEFAULT_AUTO_LOCK_TIMEOUT_MS,
        });
      });

      // 刚创建的库不存在"期间被锁定"的问题,不传 expectedEpoch
      this.session.open(sessionKey, keyId);
    } finally {
      wipe(raw);
      wipe(recovery.bytes);
    }
  }

  isInitialized(): Promise<boolean> {
    return isVaultInitialized(this.db);
  }

  // —— 解锁 ————————————————————————————————————————————

  async unlockWithMasterPassword(password: string): Promise<void> {
    const epoch = this.session.getEpoch();
    const keys = await this.loadKeys();
    const { raw, wrapKey } = await this.unwrapWithMaster(keys, password);
    let sessionKey: CryptoKey;
    try {
      sessionKey = await this.crypto.importSessionKey(raw);
    } finally {
      wipe(raw);
    }
    this.session.open(sessionKey, keys.wrapper.keyId, { expectedEpoch: epoch });

    if (this.policy.needsUpgrade(keys.wrapper.master.kdf)) {
      this.runInBackground(() => this.upgradeKdf(keys, password, wrapKey));
    }
  }

  async unlockWithRecoveryKey(input: string): Promise<void> {
    const epoch = this.session.getEpoch();
    const keys = await this.loadKeys();
    const raw = await this.unwrapWithRecovery(keys, input);
    let sessionKey: CryptoKey;
    try {
      sessionKey = await this.crypto.importSessionKey(raw);
    } finally {
      wipe(raw);
    }
    this.session.open(sessionKey, keys.wrapper.keyId, { expectedEpoch: epoch });
  }

  /**
   * 只验证主密码,不碰 Session:不 epoch++,不通知订阅者,不会让 UI 子树重建。
   * 改主密码、重新生成 Recovery Key、导出前重新验证都用它。
   */
  async verifyMasterPassword(password: string): Promise<void> {
    const keys = await this.loadKeys();
    const { raw } = await this.unwrapWithMaster(keys, password);
    wipe(raw);
  }

  // —— 改主密码 ————————————————————————————————————————

  async changeMasterPassword(current: string, next: string): Promise<void> {
    requirePassword(next);
    const keys = await this.loadKeys();
    const { raw } = await this.unwrapWithMaster(keys, current);
    try {
      await this.commitMasterWrapper(keys, raw, next);
    } finally {
      wipe(raw);
    }
  }

  // —— Recovery 两步 ————————————————————————————————————

  /**
   * 步骤一:用 Recovery Key 解开 Vault Key,写入新的 master wrapper,
   * 并标记 recoveryRotationRequired。提交后新主密码立即生效,旧 Recovery Key 仍然有效。
   * 成功后 Session 保持打开(此时已经证明持有 Vault Key)。
   */
  async recoverAccess(
    recoveryKeyInput: string,
    newMasterPassword: string
  ): Promise<{ accessRestored: true; rotationRequired: true }> {
    requirePassword(newMasterPassword);
    const keys = await this.loadKeys();
    const raw = await this.unwrapWithRecovery(keys, recoveryKeyInput);
    try {
      await this.commitMasterWrapper(keys, raw, newMasterPassword, { rotationRequired: true });
      // 提交已经成功,这里不能再因为 epoch 变化抛错让调用方以为没改成
      this.session.open(await this.crypto.importSessionKey(raw), keys.wrapper.keyId);
    } finally {
      wipe(raw);
    }
    return { accessRestored: true, rotationRequired: true };
  }

  /**
   * 步骤二,也是 Settings 里"重新生成"的入口。
   * 回调抛错(取消)时什么都不写,旧 Recovery Key 继续有效。
   */
  async rotateRecoveryKey(
    masterPassword: string,
    onRecoveryKey: RecoveryKeyCallback
  ): Promise<void> {
    const keys = await this.loadKeys();
    const { raw } = await this.unwrapWithMaster(keys, masterPassword);
    const fresh = await this.crypto.generateRecoveryKey();
    let wrapped: WrappedKey;
    try {
      // 先把包装和试解做完再清零 raw,这样等用户抄写 Recovery Key 期间内存里没有 Vault Key
      const wrapKey = await this.crypto.deriveRecoveryWrapKey(fresh.bytes);
      wrapped = await this.crypto.wrap(raw, wrapKey);
      await this.trialUnwrap(wrapped, wrapKey, keys.wrapper.keyId);
    } finally {
      wipe(raw);
      wipe(fresh.bytes);
    }

    await onRecoveryKey(fresh.formatted);

    await this.commitKeys(keys, current => ({
      ...current,
      recoveryRotationRequired: false,
      wrapper: { ...current.wrapper, recovery: wrapped },
    }));
  }

  // —— 记录 CRUD ———————————————————————————————————————

  /** 只解密 summary。单条解不开标记为 unreadable,不让一条坏记录拖垮整个列表 */
  async listSummaries(filter?: { type?: VaultRecordType }): Promise<VaultSummary[]> {
    const { key, epoch } = this.session.requireKey();
    const rows = filter?.type
      ? await this.db.vaultRecords.where('type').equals(filter.type).toArray()
      : await this.db.vaultRecords.toArray();
    this.session.assertEpoch(epoch);

    const items = await Promise.all(
      rows.map(async (row): Promise<VaultSummary> => {
        const base = {
          id: row.id,
          type: row.type,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        };
        try {
          const plain = await this.decryptRow<VaultSummaryPlain>(row, 'summary', key);
          return { ...base, title: plain.title, ...(plain.tags ? { tags: plain.tags } : {}) };
        } catch (error) {
          if (error instanceof AuthError || error instanceof CorruptError) {
            return { ...base, title: '', unreadable: true };
          }
          throw error;
        }
      })
    );
    this.session.assertEpoch(epoch);

    return items.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** 详情页才调用 */
  async getSecret(id: string): Promise<VaultSecret> {
    const { key, epoch } = this.session.requireKey();
    this.session.touch();
    const row = await this.db.vaultRecords.get(id);
    this.session.assertEpoch(epoch);
    if (!row) throw new NotFoundError();

    const [summary, secret] = await Promise.all([
      this.decryptRow<VaultSummaryPlain>(row, 'summary', key),
      this.decryptRow<VaultSecretPlain>(row, 'secret', key),
    ]);
    this.session.assertEpoch(epoch);

    return {
      id: row.id,
      type: row.type,
      title: summary.title,
      ...(summary.tags ? { tags: summary.tags } : {}),
      secret: secret.secret,
      ...(secret.username !== undefined ? { username: secret.username } : {}),
      ...(secret.url !== undefined ? { url: secret.url } : {}),
      ...(secret.notes !== undefined ? { notes: secret.notes } : {}),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async createRecord(input: VaultRecordInput): Promise<string> {
    validateInput(input);
    const { key, keyId, epoch } = this.session.requireKey();
    this.session.touch();

    const id = this.newId();
    const [summary, secret] = await this.encryptInput(input, id, key);
    const now = this.now();
    const row: VaultRecord = {
      id,
      formatVersion: VAULT_FORMAT_VERSION,
      keyId,
      type: input.type,
      createdAt: now,
      updatedAt: now,
      summary,
      secret,
    };

    await this.db.transaction('rw', this.db.vaultKeys, this.db.vaultRecords, async () => {
      await this.assertDbKeyId(keyId);
      this.session.assertEpoch(epoch);
      await this.db.vaultRecords.add(row);
    });
    return id;
  }

  /** 保留 createdAt,更新 updatedAt,两段都用新 IV 重新加密。记录不存在抛 NotFoundError */
  async updateRecord(id: string, input: VaultRecordInput): Promise<void> {
    validateInput(input);
    const { key, keyId, epoch } = this.session.requireKey();
    this.session.touch();

    const [summary, secret] = await this.encryptInput(input, id, key);

    await this.db.transaction('rw', this.db.vaultKeys, this.db.vaultRecords, async () => {
      await this.assertDbKeyId(keyId);
      const existing = await this.db.vaultRecords.get(id);
      if (!existing) throw new NotFoundError();
      this.session.assertEpoch(epoch);
      await this.db.vaultRecords.put({
        id,
        formatVersion: VAULT_FORMAT_VERSION,
        keyId,
        type: input.type,
        createdAt: existing.createdAt,
        updatedAt: this.now(),
        summary,
        secret,
      });
    });
  }

  async deleteRecord(id: string): Promise<void> {
    const { keyId, epoch } = this.session.requireKey();
    this.session.touch();

    await this.db.transaction('rw', this.db.vaultKeys, this.db.vaultRecords, async () => {
      await this.assertDbKeyId(keyId);
      if (!(await this.db.vaultRecords.get(id))) throw new NotFoundError();
      this.session.assertEpoch(epoch);
      await this.db.vaultRecords.delete(id);
    });
  }

  /** 等后台任务(KDF 静默升级)结束。主要给测试用 */
  async idle(): Promise<void> {
    while (this.background.size > 0) await Promise.allSettled([...this.background]);
  }

  // —— 内部:wrapper ————————————————————————————————————

  private async loadKeys(): Promise<VaultKeys> {
    const keys = await this.db.vaultKeys.get('singleton');
    if (!keys) throw new NotInitializedError();
    assertKeysShape(keys);
    return keys;
  }

  /** 返回的 wrapKey 不可导出,可以留给后台升级复用;raw 由调用方清零 */
  private async unwrapWithMaster(
    keys: VaultKeys,
    password: string
  ): Promise<{ raw: Uint8Array; wrapKey: CryptoKey }> {
    const wrapKey = await this.crypto.deriveMasterWrapKey(password, keys.wrapper.master.kdf);
    const raw = await this.crypto.unwrap(keys.wrapper.master, wrapKey);
    await this.assertKeyIdOrWipe(raw, keys.wrapper.keyId);
    return { raw, wrapKey };
  }

  private async unwrapWithRecovery(keys: VaultKeys, input: string): Promise<Uint8Array> {
    const bytes = await this.crypto.parseRecoveryKey(input);
    try {
      const wrapKey = await this.crypto.deriveRecoveryWrapKey(bytes);
      const raw = await this.crypto.unwrap(keys.wrapper.recovery, wrapKey);
      await this.assertKeyIdOrWipe(raw, keys.wrapper.keyId);
      return raw;
    } finally {
      wipe(bytes);
    }
  }

  private async assertKeyIdOrWipe(raw: Uint8Array, expected: Uint8Array): Promise<void> {
    try {
      const actual = await this.crypto.computeKeyId(raw);
      if (!equalBytes(actual, expected)) throw new CorruptError();
    } catch (error) {
      wipe(raw);
      throw error;
    }
  }

  /** 用内存里的新密钥把刚包装的结果解一遍,确认能还原出同一个 keyId */
  private async trialUnwrap(
    wrapped: WrappedKey,
    wrapKey: CryptoKey,
    expectedKeyId: Uint8Array
  ): Promise<void> {
    const raw = await this.crypto.unwrap(wrapped, wrapKey);
    await this.assertKeyIdOrWipe(raw, expectedKeyId);
    wipe(raw);
  }

  /** 用新主密码重新包装 Vault Key 并提交。改主密码、Recovery 步骤一、KDF 升级共用 */
  private async commitMasterWrapper(
    read: VaultKeys,
    raw: Uint8Array,
    newPassword: string,
    options: { rotationRequired?: true } = {}
  ): Promise<void> {
    const kdf = this.policy.create();
    const wrapKey = await this.crypto.deriveMasterWrapKey(newPassword, kdf);
    const wrapped = await this.crypto.wrap(raw, wrapKey);
    await this.trialUnwrap(wrapped, wrapKey, read.wrapper.keyId);

    await this.commitKeys(read, current => ({
      ...current,
      recoveryRotationRequired: options.rotationRequired ?? current.recoveryRotationRequired,
      wrapper: { ...current.wrapper, master: { ...wrapped, kdf } },
    }));
  }

  /** 短事务:revision 与 keyId 都没变才写入,revision + 1,提交后广播 */
  private async commitKeys(read: VaultKeys, change: (current: VaultKeys) => VaultKeys): Promise<void> {
    await this.db.transaction('rw', this.db.vaultKeys, async () => {
      const current = await this.db.vaultKeys.get('singleton');
      if (
        !current ||
        current.wrapper.revision !== read.wrapper.revision ||
        !equalBytes(current.wrapper.keyId, read.wrapper.keyId)
      ) {
        throw new ConflictError();
      }
      const changed = change(current);
      await this.db.vaultKeys.put({
        ...changed,
        updatedAt: this.now(),
        wrapper: { ...changed.wrapper, revision: current.wrapper.revision + 1 },
      });
    });
    this.session.announce('wrapper-changed');
  }

  private async upgradeKdf(read: VaultKeys, password: string, oldWrapKey: CryptoKey): Promise<void> {
    const raw = await this.crypto.unwrap(read.wrapper.master, oldWrapKey);
    try {
      await this.commitMasterWrapper(read, raw, password);
    } finally {
      wipe(raw);
    }
  }

  private runInBackground(task: () => Promise<void>): void {
    // 升级失败(冲突、库被替换等)不影响已经成功的解锁,下次解锁会再尝试
    const promise: Promise<void> = task()
      .catch(() => undefined)
      .finally(() => this.background.delete(promise));
    this.background.add(promise);
  }

  // —— 内部:记录 ——————————————————————————————————————

  private async encryptInput(
    input: VaultRecordInput,
    id: string,
    key: CryptoKey
  ): Promise<[VaultRecord['summary'], VaultRecord['secret']]> {
    const summary: VaultSummaryPlain = { title: input.title, tags: input.tags };
    const secret: VaultSecretPlain = {
      secret: input.secret,
      username: input.username,
      url: input.url,
      notes: input.notes,
    };
    return Promise.all([
      this.crypto.encryptSegment(summary, key, segmentContext(id, input.type, 'summary')),
      this.crypto.encryptSegment(secret, key, segmentContext(id, input.type, 'secret')),
    ]);
  }

  private decryptRow<T>(row: VaultRecord, segment: RecordSegment, key: CryptoKey): Promise<T> {
    if (row.formatVersion !== VAULT_FORMAT_VERSION) return Promise.reject(new CorruptError());
    return this.crypto.decryptSegment<T>(
      row[segment],
      key,
      segmentContext(row.id, row.type, segment)
    );
  }

  /** 在写记录的事务里调用:库里当前的 keyId 必须等于 Session 的,否则库已被导入或替换 */
  private async assertDbKeyId(sessionKeyId: Uint8Array): Promise<void> {
    const keys = await this.db.vaultKeys.get('singleton');
    if (!keys || !equalBytes(keys.wrapper.keyId, sessionKeyId)) throw new ConflictError();
  }
}

function segmentContext(
  recordId: string,
  type: VaultRecordType,
  segment: RecordSegment
): SegmentContext {
  return { recordId, type, formatVersion: VAULT_FORMAT_VERSION, segment };
}

function requirePassword(password: string): void {
  if (typeof password !== 'string' || password.length === 0) {
    throw new TypeError('Master password is required');
  }
}

function validateInput(input: VaultRecordInput): void {
  const optionalStrings = [input.username, input.url, input.notes];
  const valid =
    (VAULT_RECORD_TYPES as readonly string[]).includes(input.type) &&
    typeof input.title === 'string' &&
    typeof input.secret === 'string' &&
    optionalStrings.every(v => v === undefined || typeof v === 'string') &&
    (input.tags === undefined ||
      (Array.isArray(input.tags) && input.tags.every(t => typeof t === 'string')));
  if (!valid) throw new TypeError('Invalid record input');
}

function isBytes(value: unknown, length: number): boolean {
  return ArrayBuffer.isView(value) && value.byteLength === length;
}

/** 只检查结构,密码学上的校验由解开 wrapper 时完成 */
function assertKeysShape(keys: VaultKeys): void {
  const wrapper = keys.wrapper;
  const valid =
    !!wrapper &&
    wrapper.formatVersion === VAULT_FORMAT_VERSION &&
    Number.isInteger(wrapper.revision) &&
    wrapper.revision >= 0 &&
    isBytes(wrapper.keyId, KEY_ID_LENGTH) &&
    !!wrapper.master &&
    !!wrapper.master.kdf &&
    !!wrapper.recovery;
  if (!valid) throw new CorruptError();
}
