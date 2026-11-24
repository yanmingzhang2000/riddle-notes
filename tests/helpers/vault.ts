import { RiddleVaultDB } from '../../src/db/vault-schema';
import { CryptoService } from '../../src/vault/crypto/crypto-service';
import type { PasswordPolicy } from '../../src/vault/services/password-policy';
import { VaultService, type KdfPolicy } from '../../src/vault/services/vault-service';
import { VaultSession } from '../../src/vault/services/vault-session';
import type { KdfParams, VaultKeys, VaultRecord } from '../../src/vault/types';

/** 每个测试用一个全新的库名,互不影响。fake-indexeddb 在内存里,不会碰真实数据 */
let counter = 0;
export function createTestVaultDb(name?: string): RiddleVaultDB {
  return new RiddleVaultDB(name ?? `RiddleVaultDB-test-${Date.now()}-${counter++}`);
}

/** 测试里用很小的迭代次数加快速度;生产参数另有专门的用例 */
export function fastKdfPolicy(iterations = 1000): KdfPolicy {
  return {
    create: (): KdfParams => ({
      algorithm: 'PBKDF2-SHA256',
      iterations,
      salt: crypto.getRandomValues(new Uint8Array(32)),
    }),
    needsUpgrade: kdf => kdf.algorithm === 'PBKDF2-SHA256' && kdf.iterations < iterations,
  };
}

/**
 * 宽松的强度策略:任何非空密码都放行。**只给测试用**。
 * 生产默认是严格策略;现有测试里有大量 'wrong'、'x'、'another' 这样的短密码,
 * 它们测的是别的行为(认证失败、并发冲突),不该被强度策略挡住。
 * 严格策略有专门的测试(tests/vault/password-policy.test.ts)。
 */
export const permissivePasswordPolicy: PasswordPolicy = {
  async evaluate(password) {
    const length = Array.from(password.normalize('NFKC')).length;
    return { score: 4, length, ok: true, issues: [] };
  },
};

export interface TestVault {
  name: string;
  db: RiddleVaultDB;
  session: VaultSession;
  crypto: CryptoService;
  service: VaultService;
  channelName: string;
}

const created: TestVault[] = [];

export interface TestVaultOptions {
  /** 共用同一个库和广播频道,模拟打开了两个 Side Panel */
  peerOf?: TestVault;
  kdfPolicy?: KdfPolicy;
  /** 不传就用宽松策略。要测严格策略时传 DEFAULT_PASSWORD_POLICY */
  passwordPolicy?: PasswordPolicy;
  now?: () => number;
  newId?: () => string;
}

export function createTestVault(options: TestVaultOptions = {}): TestVault {
  const id = counter++;
  const name = options.peerOf?.name ?? `RiddleVaultDB-test-${Date.now()}-${id}`;
  const channelName = options.peerOf?.channelName ?? `test-vault-channel-${Date.now()}-${id}`;
  const db = new RiddleVaultDB(name);
  const session = new VaultSession({ channelName });
  const cryptoService = new CryptoService();
  const service = new VaultService({
    db,
    session,
    crypto: cryptoService,
    kdfPolicy: options.kdfPolicy ?? fastKdfPolicy(),
    passwordPolicy: options.passwordPolicy ?? permissivePasswordPolicy,
    now: options.now,
    newId: options.newId,
  });
  const vault = { name, db, session, crypto: cryptoService, service, channelName };
  created.push(vault);
  return vault;
}

/** afterEach 里调用:释放 BroadcastChannel 和数据库连接 */
export async function disposeTestVaults(): Promise<void> {
  for (const vault of created.splice(0)) {
    vault.session.dispose();
    vault.db.close();
  }
}

/** 让 n 个调用者都到达之后才一起放行,用来把并发操作卡在同一个位置 */
export function createBarrier(parties: number) {
  let arrived = 0;
  let release!: () => void;
  const open = new Promise<void>(resolve => (release = resolve));
  return {
    wait: async () => {
      if (++arrived >= parties) release();
      await open;
    },
  };
}

