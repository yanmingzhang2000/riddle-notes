# Riddle Notes Secure Vault — 技术架构方案

**版本**: 1.2  
**状态**: 评审中。Task 1.1–1.3、2.1（含主密码强度策略）、2.3、Phase 3 UI 的主体、Task 4.2 的设置页已实现并有 jsdom 测试；Task 1.0 的两个 spike 只完成了 Node 侧；备份（Phase 4.1）未开始。**所有 UI 都没有在真实 Chrome 里渲染或点过一次**，下面这些只有在真实 Chrome 里才能确认，见 §14：Side Panel 关闭是否销毁页面（R4）、浏览器会不会弹"保存密码"、页面实际长什么样、低端机上的 KDF 耗时。进度以 §7 的勾选为准。  
**范围**: 加密机制、密钥管理、数据存储、运行时安全、开发计划

> 本文档是设计。实现在 `src/vault/` 与 `src/db/vault-schema.ts`，测试在 `tests/vault/`（22 个文件、941 个用例，全部通过）。仓库全量测试另有 64 个失败，分布在 6 个与保险箱无关的文件里（chatgpt、claude、deepseek、gemini、update-service、workbuddy 的集成测试），在保险箱的改动开始之前就存在，没有新增。文中代码块是接口与流程示意，不是可直接运行的实现；**与代码不一致时以代码和测试为准**。产品需求见对话中的 PRD，仓库里尚无 `vault-prd.md`。

## 目录

