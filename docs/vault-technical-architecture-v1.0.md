# Riddle Notes Secure Vault — 技术架构方案

**版本**: 1.1  
**日期**: 2025-01-27  
**状态**: 修订中（基于评审反馈）

## 文档概述

本文档定义 Riddle Notes Secure Vault 功能的完整技术架构，包括加密机制、密钥管理、数据存储、运行时安全和开发实施计划。

**关键读者**：开发团队、安全审查人员

**配套文档**：[Secure Vault PRD](./vault-prd.md)

---

## 目录

1. [加密架构设计](#1-加密架构设计)
2. [密钥管理方案](#2-密钥管理方案)
3. [数据存储设计](#3-数据存储设计)
4. [运行时安全](#4-运行时安全)
5. [核心服务实现](#5-核心服务实现)
6. [UI 组件架构](#6-ui-组件架构)
7. [开发任务拆分](#7-开发任务拆分)
8. [风险评估与缓解](#8-风险评估与缓解)
9. [测试策略](#9-测试策略)
10. [UI 设计建议](#10-ui-设计建议)
11. [后续扩展预留](#11-后续扩展预留)
12. [安全审查 Checklist](#12-安全审查-checklist)

---

## 1. 加密架构设计

### 1.1 核心原则

**双层密钥架构**

```
User Master Password (不持久化)
    ↓ PBKDF2/Argon2id + Salt
Password-Derived Key (运行时)
    ↓ 加密
Encrypted Vault Key (持久化)
    ↓ 解密
Vault Key (运行时)
    ↓ AES-256-GCM
Encrypted Records (持久化)
```

**为什么需要 Vault Key？**

- 修改主密码时只需重新加密 Vault Key，无需重加密所有记录
- Recovery Key 可独立保护同一个 Vault Key
- 为未来的密钥轮换和算法升级提供统一入口
- 支持未来多设备同步场景

### 1.2 密钥派生函数（KDF）选择

**第一版方案：PBKDF2-SHA256**

```typescript
// Web Crypto API 原生支持，无需额外依赖
iterations: 600000  // OWASP 2023 最低推荐
salt: 32 bytes (CSPRNG)
```

**选择理由**：
- 浏览器原生支持，无需 WASM 和 CSP 调整
- 性能可预测（< 1s）
- 满足安全最低标准

**未来升级路径：Argon2id**

OWASP 首选 Argon2id (m=19 MiB, t=2, p=1)，抗 GPU/ASIC 攻击能力更强。第一版使用 PBKDF2 的原因：
- 现在没有存量用户，格式升级成本低
- 需要在 MV3 的 `extension_pages` CSP 中添加 `'wasm-unsafe-eval'`
- 需要评估依赖库（`hash-wasm` 或 `@noble/hashes`，`argon2-browser` 自 2022 年后未维护）

**升级策略**：
- `kdfParams` 使用带 `algorithm` 判别字段的联合类型
- 解锁成功后，若当前参数低于策略，静默重新包装 Vault Key
- 双密钥架构让重包装成本很低（只加密 32 字节）
- 不在 Settings 中让用户选择 KDF，避免降级风险

### 1.3 加密算法

**AES-256-GCM**

```typescript
algorithm: 'AES-GCM'
keyLength: 256 bits
ivLength: 12 bytes  // GCM 推荐
tagLength: 128 bits  // 认证标签
```

**每条记录独立 IV**

```typescript
interface EncryptedRecord {
  id: string;
  iv: Uint8Array;  // 12 bytes, 每次加密随机生成
  ciphertext: Uint8Array;
  version: 1;
}
```

**关键规则**：

- 同一 Vault Key 下，IV 绝不能重复
- 每次加密（新建/编辑）都必须生成新 IV
- GCM 的 IV 重用会导致灾难性的密钥泄露

---

## 2. 密钥管理方案

### 2.1 Vault Key 生成与存储

**生成**

```typescript
// 使用 CSPRNG 生成 256-bit 随机密钥
const vaultKey = crypto.getRandomValues(new Uint8Array(32));
```

**存储结构**

```typescript
interface VaultKeyWrapper {
  // 主密码保护的 Vault Key
  masterProtected: {
    encryptedKey: Uint8Array;
    iv: Uint8Array;
    salt: Uint8Array;  // KDF salt
    kdfParams: {
      algorithm: 'PBKDF2-SHA256';
      iterations: 600000;
    };
  };
  
  // Recovery Key 保护的 Vault Key
  recoveryProtected: {
    encryptedKey: Uint8Array;
    iv: Uint8Array;
    salt: Uint8Array;
    kdfParams: {
      algorithm: 'PBKDF2-SHA256';
      iterations: 100000;  // 可适当降低，用户会妥善保管
    };
  };
  
  version: 1;
  createdAt: number;
  updatedAt: number;
}
```

### 2.2 Recovery Key 设计

**生成方式**

```typescript
// 生成 256-bit 高熵密钥
const recoveryKey = crypto.getRandomValues(new Uint8Array(32));

// Base32 编码（52 个字符 + 4 字符校验和）
const encoded = base32Encode(recoveryKey);  // RFC 4648, no padding
const checksum = computeChecksum(encoded);  // CRC-16 或 SHA256 前 2 字节
const formatted = formatWithChecksum(encoded, checksum);
```

**格式定义**

```
Recovery Key Format (56 characters):
RN-V1-ABCD-EFGH-IJKL-MNOP-QRST-UVWX-YZ23-4567-89AB-CDEF-GHIJ-KLMN-OPQR

RN:    Riddle Notes 标识
V1:    版本 1
52字符: 256-bit 密钥的 Base32 编码（32 bytes × 8 bits ÷ 5 bits/char = 51.2 → 52）
4字符:  校验和（CRC-16 的 Base32 编码）

总计: 2 + 1 + 2 + 52 + 4 = 61 字符（含分隔符 14 × '-'）
```

**派生密钥（用于加密 Vault Key）**

```typescript
// 用户输入恢复密钥后，先规范化
function normalizeRecoveryKey(input: string): Uint8Array {
  // 1. 转大写、去除空格和连字符
  const clean = input.toUpperCase().replace(/[\s-]/g, '');
  
  // 2. 验证格式：RNV1 + 52字符 + 4字符校验
  if (!clean.startsWith('RNV1') || clean.length !== 60) {
    throw new Error('Recovery Key 格式错误');
  }
  
  // 3. 分离数据和校验和
  const data = clean.slice(4, 56);  // 52 字符
  const checksum = clean.slice(56, 60);  // 4 字符
  
  // 4. 验证校验和
  const expectedChecksum = computeChecksum(data);
  if (checksum !== expectedChecksum) {
    throw new Error('Recovery Key 校验失败，请检查是否输入正确');
  }
  
  // 5. Base32 解码
  return base32Decode(data);  // 返回 32 字节
}

// 使用 HKDF-SHA256 派生包装密钥，而非 PBKDF2
async function deriveRecoveryWrapperKey(recoveryKeyBytes: Uint8Array): Promise<CryptoKey> {
  const ikm = await crypto.subtle.importKey(
    'raw',
    recoveryKeyBytes,
    'HKDF',
    false,
    ['deriveKey']
  );
  
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(0),  // Recovery Key 本身已有足够熵
      info: new TextEncoder().encode('riddle-notes/vault/recovery-wrap/v1')
    },
    ikm,
    { name: 'AES-GCM', length: 256 },
    false,
    ['wrapKey', 'unwrapKey']
  );
}
```

**关键特性**

- 256 bits 熵（满足密码学要求）
- 人类可复制（分段显示、校验和防止输入错误）
- 可下载为文本文件（提示：此文件无需主密码即可解锁 Vault，不要与加密备份放在一起）
- 恢复时需要精确匹配（校验和机制能区分"输错字符"和"密钥错误"）

**轮换策略**

恢复流程分为两步，避免用户在确认前关闭面板导致 Vault 永久锁死：

**步骤一：恢复访问**
1. 用户输入 Recovery Key
2. 解密 Vault Key
3. 用户设置新主密码
4. 用新主密码重新加密 Vault Key
5. 在一次事务中提交：
   - 新的 `masterProtected` wrapper
   - `recoveryRotationRequired: true` 标记
6. 此时用户已可以用新主密码访问 Vault

**步骤二：轮换 Recovery Key**
1. 在内存中生成新 Recovery Key
2. 展示新 Recovery Key，要求用户回填部分字符校验
3. 用户确认保存后，用新 Recovery Key 重新加密 Vault Key
4. 在一次事务中提交：
   - 新的 `recoveryProtected` wrapper
   - `recoveryRotationRequired: false`
5. 旧 Recovery Key 在当前库中失效

**中断恢复**：
- 步骤一和二之间中断：旧 Recovery Key 仍然有效，不会锁死
- UI 在步骤一完成后强提示"请完成 Recovery Key 轮换"
- Settings 中"重新生成 Recovery Key"功能要求输入主密码

**威胁模型说明**：
- "旧 Key 失效"只对当前库成立
- 旧备份文件中的旧 `recoveryProtected` wrapper 仍可用旧 Key 解开
- 如需彻底撤销旧密钥，需要"轮换 Vault Key"（重加密所有记录，本期不实现）

### 2.3 密钥生命周期

```
初始化
  ↓
生成 Vault Key (CSPRNG)
  ↓
生成 Master Protected Wrapper
生成 Recovery Protected Wrapper
  ↓
持久化到 IndexedDB
  ↓
用户使用
  ↓
修改主密码 → 只更新 Master Protected Wrapper
  ↓
Recovery 恢复 → 废弃旧 Recovery Key，生成新的
```

---

## 3. 数据存储设计

### 3.1 IndexedDB Schema

```typescript
// Database: SidecarDB (现有的 Notes 数据库)
// 当前版本: 3

// Database: RiddleVaultDB (新建，独立数据库)
// 版本: 1

// 新建独立数据库，避免故障域污染
export class RiddleVaultDB extends Dexie {
  vaultConfig!: Table<VaultConfig, string>;
  vaultRecords!: Table<VaultRecord, string>;

  constructor() {
    super('RiddleVaultDB');
    
    this.version(1).stores({
      vaultConfig: 'id',  // 单例，id 固定为 'singleton'
      vaultRecords: 'id, type, updatedAt'
    });
  }
}

// 新增 Object Store: vaultConfig
interface VaultConfig {
  id: 'singleton';  // 只有一条记录
  version: 1;
  keyWrapper: VaultKeyWrapper;
  settings: {
    autoLockTimeout: number;  // 毫秒
  };
  // 去掉 initialized 字段，用 keyWrapper !== null 判断
  createdAt: number;
  updatedAt: number;
}

// 新增 Object Store: vaultRecords
interface VaultRecord {
  id: string;  // UUID
  
  // 元数据（明文，用于列表展示）
  type: 'api_key' | 'password' | 'database' | 'secure_note';
  version: 1;
  createdAt: number;
  updatedAt: number;
  
  // 摘要数据（加密，列表页解密）
  summaryData: Uint8Array;  // { title: string; tags?: string[] }
  summaryIv: Uint8Array;
  
  // 秘密数据（加密，详情页解密）
  secretData: Uint8Array;  // { secret: string; username?: string; url?: string; notes?: string }
  secretIv: Uint8Array;
}

// 解密后的结构（仅存在于运行时）
interface VaultRecordPlaintext {
  // 摘要（列表展示）
  title: string;
  tags?: string[];
  
  // 秘密（详情页展示）
  secret: string;
  username?: string;
  url?: string;
  notes?: string;
  
  // 类型（从 VaultRecord.type 复制）
  type: 'api_key' | 'password' | 'database' | 'secure_note';
}
```

**设计说明**：
- **独立数据库**：避免 Notes 的"重置数据库"误删 Vault，升级失败也不互相影响
- **type 明文**：用于列表分类过滤，不解密即可展示分组
- **两段加密**：列表页只解密 `summaryData` 获取标题，详情页才解密 `secretData`
- **去掉 initialized**：`keyWrapper === null` 即未初始化，减少状态

**索引设计**

```typescript
vaultRecords:
  - 主键: id
  - 索引: type (用于分类过滤)
  - 索引: updatedAt (用于排序)
```

### 3.2 迁移脚本

```typescript
// src/db/vault-schema.ts
import Dexie, { Table } from 'dexie';

export class RiddleVaultDB extends Dexie {
  vaultConfig!: Table<VaultConfig, string>;
  vaultRecords!: Table<VaultRecord, string>;

  constructor() {
    super('RiddleVaultDB');
    
    this.version(1).stores({
      vaultConfig: 'id',
      vaultRecords: 'id, type, updatedAt'
    });
  }
}

// 导出单例实例
export const vaultDb = new RiddleVaultDB();
```

**初始化检查**

```typescript
// 检查是否已初始化
async function isVaultInitialized(): Promise<boolean> {
  const config = await vaultDb.vaultConfig.get('singleton');
  return config !== undefined && config.keyWrapper !== null;
}
```

### 3.3 数据隔离原则

**IndexedDB 允许存储（加密后）**：

- Vault 配置版本
- KDF 参数
- Salt
- 加密的 Vault Key
- Recovery Key 对应的加密 Vault Key
- 加密记录
- IV / Nonce
- 必要的版本、状态等元数据

**IndexedDB 不允许存储（明文）**：

- 主密码
- 明文 Vault Key
- 明文 API Key
- 明文 Password
- 明文 Token
- 明文 Notes
- 未加密的 Recovery Key

---

## 4. 运行时安全

### 4.1 内存中的敏感数据管理

**VaultSession 单例**

```typescript
class VaultSession {
  private static instance: VaultSession | null = null;
  private vaultKey: CryptoKey | null = null;
  private epoch: number = 0;  // 用于检测异步操作是否过期
  private lastActivity: number = 0;
  private lockTimer: NodeJS.Timeout | null = null;
  private broadcastChannel: BroadcastChannel;

  private constructor() {
    this.broadcastChannel = new BroadcastChannel('riddle-vault');
    this.broadcastChannel.onmessage = (event) => {
      if (event.data.type === 'lock' || event.data.type === 'wrapper-changed') {
        this.lock();
      }
    };
  }

  static getInstance(): VaultSession {
    if (!VaultSession.instance) {
      VaultSession.instance = new VaultSession();
    }
    return VaultSession.instance;
  }

  async unlock(vaultKey: CryptoKey): Promise<void> {
    this.vaultKey = vaultKey;
    this.epoch++;
    this.lastActivity = Date.now();
    this.resetLockTimer();
  }

  lock(): void {
    // 清除所有敏感数据
    this.vaultKey = null;
    this.epoch++;  // 让所有在途异步操作失效
    this.lastActivity = 0;
    if (this.lockTimer) {
      clearTimeout(this.lockTimer);
      this.lockTimer = null;
    }
    
    // 广播锁定事件给其他 Side Panel 实例
    this.broadcastChannel.postMessage({ type: 'lock' });
  }

  isUnlocked(): boolean {
    return this.vaultKey !== null;
  }

  getVaultKey(): CryptoKey | null {
    return this.vaultKey;
  }

  getEpoch(): number {
    return this.epoch;
  }

  updateActivity(): void {
    this.lastActivity = Date.now();
    this.resetLockTimer();
  }

  private resetLockTimer(): void {
    if (this.lockTimer) {
      clearTimeout(this.lockTimer);
    }
    
    // 读取配置的超时时间
    const timeout = 5 * 60 * 1000;  // 默认 5 分钟
    
    this.lockTimer = setTimeout(() => {
      const elapsed = Date.now() - this.lastActivity;
      if (elapsed >= timeout) {
        this.lock();
      } else {
        // 处理系统休眠导致的时间跳跃
        this.resetLockTimer();
      }
    }, timeout);
  }
}
```

**生命周期管理**

- **Side Panel 关闭：立即锁定**（页面卸载时 Session 对象销毁，Vault Key 随之清除）
- **浏览器关闭：立即锁定**
- **Service Worker 重启：不影响**（Session 在 Side Panel 进程中）
- **扩展更新/重新加载：立即锁定**（Side Panel 重新加载）

**异步操作的 Epoch 检查**

```typescript
async function getRecord(id: string): Promise<VaultRecordPlaintext | null> {
  const session = VaultSession.getInstance();
  const vaultKey = session.getVaultKey();
  if (!vaultKey) throw new Error('Vault is locked');
  
  const startEpoch = session.getEpoch();
  
  // 从数据库读取（异步操作）
  const record = await vaultDb.vaultRecords.get(id);
  
  // 检查是否在等待期间被锁定
  if (session.getEpoch() !== startEpoch) {
    throw new Error('Vault was locked during operation');
  }
  
  if (!record) return null;
  
  // 解密（异步操作）
  const plaintext = await cryptoService.decrypt(record, vaultKey);
  
  // 再次检查
  if (session.getEpoch() !== startEpoch) {
    // 立即清零解密结果（虽然 JS 无法真正清零字符串）
    throw new Error('Vault was locked during operation');
  }
  
  return plaintext;
}
```

### 4.2 用户活动监听

```typescript
// 在 Side Panel 中监听用户活动
function setupActivityTracking() {
  const events = ['mousedown', 'keydown', 'scroll', 'touchstart'];
  
  const handler = () => {
    if (VaultSession.getInstance().isUnlocked()) {
      VaultSession.getInstance().updateActivity();
    }
  };
  
  events.forEach(event => {
    window.addEventListener(event, handler, { passive: true });
  });
  
  // 监听页面可见性变化，处理系统休眠
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      const session = VaultSession.getInstance();
      if (session.isUnlocked()) {
        const config = await vaultDb.vaultConfig.get('singleton');
        const timeout = config?.settings.autoLockTimeout ?? 5 * 60 * 1000;
        const elapsed = Date.now() - session.lastActivity;
        
        if (elapsed >= timeout) {
          session.lock();
        }
      }
    }
  });
}
```

### 4.3 锁定触发点

1. **手动锁定**：用户点击 Lock 按钮
2. **超时锁定**：自动定时器触发
3. **Side Panel 关闭**：页面卸载时 Session 对象销毁
4. **浏览器关闭**：Side Panel 随之关闭
5. **扩展更新/重新加载**：Side Panel 重新加载，Session 重建
6. **其他实例触发**：BroadcastChannel 收到 `lock` 或 `wrapper-changed` 消息

### 4.4 锁定时的清理要求

锁定不只是 UI 切换到锁屏。必须完成：

- 清除内存中的 Vault Key 引用
- Epoch 计数器递增，让所有在途异步操作失效
- 清除搜索结果和搜索关键词（组件 state，锁定时 UI 卸载自动清除）
- 隐藏所有已显示的秘密
- VaultGuard 卸载整个 `/vault` 子树，用 `key={epoch}` 强制重建
- 停止正在进行的解密操作（Epoch 检查机制）
- 下次访问需要重新解锁

**UI 架构**

```typescript
function VaultRoot() {
  const session = VaultSession.getInstance();
  const epoch = useSyncExternalStore(
    (callback) => {
      // 订阅 Session 的 epoch 变化
      session.subscribe(callback);
      return () => session.unsubscribe(callback);
    },
    () => session.getEpoch()
  );
  
  // epoch 变化时强制重建整个子树
  return <Outlet key={epoch} />;
}
```

**剪贴板清理**

```typescript
let lastCopiedSecret: string | null = null;

async function copySecret(secret: string) {
  await navigator.clipboard.writeText(secret);
  lastCopiedSecret = secret;
  // 显示 Toast: "已复制"
}

// 锁定时清理
function lock() {
  // ... 清理其他数据
  
  if (lastCopiedSecret) {
    navigator.clipboard.readText().then(current => {
      if (current === lastCopiedSecret) {
        navigator.clipboard.writeText('');
      }
    }).catch(() => {
      // 用户未授权 clipboard-read，忽略
    });
    lastCopiedSecret = null;
  }
}
```

**威胁模型**

- JS 无法清零字符串，明文要等 GC
- 防护目标：离线窃取 IndexedDB、旁人使用已解锁设备
- 不防护：同权限的恶意软件、内存取证、键盘记录器

---

## 5. 核心服务实现

### 5.1 CryptoService

```typescript
// src/vault/crypto/crypto-service.ts
export class CryptoService {
  // 生成 Vault Key
  async generateVaultKey(): Promise<CryptoKey> {
    return crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true,  // extractable
      ['encrypt', 'decrypt']
    );
  }

  // KDF: 主密码 -> 密钥
  async deriveKeyFromPassword(
    password: string,
    salt: Uint8Array,
    iterations: number = 600000
  ): Promise<CryptoKey> {
    const encoder = new TextEncoder();
    // 主密码统一 Unicode 规范化，避免输入法差异
    const normalized = password.normalize('NFKC');
    const passwordKey = await crypto.subtle.importKey(
      'raw',
      encoder.encode(normalized),
      'PBKDF2',
      false,
      ['deriveBits', 'deriveKey']
    );

    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt,
        iterations,
        hash: 'SHA-256'
      },
      passwordKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  // Recovery Key: 原始字节 -> 包装密钥（HKDF）
  async deriveRecoveryWrapperKey(recoveryKeyBytes: Uint8Array): Promise<CryptoKey> {
    const ikm = await crypto.subtle.importKey(
      'raw',
      recoveryKeyBytes,
      'HKDF',
      false,
      ['deriveKey']
    );
    
    return crypto.subtle.deriveKey(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: new Uint8Array(0),  // Recovery Key 本身已有足够熵
        info: new TextEncoder().encode('riddle-notes/vault/recovery-wrap/v1')
      },
      ikm,
      { name: 'AES-GCM', length: 256 },
      false,
      ['wrapKey', 'unwrapKey']
    );
  }

  // 加密 Vault Key
  async encryptVaultKey(
    vaultKey: CryptoKey,
    wrapperKey: CryptoKey
  ): Promise<{ encryptedKey: Uint8Array; iv: Uint8Array }> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const exported = await crypto.subtle.exportKey('raw', vaultKey);
    
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      wrapperKey,
      exported
    );

    return {
      encryptedKey: new Uint8Array(encrypted),
      iv
    };
  }

  // 解密 Vault Key
  async decryptVaultKey(
    encryptedKey: Uint8Array,
    iv: Uint8Array,
    wrapperKey: CryptoKey
  ): Promise<CryptoKey> {
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      wrapperKey,
      encryptedKey
    );

    return crypto.subtle.importKey(
      'raw',
      decrypted,
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );
  }

  // 加密记录（两段加密）
  async encryptRecord(
    summary: { title: string; tags?: string[] },
    secret: { secret: string; username?: string; url?: string; notes?: string },
    vaultKey: CryptoKey
  ): Promise<{
    summaryData: Uint8Array;
    summaryIv: Uint8Array;
    secretData: Uint8Array;
    secretIv: Uint8Array;
  }> {
    const encoder = new TextEncoder();
    
    // 加密摘要
    const summaryIv = crypto.getRandomValues(new Uint8Array(12));
    const summaryEncrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: summaryIv },
      vaultKey,
      encoder.encode(JSON.stringify(summary))
    );
    
    // 加密秘密
    const secretIv = crypto.getRandomValues(new Uint8Array(12));
    const secretEncrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: secretIv },
      vaultKey,
      encoder.encode(JSON.stringify(secret))
    );

    return {
      summaryData: new Uint8Array(summaryEncrypted),
      summaryIv,
      secretData: new Uint8Array(secretEncrypted),
      secretIv
    };
  }

  // 解密摘要（列表页使用）
  async decryptSummary(
    summaryData: Uint8Array,
    summaryIv: Uint8Array,
    vaultKey: CryptoKey
  ): Promise<{ title: string; tags?: string[] }> {
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: summaryIv },
      vaultKey,
      summaryData
    );

    const decoder = new TextDecoder();
    const json = decoder.decode(decrypted);
    return JSON.parse(json);
  }

  // 解密秘密（详情页使用）
  async decryptSecret(
    secretData: Uint8Array,
    secretIv: Uint8Array,
    vaultKey: CryptoKey
  ): Promise<{ secret: string; username?: string; url?: string; notes?: string }> {
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: secretIv },
      vaultKey,
      secretData
    );

    const decoder = new TextDecoder();
    const json = decoder.decode(decrypted);
    return JSON.parse(json);
  }

  // 生成 Recovery Key
  generateRecoveryKey(): { key: Uint8Array; formatted: string } {
    const key = crypto.getRandomValues(new Uint8Array(32));
    const formatted = this.formatRecoveryKey(key);
    return { key, formatted };
  }

  private formatRecoveryKey(key: Uint8Array): string {
    // 使用 base32 编码并分段
    // RN-V1-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX
    // 实现略，需要引入 base32 编码库或自行实现
    return 'RN-V1-XXXX-XXXX-...';  // 占位符
  }
}
```

### 5.2 VaultService

```typescript
// src/vault/services/vault-service.ts
export class VaultService {
  private cryptoService = new CryptoService();
  private session = VaultSession.getInstance();

  // 初始化 Vault
  async initializeVault(masterPassword: string): Promise<{
    success: boolean;
    recoveryKey?: string;
  }> {
    try {
      // 1. 生成 Vault Key
      const vaultKey = await this.cryptoService.generateVaultKey();

      // 2. 生成 Recovery Key
      const { key: recoveryKeyRaw, formatted: recoveryKeyFormatted } = 
        this.cryptoService.generateRecoveryKey();

      // 3. 主密码保护 Vault Key
      const masterSalt = crypto.getRandomValues(new Uint8Array(32));
      const masterDerivedKey = await this.cryptoService.deriveKeyFromPassword(
        masterPassword,
        masterSalt,
        600000
      );
      const masterProtected = await this.cryptoService.encryptVaultKey(
        vaultKey,
        masterDerivedKey
      );

      // 4. Recovery Key 保护 Vault Key
      const recoverySalt = crypto.getRandomValues(new Uint8Array(32));
      const recoveryDerivedKey = await this.cryptoService.deriveKeyFromPassword(
        recoveryKeyFormatted,
        recoverySalt,
        100000
      );
      const recoveryProtected = await this.cryptoService.encryptVaultKey(
        vaultKey,
        recoveryDerivedKey
      );

      // 5. 保存到 IndexedDB
      const keyWrapper: VaultKeyWrapper = {
        masterProtected: {
          encryptedKey: masterProtected.encryptedKey,
          iv: masterProtected.iv,
          salt: masterSalt,
          kdfParams: {
            algorithm: 'PBKDF2-SHA256',
            iterations: 600000
          }
        },
        recoveryProtected: {
          encryptedKey: recoveryProtected.encryptedKey,
          iv: recoveryProtected.iv,
          salt: recoverySalt,
          kdfParams: {
            algorithm: 'PBKDF2-SHA256',
            iterations: 100000
          }
        },
        version: 1,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      await this.saveKeyWrapper(keyWrapper);

      return {
        success: true,
        recoveryKey: recoveryKeyFormatted
      };
    } catch (error) {
      console.error('Vault initialization failed:', error);
      return { success: false };
    }
  }

  // 解锁（主密码）
  async unlockWithMasterPassword(masterPassword: string): Promise<boolean> {
    try {
      const keyWrapper = await this.loadKeyWrapper();
      if (!keyWrapper) return false;

      // 派生密钥
      const derivedKey = await this.cryptoService.deriveKeyFromPassword(
        masterPassword,
        keyWrapper.masterProtected.salt,
        keyWrapper.masterProtected.kdfParams.iterations
      );

      // 解密 Vault Key
      const vaultKey = await this.cryptoService.decryptVaultKey(
        keyWrapper.masterProtected.encryptedKey,
        keyWrapper.masterProtected.iv,
        derivedKey
      );

      // 保存到 Session
      await this.session.setVaultKey(vaultKey);
      return true;
    } catch (error) {
      // 解密失败（密码错误或数据损坏）
      return false;
    }
  }

  // 解锁（Recovery Key）
  async unlockWithRecoveryKey(recoveryKey: string): Promise<boolean> {
    try {
      const keyWrapper = await this.loadKeyWrapper();
      if (!keyWrapper) return false;

      // 派生密钥
      const derivedKey = await this.cryptoService.deriveKeyFromPassword(
        recoveryKey,
        keyWrapper.recoveryProtected.salt,
        keyWrapper.recoveryProtected.kdfParams.iterations
      );

      // 解密 Vault Key
      const vaultKey = await this.cryptoService.decryptVaultKey(
        keyWrapper.recoveryProtected.encryptedKey,
        keyWrapper.recoveryProtected.iv,
        derivedKey
      );

      // 保存到 Session
      await this.session.setVaultKey(vaultKey);
      return true;
    } catch (error) {
      return false;
    }
  }

  // 修改主密码
  async changeMasterPassword(
    currentPassword: string,
    newPassword: string
  ): Promise<boolean> {
    try {
      // 1. 验证当前密码并获取 Vault Key
      const unlocked = await this.unlockWithMasterPassword(currentPassword);
      if (!unlocked) return false;

      const vaultKey = this.session.getVaultKey();
      if (!vaultKey) return false;

      // 2. 使用新密码重新加密 Vault Key
      const newSalt = crypto.getRandomValues(new Uint8Array(32));
      const newDerivedKey = await this.cryptoService.deriveKeyFromPassword(
        newPassword,
        newSalt,
        600000
      );
      const newProtected = await this.cryptoService.encryptVaultKey(
        vaultKey,
        newDerivedKey
      );

      // 3. 更新 keyWrapper（保持 recoveryProtected 不变）
      const keyWrapper = await this.loadKeyWrapper();
      if (!keyWrapper) return false;

      keyWrapper.masterProtected = {
        encryptedKey: newProtected.encryptedKey,
        iv: newProtected.iv,
        salt: newSalt,
        kdfParams: {
          algorithm: 'PBKDF2-SHA256',
          iterations: 600000
        }
      };
      keyWrapper.updatedAt = Date.now();

      await this.saveKeyWrapper(keyWrapper);
      return true;
    } catch (error) {
      console.error('Change master password failed:', error);
      return false;
    }
  }

  // CRUD operations
  async createRecord(plaintext: VaultRecordPlaintext): Promise<string> {
    const vaultKey = this.session.getVaultKey();
    if (!vaultKey) throw new Error('Vault is locked');

    const { ciphertext, iv } = await this.cryptoService.encryptRecord(
      plaintext,
      vaultKey
    );

    const record: VaultRecord = {
      id: crypto.randomUUID(),
      encryptedData: ciphertext,
      iv,
      type: plaintext.type,
      version: 1,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    await this.saveRecord(record);
    return record.id;
  }

  async getRecord(id: string): Promise<VaultRecordPlaintext | null> {
    const vaultKey = this.session.getVaultKey();
    if (!vaultKey) throw new Error('Vault is locked');

    const record = await this.loadRecord(id);
    if (!record) return null;

    return this.cryptoService.decryptRecord(
      record.encryptedData,
      record.iv,
      vaultKey
    );
  }

  async updateRecord(id: string, plaintext: VaultRecordPlaintext): Promise<boolean> {
    const vaultKey = this.session.getVaultKey();
    if (!vaultKey) throw new Error('Vault is locked');

    const { ciphertext, iv } = await this.cryptoService.encryptRecord(
      plaintext,
      vaultKey
    );

    const record: VaultRecord = {
      id,
      encryptedData: ciphertext,
      iv,
      type: plaintext.type,
      version: 1,
      createdAt: Date.now(),  // 从旧记录读取
      updatedAt: Date.now()
    };

    await this.saveRecord(record);
    return true;
  }

  async deleteRecord(id: string): Promise<boolean> {
    // IndexedDB delete operation
    return true;
  }

  async listRecords(): Promise<VaultRecord[]> {
    // 返回列表（不解密，只用于展示元数据）
    return [];
  }

  // 私有方法
  private async loadKeyWrapper(): Promise<VaultKeyWrapper | null> {
    // 从 IndexedDB 读取
    return null;
  }

  private async saveKeyWrapper(wrapper: VaultKeyWrapper): Promise<void> {
    // 保存到 IndexedDB
  }

  private async loadRecord(id: string): Promise<VaultRecord | null> {
    // 从 IndexedDB 读取
    return null;
  }

  private async saveRecord(record: VaultRecord): Promise<void> {
    // 保存到 IndexedDB
  }
}
```

---

## 6. UI 组件架构

### 6.1 目录结构

```
src/vault/
├── pages/
│   ├── VaultSetup.tsx          # 初始化流程
│   ├── VaultUnlock.tsx         # 解锁页面
│   ├── VaultList.tsx           # 记录列表
│   ├── VaultDetail.tsx         # 记录详情
│   ├── VaultEditor.tsx         # 新建/编辑
│   └── VaultSettings.tsx       # Vault 设置
├── components/
│   ├── RecoveryKeyDisplay.tsx  # 恢复密钥展示
│   ├── PasswordStrength.tsx    # 密码强度
│   ├── SecretField.tsx         # 可隐藏的秘密字段
│   ├── AutoLockTimer.tsx       # 自动锁定倒计时
│   └── VaultBadge.tsx          # 类型徽章
├── hooks/
│   ├── useVaultSession.ts      # Session 状态
│   ├── useAutoLock.ts          # 自动锁定逻辑
│   └── useVaultRecords.ts      # 记录 CRUD
├── crypto/
│   └── crypto-service.ts       # 加密服务
├── services/
│   ├── vault-service.ts        # Vault 服务
│   └── vault-session.ts        # Session 管理
└── types/
    └── index.ts                # 类型定义
```

### 6.2 关键交互模式

**密码输入**

```tsx
<input 
  type="password" 
  autoComplete="new-password"  // 初始化时
  autoComplete="current-password"  // 解锁时
  className="input"
/>
```

**秘密字段显示**

```tsx
const [visible, setVisible] = useState(false);

<div className="secret-field">
  <input 
    type={visible ? 'text' : 'password'} 
    value={secret} 
    readOnly 
    className="input"
  />
  <button onClick={() => setVisible(!visible)} className="btn-icon">
    {visible ? <EyeOff /> : <Eye />}
  </button>
  <button onClick={() => navigator.clipboard.writeText(secret)} className="btn-icon">
    <Copy />
  </button>
</div>
```

**恢复密钥展示**

```tsx
<div className="recovery-key-display">
  <div className="key-segments">
    {segments.map((seg, i) => (
      <span key={i} className="segment">{seg}</span>
    ))}
  </div>
  <div className="actions">
    <button onClick={handleCopy} className="btn-secondary">
      <Copy /> 复制
    </button>
    <button onClick={handleDownload} className="btn-secondary">
      <Download /> 下载
    </button>
  </div>
  <label className="confirmation">
    <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />
    我已安全保存恢复密钥
  </label>
</div>
```

### 6.3 路由设计

```tsx
// src/sidepanel/App.tsx
<Routes>
  {/* 现有路由 */}
  <Route path="/" element={<PromptList />} />
  <Route path="/notes/:id" element={<PromptDetail />} />
  <Route path="/notes/new" element={<NoteEditor />} />
  <Route path="/notes/:id/edit" element={<NoteEditor />} />
  <Route path="/settings" element={<Settings />} />
  
  {/* Vault 路由 */}
  <Route path="/vault" element={<VaultGuard />}>
    <Route index element={<VaultList />} />
    <Route path="setup" element={<VaultSetup />} />
    <Route path="unlock" element={<VaultUnlock />} />
    <Route path="new" element={<VaultEditor />} />
    <Route path=":id" element={<VaultDetail />} />
    <Route path=":id/edit" element={<VaultEditor />} />
    <Route path="settings" element={<VaultSettings />} />
  </Route>
</Routes>
```

**VaultGuard 逻辑**

```tsx
function VaultGuard() {
  const { initialized, unlocked } = useVaultSession();
  
  if (!initialized) {
    return <Navigate to="/vault/setup" />;
  }
  
  if (!unlocked) {
    return <Navigate to="/vault/unlock" />;
  }
  
  return <Outlet />;
}
```

---

## 7. 开发任务拆分

### Phase 1: 基础设施 (Week 1)

**Task 1.1: IndexedDB Schema 升级**
- [ ] 添加 `vaultConfig` 和 `vaultRecords` stores
- [ ] 编写迁移脚本（v3 → v4）
- [ ] 测试数据隔离
- [ ] 验证现有 Notes 功能不受影响

**Task 1.2: CryptoService**
- [ ] 实现 KDF (PBKDF2-SHA256)
- [ ] 实现 AES-256-GCM 加密/解密
- [ ] 实现 Vault Key 生成
- [ ] 实现 Recovery Key 生成和格式化（Base32 编码）
- [ ] 单元测试：
  - 密钥派生一致性
  - 加密/解密正确性
  - IV 唯一性
  - 密文篡改检测

**Task 1.3: VaultSession**
- [ ] 单例模式实现
- [ ] 内存管理（Vault Key、已解密记录）
- [ ] 自动锁定定时器
- [ ] 用户活动追踪
- [ ] 锁定时清理逻辑

### Phase 2: 核心功能 (Week 2)

**Task 2.1: VaultService**
- [ ] Vault 初始化（双密钥保护）
- [ ] 主密码解锁
- [ ] Recovery Key 解锁
- [ ] 修改主密码（原子操作）
- [ ] CRUD 操作（创建、读取、更新、删除记录）
- [ ] 事务完整性保证

**Task 2.2: 数据隔离**
- [ ] 确保 Notes 搜索不包含 Vault
- [ ] Notes JSON 导出不包含 Vault
- [ ] 日志和错误消息不泄露秘密
- [ ] Content Script 无权访问 Vault

### Phase 3: UI 实现 (Week 3)

**Task 3.1: 初始化流程**
- [ ] VaultSetup 页面（四步流程）
- [ ] 密码强度指示器
- [ ] Recovery Key 展示组件
- [ ] 保存确认机制
- [ ] 流程状态管理

**Task 3.2: 解锁和锁定**
- [ ] VaultUnlock 页面
- [ ] 主密码解锁
- [ ] Recovery Key 恢复流程
- [ ] 手动锁定按钮
- [ ] 自动锁定 UI 反馈
- [ ] 解锁失败提示

**Task 3.3: CRUD UI**
- [ ] VaultList 页面（分类、搜索、排序）
- [ ] VaultDetail 页面（秘密显示/隐藏、复制）
- [ ] VaultEditor 页面（表单验证、类型选择）
- [ ] 删除确认对话框
- [ ] 类型徽章和图标

### Phase 4: 备份与设置 (Week 4)

**Task 4.1: 加密备份**
- [ ] 导出加密 Vault（只包含密文）
- [ ] 导入和验证
- [ ] 覆盖前自动备份
- [ ] 文件格式版本控制

**Task 4.2: 设置页面**
- [ ] 修改主密码
- [ ] 自动锁定超时设置
- [ ] 重新生成 Recovery Key
- [ ] 导出/导入 Vault

### Phase 5: 测试与优化 (Week 5)

**Task 5.1: 安全测试**
- [ ] 密码错误处理
- [ ] 数据损坏恢复
- [ ] 中间状态回滚
- [ ] 内存泄露检查
- [ ] 锁定后数据清理验证

**Task 5.2: 集成测试**
- [ ] 完整初始化流程
- [ ] 解锁-使用-锁定流程
- [ ] 修改密码流程
- [ ] Recovery 流程
- [ ] 备份-导入流程

**Task 5.3: 性能测试**
- [ ] KDF 耗时测试（目标 < 1s）
- [ ] 大量记录（100+）加载性能
- [ ] 自动锁定响应时间
- [ ] 内存占用分析

---

## 8. 风险评估与缓解

### 风险 1: KDF 性能影响用户体验

**风险等级**: 中

**表现**: PBKDF2 600000 iterations 在低端设备可能需要 2-3 秒

**缓解方案**:
- 显示解锁进度 UI（加载动画）
- 异步执行 KDF，不阻塞 UI 渲染
- 提供"记住解锁状态"选项（延长自动锁定时间至 15 分钟或更长）
- 未来支持 WebAuthn 作为辅助解锁方式

### 风险 2: Recovery Key 用户丢失

**风险等级**: 高

**表现**: 用户未妥善保存 Recovery Key，主密码又忘记

**缓解方案**:
- 初始化时强制确认流程（必须勾选"已保存"才能继续）
- 提供 "Test Recovery Key" 功能，让用户在初始化后立即验证
- 在 Settings 中提供"导出 Recovery Key"（需要输入主密码）
- 明确告知：丢失主密码和 Recovery Key 将永久无法访问
- 引导用户使用密码管理器或物理介质保存 Recovery Key

### 风险 3: 加密数据格式升级

**风险等级**: 中

**表现**: 未来需要升级加密算法或密钥长度时的迁移

**缓解方案**:
- 所有加密数据包含 `version` 字段
- 解密时根据版本选择算法
- 提供"重新加密"工具（解锁后后台逐步迁移）
- Vault Key 架构支持平滑过渡（只需更新记录，不改变密钥结构）

### 风险 4: Service Worker 内存限制

**风险等级**: 低

**表现**: Chrome Extension Service Worker 可能被频繁卸载

**缓解方案**:
- VaultSession 在 Side Panel 进程中运行（不在 Service Worker）
- Side Panel 关闭不自动锁定，仅超时锁定
- 关键操作（解锁、修改密码）在用户主动操作时进行
- 避免在 Service Worker 中持有解密后的数据

### 风险 5: 剪贴板泄露

**风险等级**: 中

**表现**: 用户复制秘密后忘记清除，被其他应用读取

**缓解方案**:
- Phase 1 暂不实现自动清除（避免打断用户工作流）
- Phase 2 可选功能：复制后 30 秒自动清除剪贴板
- 显示"已复制"Toast 提示，提醒用户注意安全
- 在文档中建议用户复制后立即粘贴

### 风险 6: 时序攻击

**风险等级**: 低

**表现**: 密码验证时间差异可能泄露信息

**缓解方案**:
- 验证失败时不提供详细错误（统一提示"解锁失败"）
- 不区分"密码错误"和"数据损坏"
- KDF 和解密操作耗时相对固定

---

## 9. 测试策略

### 9.1 单元测试

**CryptoService 测试**

```typescript
// tests/vault/crypto-service.test.ts
describe('CryptoService', () => {
  test('生成的 Vault Key 长度为 256 bits', async () => {
    const key = await cryptoService.generateVaultKey();
    const exported = await crypto.subtle.exportKey('raw', key);
    expect(exported.byteLength).toBe(32);
  });

  test('相同密码和 salt 派生相同密钥', async () => {
    const salt = new Uint8Array(32);
    const key1 = await cryptoService.deriveKeyFromPassword('test', salt);
    const key2 = await cryptoService.deriveKeyFromPassword('test', salt);
    const export1 = await crypto.subtle.exportKey('raw', key1);
    const export2 = await crypto.subtle.exportKey('raw', key2);
    expect(export1).toEqual(export2);
  });

  test('每次加密生成不同的 IV', async () => {
    const vaultKey = await cryptoService.generateVaultKey();
    const plaintext = { title: 'test', secret: '123', type: 'api_key' };
    const result1 = await cryptoService.encryptRecord(plaintext, vaultKey);
    const result2 = await cryptoService.encryptRecord(plaintext, vaultKey);
    expect(result1.iv).not.toEqual(result2.iv);
  });

  test('篡改密文导致解密失败', async () => {
    const vaultKey = await cryptoService.generateVaultKey();
    const plaintext = { title: 'test', secret: '123', type: 'api_key' };
    const { ciphertext, iv } = await cryptoService.encryptRecord(plaintext, vaultKey);
    
    // 篡改第一个字节
    ciphertext[0] ^= 1;
    
    await expect(
      cryptoService.decryptRecord(ciphertext, iv, vaultKey)
    ).rejects.toThrow();
  });

  test('Recovery Key 格式正确', () => {
    const { formatted } = cryptoService.generateRecoveryKey();
    expect(formatted).toMatch(/^RN-V1-[A-Z2-7]{4}(-[A-Z2-7]{4}){7}$/);
  });
});
```

### 9.2 集成测试

**完整流程测试**

```typescript
// tests/vault/vault-flow.test.ts
describe('Vault Complete Flow', () => {
  test('初始化 -> 解锁 -> 创建记录 -> 锁定 -> 重新解锁', async () => {
    // 1. 初始化
    const { success, recoveryKey } = await vaultService.initializeVault('strong-password');
    expect(success).toBe(true);
    expect(recoveryKey).toBeTruthy();

    // 2. 解锁
    const unlocked = await vaultService.unlockWithMasterPassword('strong-password');
    expect(unlocked).toBe(true);

    // 3. 创建记录
    const id = await vaultService.createRecord({
      title: 'Test API Key',
      type: 'api_key',
      secret: 'sk-test-123'
    });
    expect(id).toBeTruthy();

    // 4. 锁定
    vaultService.lock();
    expect(vaultService.isLocked()).toBe(true);

    // 5. 重新解锁并验证记录存在
    await vaultService.unlockWithMasterPassword('strong-password');
    const record = await vaultService.getRecord(id);
    expect(record.title).toBe('Test API Key');
    expect(record.secret).toBe('sk-test-123');
  });

  test('Recovery Key 恢复流程', async () => {
    // 初始化
    const { recoveryKey } = await vaultService.initializeVault('old-password');
    
    // 使用 Recovery Key 恢复并设置新密码
    const recovered = await vaultService.recoverWithKey(recoveryKey, 'new-password');
    expect(recovered).toBe(true);

    // 新密码可以解锁
    vaultService.lock();
    const unlocked = await vaultService.unlockWithMasterPassword('new-password');
    expect(unlocked).toBe(true);

    // 旧密码不能解锁
    vaultService.lock();
    const oldUnlocked = await vaultService.unlockWithMasterPassword('old-password');
    expect(oldUnlocked).toBe(false);
  });

  test('修改主密码保持数据完整', async () => {
    // 初始化并创建记录
    await vaultService.initializeVault('old-password');
    await vaultService.unlockWithMasterPassword('old-password');
    const id = await vaultService.createRecord({
      title: 'Test',
      type: 'password',
      secret: 'secret123'
    });

    // 修改密码
    const changed = await vaultService.changeMasterPassword('old-password', 'new-password');
    expect(changed).toBe(true);

    // 使用新密码解锁并验证记录
    vaultService.lock();
    await vaultService.unlockWithMasterPassword('new-password');
    const record = await vaultService.getRecord(id);
    expect(record.secret).toBe('secret123');
  });
});
```

### 9.3 性能测试

```typescript
// tests/vault/performance.test.ts
describe('Performance', () => {
  test('KDF 耗时应在可接受范围内', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(32));
    const start = performance.now();
    await cryptoService.deriveKeyFromPassword('test-password', salt, 600000);
    const duration = performance.now() - start;
    
    console.log(`KDF duration: ${duration}ms`);
    expect(duration).toBeLessThan(2000);  // 低端设备目标 < 2s
  });

  test('100 条记录解密耗时', async () => {
    // 初始化并创建 100 条记录
    await vaultService.initializeVault('password');
    await vaultService.unlockWithMasterPassword('password');
    
    const ids = [];
    for (let i = 0; i < 100; i++) {
      const id = await vaultService.createRecord({
        title: `Record ${i}`,
        type: 'api_key',
        secret: `secret-${i}`
      });
      ids.push(id);
    }

    // 测量解密所有记录的时间
    const start = performance.now();
    for (const id of ids) {
      await vaultService.getRecord(id);
    }
    const duration = performance.now() - start;
    
    console.log(`Decrypt 100 records: ${duration}ms`);
    expect(duration).toBeLessThan(500);  // 目标 < 500ms
  });

  test('自动锁定响应时间', async () => {
    await vaultService.initializeVault('password');
    await vaultService.unlockWithMasterPassword('password');
    
    const start = performance.now();
    vaultService.lock();
    const duration = performance.now() - start;
    
    expect(duration).toBeLessThan(50);  // 目标 < 50ms
    expect(vaultService.isLocked()).toBe(true);
  });
});
```

### 9.4 安全测试

```typescript
// tests/vault/security.test.ts
describe('Security', () => {
  test('锁定后无法访问解密数据', async () => {
    await vaultService.initializeVault('password');
    await vaultService.unlockWithMasterPassword('password');
    const id = await vaultService.createRecord({
      title: 'Secret',
      type: 'password',
      secret: 'confidential'
    });

    vaultService.lock();

    await expect(vaultService.getRecord(id)).rejects.toThrow('Vault is locked');
  });

  test('错误密码不能解锁', async () => {
    await vaultService.initializeVault('correct-password');
    vaultService.lock();

    const unlocked = await vaultService.unlockWithMasterPassword('wrong-password');
    expect(unlocked).toBe(false);
  });

  test('IndexedDB 不包含明文秘密', async () => {
    await vaultService.initializeVault('password');
    await vaultService.unlockWithMasterPassword('password');
    await vaultService.createRecord({
      title: 'Test',
      type: 'api_key',
      secret: 'sk-very-secret-key'
    });

    // 直接读取 IndexedDB
    const db = await openDB('riddleNotes');
    const tx = db.transaction('vaultRecords', 'readonly');
    const store = tx.objectStore('vaultRecords');
    const records = await store.getAll();

    // 验证没有明文
    for (const record of records) {
      const dataString = new TextDecoder().decode(record.encryptedData);
      expect(dataString).not.toContain('sk-very-secret-key');
      expect(dataString).not.toContain('Test');
    }
  });

  test('Notes 导出不包含 Vault 数据', async () => {
    // 创建普通 Note
    await notesService.createNote({ title: 'Normal Note', content: 'content' });
    
    // 创建 Vault 记录
    await vaultService.initializeVault('password');
    await vaultService.unlockWithMasterPassword('password');
    await vaultService.createRecord({
      title: 'Secret',
      type: 'password',
      secret: 'confidential'
    });

    // 导出 Notes
    const exported = await exportNotes();
    const exportString = JSON.stringify(exported);

    expect(exportString).toContain('Normal Note');
    expect(exportString).not.toContain('Secret');
    expect(exportString).not.toContain('confidential');
    expect(exportString).not.toContain('vaultRecords');
  });
});
```

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

```tsx
<nav className="sidebar-nav">
  <NavItem to="/notes" icon={<FileText />}>笔记</NavItem>
  <NavItem to="/vault" icon={<Lock />}>保险箱</NavItem>
  <NavItem to="/settings" icon={<Settings />}>设置</NavItem>
</nav>
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

### 10.3 图标使用

- 🔒 Lock: 锁定状态、Vault 入口
- 🔓 Unlock: 已解锁状态
- 🔑 Key: API Keys、Passwords
- 🗄️ Database: 数据库记录
- 💭 FileText: Secure Notes
- 👁 Eye: 显示秘密
- 🙈 EyeOff: 隐藏秘密
- 📋 Copy: 复制
- ⬇️ Download: 下载 Recovery Key

---

## 11. 后续扩展预留

虽然本期不实现，但架构需要为以下功能预留空间：

### 11.1 跨设备同步

**架构要求**

- 云端只存储加密数据（E2EE）
- 服务器无法解密任何内容
- 使用设备指纹 + 主密码派生同步密钥
- 冲突解决策略（LWW 或 Manual Merge）

**预留设计**

```typescript
interface VaultRecord {
  // ...现有字段
  syncVersion: number;
  syncStatus: 'local' | 'synced' | 'conflict';
  deviceId: string;
  lastSyncedAt?: number;
}

interface SyncMetadata {
  deviceId: string;
  encryptedSyncKey: Uint8Array;  // Vault Key 加密的同步密钥
  lastSyncTimestamp: number;
}
```

### 11.2 WebAuthn 支持

**用途**: 使用生物识别快速解锁

**实现**: 
- WebAuthn 只用于解锁，不作为主密码替代
- 本地存储加密的 Vault Key，由 WebAuthn 保护
- 仍需要主密码用于修改密码等关键操作

**预留设计**

```typescript
interface VaultKeyWrapper {
  // ...现有字段
  webauthnProtected?: {
    credentialId: string;
    encryptedKey: Uint8Array;
    iv: Uint8Array;
  };
}
```

### 11.3 密码生成器

**功能**: 生成强随机密码

**位置**: VaultEditor 中的辅助工具

**特性**:
- 可配置长度（12-64 字符）
- 可选字符集（大小写、数字、符号）
- 避免混淆字符（0/O, 1/l/I）
- 密码强度评估

### 11.4 自动清除剪贴板

**功能**: 复制秘密后自动清除剪贴板

**设置**: 用户可选择超时时间（30s / 60s / 不清除）

**实现**:
```typescript
async function copySecret(secret: string, clearAfter: number) {
  await navigator.clipboard.writeText(secret);
  
  if (clearAfter > 0) {
    setTimeout(async () => {
      const current = await navigator.clipboard.readText();
      if (current === secret) {
        await navigator.clipboard.writeText('');
      }
    }, clearAfter * 1000);
  }
}
```

---

## 12. 安全审查 Checklist

在正式发布前，需要完成以下审查：

### 12.1 加密实现

- [ ] KDF 参数符合 OWASP 推荐（PBKDF2 ≥ 600,000 iterations）
- [ ] IV/Nonce 每次唯一且随机（使用 CSPRNG）
- [ ] GCM 认证标签正确验证（自动由 Web Crypto API 处理）
- [ ] 密钥长度符合标准（AES-256, 256 bits）
- [ ] 未使用弱密码算法（MD5, SHA1, DES, 3DES, RC4）
- [ ] 未在客户端实现自定义加密算法

### 12.2 密钥管理

- [ ] 主密码不持久化（不存入 localStorage、IndexedDB、日志）
- [ ] Vault Key 不以明文存储
- [ ] Recovery Key 具备足够熵（≥ 256 bits）
- [ ] 密钥轮换不丢失数据
- [ ] 修改密码的事务完整性（失败时回滚）
- [ ] 双密钥保护机制正确实现

### 12.3 运行时安全

- [ ] 锁定后清除内存中的敏感数据（Vault Key、已解密记录、搜索历史）
- [ ] 日志不包含秘密（console.log、错误上报）
- [ ] 错误消息不泄露加密细节（统一提示"解锁失败"）
- [ ] Content Script 无法访问 Vault（权限隔离）
- [ ] Side Panel 关闭不暴露数据

### 12.4 数据隔离

- [ ] Vault 不进入 Notes 搜索索引
- [ ] Vault 不进入普通 JSON 导出
- [ ] IndexedDB 访问权限正确隔离（不同 Object Stores）
- [ ] UI 路由正确隔离（需要解锁才能访问）

### 12.5 异常处理

- [ ] 加密失败不保存部分数据
- [ ] 解密失败不修改原数据
- [ ] 初始化失败可回滚（事务原子性）
- [ ] 修改密码失败保留旧密钥
- [ ] 导入覆盖前自动备份

### 12.6 用户体验

- [ ] 密码强度指示器准确
- [ ] Recovery Key 保存确认机制有效
- [ ] 自动锁定定时器正确工作
- [ ] 用户活动追踪不影响性能
- [ ] 秘密默认隐藏，需主动显示

### 12.7 性能

- [ ] KDF 耗时可接受（< 2s）
- [ ] 大量记录加载不卡顿（100+ 记录 < 1s）
- [ ] 锁定响应快速（< 50ms）
- [ ] 内存占用合理（< 50MB）

---

## 13. 开发验收标准

### A. Vault 初始化

- [ ] Notes 使用方式不受影响
- [ ] 首次进入 Vault 展示初始化流程
- [ ] 主密码可设置和确认
- [ ] 主密码不存入 IndexedDB
- [ ] Vault Key 随机生成（256 bits）
- [ ] Recovery Key 正确生成（256 bits, Base32 编码）
- [ ] Recovery Key 能够独立解密 Vault Key
- [ ] Recovery Key 展示后用户能够复制或下载
- [ ] 未完成 Recovery Key 确认不能完成初始化
- [ ] 初始化失败不会产生半初始化状态

### B. 加密存储

- [ ] Vault 所有字段均加密（包括 title、username、url、notes）
- [ ] IndexedDB 无可直接读取的秘密明文
- [ ] 每次加密均使用正确、唯一的 IV / Nonce
- [ ] 密文被篡改后无法通过验证（GCM 自动检测）
- [ ] 数据格式包含版本号
- [ ] 没有明文写入日志或错误消息

### C. 解锁与锁定

- [ ] 正确主密码能够解锁
- [ ] 错误主密码无法解锁
- [ ] 锁定状态不能显示秘密
- [ ] 手动锁定立即生效
- [ ] 自动锁定在设定时间后生效
- [ ] 锁定时清除解密后的数据与密钥引用
- [ ] 刷新或扩展重新加载后必须重新解锁

### D. CRUD

- [ ] 创建记录
- [ ] 查看记录
- [ ] 编辑记录
- [ ] 删除记录
- [ ] 秘密默认隐藏
- [ ] 临时显示秘密
- [ ] 复制秘密
- [ ] 更新保存时间
- [ ] 删除确认
- [ ] 操作失败不会导致数据损坏

### E. 恢复机制

- [ ] Recovery Key 可成功恢复 Vault Key
- [ ] 错误 Recovery Key 无法恢复
- [ ] 恢复后可设置新主密码
- [ ] 恢复后原有记录保持完整
- [ ] Recovery Key 轮换机制正常
- [ ] 新 Recovery Key 生成失败时旧恢复机制不会失效
- [ ] 恢复流程中断不会导致 Vault 永久锁死

### F. 备份

- [ ] Notes 导出不包含 Vault
- [ ] Vault 导出仅包含密文
- [ ] 加密备份可恢复
- [ ] 覆盖前自动备份
- [ ] 错误备份文件不能破坏现有数据
- [ ] 不存在明文 Vault 导出功能

### G. 隔离

- [ ] Vault 不出现在普通 Notes 搜索中
- [ ] Vault 不进入普通 JSON 导出
- [ ] Vault 不被 AI 收藏流程访问
- [ ] Vault 数据访问权限独立
- [ ] 锁定后无法通过其他页面、缓存或状态获取秘密

---

## 14. 下一步行动

### 立即执行

1. **Review 这份技术方案**
   - 开发团队审查加密架构
   - 安全专家审查密钥管理和 Recovery Key 设计
   - 产品经理确认 UI 流程

2. **搭建 Crypto 层**
   - 先实现 CryptoService
   - 通过所有单元测试
   - 性能测试（KDF 耗时）

3. **实现 Vault 初始化流程**
   - VaultService.initializeVault
   - 验证双密钥保护
   - 验证 Recovery Key 可用

4. **逐步实现 UI**
   - 每个阶段都有对应的集成测试
   - 持续验证安全隔离

### 等待决策

- [ ] 是否在第一版就支持 Argon2id？
- [ ] 自动锁定默认超时时间（推荐 5 分钟）
- [ ] 是否在第一版就支持自动清除剪贴板？
- [ ] Recovery Key 格式（Base32 vs Base58 vs Bech32）

### 长期规划

- 跨设备同步（E2EE）
- WebAuthn 支持
- 密码生成器
- 批量导入

---

## 附录

### A. 相关文档

- [Secure Vault PRD](./vault-prd.md)
- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [Web Crypto API Documentation](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API)

### B. 外部依赖

可能需要的库：

- **Base32 编码**: 用于 Recovery Key 格式化
  - `hi-base32` (2KB, MIT License)
  - 或自行实现（RFC 4648）

- **密码强度评估**: 用于密码输入提示
  - `zxcvbn` (800KB, MIT License)
  - 或简化版自行实现

- **Argon2 (可选)**: 如果决定支持
  - `argon2-browser` (300KB WASM, MIT License)

### C. 参考实现

- **Bitwarden**: 开源密码管理器，E2EE 架构参考
- **1Password**: 双密钥架构（Master Password + Secret Key）
- **Signal**: E2EE 消息加密设计

---

**文档版本历史**

- v1.0 (2025-01-26): 初始版本，完整技术架构方案

**作者**: Kiro AI  
**审核**: 待定  
**批准**: 待定