/** 手动开关的门:先 hold,需要时 release */
export function createGate() {
  let release!: () => void;
  const open = new Promise<void>(resolve => (release = resolve));
  return { wait: () => open, release };
}

export const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export const PASSWORD = 'correct horse battery staple';

/** 建一个已初始化、会话打开的保险箱,返回初始化时展示的 Recovery Key */
export async function createInitializedVault(
  options: TestVaultOptions = {}
): Promise<TestVault & { recoveryKey: string }> {
  const vault = createTestVault(options);
  let recoveryKey = '';
  await vault.service.initialize(PASSWORD, async formatted => {
    recoveryKey = formatted;
  });
  return Object.assign(vault, { recoveryKey });
}

/** 四张表的全部内容,用来断言"失败后数据库没有任何变化" */
export async function snapshotVault(db: RiddleVaultDB) {
  return {
    keys: await db.vaultKeys.toArray(),
    settings: await db.vaultSettings.toArray(),
    records: await db.vaultRecords.toArray(),
    snapshot: await db.vaultSnapshot.toArray(),
  };
}

/** 直接改库里的 vaultKeys,模拟损坏、篡改或被另一个实例修改 */
export async function tamperKeys(db: RiddleVaultDB, change: (keys: VaultKeys) => void) {
  const keys = (await db.vaultKeys.get('singleton'))!;
  change(keys);
  await db.vaultKeys.put(keys);
}

/**
 * 记录服务拿到的原始密钥字节(Vault Key、Recovery Key、unwrap 的结果),
 * 测试结束时断言它们都已经清零。
 */
export function trackKeyMaterial(service: CryptoService): Uint8Array[] {
  const tracked: Uint8Array[] = [];
  const generate = service.generateVaultKeyBytes.bind(service);
  const generateRecovery = service.generateRecoveryKey.bind(service);
  const unwrap = service.unwrap.bind(service);
  const parse = service.parseRecoveryKey.bind(service);

  service.generateVaultKeyBytes = () => {
    const bytes = generate();
    tracked.push(bytes);
    return bytes;
  };
  service.generateRecoveryKey = async () => {
    const result = await generateRecovery();
    tracked.push(result.bytes);
    return result;
  };
  service.unwrap = async (...args) => {
    const bytes = await unwrap(...args);
    tracked.push(bytes);
    return bytes;
  };
  service.parseRecoveryKey = async input => {
    const bytes = await parse(input);
    tracked.push(bytes);
    return bytes;
  };
  return tracked;
}

export const isZeroed = (bytes: Uint8Array) => bytes.every(b => b === 0);

export const toHex = (b: Uint8Array) => Buffer.from(b).toString('hex');

/** 在字节数组里找子序列,扫描密文有没有漏出明文 */
export function containsSubarray(haystack: Uint8Array, needle: Uint8Array): boolean {
  if (needle.length === 0) return true;
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

const bytes = (n: number, fill: number) => new Uint8Array(n).fill(fill);

export function makeKeys(overrides: Partial<VaultKeys> = {}): VaultKeys {
  return {
    id: 'singleton',
    wrapper: {
      master: {
        wrappedKey: bytes(48, 1),
        iv: bytes(12, 2),
        kdf: { algorithm: 'PBKDF2-SHA256', iterations: 600_000, salt: bytes(32, 3) },
      },
      recovery: { wrappedKey: bytes(48, 4), iv: bytes(12, 5) },
      keyId: bytes(8, 6),
      revision: 1,
      formatVersion: 1,
    },
    recoveryRotationRequired: false,
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

export function makeRecord(id: string, overrides: Partial<VaultRecord> = {}): VaultRecord {
  return {
    id,
    formatVersion: 1,
    keyId: bytes(8, 6),
    type: 'api_key',
    createdAt: 1000,
    updatedAt: 1000,
    summary: { iv: bytes(12, 7), data: bytes(30, 8) },
    secret: { iv: bytes(12, 9), data: bytes(40, 10) },
    ...overrides,
  };
}