1. [加密架构设计](#1-加密架构设计)
2. [密钥管理方案](#2-密钥管理方案)
3. [数据存储设计](#3-数据存储设计)
4. [运行时安全](#4-运行时安全)
5. [核心服务](#5-核心服务)
6. [UI 组件架构](#6-ui-组件架构)
7. [开发任务拆分](#7-开发任务拆分)
8. [风险与缓解](#8-风险与缓解)
9. [测试策略](#9-测试策略)
10. [UI 设计建议](#10-ui-设计建议)
11. [后续扩展预留](#11-后续扩展预留)
12. [安全审查 Checklist](#12-安全审查-checklist)
13. [验收标准](#13-验收标准)
14. [开工顺序与待决策](#14-开工顺序与待决策)

---

## 1. 加密架构设计

### 1.1 密钥层级

```
Master Password（不持久化，KDF 前 NFKC 规范化）
    ↓ KDF（PBKDF2-SHA256 或 Argon2id，随机 salt）
Master Wrap Key（运行时）──加密──┐
                                 ├──→ Vault Key 的两份密文（持久化）
Recovery Key（256 bit，不持久化）│
    ↓ HKDF-SHA256               │
Recovery Wrap Key（运行时）──加密─┘

Vault Key（32 字节随机，Session 里 extractable:false）
    ↓ AES-256-GCM，每段独立 IV，AAD 绑定记录上下文
加密记录（持久化）
```

**为什么用 Vault Key 而不是直接用主密码加密记录**

- 改主密码只需重新加密 32 字节的 Vault Key，不必重加密所有记录
- Recovery Key 是同一个 Vault Key 的第二条独立解密路径
- 后续 KDF 升级、算法升级、多设备同步都有统一入口

### 1.2 KDF 选择

OWASP 把 Argon2id 列为首选（最低配置 19 MiB、t=2、p=1）；PBKDF2-SHA256 的 600k 次迭代只是满足 FIPS 合规时的最低线。本产品没有 FIPS 需求。PBKDF2 不占内存，对 GPU 并行有利，而最现实的威胁是加密备份被放进网盘或邮箱后离线破解。

**因为现在没有存量用户，格式还没冻结，所以该在冻结之前把 Argon2id 评估清楚**，而不是先上 PBKDF2 再迁移。

- 先做 Task 1.0 的 spike：评估 `hash-wasm` / `@noble/hashes`，验证 manifest 加 `'wasm-unsafe-eval'`（这不等于允许 `eval`），在低端设备实测，起点参数 m=64MiB、t=3、p=1，目标 ≤1s 且不低于 OWASP 最低配置。
- **无论 spike 结果如何，`KdfParams` 都是带 `algorithm` 判别字段的联合类型**（§2.1），`deriveMasterWrapKey(password, kdf)` 按它分派。这样 Argon2id 随时可以接入。
- 若排期不允许上 Argon2id，PBKDF2-SHA256 600k 不阻塞 v1，但解锁成功后若参数低于当前策略，必须静默重包装（走 §2.3 的 CAS）。
- **不提供"选择 KDF"的设置项**。让用户自选会增加降级与混淆风险，由产品定默认值并自动升级。


### 1.3 加密算法

AES-256-GCM，Web Crypto 实现，不自行实现任何密码学原语。

| 参数 | 值 |
|------|------|
| 密钥 | 256 bit |
| IV | 12 字节，`getRandomValues`，**每次加密新生成，调用方无法传入** |
| 认证标签 | 128 bit |
| AAD | 记录段绑定 `recordId \| type \| formatVersion \| segment`，见 §3.2 |

**规则**

- 同一 Vault Key 下 IV 不能重复。96 bit 随机 IV 在个人 Vault 的规模下碰撞概率可忽略（NIST 对随机 IV 的上限是单密钥约 2^32 次）。
- 每次新建、编辑都生成新 IV。
- 解密前校验 `iv.length === 12`，导入文件同样校验。
- 记录的存储结构见 §3.2，包装的存储结构见 §2.1。

---

## 2. 密钥管理方案

### 2.1 Vault Key 与 Wrapper

**Vault Key**：32 字节，`crypto.getRandomValues` 生成。只在初始化时以原始字节形式短暂存在，用完立刻 `fill(0)`。Session 里持有的是 `extractable: false` 的 `CryptoKey`。

**存储结构**

```typescript
type KdfParams =
  | { algorithm: 'PBKDF2-SHA256'; iterations: number; salt: Uint8Array }
  | { algorithm: 'Argon2id'; memoryKiB: number; timeCost: number; parallelism: number; salt: Uint8Array };

interface MasterWrapper {
  wrappedKey: Uint8Array;   // AES-GCM(Vault Key)，含 16 字节 tag
  iv: Uint8Array;           // 12 字节
  kdf: KdfParams;
}

interface RecoveryWrapper {
  wrappedKey: Uint8Array;
  iv: Uint8Array;
  // 没有 kdf：Recovery Key 本身 256 bit，用 HKDF 派生，见 §2.2
}

interface VaultKeyWrapper {
  master: MasterWrapper;
  recovery: RecoveryWrapper;
  keyId: Uint8Array;        // HKDF(vaultKey, info="riddle-notes/vault/key-id/v1") 前 8 字节，明文
  revision: number;         // 每次提交 +1，乐观锁用
  formatVersion: 1;
}
```

`keyId` 的用途：记录写入前比对 Session 的 `keyId` 与当前库的 `keyId`，不一致说明库已被导入或替换，拒绝写入，避免写出永远解不开的记录。

### 2.2 Recovery Key

#### 规范格式（冻结项）

```
RN-V1-AAAQ-EAYE-AUDA-OCAJ-BIFQ-YDIO-B4IB-CEQT-CQKR-MFYY-DENB-WHA5-DYPQ-MMG4
```

| 部分 | 内容 | 长度 |
|------|------|------|
| `RN-V1-` | 固定前缀，含版本 | 6 |
| 数据 | 32 字节的 Base32（RFC 4648 字母表 `A–Z2–7`，无 padding） | 52 字符，13 组 × 4 |
| 校验 | 见下 | 4 字符，1 组 |
| 分隔符 | 每组之间一个 `-` | 15 个 |

总长 75 个字符（60 个编码字符 + 15 个连字符）。展示时 `RN-V1` 不参与编码和校验。

**填充位**：52 个字符编码 260 bit，32 字节只有 256 bit，末字符低 4 位是填充位。解码时**必须要求这 4 位为 0**，否则两个不同的字符串会解出同一个 Key。

**校验和**：`SHA-256(32 字节原始 Key)` 的前 20 bit，编码成 4 个 Base32 字符。选 SHA-256 而不是 CRC-16，是因为 Web Crypto 已有，不用再引入 CRC 实现，且 4 个字符正好是 20 bit，不需要补位。

```
校验值 v = (h[0] << 12) | (h[1] << 4) | (h[2] >>> 4)     // h = SHA-256(key)，共 20 bit
校验字符 = 依次取 v 的 [19:15] [14:10] [9:5] [4:0]，查字母表
```

校验和只用来区分"输错字符"和"Key 不对"，不提供安全性。

#### 测试向量

以下由 `node:crypto` 实际计算得出，Task 1.2 的单元测试必须逐字比对。

| 输入（32 字节，hex） | 完整字符串 |
|------|------|
| `000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f` | `RN-V1-AAAQ-EAYE-AUDA-OCAJ-BIFQ-YDIO-B4IB-CEQT-CQKR-MFYY-DENB-WHA5-DYPQ-MMG4` |
| 全 `0x00` | `RN-V1-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-MZUH` |
| 全 `0xff` | `RN-V1-7777-7777-7777-7777-7777-7777-7777-7777-7777-7777-7777-7777-777Q-V6LB` |

全 `0xff` 的末数据组是 `777Q` 而不是 `7777`，这是填充位的体现。

**必须拒绝的输入**（各写一条用例）：
- 末数据字符的填充位非 0（例如把 `DYPQ` 改成 `DYPR`，校验和也相应重算，仍应拒绝）
- 含 `0 1 8 9`（不在字母表内）
- 缺组、多组、前缀不是 `RN-V1`
- 校验组与数据不匹配

#### 输入规范化

```typescript
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

type RecoveryKeyError = 'format' | 'checksum';

// 校验和用 WebCrypto 的 SHA-256，所以是异步的
async function parseRecoveryKey(input: string): Promise<Uint8Array> {
  const clean = input.normalize('NFKC').toUpperCase().replace(/[\s-]/g, '');
  if (!clean.startsWith('RNV1') || clean.length !== 4 + 52 + 4) throw new RecoveryKeyFormatError();
  const data = clean.slice(4, 56);
  const check = clean.slice(56);
  if (![...data, ...check].every(c => ALPHABET.includes(c))) throw new RecoveryKeyFormatError();

  const bytes = base32Decode(data);          // 必须校验末字符低 4 位为 0，否则 throw RecoveryKeyFormatError
  if (check !== (await checksumOf(bytes))) throw new RecoveryKeyChecksumError();
  return bytes;                              // 32 字节
}
```

#### 派生包装密钥

Recovery Key 本身有 256 bit 熵，不需要慢 KDF，用 HKDF-SHA256 即可。`usages` 必须是 `['encrypt','decrypt']`，因为后面直接调 `subtle.encrypt/decrypt` 包装 Vault Key，写成 `wrapKey/unwrapKey` 会抛 `InvalidAccessError`。

```typescript
async function deriveRecoveryWrapKey(keyBytes: Uint8Array): Promise<CryptoKey> {
  const ikm = await crypto.subtle.importKey('raw', keyBytes, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(0),
      info: new TextEncoder().encode('riddle-notes/vault/recovery-wrap/v1'),
    },
    ikm,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}
```

#### 下载与展示

- 下载为 `.txt` 时在文件头写明：「此文件无需主密码即可打开你的保险箱，请勿与加密备份放在同一位置。」
- Recovery Key 不落库，所有字段都无法让它之后被导出。Settings 里提供的是"重新生成"，不是"导出"。

### 2.3 状态与乐观锁

状态拆成 `vaultKeys` 和 `vaultSettings` 两张表（wrapper 和设置不放在同一条记录里），避免改设置时对 wrapper 做读改写：

```typescript
interface VaultKeys {           // 表 vaultKeys，主键 'singleton'；记录不存在 = 未初始化
  id: 'singleton';
  wrapper: VaultKeyWrapper;
  recoveryRotationRequired: boolean;
  createdAt: number;
  updatedAt: number;
}

interface VaultSettings {       // 表 vaultSettings，主键 'singleton'
  id: 'singleton';
  autoLockTimeoutMs: number;    // 60_000 | 300_000 | 900_000 | 0（Never）
}
```

**所有改写 `vaultKeys` 的操作统一模式**（初始化除外）：

1. 事务外读取，记下 `expectedRevision`。
2. 事务外完成全部 KDF 和加解密。IDB 事务在没有待处理请求时会自动提交，`crypto.subtle` 的 Promise 不属于 IDB 请求，事务里 `await` 它会让事务提前结束。
3. 提交前用内存里的新密钥试解一次新 wrapper，确认还原出同一个 `keyId`。
4. 开短事务：`if (current.wrapper.revision !== expectedRevision) throw new ConflictError()`，通过才 `put`，`revision + 1`。
5. 提交后广播 `wrapper-changed`。

这个模式用于：改主密码、Recovery 两步、重新生成 Recovery Key、KDF 自动升级重包装。

**初始化**则用存在性检查：事务里 `get('singleton')` 非空就中止，否则 `add`。

### 2.4 Recovery 流程

两步，每步一个独立方法，步骤一成功后即使用户关闭面板也不会锁死：

```
步骤一  recoverAccess(recoveryKeyInput, newMasterPassword)
        ├─ parseRecoveryKey → deriveRecoveryWrapKey → 解开 Vault Key
        ├─ 用新主密码做 KDF，包装 Vault Key，试解
        ├─ 短事务：校验 revision，写入新 master wrapper，recoveryRotationRequired = true
        └─ 返回 { accessRestored: true, rotationRequired: true }
           此时新主密码已生效，旧 Recovery Key 仍然有效

步骤二  rotateRecoveryKey(requireMasterPassword, onGenerated)
        ├─ 先用主密码重新验证（verifyMasterPassword，不碰 Session）
        ├─ 内存生成新 Recovery Key，调用 onGenerated 让用户回填校验
        ├─ 回填通过后：包装、试解
        ├─ 短事务：校验 revision，替换 recovery wrapper，recoveryRotationRequired = false
        └─ 回调取消或抛错：什么都不写，旧 Recovery Key 继续有效
```

步骤二失败不影响步骤一的结果。UI 在 `recoveryRotationRequired` 为 true 时持续提示，直到步骤二完成。Settings 里的"重新生成 Recovery Key"复用 `rotateRecoveryKey`。

### 2.5 威胁模型说明

- "旧 Key 失效"只对当前库成立。旧备份文件里的旧 recovery wrapper 仍可用旧 Key 解开，改主密码同理。UI 文案写"替换当前恢复密钥"，不写"旧密钥作废"。
- 要真正撤销旧密钥需要"轮换 Vault Key"：重加密所有记录并在同一事务里替换两个 wrapper。本期不做。
- 防护目标：离线窃取 IndexedDB 或备份文件、旁人使用已解锁设备。
- 不防护：同权限的恶意软件、内存取证、键盘记录器。JS 无法清零字符串，明文要等 GC。
- 明文元数据：`type`、`createdAt`、`updatedAt`、记录数、密文长度。接受这个泄露，换取列表分类不需要先解密。

---


## 3. 数据存储设计

### 3.1 独立数据库

Vault 使用独立的 Dexie 数据库 `RiddleVaultDB`，不放进现有的 `SidecarDB`（当前 v3）。

- `SidecarDB` 升级失败不会连带 Vault，反过来也一样。
- 将来任何"重置数据库"功能对 `SidecarDB` 调 `delete()` 都不会误删 Vault。
- 现有 `createBackup/restoreBackup` 用显式表名，Notes 的导入导出和搜索不会碰 Vault 表。

```typescript
// src/db/vault-schema.ts
export class RiddleVaultDB extends Dexie {
  vaultKeys!: Table<VaultKeys, string>;
  vaultSettings!: Table<VaultSettings, string>;
  vaultRecords!: Table<VaultRecord, string>;
  vaultSnapshot!: Table<VaultSnapshot, string>;

  constructor() {
    super('RiddleVaultDB');
    this.version(1).stores({
      vaultKeys: 'id',
      vaultSettings: 'id',
      vaultRecords: 'id, type, updatedAt',
      vaultSnapshot: 'id',
    });
  }
}

export const vaultDb = new RiddleVaultDB();
```

`vaultSnapshot` 在 v1 就建好。发布前加进 v1 不需要迁移，发布后再加就要 v2。

**未初始化的判定**：`vaultKeys` 里没有 `singleton` 记录。不预写 `keyWrapper: null`，也不设 `initialized` 字段，少一个状态。

### 3.2 记录结构

```typescript
type VaultRecordType = 'api_key' | 'password' | 'database' | 'secure_note';

interface VaultRecord {
  id: string;                    // UUID
  formatVersion: 1;
  keyId: Uint8Array;             // 写入时 Session 的 keyId，见 §2.1
  type: VaultRecordType;         // 明文，列表分类用
  createdAt: number;
  updatedAt: number;

  summary: { iv: Uint8Array; data: Uint8Array };   // { title, tags? }
  secret:  { iv: Uint8Array; data: Uint8Array };   // { secret, username?, url?, notes? }
}
```

**两段加密**：列表页只解密 `summary` 取标题；详情页才解密 `secret`，离开详情页即清除。

**AAD**：两段密文都绑定同一个 AAD，AAD 会改变密文格式，所以必须在 Task 1.2 一次定下来，不能事后加。

```
AAD = UTF-8( "riddle-notes/vault/record/v1" | recordId | type | formatVersion | segment )
segment ∈ { "summary", "secret" }
```

好处：篡改明文的 `type`、把 A 记录的密文放到 B 记录上、把 summary 和 secret 互换，解密都会失败。

**更新**：`updateRecord` 保留原 `createdAt`，记录不存在时抛错，不当作新建。

### 3.3 备份快照

```typescript
interface VaultSnapshot {
  id: 'pre-import';              // 同一时刻只保留一份
  createdAt: number;
  keys: VaultKeys;
  settings: VaultSettings | null;
  records: VaultRecord[];
}
```

覆盖导入前写入，导入后首次成功解锁再删除，见 §7 Task 4.1。

### 3.4 数据隔离原则

**允许存储（均不含明文）**：格式版本、KDF 参数、salt、两个 wrapper 密文、`keyId`、`revision`、加密记录、IV、`type` 和时间戳。

**不允许存储**：主密码、明文 Vault Key、明文 Recovery Key、任何明文秘密字段。

---


## 4. 运行时安全

### 4.1 生命周期

- **Session 只存在于 Side Panel 页面的 JS 内存里**，不放进 Service Worker。
- **Side Panel 关闭即锁定**：页面销毁，Vault Key 随之消失。代价是每次重新打开都要付一次 KDF 成本，需要在 UX 上说明。
- 浏览器关闭、扩展重新加载同理。
- 这是基于"Side Panel 关闭会销毁页面"的假设，**没有实测**，Phase 1 先用一个小 spike 验证（见 Task 1.0）。
- 可以同时存在多个 Side Panel 实例，各自有独立的 Session，用 BroadcastChannel 同步（§4.3）。

### 4.2 VaultSession 接口

```typescript
class VaultSession {
  private key: CryptoKey | null = null;     // extractable: false
  private keyId: Uint8Array | null = null;
  private epoch = 0;
  private lastActivity = 0;
  private subscribers = new Set<() => void>();
  private channel = new BroadcastChannel('riddle-vault');

  private timeoutMs: number | null = null;          // 自动锁定超时的内存缓存，见 §4.3
  private settingsListeners = new Set<() => void>();

  constructor(private getTimeoutMs: () => number) {   // 默认来源；setAutoLockTimeoutMs 之后内存值优先
    this.channel.onmessage = (e) => {
      // 只做本地处理，不再广播，否则两个实例会无限互相触发
      if (e.data?.type === 'lock' || e.data?.type === 'wrapper-changed' || e.data?.type === 'imported') {
        this.lockLocal();
      } else if (e.data?.type === 'settings-changed') {
        this.settingsListeners.forEach(cb => cb());   // 不锁定，只通知监听者去重新读设置
      }
    };
  }

  // 订阅，供 useSyncExternalStore 使用
  subscribe = (cb: () => void) => { this.subscribers.add(cb); return () => this.subscribers.delete(cb); };
  getEpoch = () => this.epoch;

  /** key 必须是 extractable:false 导入的 */
  open(key: CryptoKey, keyId: Uint8Array): void {
    this.key = key; this.keyId = keyId;
    this.lastActivity = Date.now();
    this.epoch++; this.notify();
  }

  /** 用户或超时触发：本地锁定并通知其他实例 */
  lock(): void { this.lockLocal(); this.channel.postMessage({ type: 'lock' }); }

  /** 收到广播时调用：只清本地，不广播 */
  lockLocal(): void {
    this.key = null; this.keyId = null; this.lastActivity = 0;
    this.epoch++; this.notify();
  }

  /** 提交改密码、recover、导入之后调用 */
  announce(type: 'wrapper-changed' | 'imported'): void { this.channel.postMessage({ type }); }

  touch(): void { if (this.key) this.lastActivity = Date.now(); }

  /** 当前生效的超时（毫秒，0 = Never）：内存值优先，没设过就用构造时的回调 */
  getAutoLockTimeoutMs(): number { return this.timeoutMs ?? this.getTimeoutMs(); }
  /** 由服务层推进来：解锁/恢复时从库里读出的值，或用户刚改的值。只校验有限非负，几档由服务层管 */
  setAutoLockTimeoutMs(ms: number): void { /* 非有限或负数抛 TypeError */ this.timeoutMs = ms; }

  /** 设置改了之后通知其他面板。收到的面板不会被锁定 */
  announceSettingsChanged(): void { this.channel.postMessage({ type: 'settings-changed' }); }
  /** 收到其他面板的"设置变了"时回调，返回取消监听的函数 */
  onSettingsChanged(cb: () => void): () => void { this.settingsListeners.add(cb); return () => this.settingsListeners.delete(cb); }

  /** 定时器、visibilitychange 都调这个，对比 Date.now() 而不是依赖 setTimeout 精度。必须同步 */
  checkIdle(): void {
    const t = this.getAutoLockTimeoutMs();
    if (this.key && t > 0 && Date.now() - this.lastActivity >= t) this.lock();
  }

  requireKey(): { key: CryptoKey; keyId: Uint8Array; epoch: number } {
    if (!this.key || !this.keyId) throw new VaultLockedError();
    return { key: this.key, keyId: this.keyId, epoch: this.epoch };
  }

  assertEpoch(epoch: number): void { if (epoch !== this.epoch) throw new VaultLockedError(); }

  private notify() { this.subscribers.forEach(cb => cb()); }
}
```

要点：

- `lock()` 与 `lockLocal()` 分开。`onmessage` 只调 `lockLocal()`。
- `wrapper-changed` 和 `imported` 有明确的发送方：改主密码、Recovery 两步、重新生成 Recovery Key、KDF 重包装提交后发 `wrapper-changed`；覆盖导入提交后发 `imported`。收到的实例全部本地锁定。
- **广播分两类，不能混**：上面这些（连同 `lock`）是**锁定类**，收到就 `lockLocal()`；`settings-changed` 是**设置类**，收到只通知监听者重新读设置，**不锁定**。如果把它误放进锁定类，用户改一下自动锁定时间就会把所有面板锁掉；有测试专门守这一点。
- 上面的代码块是示意，与实现有出入（例如 `open` 还有 `expectedEpoch` 参数、另有 `isOpen`、`startIdleWatch` 等），**以 `src/vault/services/vault-session.ts` 为准**。
- `unlock` 不叫 `unlock()`，叫 `open(key, keyId)`。服务层只调这一个入口。
- Session 里不放解密后的记录，没有 `decryptedRecords` Map。

### 4.3 自动锁定

- 超时来自 `vaultSettings.autoLockTimeoutMs`，不写死。可选 1 / 5（默认）/ 15 分钟 / Never（存成 0）。
- **谁读、什么时候读**：设置存在 IndexedDB 里是异步的，而 `checkIdle()` 必须同步，所以 Session 里缓存一个内存值，由 `VaultService` 推进来：
  - `initialize` 提交后把默认值推给 Session；
  - `unlockWithMasterPassword`、`unlockWithRecoveryKey`、`recoverAccess` 在**拿到原始密钥字节之前**先读设置（`recoverAccess` 是在提交之前，免得提交之后多出一个可能失败的读库）；
  - `setAutoLockTimeout(ms)` 写库成功之后才更新本面板的 Session（写失败时内存和库一致），再通知其他面板；
  - 收到其他面板的 `settings-changed` 后重新读库。
- **读不出来怎么办**，两条路径故意不同：
  - 解锁、恢复时读失败，或库里的值缺失、不在可选范围内：用默认值，**不能因为读不出一个设置就让用户进不了自己的保险箱**。
  - 收到其他面板通知后刷新时读失败：**保持当前值**，不能因为一次读库失败就把用户选的 1 分钟悄悄改回 5 分钟。
- 改设置必须已解锁，值必须是上面四档之一（否则 `TypeError`），不要求重新输入主密码（不涉及密钥）。改设置算一次有效活动，会刷新计时。
- 多个面板同时改时，各面板最终都以库里的值为准（每次通知都会触发一次重读）。
- 用 `lastActivity` 加每 10 秒一次的 `checkIdle()` 轮询，不依赖单个长 `setTimeout`（系统休眠时计时可能不推进）。
- `visibilitychange` 变为 `visible` 时立即调一次 `checkIdle()`。回调里**不能直接 `await`**，只调同步的 `checkIdle()`，超时值由 Session 缓存。
- 有效活动：`keydown`、`pointerdown`、Vault 内的查看/编辑操作。单纯渲染、轮询、自动刷新不调 `touch()`。
- 如需"系统锁屏时锁定"，要加 `idle` 权限并监听 `chrome.idle`。本期不做。

### 4.4 锁定后的清理

锁定必须同时做到：

1. Session 清空 key 和 keyId，`epoch++`。
2. **在途异步失效**：每个服务方法开头 `const { key, epoch } = session.requireKey()`，每次 `await` 之后 `session.assertEpoch(epoch)`，不一致就丢弃结果并抛错。否则 `getRecord` 在 `await` 之间被锁定，仍会把明文返回给 UI。
3. **UI 同步卸载**：见 §6.3，`VaultGuard` 在已解锁分支里给 `<Outlet key={epoch}>`，锁定时整个 Vault 子树重建。`tests/vault/vault-routing.test.tsx` 验证了编辑页里输入到一半的秘密、详情页已展开的明文、搜索词在锁定后都不在页面上，也验证了"锁定和重新解锁发生在同一次渲染之间"这种状态始终是 `unlocked` 的情况。
4. **明文只存在于一处**：解密结果放在独立的 `VaultStore`（`src/vault/services/vault-store.ts`）里，不放在 Session 里（Session 不持有解密后的记录，见 §4.2）。`VaultStore` 在构造时订阅 Session，所以排在所有 React 组件的订阅前面：锁定时先于它们**同步清空**，组件重新渲染时读到的已经是空的。组件用 `useSyncExternalStore` 订阅，不在各自的 `useState` 里存副本。在途请求有两道防线：返回时对比开始时的 epoch，以及请求序号（连点两条记录时先发出的后返回不会盖掉后发出的）。`SecretField` 的 `<input value>` 会把明文放进 DOM 节点，改成显示时才渲染文本节点，隐藏时渲染固定的 `••••••••`。
   - **一个绕不开的例外**：编辑页要改内容，表单里必须有一份明文。做法是读出来填进表单之后立刻清掉 `VaultStore` 里的那一份，让同一时刻内存里只留一份；锁定时靠第 3 条把整个页面卸载来销毁表单 state，没保存的修改会丢。
   - **保证的范围**：目标是"锁定后 DOM 与组件 state 里没有"。JS 字符串无法清零，**不承诺内存取证安全**；堆快照检查（Task 5.1）没有做。
5. 搜索关键词只放组件 state，卸载即清除，不进 URL，不进表单历史。
6. 剪贴板：见 §4.5。

### 4.5 剪贴板（尽力而为）

原设计：复制秘密时在内存里记 `lastCopiedSecret`，锁定时尝试 `readText()`，若仍等于它就写入空串。

**实现时偏离了这个设计，没有记 `lastCopiedSecret`，等待决定**。理由有三：
1. 记在模块变量里的明文在锁定之后还留在内存里，和"锁定后不留明文"（§4.4）矛盾；要避免这一点就得再给它加一套锁定时清除的机制；
2. 它唯一的用途是锁定时和剪贴板内容比对，而 `readText()` 需要 `clipboardRead` 权限（manifest 里没有），自动锁定触发时面板通常没有焦点，会静默失败，所以这个比对在大多数情况下根本执行不了；
3. 不比对就盲目写入空串，会冲掉用户之后复制的别的东西。

现状：`SecretField` 复制成功后提示"已复制，请注意及时清除剪贴板"（有测试），这是本节原来就规定的 UI 行为。**不做**自动清除，也不记录复制过什么。如果仍然想要尽力清除，需要先决定要不要加 `clipboardRead` 权限，见 §11.4。

这只能尽力而为，不作为验收项。"复制后 N 秒自动清除"同样不可靠（面板关闭后定时器不再触发），本期不做。

### 4.6 密钥材料处理

- `unwrapVaultKey()` 返回原始 `Uint8Array`；Session 通过 `importKey('raw', bytes, 'AES-GCM', false, …)` 保存；原始字节立即 `fill(0)`。
- 所有 `decrypt` / `exportKey` 返回的 `ArrayBuffer`，用完立刻 `new Uint8Array(buf).fill(0)`。
- `generateVaultKey` 在初始化时返回原始字节，用于包装两次后清零。
- 改主密码、导出前重新验证，用 `verifyMasterPassword(password)`：只解开 wrapper 得到原始字节、比对 `keyId` 后清零，**不触碰 Session**，因此不会 `epoch++`，也不会触发整棵子树重建。

---


## 5. 核心服务

以下是接口和关键流程，不是可直接运行的完整实现。**这些签名在 Task 1.2 冻结**：`extractable:false`、AAD、`KdfParams` 联合类型都会改变函数签名，写完再改会连带返工。

### 5.1 CryptoService

```typescript
export class CryptoService {
  // —— KDF ——
  // params 是联合类型，Argon2id 接入时只加一个分支，调用方不变
  deriveMasterWrapKey(password: string, kdf: KdfParams): Promise<CryptoKey>;   // 内部先 password.normalize('NFKC')
  deriveRecoveryWrapKey(keyBytes: Uint8Array): Promise<CryptoKey>;             // HKDF，usages ['encrypt','decrypt']，见 §2.2

  // —— Vault Key ——
  generateVaultKeyBytes(): Uint8Array;                                         // 32 字节，调用方用完 fill(0)
  importSessionKey(raw: Uint8Array): Promise<CryptoKey>;                       // extractable: false
  computeKeyId(raw: Uint8Array): Promise<Uint8Array>;                          // HKDF，前 8 字节

  // —— 包装：加密 / 解密原始字节，不返回 extractable 的 CryptoKey ——
  wrap(vaultKeyRaw: Uint8Array, wrapKey: CryptoKey): Promise<{ wrappedKey: Uint8Array; iv: Uint8Array }>;
  unwrap(wrapped: { wrappedKey: Uint8Array; iv: Uint8Array }, wrapKey: CryptoKey): Promise<Uint8Array>;

  // —— 记录：每段独立 IV，AAD 见 §3.2 ——
  encryptSegment(plain: object, key: CryptoKey, ctx: SegmentContext): Promise<{ iv: Uint8Array; data: Uint8Array }>;
  decryptSegment<T>(seg: { iv: Uint8Array; data: Uint8Array }, key: CryptoKey, ctx: SegmentContext): Promise<T>;

  // —— Recovery Key，规范见 §2.2 ——
  // 都是异步的：校验和用 WebCrypto 的 SHA-256
  generateRecoveryKey(): Promise<{ bytes: Uint8Array; formatted: string }>;
  formatRecoveryKey(bytes: Uint8Array): Promise<string>;
  parseRecoveryKey(input: string): Promise<Uint8Array>;                        // 抛 RecoveryKeyFormatError | RecoveryKeyChecksumError
}

interface SegmentContext { recordId: string; type: VaultRecordType; formatVersion: 1; segment: 'summary' | 'secret'; }
```

**Task 1.2 必须内置的规则**

- `encryptSegment` 每次调用都 `getRandomValues` 生成新的 12 字节 IV，不接受外部传入。
- `decryptSegment` 先检查 `iv.length === 12`、`data.length >= 16`，不满足抛结构错误（见 §5.3）。
- 所有 `ArrayBuffer` 结果用完立刻清零。
- 主密码 `normalize('NFKC')` 只在 `deriveMasterWrapKey` 一处做。

### 5.2 VaultService

所有方法都遵循 §2.3 的"事务外加解密 + 短事务校验 revision"，以及 §4.4 的 epoch 检查。

```typescript
export class VaultService {
  // —— 主密码强度 ——
  // 设置主密码的三个入口（initialize / changeMasterPassword / recoverAccess）都先过强度策略，见 §5.4。
  // UI 的强度指示器调用同一个策略，避免"指示器说合格、服务层却拒绝"。
  evaluatePassword(password: string): Promise<PasswordEvaluation>;

  // —— 初始化 ——
  // 全程在内存里完成；onRecoveryKey 回调里用户必须回填校验通过才 resolve；之后才开事务。
  // 回调 reject（取消）时什么都没写，没有半初始化状态。
  async initialize(
    masterPassword: string,
    onRecoveryKey: (formatted: string) => Promise<void>
  ): Promise<void>;
  //   1. 事务外：生成 Vault Key，生成 Recovery Key，两个 wrapper，试解两个 wrapper
  //   2. await onRecoveryKey(formatted)
  //   3. 短事务：vaultKeys.get('singleton') 非空 → throw AlreadyInitializedError；否则 add
  //   4. session.open(importSessionKey(raw), keyId)；raw.fill(0)

  async isInitialized(): Promise<boolean>;                         // vaultKeys.get('singleton') !== undefined

  // —— 解锁 ——
  async unlockWithMasterPassword(password: string): Promise<void>; // 失败抛 UnlockError（含分类，见 §5.3）
  async unlockWithRecoveryKey(input: string): Promise<void>;
  //   成功后若 master wrapper 的 KdfParams 低于当前策略，在后台静默重包装（走 §2.3 的 CAS）

  // —— 不碰 Session 的验证 ——
  // 改主密码、重新生成 Recovery Key、导出前重新验证都用它。不 epoch++，不重建 UI。
  async verifyMasterPassword(password: string): Promise<void>;
  // "Test Recovery Key"用:只验证,不碰 Session、不写库、不广播,用完清零。
  // 格式不对抛 RecoveryKeyFormatError / RecoveryKeyChecksumError,解不开抛 AuthError,库里结构不对抛 CorruptError。
  async verifyRecoveryKey(input: string): Promise<void>;

  // —— 改主密码 ——
  async changeMasterPassword(current: string, next: string): Promise<void>;
  //   expectedRevision = 读取时的 revision
  //   unwrap 得到 raw（用 current）→ 用 next 做 KDF → wrap → 试解 → 校验 keyId 一致
  //   短事务：revision !== expectedRevision → throw ConflictError
  //   提交后 session.announce('wrapper-changed')；raw.fill(0)

  // —— Recovery 两步，见 §2.4 ——
  async recoverAccess(recoveryKeyInput: string, newMasterPassword: string):
    Promise<{ accessRestored: true; rotationRequired: true }>;     // 步骤一提交后立即返回
  async rotateRecoveryKey(
    masterPassword: string,
    onRecoveryKey: (formatted: string) => Promise<void>
  ): Promise<void>;                                                // 步骤二，也是 Settings 里"重新生成"的入口
  // 是否还需要重新生成 Recovery Key,UI 的持续提醒用它。不要求已解锁(标记不是秘密)。
  // 未初始化抛 NotInitializedError;结构损坏抛 CorruptError;标记不是明确的 false(缺失、被改成别的类型)时按"需要"返回:
  // 多提醒一次无害,漏提醒会让用户继续依赖一把可能已经泄漏的旧 Recovery Key。
  async isRecoveryRotationRequired(): Promise<boolean>;

  // —— 记录 CRUD ——
  async listSummaries(filter?: { type?: VaultRecordType }): Promise<VaultSummary[]>;
  async getSecret(id: string): Promise<VaultSecret>;               // 详情页才调用
  async createRecord(input: VaultRecordInput): Promise<string>;
  async updateRecord(id: string, input: VaultRecordInput): Promise<void>;   // 保留 createdAt；不存在抛 NotFoundError
  async deleteRecord(id: string): Promise<void>;

  // —— 自动锁定设置，见 §4.3 ——
  async getAutoLockTimeout(): Promise<AutoLockTimeoutMs>;          // 不要求已解锁；缺失/非法按默认值；读库失败会抛
  async setAutoLockTimeout(ms: AutoLockTimeoutMs): Promise<void>;  // 必须已解锁；非法值 TypeError；本面板立即生效，其他面板收到通知后重读，不会被锁定
}
```

**记录写入的 keyId 校验**：`createRecord` / `updateRecord` 在短事务里同时读 `vaultKeys` 和写 `vaultRecords`，要求 `vaultKeys.wrapper.keyId` 等于 `session.requireKey().keyId`，不等就抛 `ConflictError`（库已被导入或替换）。这是 BroadcastChannel 之外的最后一道防线。

**Session 入口只有一个**：服务层调 `session.open(key, keyId)`，不存在 `setVaultKey` / `unlock`。

### 5.3 错误分类

AES-GCM 在密钥错误和密文被篡改时抛的是同一种认证失败，无法区分。能区分的只有三类，UI 文案对应如下：

| 类别 | 触发 | 提示 |
|------|------|------|
| 结构损坏 `CorruptError` | 缺字段、`iv` 长度不是 12、版本不认识、`keyId` 长度不对 | "保险箱数据已损坏，可导出原始加密备份" |
| 输入有误 `RecoveryKeyFormatError` / `RecoveryKeyChecksumError` | Recovery Key 格式或校验和不对 | "恢复密钥输入有误，请检查" |
| 认证失败 `AuthError` | 主密码或 Recovery Key 通过格式检查，但解开 wrapper 失败 | "密码错误，或数据已损坏。可尝试使用恢复密钥" |

不再承诺"区分密码错误和数据损坏"。错误对象只带类别，不带任何字段内容；Vault 相关错误不得经 Service Worker 消息原样回传。

**文案的实现**（`src/vault/error-messages.ts` 的 `describeVaultError`）：只按错误的类别选文案，**永远不显示 `error.message`**，未知错误一律显示"操作失败，请重试"。同一个认证失败在三种语境里措辞不同：输入主密码时是上表的措辞；输入恢复密钥时说"恢复密钥不正确，或数据已损坏"（本来就在输入恢复密钥，不再建议"使用恢复密钥"）；**读取某一条记录**时说"这条记录无法解密，数据可能已损坏"（用户没有输入任何密码，说"密码错误"会误导他）。

**一处文案与现状不符**：上表"结构损坏"的提示"可导出原始加密备份"提到的导出功能（Task 4.1）**还没有实现**。文案按本节原有规定写进了界面，在备份做出来之前，用户看到这句话时没有对应的按钮可点。

以上三类是**解锁和验证**时的分类。设置新主密码时另有 `WeakPasswordError`（`kind: 'weak-password'`），见 §5.4。

### 5.4 主密码强度策略

**为什么在服务层**：备份文件的离线防护主要靠主密码强度（R7）。改主密码和 Recovery 恢复也会设置新的主密码，只在初始化页面检查等于留了两个后门，所以三个入口都在服务层强制，UI 只负责展示。

**规则**：长度 ≥ 12，且 zxcvbn 得分 ≥ 3。两者同时满足才放行。

- 长度按 **NFKC 规范化之后的码点数**计，与 KDF 实际看到的密码一致。全角字母、组合字符不能用来凑长度。
- 只评估前 100 个码点，更长的部分不拿来加分；`length` 仍是全长。
- 估算器用 `@zxcvbn-ts/core` + `@zxcvbn-ts/language-common`，**动态 `import()` 懒加载**：字典实测 471 KiB（minified）/ 233 KiB（gzip），不进主包，只在设置密码时才下载。
- 估算器加载失败时**不放行**（直接抛错，不退回"只看长度"），并清掉缓存，下次调用可以重试。

**接口**：策略是可注入的，默认是严格策略。

```typescript
interface PasswordPolicy { evaluate(password: string): Promise<PasswordEvaluation>; }
interface PasswordEvaluation { score: 0|1|2|3|4; length: number; ok: boolean; issues: ('too-short' | 'too-weak')[]; }

new VaultService({ session, passwordPolicy? });   // 不传 = DEFAULT_PASSWORD_POLICY（严格）
```

只有测试会注入宽松策略（`tests/helpers/vault.ts` 的 `permissivePasswordPolicy`），因为已有测试里有大量 `'wrong'`、`'x'` 这样的短密码，它们测的是别的行为。严格策略由 `tests/vault/password-policy.test.ts` 单独测，其中一条专门守"不传策略时默认是严格的"。

**检查顺序**：先拒绝空串（`TypeError`，调用方的 bug），再过策略，都在任何 KDF 和数据库读取**之前**。弱密码被拒绝时不付出一次 600k 迭代的代价，也不碰库。因此 `changeMasterPassword` 里"弱的新密码"先于"旧密码是否正确"报错。

**错误**：`WeakPasswordError` 只带 `issues`（类别），不带密码，也不带 zxcvbn 的反馈文案，这样即使被记进日志也不会泄露。UI 按 `issues` 选提示语。

**已知局限（不要把 score ≥ 3 当成对所有语言都有效的保证）**：

- zxcvbn 的字典以英文为主。中文短语（`我的密码是一二三四五六七八`）、无声调拼音加日期（`wangxiaoming1234`、`zhangsan19900101`）这类密码会被高估成 4 分而放行。
- 实测过 `@zxcvbn-ts/language-zh`：它的拼音字典带声调，对用户实际键入的无声调拼音几乎匹配不上，在 ≥ 3 的门槛下没有改变任何放行或拒绝的决定，却多 660 KiB（minified），所以没有带上。`language-en` 在 24 个样本里只多拦下 2 个，却多 1174 KiB，也没有带。
- score 3 的区间是约 1e8 到 1e10 次猜测，zxcvbn 的说法是"对离线慢哈希场景有中等保护"；≥ 1e10 才是 4。这条门槛是底线，不是目标。对中文用户，强度指示器应当提示"建议使用长随机口令或随机词组"，不要只靠分数。

---


## 6. UI 组件架构

### 6.1 目录结构

实际的目录（比最初的设计多出组合根、明文 store 和几个共用组件）：

```
src/vault/
├── crypto/        crypto-service.ts, recovery-key.ts, errors.ts
├── services/      vault-service.ts, vault-session.ts, vault-store.ts（解密后的明文只放在这里）, password-policy.ts
├── runtime.ts     组合根：建 Session / Service / Store，start() 开空闲检查、活动追踪、pagehide 兜底
├── routes.tsx     vaultRoutes：一个 <Route path="/vault"> 元素，接进 App 的 <Routes>
├── error-messages.ts   describeVaultError：按类别选文案，不显示 error.message
├── pages/         VaultSetup, VaultUnlock, VaultRecover, VaultGuard, VaultList, VaultDetail, VaultEditor, VaultSettings,
│                  return-path.ts, list-model.ts, editor-model.ts, format.ts（后三个是可单独测试的纯逻辑）
├── components/    RecoveryKeyDisplay, RecoveryKeyConfirm, RecoveryKeyRotation, PasswordStrength, SecretField, VaultBadge,
│                  VaultPage, AutoLockSetting, ChangeMasterPassword, RecoveryKeySettings,
│                  record-types.ts, recovery-key-groups.ts, recovery-key-file.ts
└── hooks/         VaultRuntimeProvider.tsx, useVaultStatus, useVaultSession, useVaultStore,
                   useRecoveryRotationRequired, useRecoveryKeyCeremony
src/db/vault-schema.ts
```

**`VaultRuntimeProvider` 必须包住整个 App**（见 `src/sidepanel/App.tsx`），而不是只包 `/vault` 路由：用户解锁后切到笔记页，自动锁定的空闲检查和活动追踪仍要继续运行。`tests/vault/vault-app-integration.test.tsx` 验证了在笔记页面上的按键也会被计为活动。

### 6.2 交互要点

**密码输入**：解锁页和设置页**不使用 `<form>`**，用普通容器加按钮的 `onClick` 和 Enter 键处理，避免浏览器弹出"保存密码"提示（与"主密码不持久化"冲突）。每个 `<input>` 只写一个 `autoComplete`：初始化页 `new-password`，解锁页 `off`。上线前在真实 Side Panel 里实测是否仍会弹提示。

**搜索框**：`autoComplete="off"`，不用 `<form onSubmit>`，关键词只放组件 state，不写进 URL。现有 Notes 搜索是把关键词放进 `navigate('/prompts?search=...')` 的，Vault 不能照搬。

**SecretField**：隐藏时渲染固定占位 `••••••••`，点击 Show 才把明文渲染成文本节点；不使用 `<input value={secret}>`。

**Recovery Key 回填校验**（替代"我已保存"勾选框）：展示 Recovery Key 后，随机要求用户输入其中 3 个指定位置的分组（例如第 2、7、12 组）；全部匹配才启用"继续"。这一步在内存里完成，通过后才会提交到数据库。

**最低主密码强度**：长度 ≥ 12 且 zxcvbn 得分 ≥ 3。**强制执行在服务层**（§5.4），UI 不重复实现规则，强度指示器调用 `service.evaluatePassword()`，初始化、改主密码、恢复三个页面都用同一个。备份文件的离线防护主要靠主密码强度，不能只靠用户自觉。

### 6.3 路由与守卫

`setup` 和 `unlock` 必须在守卫**外面**，否则未初始化时守卫重定向到 `/vault/setup`，而这个路由仍被守卫包着，会再次重定向，形成死循环。

```tsx
<Routes>
  {/* 现有路由略 */}

  <Route path="/vault">
    {/* 守卫之外：任何状态都能访问 */}
    <Route path="setup" element={<VaultSetup />} />
    <Route path="unlock" element={<VaultUnlock />} />
    <Route path="recover" element={<VaultRecover />} />

    {/* 守卫之内：必须已初始化且已解锁 */}
    <Route element={<VaultGuard />}>
      <Route index element={<VaultList />} />
      <Route path="new" element={<VaultEditor />} />
      <Route path=":id" element={<VaultDetail />} />
      <Route path=":id/edit" element={<VaultEditor />} />
      <Route path="settings" element={<VaultSettings />} />
    </Route>
  </Route>
</Routes>
```

**实现与上面的最初设计有三处不同**（`src/vault/pages/VaultGuard.tsx`）：

1. **没有单独的 `VaultShell`**。原设计让它负责"锁定时整棵子树重建"，但 `setup` / `unlock` / `recover` 在守卫外面，也被它包着的话，`open()` 或另一个窗口的锁定会让这三个向导页白白重建。重建只需要对**已解锁**的页面做，所以 `key={epoch}` 放在 `VaultGuard` 已解锁分支的 `<Outlet>` 上；`/vault` 本身是一个没有 `element` 的路由（React Router 默认渲染 `<Outlet>`），单独做 `VaultShell` 只会是个空壳。
2. **状态有五个而不是四个**：`'loading' | 'uninitialized' | 'locked' | 'unlocked' | 'error'`。读库本身失败**不能**当成 `uninitialized`：那会把已经创建过保险箱的用户带去创建页。`error` 时显示错误和"重试"，不跳转。
3. **被踢去解锁页时带上原路径**：`<Navigate to="/vault/unlock" state={{ from: location.pathname }}>`，解锁成功后回到刚才的页面。路由状态理论上可以被构造，所以 `vaultReturnPath` 只接受 `/vault` 之内的路径，并且不回到 `setup` / `unlock` / `recover`（会循环）。

```tsx
function VaultGuard() {
  const { status, refresh } = useVaultStatus();
  const { epoch } = useVaultSession();
  if (status === 'loading') return <正在检查…/>;              // 异步读库期间不能当作"未初始化"，也不跳转
  if (status === 'error') return <错误 + 重试 />;             // 读库失败 ≠ 未初始化
  if (status === 'uninitialized') return <Navigate to="/vault/setup" replace />;
  if (status === 'locked') return <Navigate to="/vault/unlock" replace state={{ from: location.pathname }} />;
  return <UnlockedFrame><Outlet key={epoch} /></UnlockedFrame>;  // 顶栏：状态、"立即锁定"、恢复密钥提醒
}
```

`useVaultStatus` 在首次读库完成前返回 `'loading'`。如果直接把未加载完当成 `initialized === false`，已初始化的用户会被带去 `/vault/setup`，并有机会覆盖现有 Vault。

**`key={epoch}` 不能省，只靠"状态变成 locked 就跳走"不够**：如果锁定和重新解锁发生在同一次渲染之间，状态始终是 `unlocked`，页面不会被卸载，上一个会话里的内容会留在屏幕上。`vault-routing.test.tsx` 里有一条专门的测试，去掉 `key={epoch}` 只有这一条会失败。

**恢复密钥提醒**：用恢复密钥找回访问之后，旧的恢复密钥仍然有效，直到用户重新生成。`VaultGuard` 的顶栏下面在保险箱的每个页面显示一条不能关掉的提醒，指向设置页；设置页自己有更详细的提示，所以在那里不重复显示。用户在设置页完成重新生成、离开设置页时，提醒消失。

---


## 7. 开发任务拆分

估算按 1 名熟悉本仓库的工程师、含单元测试、不含外部安全评审。合计约 230–300 人时：1 人全职约 7–9 周（每周 30 小时有效），2 人并行约 4–5 周（需先冻结 `CryptoService` 接口）。另有外部安全评审与修复约 20–30h、发布与用户文档约 8–12h，不在此内。

### Phase 1: 基础设施（50–64h）

**Task 1.0: 两个 spike（14–20h）—— 必须在 1.2 之前**

结果会改变 wrapper 格式、CSP 和是否需要 Worker，所以先做。

- [ ] **Side Panel 生命周期**：在真实 Chrome 里验证关闭 Side Panel 后页面是否销毁、内存里的 `CryptoKey` 是否随之丢失；同时验证多个窗口是否各有一个独立实例。结果写回 §4.1。
- [ ] **Argon2id**：评估 `hash-wasm` / `@noble/hashes`（`argon2-browser` 最后发布于 2022-04，不再考虑）。验证 manifest 加 `'wasm-unsafe-eval'` 的效果，起点参数 m=64MiB、t=3、p=1，在低端设备实测，目标 ≤1s 且不低于 OWASP 最低配置（19 MiB、t=2、p=1）。是否需要放进 Worker 避免阻塞 UI。
  - **已做（Node 基准，`scripts/spike-argon2id-bench.mjs`）**。本机 i7-13700H、Node 22，每个配置每个样本一个独立子进程，取冷启动中位数：

    | 配置 | hash-wasm | noble 同步（纯 JS） | noble 异步（纯 JS） |
    |---|---|---|---|
    | 19 MiB, t=2（OWASP 最低） | 32 ms | 182 ms | 258 ms |
    | 46 MiB, t=1（OWASP 最低） | 46 ms | 207 ms | 356 ms |
    | 64 MiB, t=3（方案起点） | 148 ms | 758 ms | 1372 ms（超 1s） |

    PBKDF2-SHA256 600k（WebCrypto）为 90 ms。hash-wasm 峰值内存约比基线多 37 / 45 / 63 MiB。三种实现在 m=1 MiB、t=2、p=1 时输出一致，参数和 salt 相同则换库不破坏已存数据。
  - **结论倾向**：要用 Argon2id 就选 hash-wasm。它在计算期间**完全占住线程**（最长卡顿约等于整段耗时），所以必须放进 Worker；noble 异步不阻塞，但 64 MiB / t=3 在这台高端机上就超过 1s。
  - **已做（manifest）**：加 `"extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"` 后 `vite build` 通过，产物 manifest 只多出这一个 CSP 块。已还原，KDF 没定之前不放宽 CSP。构建通过只证明 manifest 合法，**不证明 WASM 能在 Chrome 里跑起来**。
  - **未做**：低端设备实测（这是 ≤1s 目标的真正判据，上面的数字只代表这一台机器和 Node）；Chrome 的 Side Panel / Worker 里 WASM 是否真的能实例化；Worker 在这个 CSP 下的行为。
- [ ] 产出决策：第一版用 Argon2id，还是 PBKDF2-SHA256 600k + 自动升级。无论哪种，`KdfParams` 联合类型都已在 §2.1 定义。
  - 实际顺序是 Task 1.1–1.3 先于 1.0 完成。因为联合类型已经留好 Argon2id 分支（现在遇到会抛 `UnsupportedKdfError`），这个决定不会改变存储格式，只需要在 `deriveMasterWrapKey` 里补一个分支。

**Task 1.1: RiddleVaultDB（8–10h）**
- [x] `src/db/vault-schema.ts`：`vaultKeys` / `vaultSettings` / `vaultRecords` / `vaultSnapshot`，见 §3
- [x] 回归测试：Notes 的导入、导出、搜索前后，Vault 各表行数不变
- [x] 回归测试：对 `SidecarDB` 调 `delete()` 不影响 `RiddleVaultDB`

**Task 1.2: CryptoService（16–20h）**

接口见 §5.1，签名在这一步冻结。

- [x] `deriveMasterWrapKey(password, kdf)`：入口处 `normalize('NFKC')`；支持 `KdfParams` 联合类型（PBKDF2 已实现；Argon2id 分支是占位，抛 `UnsupportedKdfError`，等 Task 1.0）
- [x] `deriveRecoveryWrapKey`：HKDF-SHA256，`usages = ['encrypt','decrypt']`
- [x] `importSessionKey` 使用 `extractable: false`；`computeKeyId`
- [x] `wrap` / `unwrap` 以原始字节进出，`ArrayBuffer` 用完清零
- [x] `encryptSegment` / `decryptSegment`：每次新 IV，**AAD 绑定 `recordId | type | formatVersion | segment`**，解密前校验 `iv.length === 12`
- [x] Recovery Key：生成、格式化、`parseRecoveryKey`（规范化、字母表、填充位、SHA-256 校验和），见 §2.2
- [x] 单元测试（`tests/vault/crypto-service.test.ts`、`recovery-key.test.ts`）：
  - Recovery Key 三组固定测试向量逐字比对（§2.2）
  - 拒绝：填充位非 0、含 `0189`、缺组/多组/错前缀、校验和不符
  - NFKC：同一密码的预组合与分解形式（如 `é`、全角字符）派生出相同的 key
  - 相同密码 + salt 派生一致：通过 wrap/unwrap 往返验证，**不对 `extractable:false` 的 key 调 `exportKey`**
  - 每次加密 IV 不同
  - 篡改密文任意一字节解密失败
  - **篡改明文 `type`、把 A 记录的 segment 放到 B 记录上、互换 summary 与 secret，解密必须失败**
  - `iv` 长度不是 12 时抛 `CorruptError`
  - HKDF 派生的 key 能被 `encrypt` / `decrypt` 使用（防止 usages 写错）

**Task 1.3: VaultSession（12–16h）**
- [x] 接口见 §4.2：`open` / `lock` / `lockLocal` / `announce` / `requireKey` / `assertEpoch` / `subscribe`（另有 `isOpen`、`touch`、`checkIdle`、`startIdleWatch`、`dispose`）
- [x] 测试：两个 Session 实例互相收到 `lock` 后各自只锁一次，`epoch` 只增加一次（不无限广播）
- [x] 测试：`wrapper-changed`、`imported` 广播会让其他实例锁定
- [x] 测试：在途 `getRecord` 在 `await` 之间被锁定，结果被丢弃并抛 `VaultLockedError`（Session 层的 `assertEpoch` 测试，和 `vault-service-records.test.ts` 里的服务层测试）
- [x] 自动锁定：`checkIdle` + 轮询 + `visibilitychange`；用假时钟测试休眠场景
- [x] 自动锁定的超时值取自 `vaultSettings.autoLockTimeoutMs`（`tests/vault/vault-service-settings.test.ts` 与 `vault-session.test.ts`）。Session 缓存内存值，服务层在初始化、两种解锁、`recoverAccess` 时推进去；`getAutoLockTimeout` / `setAutoLockTimeout`；改设置用 `settings-changed` 通知其他面板，不锁定它们。读失败的两条路径不同（解锁用默认值，刷新保持当前值），见 §4.3。Task 4.2 的设置页只差 UI

### Phase 2: 核心功能（44–56h）

**Task 2.1: VaultService（28–36h）**
测试在 `tests/vault/vault-service-unlock.test.ts`、`vault-service-keys.test.ts`、`vault-service-records.test.ts`。

- [x] `initialize`：内存中完成、回填回调、短事务存在性检查，见 §5.2
- [x] 解锁（主密码 / Recovery Key）、错误分类见 §5.3
- [x] `verifyMasterPassword`（不碰 Session）
- [x] `changeMasterPassword`：`expectedRevision` + 试解 + 提交后 `announce`
- [x] `recoverAccess` / `rotateRecoveryKey` 两个独立方法，见 §2.4
- [x] KDF 自动升级的静默重包装（同样走 CAS）
- [x] 记录 CRUD：两段加密、`keyId` 校验、`updateRecord` 保留 `createdAt`
- [x] 故障注入测试：每个短事务中途 abort、`onRecoveryKey` 回调 reject、两个 VaultService 实例同时 `initialize`（只有一个成功）、两个实例并发 `changeMasterPassword`（后者抛 `ConflictError`）
- [x] 测试：步骤一提交后回调取消，旧 Recovery Key 仍可解锁，新主密码也可解锁
- [x] 测试：库被"导入"替换后，旧 Session 写记录被 `keyId` 校验拒绝（这里的"导入"是直接改库模拟的；真正的导入流程是 Task 4.1）
- [x] 主密码强度策略（§5.4）：`initialize` / `changeMasterPassword` / `recoverAccess` 三处强制，策略可注入，`evaluatePassword` 供 UI 指示器使用（`tests/vault/password-policy.test.ts`）

**Task 2.2: 隔离与安全（8–10h）**
- [x] Vault 逻辑只放在 Side Panel，不进 Service Worker 消息路由。`tests/vault/isolation.test.ts` 的静态守卫从 manifest 的入口（`background.service_worker` 与 `content_scripts[].js`）沿 import 图（相对路径和别名）走完所有可达模块，断言其中没有 `src/vault/**`、`src/db/vault-schema.ts`，也没有 `@zxcvbn-ts/`、`hash-wasm`、`@noble/hashes`；有两条自检证明遍历本身有效。另外对真实 `vite build` 的产物做过一次人工检查：`service-worker` 和 `content-script` 的 chunk 里没有 `PBKDF2` / `RiddleVaultDB` / `RN-V1` 等标记（这次检查没有做成自动测试）
- [ ] 如果将来必须在 SW 里加 `VAULT_*`：按 allow-list，校验 `sender.id === chrome.runtime.id && sender.tab === undefined`；错误不得回传 `error.message`（**现在没有这个需求，所以没有做**；上一条的守卫测试会在有人这么做时失败，提醒他回来看这一条）
- [x] 测试：从 content script 上下文和扩展页面上下文发 `VAULT_*` 消息都被拒绝（`isolation.test.ts` 的动态守卫，驱动真实的 `service-worker.ts`：10 种 `VAULT_*` 类型都返回 `{success:false, error:'Unknown message type'}`，响应不含任何 payload，畸形消息不抛，不会打开 `RiddleVaultDB`）。守卫测试做过变异检查：直接引用、以及经 `@shared` 中转模块间接引用，各被恰好一条测试抓到
- [ ] 日志只记 id 和 type，不记 title / secret（现状：`src/vault` 里有三处 `console.error`——Session 的订阅者和设置监听者抛错各一处、`VaultStore` 的监听者抛错一处——文案都是固定的，不带数据，也不带被捕获的错误；`vault-session.test.ts` 和 `vault-store.test.ts` 各有测试断言错误内容不进日志。UI 错误提示不显示 `error.message`，有测试守着。但没有统一的日志规则，也没有"跑完整流程后扫描 console 输出"的测试，见 Task 5.1）

**Task 2.3: Recovery Key 辅助（8–10h）**
- [x] "Test Recovery Key"：服务方法 `verifyRecoveryKey`（不碰 Session、不写库、不广播、用完清零；`vault-service-unlock.test.ts` 14 条，变异检查过）和设置页入口（`RecoveryKeySettings` 的"检查恢复密钥"，`vault-settings.test.tsx` 验证它不改库、不改会话 epoch，成功后清空输入框）
- [x] Settings"重新生成"复用 `rotateRecoveryKey`，要求主密码：`RecoveryKeyRotation` 组件，Recover 的第二屏和设置页共用。流程是输入主密码 → 显示新 Key → 回填确认 → 才写库；取消或出错时旧 Key 仍有效（`vault-onboarding.test.tsx`、`vault-settings.test.tsx` 用真实的 `VaultService` 走完整流程）
- [x] `recoveryRotationRequired` 为 true 时的持续提示：服务方法 `isRecoveryRotationRequired`（新增，12 条测试）、`VaultGuard` 里每个页面都显示的提醒条、设置页里更详细的提示（`vault-routing.test.tsx`、`vault-settings.test.tsx`）

### Phase 3: UI（58–74h）

**Task 3.1: 初始化（18–24h）**
测试：`vault-onboarding.test.tsx`（真实的 `VaultService`、真实的 KDF 流程和真实的 zxcvbn）、`vault-components.test.tsx`、`ceremony.test.tsx`、`ui-logic.test.ts`。

- [x] 4 步流程，状态只在内存：说明 → 主密码 → 显示恢复密钥 → 回填确认。**回填确认通过之前数据库里什么都没有**，在第 3 步、第 4 步分别检查过；取消、中途离开页面（卸载）、确认之后创建失败，都不会留下半个保险箱。这条保证由 `useRecoveryKeyCeremony` 这个状态机承担，它只在 `confirm` 阶段才接受"确认"，`ceremony.test.tsx` 对它做了变异检查
- [x] 强度指示器：调用 `service.evaluatePassword()`，不自己实现规则；对中文用户一直显示"建议使用长随机口令或随机词组"。初始化、改主密码、恢复三个页面共用同一个 `PasswordStrength`。评估中、评估失败（估算器加载不了）都当成不合格处理（对父组件通知 `null`），过期的评估结果被丢弃。**这只是界面上的便利，真正的把关仍在服务层**（§5.4）：页面测试里"弱密码时服务层的 `initialize` 根本没被调用"和服务层自己的拒绝是两层
- [x] Recovery Key 回填校验（§6.2），不是勾选框：随机抽 3 组，挂载时确定一次（刷新不能换位置），全部匹配才启用"继续"，回车也不能绕过；回填那一步不再显示 Recovery Key（否则"回填"只是照抄）。比对是整组精确匹配：把整串 Recovery Key 粘进任何一个框都不通过
- [x] 下载 `.txt` 的文件头警示：技术方案规定的原话（"此文件无需主密码即可打开你的保险箱，请勿与加密备份放在同一位置。"）出现在 Recovery Key 之前，逐字有测试。**界面上没有"复制 Recovery Key"按钮**（有测试守着）：这把密钥不需要主密码就能打开保险箱，一键复制会让它进入剪贴板历史，甚至被同步到其他设备

**Task 3.2: 解锁与恢复（14–18h）**
- [x] 解锁页不用 `<form>`，`autoComplete="off"`（`vault-onboarding.test.tsx`；创建页和恢复页的密码框是 `new-password`，同样没有 `<form>`）
- [ ] **上线前在真实 Chrome 的 Side Panel 里实测是否仍会弹"保存密码"**：jsdom 测试只能证明没有 `<form>` 和属性写对了，**不能证明 Chrome 不会弹**。没做
- [x] 恢复页：步骤一与步骤二分开两屏，步骤一完成后即进入 Vault。第一步 `recoverAccess` 一成功会话就打开，页面**停在第二屏**而不是被自动带走（专门测试）；第二屏可以"稍后再说"，之后保险箱每个页面都有持续提示（见 §6.3）
- [x] 错误文案按 §5.3 三类，另加"记录"语境（§5.3）；永远不显示 `error.message`，未知错误只显示"操作失败，请重试"（各页面都有测试）
- [x] 路由与守卫按 §6.3：`setup`/`unlock`/`recover` 在守卫外（把 `unlock` 放进守卫里的变异会死循环，靠超时被抓到）；`loading`、`error` 状态不跳转（`vault-routing.test.tsx`）

**Task 3.3: CRUD UI（26–32h）**
测试：`vault-records.test.tsx`、`vault-routing.test.tsx`、`vault-components.test.tsx`。

- [x] 列表只展示 summary，按 type 分组：列表页**不调用** `getSecret`，页面里没有任何明文、用户名、网址或备注（测试逐个断言）；解不开的记录单独一组，不影响其他记录
- [x] 详情页才解密 secret，离开即清除：卸载时 `store.clearSecret()`；切到另一条时，新记录还在加载的这段时间里页面上已经没有上一条的内容（连"路由刚变、清理还没跑"的那一次提交都检查了）；记录解不开时用"记录"的措辞，并允许删除它，否则它会永远留在列表里
- [x] 搜索：关键词不进 URL，`autoComplete="off"`，不用 `<form>`；也不进 `localStorage` / `sessionStorage`，锁定再解锁后是空的
- [x] `SecretField` 按 §6.2：隐藏时固定占位，不泄露长度；点"显示"才渲染成文本节点；不是 `<input>`；换记录时立刻复位（修了一个测试发现的真实缺陷：切走再切回来时旧记录会自动变回"显示"）
- [ ] 复制：提示"已复制，请注意及时清除剪贴板"已做并有测试；**"记 `lastCopiedSecret`" 没有做，是有意的偏离**，理由和待决定的事见 §4.5
- [x] 删除确认：`window.confirm`，取消确认时不调用 `deleteRecord`（专门的测试，变异检查抓到过一个"取消也删"的时序盲区并补强）

另外编辑页（`VaultEditor`）有几条值得单独记的，都有测试：类型在编辑时不能改（类型参与 AAD，改类型等于换一条记录）；保存时**当前类型没有的字段一律丢掉**（先填了用户名又把类型改成安全笔记，用户名不会被存进去）；同一个路由 `/vault/:id/edit` 在 id 变化时 React Router 会复用同一个组件实例，已经修好"拿上一条的表单去覆盖另一条记录"的缺陷（渲染期按 id 重置表单，有专门的测试，去掉修复会失败）。

### Phase 4: 备份与设置（38–50h）

**Task 4.1: 加密备份（22–28h）**

*文件格式*
- [ ] 顶层 `{ app: "riddle-notes-vault", formatVersion: 1, exportedAt, keys, settings?, records }`，`app` 严格相等，不接受缺失
- [ ] 所有 `Uint8Array` 显式 Base64 编解码（直接 `JSON.stringify` 会变成 `{"0":1,…}`）
- [ ] 导出用显式字段白名单，不整表转储
- [ ] Notes 的 `parseBackup` 拒绝 Vault 文件，Vault 导入也拒绝 Notes 文件

*导入边界校验（文件内容不可信）*
- [ ] KDF 参数设上下限：PBKDF2 iterations ∈ [600k, 10M]；Argon2id 限制 m、t、p
- [ ] salt、iv、wrappedKey 长度；记录数上限；单条密文长度上限

*导入流程*
1. 解析并校验结构与边界
2. 让用户输入**备份的**主密码或 Recovery Key，解开备份的 Vault Key，试解全部记录，报告失败条数
3. 确认页提示"导入后主密码和恢复密钥都会变成备份当时的"，并显示当前与备份的记录数
4. 事务外准备好一切；开一个事务：写 `vaultSnapshot`，清空并写入
5. 提交后 `announce('imported')`，所有会话锁定
6. 用导入后的库**成功解锁一次**，再删除 `vaultSnapshot`

- [ ] 故障注入：第 4 步中途 abort，原库不变；导入后无法解锁时可从快照回退
- [ ] 测试：随机字节拼出的"结构合法"文件能过结构校验，但过不了第 2 步

**Task 4.2: 设置（16–22h）**
测试：`vault-settings.test.tsx`。

- [x] 修改主密码（`ChangeMasterPassword`）：弱密码、两次不一致、没填当前密码都不能提交（服务层的 `changeMasterPassword` 根本没被调用）；当前密码错误时库不变、输入保留，输入框不会卡在禁用；成功后旧密码失效、新密码可用，**别的打开着的侧边栏被锁定**（服务层广播）、本面板保持解锁
- [x] 自动锁定超时（1 / 5 / 15 分钟 / 从不）：四档的取值来自 `AUTO_LOCK_TIMEOUT_OPTIONS`，界面只写显示名（`Record<AutoLockTimeoutMs, string>` 由类型保证不会漏档）；选一档写进库、本面板立即生效；保存失败时选中状态保持原样（和实际生效的一致）；别的面板改了会跟着变，且本面板不会被锁定；卸载后不泄漏监听。文案写了"关闭侧边栏会立即锁定"，**这句话依赖 R4 的假设，没有在真实 Chrome 里验证过**（`pagehide` 兜底有测试，但那只证明代码在收到 `pagehide` 时会本地锁定）
- [x] 重新生成 Recovery Key（入口在 2.3 已做）
- [ ] 导出前重新输入主密码（`verifyMasterPassword`）；提示"备份文件的安全性取决于主密码强度"。**等 Task 4.1，导出还没做**
- [x] 不提供"选择 KDF"的选项，由产品定默认值并自动升级（设置页里没有这个选项；自动升级的重包装属于 Task 2.1，已勾）

### Phase 5: 测试与优化（40–54h）

**Task 5.1: 安全测试（18–24h）**
- [ ] 并发：两个实例同时初始化、改密码、导入（初始化、改密码已有测试；导入等 Task 4.1）
- [ ] 内存残留检查，具体步骤：Vault 里放哨兵字符串 `SENTINEL-7f3a…` → 打开详情页显示 → 锁定 → DevTools 强制 GC → 抓堆快照 → 搜索哨兵。记录结果；JS 字符串无法清零，目标是"锁定后 DOM 与组件 state 里没有"，不承诺内存取证安全。**堆快照这一步没做，需要真实 Chrome。** "锁定后 DOM 与组件 state 里没有"这个目标有 jsdom 测试覆盖（`vault-routing.test.tsx` 的"锁定时页面被卸载：明文不残留"一组，用哨兵字符串检查页面文本和所有输入框的值）
- [x] "IndexedDB 无明文"：直接读取 `vaultRecords` 的原始字节，对 `Uint8Array` 做子串扫描，查找已知秘密的 UTF-8 字节序列。**不要把密文 TextDecoder 解码后断言**，那个断言永远通过（`vault-service-records.test.ts` 的"IndexedDB 里不含明文"，还扫了 wrapper；`vault-service-unlock.test.ts` 也有"库里没有主密码、Recovery Key、Vault Key 的任何形式"）
- [ ] 日志扫描：运行完整流程，断言 console 输出不含秘密

**Task 5.2: 集成测试（12–16h）**
- [x] 初始化 → 解锁 → CRUD → 锁定 → 重新解锁（`vault-service-records.test.ts` 的"完整流程"；UI 层面的对应：`vault-onboarding.test.tsx` 走完创建，`vault-records.test.tsx` 走 CRUD，`vault-routing.test.tsx` 走锁定、解锁、回到原页面）
- [x] 改密码后旧密码失败、新密码成功、记录完整（`vault-service-keys.test.ts`）
- [x] Recovery 两步，包含步骤间中断（`vault-service-keys.test.ts`）
- [ ] 备份 → 覆盖导入 → 快照回退（等 Task 4.1）

**Task 5.3: 性能（10–14h）**
- [ ] KDF 耗时，低端设备目标 < 2s
- [x] 100 条记录列表（只解密 summary）< 500ms（`vault-service-records.test.ts` 的"100 条记录的列表加载 < 500ms"。这是测试环境里 fake-indexeddb 加小迭代次数的数字，不是真实 Chrome）
- [ ] 锁定响应 < 50ms

---

## 8. 风险与缓解

### R1 KDF 性能与强度（中）
PBKDF2 600k 在低端设备可能 2–3 秒；PBKDF2 不占内存，对 GPU 并行有利。最现实的攻击是备份文件被放进网盘后离线破解。
缓解：Task 1.0 的 Argon2id spike；解锁时显示进度；`KdfParams` 联合类型加自动升级；最低主密码强度（Task 3.1）。

### R2 用户丢失 Recovery Key（高）
缓解：回填校验而不是勾选框；"Test Recovery Key"（Task 2.3）；Settings"重新生成"需要主密码；明确告知丢失两者将永久无法访问。Recovery Key 不落库，因此没有"导出 Recovery Key"，只有"重新生成"。

### R3 加密格式升级（中）
缓解：所有加密结构带 `formatVersion`；AAD 把版本绑进密文；`KdfParams` 带 `algorithm` 判别；解锁成功后静默重包装，只加密 32 字节。

### R4 Side Panel 生命周期假设（中）
"关闭即锁定"依赖"Side Panel 关闭会销毁页面"，未实测。缓解：Task 1.0 spike；若不成立，改为 `pagehide` / `visibilitychange` 主动锁定。

### R5 多实例并发与丢失更新（中）
缓解：`revision` 乐观锁（§2.3）；`keyId` 校验（§5.2）；BroadcastChannel 的 `lock` / `wrapper-changed` / `imported`（§4.2）；`lock()` 与 `lockLocal()` 分开避免循环广播。

### R6 备份导入造成永久丢失（高）
覆盖导入会把主密码和 Recovery Key 一起回退。缓解：导入前试解（Task 4.1）；确认页明示；DB 内快照；成功解锁一次才删除快照。

### R7 备份文件离线攻击（高）
缓解：导出前重新验证主密码；提示备份安全性取决于主密码强度；最低主密码强度；Argon2id。

### R8 剪贴板残留（中）
只能尽力而为：`readText()` 需要 `clipboardRead` 权限或文档焦点，自动锁定时面板通常没有焦点。不作为验收项。本期不做"N 秒后自动清除"。

### R9 认证失败的分类有限（低）
AES-GCM 无法区分密钥错误与密文被篡改。只能区分结构损坏、输入格式错误、认证失败三类（§5.3）。这不影响密钥安全：攻击者拿到本地 IndexedDB 时可以直接离线攻击，不需要靠错误提示。

---


## 9. 测试策略

测试环境用现有的 vitest + jsdom + `fake-indexeddb`。Node 的 `globalThis.crypto.subtle` 提供 WebCrypto，不需要额外 mock。以下是用例清单和关键断言写法，与 §5 的接口一致。

### 9.1 CryptoService 单元测试

```typescript
describe('Recovery Key', () => {
  const vectors = [
    ['000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f',
     'RN-V1-AAAQ-EAYE-AUDA-OCAJ-BIFQ-YDIO-B4IB-CEQT-CQKR-MFYY-DENB-WHA5-DYPQ-MMG4'],
    ['00'.repeat(32), 'RN-V1-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-MZUH'],
    ['ff'.repeat(32), 'RN-V1-7777-7777-7777-7777-7777-7777-7777-7777-7777-7777-7777-7777-777Q-V6LB'],
  ];

  test.each(vectors)('固定测试向量 %s', async (hex, expected) => {
    expect(await formatRecoveryKey(fromHex(hex))).toBe(expected);
    expect(toHex(await parseRecoveryKey(expected))).toBe(hex);
  });

  test('生成的格式', async () => {
    const { formatted } = await svc.generateRecoveryKey();
    expect(formatted).toMatch(/^RN-V1-([A-Z2-7]{4}-){13}[A-Z2-7]{4}$/);   // 13 组数据 + 1 组校验
  });

  test('规范化：小写、空格、缺连字符都能解析', () => { /* … */ });

  test.each([
    ['填充位非 0（并重算校验和）', mutateLastDataCharPaddingBits],
    ['含 0/1/8/9', s => s.replace('AAAQ', 'AA0Q')],
    ['缺一组', s => s.replace('-MMG4', '')],
    ['前缀错误', s => s.replace('RN-V1', 'RN-V2')],
  ])('拒绝：%s', async (_name, mutate) => {
    // parseRecoveryKey 是异步的：必须 await expect(...).rejects，写成 expect(() => ...).toThrow 会永远通过
    await expect(parseRecoveryKey(mutate(vectors[0][1]))).rejects.toBeInstanceOf(RecoveryKeyFormatError);
  });

  test('校验和不符抛 RecoveryKeyChecksumError', async () => {
    await expect(parseRecoveryKey(vectors[0][1].replace('MMG4', 'MMG5'))).rejects.toBeInstanceOf(RecoveryKeyChecksumError);
  });
});

describe('密钥派生与包装', () => {
  test('NFKC：预组合与分解形式的同一密码解开同一个 wrapper', async () => {
    const kdf = testKdf();
    const w = await svc.wrap(raw, await svc.deriveMasterWrapKey('caf\u00e9', kdf));        // é 预组合
    const out = await svc.unwrap(w, await svc.deriveMasterWrapKey('cafe\u0301', kdf));     // e + 组合重音
    expect(out).toEqual(raw);
  });

  test('相同密码与 salt：通过 wrap/unwrap 往返验证（不对 extractable:false 的 key 调 exportKey）', async () => { /* … */ });

  test('HKDF 派生的 key 可用于 encrypt/decrypt', async () => {
    const k = await svc.deriveRecoveryWrapKey(recoveryBytes);
    await expect(svc.wrap(raw, k)).resolves.toBeDefined();   // usages 写成 wrapKey/unwrapKey 时这里会抛 InvalidAccessError
  });

  test('Session key 不可导出', async () => {
    const k = await svc.importSessionKey(raw);
    await expect(crypto.subtle.exportKey('raw', k)).rejects.toThrow();
  });
});

describe('记录加密', () => {
  const ctx = { recordId: 'r1', type: 'api_key', formatVersion: 1, segment: 'secret' } as const;

  test('每次加密 IV 不同', async () => {
    const a = await svc.encryptSegment({ secret: 'x' }, key, ctx);
    const b = await svc.encryptSegment({ secret: 'x' }, key, ctx);
    expect(a.iv).not.toEqual(b.iv);
  });

  test('篡改密文任意一字节解密失败', async () => { /* 遍历若干位置 */ });

  test.each([
    ['篡改 type', { ...ctx, type: 'password' }],
    ['换成另一条记录', { ...ctx, recordId: 'r2' }],
    ['summary 与 secret 互换', { ...ctx, segment: 'summary' }],
    ['formatVersion 不同', { ...ctx, formatVersion: 2 }],
  ])('AAD 不符解密失败：%s', async (_n, wrongCtx) => {
    const seg = await svc.encryptSegment({ secret: 'x' }, key, ctx);
    await expect(svc.decryptSegment(seg, key, wrongCtx as any)).rejects.toThrow();
  });

  test('iv 长度不是 12 抛 CorruptError', async () => { /* … */ });
});
```

### 9.2 VaultService 集成测试

使用 `fake-indexeddb`。KDF 参数在测试里用很小的 iterations（如 1000）加快速度，另有一条专门的用例用生产参数。

```typescript
describe('流程', () => {
  test('初始化 → 解锁 → 创建 → 锁定 → 重新解锁', async () => {
    let recoveryKey = '';
    await vault.initialize('correct horse battery staple', async f => { recoveryKey = f; });
    expect(session.isOpen()).toBe(true);

    const id = await vault.createRecord({ type: 'api_key', title: 'Test API Key', secret: 'sk-test-123' });
    session.lock();
    await expect(vault.getSecret(id)).rejects.toThrow(VaultLockedError);

    await vault.unlockWithMasterPassword('correct horse battery staple');
    expect((await vault.getSecret(id)).secret).toBe('sk-test-123');
  });

  test('改密码：旧密码失败、新密码成功、记录完整', async () => { /* … */ });

  test('错误主密码抛 AuthError，数据不变', async () => { /* … */ });
});

describe('初始化的原子性', () => {
  test('回调 reject（用户取消）时库里没有任何记录', async () => {
    await expect(vault.initialize('pw', async () => { throw new Error('cancel'); })).rejects.toThrow();
    expect(await vault.isInitialized()).toBe(false);
  });

  test('两个实例同时初始化，只有一个成功', async () => {
    const results = await Promise.allSettled([vaultA.initialize(pw, noop), vaultB.initialize(pw, noop)]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(r => r.status === 'rejected')).toMatchObject({ reason: expect.any(AlreadyInitializedError) });
  });
});

describe('Recovery 两步', () => {
  test('步骤一后回调取消：新主密码与旧 Recovery Key 都可用', async () => {
    const r = await vault.recoverAccess(recoveryKey, 'new-password');
    expect(r).toEqual({ accessRestored: true, rotationRequired: true });

    await expect(vault.rotateRecoveryKey('new-password', async () => { throw new Error('cancel'); })).rejects.toThrow();

    session.lock();
    await vault.unlockWithMasterPassword('new-password');           // 新主密码可用
    session.lock();
    await vault.unlockWithRecoveryKey(recoveryKey);                  // 旧 Recovery Key 仍可用
  });

  test('步骤二完成后旧 Recovery Key 不再能解开当前库', async () => { /* … */ });
});

describe('并发与乐观锁', () => {
  test('并发 changeMasterPassword：后者抛 ConflictError，且不会写回旧 recovery wrapper', async () => { /* … */ });

  test('库被替换后，旧 Session 写记录被 keyId 校验拒绝', async () => { /* … */ });
});

describe('Session 广播', () => {
  test('两个 Session 互相 lock 只各锁一次，不无限循环', async () => {
    const epochA = a.getEpoch();
    a.lock();
    await flushBroadcast();
    expect(a.getEpoch()).toBe(epochA + 1);
    expect(b.getEpoch()).toBe(/* 初始 + 1 */);
  });
});
```

### 9.3 安全测试

```typescript
test('IndexedDB 不含明文：直接扫原始字节', async () => {
  const secret = 'sk-very-secret-key-1234567890';
  const title = 'My Production Server';
  await vault.createRecord({ type: 'api_key', title, secret, username: 'admin', url: 'https://internal.example' });

  const rows = await vaultDb.vaultRecords.toArray();
  const needles = [secret, title, 'admin', 'https://internal.example'].map(s => new TextEncoder().encode(s));
  for (const row of rows) {
    for (const bytes of [row.summary.data, row.secret.data, row.summary.iv, row.secret.iv]) {
      for (const n of needles) expect(containsSubarray(bytes, n)).toBe(false);
    }
  }
  // 同时检查 vaultKeys：不含主密码、不含 Recovery Key 字符串
});

test('Notes 的导入/导出/搜索不影响 Vault', async () => {
  const before = await vaultDb.vaultRecords.count();
  await restoreBackup(notesBackup);
  await createBackup();
  await findMatchingNoteIds('Secret');
  expect(await vaultDb.vaultRecords.count()).toBe(before);
});

test('Notes 导出不含 Vault 内容', async () => {
  const exported = JSON.stringify(await createBackup());
  expect(exported).not.toContain('vaultRecords');
  expect(exported).not.toContain('vaultKeys');
});

test('Vault 备份：随机字节拼成的结构合法文件过得了结构校验，过不了试解', async () => { /* … */ });
test('Vault 备份：kdf 参数超出上下限被拒绝', async () => { /* … */ });
test('Vault 备份：app 不等于 riddle-notes-vault 被拒绝', async () => { /* … */ });
```

### 9.4 性能测试

- 生产 KDF 参数下 `deriveMasterWrapKey` 的耗时，记录数值；CI 里只断言宽松上限，真正的目标（低端设备 < 2s）靠手工在目标机器上测。
- 100 条记录的 `listSummaries`（只解密 summary）< 500ms。
- `session.lock()` < 50ms。

---


## 10. UI 设计建议

### 10.1 色彩方案

继承现有的 parchment 设计系统，但为 Vault 增加安全感的视觉元素。

```css
/* 在现有 parchment 基础上增加 */
--vault-primary: #2c1810;  /* 深棕色，体现安全感 */
--vault-accent: #8b4513;   /* 赛尔棕 */
--vault-danger: #8b0000;   /* 深红色，用于删除 */
--vault-lock: #4a5568;     /* 锁定状态灰色 */
--vault-success: #2d5016;  /* 深绿色，用于成功提示 */
```

### 10.2 页面布局

**Vault 入口（Sidebar）**

在现有 `Sidebar.tsx` 里与 Notes 并列加一项，沿用已有的 `nav-item` / `nav-item-active` 样式，不改现有项的路径：

```tsx
<NavItem to="/vault" icon={<Lock />}>保险箱</NavItem>
```

**解锁页面**

```
┌────────────────────────────────────┐
│                                    │
│           🔒                       │
│      解锁保险箱                     │
│                                    │
│   ┌──────────────────────────┐    │
│   │ 主密码                    │    │
│   │ ••••••••••••••••         │    │
│   └──────────────────────────┘    │
│                                    │
│   [ 解锁 ]                         │
│                                    │
│   忘记密码？使用恢复密钥 →         │
│                                    │
└────────────────────────────────────┘
```

**记录列表**

```
┌────────────────────────────────────┐
│  保险箱  •  已解锁  •  12 项      [🔒]│
├────────────────────────────────────┤
│  🔍 搜索保险箱...          [+ 新建]  │
├────────────────────────────────────┤
│  📌 API Keys (4)                    │
│  ┌──────────────────────────────┐  │
│  │ 🔑 OpenAI API Key            │  │
│  │    更新于 2 小时前             │  │
│  └──────────────────────────────┘  │
│  ┌──────────────────────────────┐  │
│  │ 🔑 GitHub Token              │  │
│  │    更新于 1 天前               │  │
│  └──────────────────────────────┘  │
│                                    │
│  🔐 Passwords (3)                   │
│  ┌──────────────────────────────┐  │
│  │ 🔑 Gmail                     │  │
│  │    更新于 3 天前               │  │
│  └──────────────────────────────┘  │
│                                    │
│  🗄️  Databases (2)                  │
│  💭 Secure Notes (3)                │
└────────────────────────────────────┘
```

**详情页**

```
┌────────────────────────────────────┐
│  ← 返回    OpenAI API Key    [...] │
├────────────────────────────────────┤
│  类型: API Key                      │
│  创建: 2025-01-15                   │
│  更新: 2 小时前                     │
├────────────────────────────────────┤
│  Secret Value                      │
│  ┌──────────────────────────────┐  │
│  │ sk-•••••••••••••••    [👁] [📋]│  │
│  └──────────────────────────────┘  │
│                                    │
│  Endpoint (可选)                    │
│  https://api.openai.com/v1        │
│                                    │
│  备注                               │
│  生产环境使用，月限额 $100          │
│                                    │
│  [ 编辑 ]  [ 删除 ]                │
└────────────────────────────────────┘
```

### 10.3 图标

沿用现有的 lucide-react，上面线框图里的 emoji 只是示意，实现时用：`Lock` / `Unlock`（状态与入口）、`KeyRound`（API Key、Password）、`Database`、`FileText`（Secure Note）、`Eye` / `EyeOff`、`Copy`、`Download`。

### 10.4 文案要点

- 恢复密钥相关：写"替换当前恢复密钥"，不写"旧密钥立即失效"（见 §2.5）。
- 导入确认页：写"导入后主密码和恢复密钥都会变成备份当时的"。
- 自动锁定设置旁：写"关闭侧边栏会立即锁定保险箱"。
- 复制成功：写"已复制，请注意及时清除剪贴板"，不承诺会自动清除。

---

## 11. 后续扩展预留

本期不实现，但架构要给它们留空间，不需要现在改格式。

### 11.1 跨设备同步
- 云端只存储加密数据，服务器无法解密。
- 记录已带 `formatVersion`、`keyId`、`updatedAt`，足以支撑后续的同步元数据；届时再加 `deviceId`、`syncVersion`，加字段不改既有密文。
- 冲突策略（LWW 或手动合并）留到同步设计时再定。

### 11.2 WebAuthn 解锁
- 只用于解锁，不替代主密码。改主密码、导出等敏感操作仍要主密码。
- 做法是在 `VaultKeyWrapper` 里加第三个 wrapper，由 WebAuthn 派生的密钥保护同一个 Vault Key；Vault Key 不变，记录无需重加密。

### 11.3 密码生成器
延后到 P1，放在 `VaultEditor` 里。注意：最低主密码强度要求（Task 3.1）不依赖它。

### 11.4 剪贴板自动清除
本期不做，原因见 §4.5。若将来做，需要评估 `clipboardRead` 权限的代价，以及面板关闭后定时器失效的问题。

### 11.5 Vault Key 轮换
重加密所有记录并在同一事务里替换两个 wrapper。这是真正撤销旧 Recovery Key 和旧备份的唯一办法，见 §2.5。

---

## 12. 安全审查 Checklist

发布前逐项过一遍。每项都要能指到一个测试或一次手工验证。

### 12.1 加密实现
- [ ] KDF 参数不低于 OWASP 最低线（PBKDF2-SHA256 ≥ 600k，或 Argon2id ≥ 19 MiB / t=2 / p=1）
- [ ] 每次加密都生成新的 12 字节随机 IV，调用方无法传入
- [ ] 认证标签由 Web Crypto 验证；篡改任意一字节解密失败
- [ ] 密钥长度 256 bit；没有 MD5、SHA-1、DES、RC4
- [ ] 不自行实现加密原语；SHA-256 校验和只用于输入校验，不提供安全性
- [ ] AAD 绑定 `recordId | type | formatVersion | segment`，并有对应测试

### 12.2 密钥管理
- [ ] 主密码在 KDF 前统一 `normalize('NFKC')`
- [ ] 主密码、明文 Vault Key、Recovery Key 都不落库、不进日志
- [ ] Session 里的 Vault Key 是 `extractable: false`
- [ ] 原始密钥字节和 `ArrayBuffer` 用完清零
- [ ] Recovery Key 为 256 bit，格式与填充位校验符合 §2.2，三组测试向量通过
- [ ] Recovery 包装密钥用 HKDF 派生，`usages = ['encrypt','decrypt']`
- [ ] 两个 wrapper 各自独立，改主密码不影响 recovery wrapper
- [ ] 所有改写 wrapper 的操作：事务外加解密、提交前试解、短事务内校验 `revision`
- [ ] 记录写入校验 `keyId`
- [ ] "旧 Key 失效"的文案只对当前库成立，UI 不写"旧密钥作废"

### 12.3 运行时安全
- [ ] 锁定后 Session 清空，`epoch` 递增，在途异步结果被丢弃
- [ ] `lock()` 与 `lockLocal()` 分离，两个实例互相广播不会循环
- [ ] 改主密码、Recovery、导入提交后都发送了广播，其他实例随之锁定
- [ ] `verifyMasterPassword` 不触碰 Session，不会重建 UI
- [ ] 明文只存在于 Session 持有的 store；组件不自存副本；`SecretField` 隐藏时 DOM 里没有明文
- [ ] 锁定时 `/vault` 子树整体卸载
- [ ] 自动锁定读取 settings 里的超时；休眠后唤醒时 `checkIdle` 生效
- [ ] "Side Panel 关闭即锁定"已通过 Task 1.0 spike 实测
- [ ] 内存残留检查按 Task 5.1 的步骤做过，结果已记录，剩余风险写进威胁模型
- [ ] 日志不含秘密；Vault 错误不经 Service Worker 原样回传

### 12.4 数据隔离
- [ ] Vault 使用独立数据库 `RiddleVaultDB`
- [ ] Notes 的搜索、导入、导出前后，Vault 各表行数不变
- [ ] 对 `SidecarDB` 调 `delete()` 不影响 `RiddleVaultDB`
- [ ] Vault 搜索关键词不进 URL、不进表单历史
- [ ] 解锁页没有 `<form>`，实测不弹"保存密码"
- [ ] Vault 逻辑不进 Service Worker 消息路由；若将来加入，校验 `sender.id` 且 `sender.tab === undefined`
- [ ] 保持默认 CSP，只加 `'wasm-unsafe-eval'`（如采用 Argon2id）；不引入 `rehype-raw` / `dangerouslySetInnerHTML`；锁定依赖版本并 `npm audit`

### 12.5 异常处理
- [ ] 初始化：回调取消时库里没有任何记录；并发初始化只有一个成功
- [ ] 改主密码失败保留旧 wrapper；并发修改抛 `ConflictError`
- [ ] Recovery 步骤一后中断：新主密码与旧 Recovery Key 都能解锁
- [ ] 导入：事务中途 abort 原库不变；导入后无法解锁可从快照回退
- [ ] 错误分类符合 §5.3，不承诺"区分密码错误与数据损坏"

### 12.6 备份
- [ ] 备份文件 `app` 严格等于 `riddle-notes-vault`
- [ ] 所有 `Uint8Array` 经 Base64 编解码
- [ ] KDF 参数、salt、iv、记录数的上下限校验
- [ ] 导入前试解全部记录并报告失败数
- [ ] 确认页明示"主密码和恢复密钥都会回到备份当时"
- [ ] 覆盖前写 `vaultSnapshot`；成功解锁一次后才删除
- [ ] 导出前重新输入主密码
- [ ] 不存在明文导出

### 12.7 性能
- [ ] 生产 KDF 参数下，低端设备解锁 < 2s
- [ ] 100 条记录的列表加载 < 500ms
- [ ] 锁定响应 < 50ms

---

## 13. 验收标准

### A. 初始化
- [ ] Notes 的使用不受影响
- [ ] 首次进入 Vault 展示初始化流程；读库期间显示 loading，不会误入 setup
- [ ] 主密码长度 ≥ 12 且强度得分 ≥ 3 才可创建
- [ ] Recovery Key 展示后，用户通过回填校验才能继续
- [ ] 回填校验通过之前，数据库里没有任何 Vault 数据
- [ ] 并发初始化只有一个成功，不会覆盖已有 Vault
- [ ] Recovery Key 能独立解开 Vault Key（"Test Recovery Key"）

### B. 加密存储
- [ ] 除 `type` 与时间戳外，所有字段加密
- [ ] 原始字节扫描 `vaultRecords`，找不到已知明文
- [ ] 列表只解密 summary，详情页才解密 secret
- [ ] 数据带 `formatVersion`

### C. 解锁与锁定
- [ ] 主密码正确可解锁，错误失败且不改数据
- [ ] 错误提示符合 §5.3 的三类
- [ ] 手动锁定立即生效；自动锁定按设置的时间生效
- [ ] 关闭 Side Panel、刷新、扩展重载后都需要重新解锁
- [ ] 锁定后 Vault 子树卸载，组件与 DOM 中无明文
- [ ] 其他实例收到广播后锁定
- [ ] 剪贴板清除**不属于**验收项（尽力而为）

### D. 记录
- [ ] 创建、查看、编辑、删除；删除前确认
- [ ] 秘密默认隐藏，Show 后可见，离开详情页后重新隐藏
- [ ] 编辑保留 `createdAt`，更新 `updatedAt`，使用新 IV
- [ ] 失败不产生部分写入

### E. 恢复
- [ ] Recovery Key 格式错误、校验和错误、认证失败分别给出对应提示
- [ ] 步骤一：新主密码生效，`recoveryRotationRequired = true`，UI 持续提示
- [ ] 步骤二取消或失败：旧 Recovery Key 仍可用
- [ ] 步骤二完成：当前库里旧 Recovery Key 不再有效
- [ ] 恢复后记录完整
- [ ] 重新生成 Recovery Key 需要主密码

### F. 备份
- [ ] Notes 导出不含 Vault；Vault 导出只含密文
- [ ] 导入校验：app 标记、版本、KDF 参数范围、各长度、记录数
- [ ] 导入前试解全部记录
- [ ] 覆盖导入有快照可回退，成功解锁一次后才删除
- [ ] 导入后所有会话被锁定
- [ ] 错误的备份文件不会改动现有数据

### G. 隔离
- [ ] Vault 不出现在 Notes 搜索与导出中
- [ ] Notes 导入前后 Vault 行数不变
- [ ] 从 content script 发 `VAULT_*` 消息被拒绝
- [ ] Vault 搜索词不进 URL

---

## 14. 开工顺序与待决策

### 进度与下一步
**已完成（有 jsdom 测试）**：Task 1.1 `RiddleVaultDB`、1.2 `CryptoService`、1.3 `VaultSession`、2.1 `VaultService`（含主密码强度策略）、2.2 的隔离守卫测试、2.3 Recovery Key 辅助、Phase 3 UI 的主体（创建、解锁、恢复、列表、详情、编辑、守卫、Sidebar 入口）、Task 4.2 的设置页。组合根在 `src/vault/runtime.ts`，由 `src/sidepanel/App.tsx` 最外层的 `VaultRuntimeProvider` 接入。

**部分完成**：Task 1.0。Argon2id 的 Node 基准和 manifest 构建试验做了（结果在 §7 Task 1.0），Side Panel 生命周期和低端机实测没做。

**没有做**：Phase 4.1 加密备份（导出、导入、快照回退）；Task 5.1 的堆快照检查和日志扫描；Argon2id（现在是 PBKDF2-SHA256，`KdfParams` 联合类型和分派都留好了）。

#### 没有在真实 Chrome 里验证过的事（上线前必须做）

以下全部只有 jsdom 测试。jsdom 能证明代码逻辑和 DOM 结构，**证明不了浏览器的行为，也看不到页面实际长什么样**。

1. **整个 UI 的实际渲染**。我没有在真实 Chrome 里打开过这些页面：布局、间距、配色、窄面板下的表现、深浅色、`.note-card` 套在 `<button>` 上的样式、`SecretField` 的等宽字体换行等，都没看过。最简单的办法：`npm run build` 后在 `chrome://extensions` 加载 `dist`，把整个流程手动走一遍。
2. **R4：关闭 Side Panel 是否真的销毁页面**。"关闭面板即锁定"的文案（自动锁定设置页）和整个"关闭即锁定"的设计都依赖它。代码里的兜底是 `pagehide` 时本地锁定（`runtime.ts`，有测试），但这只证明收到 `pagehide` 时会锁，不证明 Chrome 的 Side Panel 关闭时一定会触发它、也不证明页面一定被销毁。
3. **浏览器会不会弹"保存密码"**。各页面没有 `<form>`、`autoComplete` 也按设计写了，但 Chrome 的启发式没有测过。尤其是编辑页的"秘密"输入框是 `type="password"`、`autoComplete="off"`，在没有 `<form>` 的情况下是否会被当作密码字段处理，未知。
4. **低端设备的 KDF 耗时**。测试里用的是很小的迭代次数；生产参数下的解锁耗时（目标低端设备 < 2s）没有在真实设备上测过。
5. **Argon2id 在 Worker + `'wasm-unsafe-eval'` 下能否实例化**。当前没有采用 Argon2id，所以没有放宽 CSP，构建出的 manifest 与源码一致（权限、无自定义 CSP）。
6. **侧边栏主 chunk 的体积增量**。构建产物确认了 zxcvbn 被拆成两个懒加载 chunk（约 47 kB 和 422 kB，只在第一次评估密码时下载），后台脚本和内容脚本的产物里没有任何保险箱代码。但我没有保存改动前的构建体积，**给不出主 chunk 具体增加了多少**。

#### 与设计不一致、或有意偏离的地方

- **`lastCopiedSecret` 没有记**（§4.5）。**需要你决定**：保持现状（只提示、不清除），还是加 `clipboardRead` 权限做尽力清除。
- **没有 `VaultShell`**，`key={epoch}` 在 `VaultGuard` 里（§6.3 说明了原因）。
- **"可导出原始加密备份"** 这句文案（§5.3）引用了还没有的导出功能。
- **明文放在独立的 `VaultStore` 里**，不是"Session 持有的 store"（§4.4）。
- **没有任何一个变异检查证明的盲区**：`VaultEditor` 里填表单时的 `secret.id === id` 比对是纵深防御，我构造不出能单独抓到去掉它的测试，保留是因为后果是静默覆盖另一条记录而代价为零（代码注释里写了）。

**下一步**（按依赖排序）：
1. **上面"没有在真实 Chrome 里验证过的事"那一节，全部手动走一遍。** 这是现在最大的风险，比任何新功能都优先。结果会改动 §4.1 和 §1.2。
2. 决定 `lastCopiedSecret` 的去留（§4.5）。
3. Task 1.0 剩下的部分和 KDF 的决策（见"待决策"）。
4. Phase 4.1 加密备份。做完之后"可导出原始加密备份"那句文案才名副其实，设置页里的"导出前验证主密码"也才有地方放。
5. Task 5.1 的堆快照检查和日志扫描。

### 待决策
- [ ] **KDF**：Argon2id 还是 PBKDF2 600k + 自动升级（由 Task 1.0 实测结果决定）。Node 数据倾向 hash-wasm + Worker，但低端机数据没有
- [ ] **自动锁定默认值**：5 分钟（已同意）
- [ ] **密码生成器**：延后到 P1（已同意）

### 修订记录
- **v1.2 状态同步（三）**：Phase 3 UI 和 Task 4.2 设置页实现并有测试；新增 `verifyRecoveryKey`、`isRecoveryRotationRequired`、`VaultStore`、组合根和 `VaultGuard`。§4.4 第 3、4 条按实现改写（`VaultGuard` 承担 `key={epoch}`、明文在独立的 `VaultStore` 里）；§4.5 写明 `lastCopiedSecret` 有意没做及理由；§5.2 补两个新方法；§5.3 补"记录"语境和一处文案与现状不符；§6.1 目录更新；§6.3 的 `VaultShell` 示意改成实际的 `VaultGuard`；§7 的勾选按测试证据更新（没有证据的不勾，写明缺什么）；§14 重写，新增"没有在真实 Chrome 里验证过的事"和"与设计不一致的地方"两份清单。测试计数更新为 22 个文件、941 个用例。§12、§13 的发布检查表**没有动**：它们要求能指到一个测试**或一次手工验证**，而手工验证一次都还没做。
- **v1.2 状态同步（二）**：Task 1.3 最后一条已完成并勾选：自动锁定超时取自 `vaultSettings`（§4.2、§4.3、§5.2 同步补入 `settings-changed` 广播、Session 的超时缓存、`get/setAutoLockTimeout`，以及"解锁读失败用默认值、刷新读失败保持当前值"的取舍）；§4.2 的 Session 示意代码仍与实现有出入，已注明以代码为准；测试计数更新为 10 个文件、455 个用例；§14 的"下一步"去掉已完成的一项。
- **v1.2 状态同步**（版本号不变，内容未重新评审）：§7 的复选框按代码和测试勾选，没有测试对应的不勾，并写明缺什么；状态行和附录 C 里"没有任何 Vault 代码"的说法更正；新增 §5.4 主密码强度策略，强制执行放在服务层，§6.2、Task 3.1 随之改成"UI 只展示"；§5.1、§2.2、§9.1 里 `generateRecoveryKey` / `parseRecoveryKey` 更正为异步并补上 `formatRecoveryKey`；Task 1.0 补入 Node 基准结果与 manifest 构建试验。§12、§13 没有动。
- **v1.2**：按第二轮评审重写 §2–§9、§11–§14。主要改动：HKDF usages 改为 `encrypt/decrypt`；乐观锁真正落地（`expectedRevision` 与 `keyId`）；`lock()` 与 `lockLocal()` 分离；Recovery 拆成 `recoverAccess` 与 `rotateRecoveryKey`；Session 统一入口 `open()` 与 `extractable:false`；路由守卫修复；错误分类改为三类；Recovery Key 规范与测试向量定稿；AAD、IV 长度校验、字节清零写入 Task 1.2；`vaultSnapshot` 并入 v1；Argon2id spike 前移到 Task 1.0；§9 测试全部对齐新接口。
- **v1.1**：第一轮评审后的修订。
- **v1.0**：初始版本。

---

## 附录

### A. 参考资料
- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [Web Crypto API (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API)
- RFC 4648（Base32）、RFC 5869（HKDF）

### B. 外部依赖（待 Task 1.0 / 3.1 确认）
- **Argon2id**（如采用）：`hash-wasm`（Node 基准里最快，需放 Worker）或 `@noble/hashes`（纯 JS，64 MiB / t=3 超过 1s，不推荐）。两者现在都在 `devDependencies`，是评估用的；正式采用时要挪到 `dependencies`，没采用就卸载。`argon2-browser` 最后发布于 2022-04，不再考虑。
- **密码强度**：已定，`@zxcvbn-ts/core` 4.3.0 + `@zxcvbn-ts/language-common` 4.2.0（`dependencies`），懒加载；不带 `language-en` / `language-zh`，原因见 §5.4。原版 `zxcvbn` 自 2022-06 起不再更新，没有采用。
- **Base32**：按 RFC 4648 自行实现即可，需要额外的填充位校验，现成库通常不做。

### C. 文档状态
- 本文档是技术方案。已实现的部分见 §7 的勾选，代码在 `src/vault/` 与 `src/db/vault-schema.ts`，测试在 `tests/vault/`。
- §12、§13 是**发布前**逐项验收的清单，这次没有勾：它们要求能指到一个测试或一次手工验证，等对应的功能（UI、备份）做完后再逐项过。
- 产品需求以对话中的 PRD 为准，仓库里尚无 `vault-prd.md`；若要保留请单独落成文件。
