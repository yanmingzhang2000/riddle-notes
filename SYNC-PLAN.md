# Riddle Notes 云同步方案

> 状态：规划草案，未实施  
> 决策记录：2026-11-26  
> 本文不提交到仓库

## 1. 方案摘要

**目标**：解决扩展移除会清空数据的问题，支持多设备同步。

**核心决策**：
- 整份快照同步，以最近修改时间为准（后保存覆盖先保存）
- 全部端到端加密：服务器看到的是密文
- 用户用单独的同步口令加密快照，忘记口令无法恢复云端数据
- 邮箱验证码登录，第一版不做 Google 登录
- 保险箱密文同步拆到第二阶段，本方案先只做笔记同步
- Supabase 免费档开发和内测，公开发布前升级 Pro
- 固定扩展 `key` 让 ID 不再随文件夹变化，升级后老用户需导出再导入一次

**产品定位**：
- 本地优先不变，同步是可选功能
- 未登录用户完全不受影响
- 登录用户关闭同步后仍能正常使用

---

## 2. 分阶段交付

### 阶段 0：前置准备（⚠️ 破坏性变更）
- [ ] **评估固定 key 的影响**：
  - 统计当前安装用户数（通过 Umami `ext_install` 事件和 Release 下载量）
  - 如果用户 < 10 人，立即执行；如果 > 50 人，考虑延后或写迁移工具
- [ ] 固定 `manifest.json` 的 `key`：
  - 生成随机 128 字符 Base64 key（见附录 D）
  - 加到 `manifest.json`，提交前在本地测试加载
- [ ] 更新 `INSTALLATION.md` 和 `README.md`：
  - 加"⚠️ 重要更新"章节：v1.1.0 升级前必须导出备份
  - 解释：扩展 ID 会变化，不导出数据会永久丢失
  - 提供迁移步骤：1) 在旧版本导出 JSON 2) 卸载旧版本 3) 安装新版本 4) 导入 JSON
- [ ] 发布 v1.0.1 维护版本：
  - 在设置页顶部加横幅提示："下一版本需要迁移，请先导出备份"
  - 维护版本只改提示，不改 key，让用户有时间准备
  - 一周后再发 v1.1.0（包含固定 key）
- [ ] 在 Supabase 创建项目（免费档）
- [ ] 配置自定义 SMTP（见附录 C）

### 阶段 1：加密模块（纯函数，可单元测试）
- [ ] 新建 `src/shared/sync-crypto.ts`：
  - `generateSyncKey()`: 生成 32 字节数据密钥
  - `deriveSyncWrapKey(passphrase, kdf)`: 从同步口令派生包装密钥（PBKDF2 60 万次）
  - `wrapSyncKey(dataKey, wrapKey)`: AES-GCM 包装数据密钥
  - `unwrapSyncKey(wrapped, wrapKey)`: 解包
  - `encryptSnapshot(backup, dataKey)`: 加密快照（复用 `backup.ts` 的 `BackupFile` 格式）
  - `decryptSnapshot(encrypted, dataKey)`: 解密
- [ ] 写测试：加解密可逆，口令错误解包失败，篡改密文解密失败

### 阶段 2：Supabase 表和 RLS
创建两张表（不用 Edge Functions，直接用 Supabase JS Client + RLS）：

**users** (Auth 自带)
```sql
-- id, email, created_at 由 Supabase Auth 管理
```

**sync_snapshots**（快照表）
```sql
CREATE TABLE sync_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  version bigint NOT NULL,
  encrypted_data bytea NOT NULL,
  wrapped_key bytea NOT NULL,
  wrap_iv bytea NOT NULL,
  kdf_params jsonb NOT NULL,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, version)
);
CREATE INDEX idx_sync_snapshots_user_version ON sync_snapshots(user_id, version DESC);

-- RLS: 用户只能读写自己的快照
ALTER TABLE sync_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own snapshots" ON sync_snapshots FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own snapshots" ON sync_snapshots FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own snapshots" ON sync_snapshots FOR DELETE USING (auth.uid() = user_id);

-- 触发器：自动清理超过 5 个的旧版本
CREATE OR REPLACE FUNCTION cleanup_old_snapshots()
RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM sync_snapshots
  WHERE user_id = NEW.user_id
  AND version NOT IN (
    SELECT version FROM sync_snapshots
    WHERE user_id = NEW.user_id
    ORDER BY version DESC
    LIMIT 5
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_cleanup_old_snapshots
AFTER INSERT ON sync_snapshots
FOR EACH ROW
EXECUTE FUNCTION cleanup_old_snapshots();
```

**sync_metadata**（元数据表，记录当前版本）
```sql
CREATE TABLE sync_metadata (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  current_version bigint NOT NULL DEFAULT 0,
  last_sync_at timestamptz NOT NULL DEFAULT now(),
  device_count int NOT NULL DEFAULT 1
);

-- RLS
ALTER TABLE sync_metadata ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own metadata" ON sync_metadata FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own metadata" ON sync_metadata FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own metadata" ON sync_metadata FOR UPDATE USING (auth.uid() = user_id);
```

**为什么不用 Edge Functions**：
- RLS 已经保证用户只能读写自己的数据
- 版本冲突用 `UNIQUE(user_id, version)` 约束 + 客户端重试即可
- 减少复杂度（无需 Deno 代码、部署、调试）
- 客户端直接用 Supabase JS Client，代码更简单

### 阶段 3：扩展侧实现

**新建 src/shared/sync-service.ts**（同步服务）
- `login(email)`: 调 Supabase Auth OTP
- `verifyCode(email, code)`: 验证并获取 token，存 `chrome.storage.local`
- `logout()`: 清除 token 和同步设置，**保留本地数据**
- `setupSyncPassphrase(passphrase)`: 首次设置同步口令，生成数据密钥，包装后存本地和云端（版本 0）
- `unlockSync(passphrase)`: 解锁已有的同步密钥，从云端下载 wrapped key
- `upload()`: 读 IndexedDB，调 `createBackup()`，加密后上传，返回版本号
  - 上传前记录 `sync_local_last_modified = new Date().toISOString()`
  - 检查快照大小，超过 5MB 警告用户
- `download(version?)`: 下载指定版本或最新版本，解密，调 `restoreBackup()`
- `checkConflict()`: 比较 `sync_last_synced_version` 和云端 `current_version`，以及 `sync_local_last_modified` 和云端 `last_sync_at`
- `resolveConflict(useCloud)`: 冲突时用户选择用云端还是本地
- `listHistory()`: 查询最近 5 个版本（`SELECT version, created_at, length(encrypted_data) as size`）
- `deleteOldVersions()`: 手动清理旧版本（触发器会自动清理，这个是兜底）

**派生密钥缓存**（减少 PBKDF2 计算）
- 解锁后在内存中缓存 `CryptoKey`（不持久化）
- 扩展关闭或登出时清除缓存
- service-worker 重启时需要重新解锁（提示用户输入口令）

**UI 改动**
- **登录页**（新建 `src/sidepanel/pages/SyncLogin.tsx`）
  - 输入邮箱 → 发验证码 → 输入 6 位数字 → 登录成功
  - 首次登录：设置同步口令（至少 12 位），保存恢复密钥（32 字节，Base32 编码，分 8 组显示）
  - 已登录设备：输入同步口令解锁
- **设置页改动**（`Settings.tsx`）
  - 加"云同步"区块（在"数据管理"和"数据统计"之间）：
    - 未登录：显示"云同步（未登录）" + "登录"按钮
    - 已登录：
      - 显示邮箱、最后同步时间、同步版本号
      - "立即同步"按钮、"查看历史"按钮、"退出登录"按钮
      - 切换开关：自动同步（默认开启）
      - **明确提示**："保险箱暂不同步，仅同步笔记和文件夹"
    - 冲突提示：弹窗选择"用云端数据覆盖本地"或"用本地数据覆盖云端"
    - 离线提示：红点 + "网络离线，待恢复后同步"
- **自动同步**（service-worker.ts）
  - 每次 `savePrompt` 成功后，如果已登录且已解锁且网络在线：
    - 延迟 5 秒自动上传（debounce：5 秒内再次修改会重新计时）
    - 或者：最多每分钟上传一次（throttle）
  - 扩展启动时，如果已登录：
    - 检查网络状态
    - 在线：检查冲突，有冲突显示红点提示（不自动处理）
    - 离线：显示离线提示

**Storage 键**
- `sync_user_email`: 登录邮箱
- `sync_access_token`: Supabase JWT token
- `sync_refresh_token`: Supabase refresh token
- `sync_local_wrapped_key`: 本地包装的数据密钥（用同步口令包装）
- `sync_local_wrap_iv`: 包装 IV
- `sync_local_kdf_params`: KDF 参数（PBKDF2 迭代次数和盐）
- `sync_last_synced_version`: 上次同步时的云端版本号
- `sync_local_last_modified`: 本地数据最后修改时间（ISO 8601），每次修改数据库时更新
- `sync_enabled`: 是否开启自动同步（默认 true）
- `sync_pending_upload`: 是否有待上传的修改（离线时标记）

### 阶段 4：保险箱同步（第二阶段）
- 读取 `RiddleVaultDB` 的 `vaultSnapshot` 表，加密后作为单独字段存入云端
- 下载时还原到 `vaultSnapshot`，再调保险箱的恢复逻辑
- 需要单独的安全审查：保险箱本身已有主密码加密，云端再加一层同步口令，服务器要两层都破解

### 阶段 5：文案和文档
- 更新 `website/src/components/LocalFirst.tsx`：改为"默认只存本地，开启同步后端到端加密上传"
- 更新 `website/src/components/Hero.tsx`：meta 加"可选云同步"
- 新建 `SYNC.md`：同步机制说明、同步口令和恢复密钥、冲突处理、安全说明
- 更新 `INSTALLATION.md`：加固定 `key` 后老用户需导出再导入

---

## 3. 数据格式

### 本地加密快照格式
```typescript
interface EncryptedSnapshot {
  version: number;                // 快照版本号（单调递增）
  encryptedData: Uint8Array;      // 加密的 BackupFile JSON
  wrappedKey: Uint8Array;         // 被包装的数据密钥
  wrapIv: Uint8Array;             // 包装 IV
  kdfParams: {
    algorithm: 'PBKDF2-SHA256';
    iterations: number;           // 默认 600000
    salt: Uint8Array;
  };
  createdAt: string;              // ISO 8601
}
```

### Supabase 快照行
```typescript
interface SyncSnapshotRow {
  id: string;                     // UUID
  user_id: string;                // 关联 auth.users
  version: number;                // 快照版本号
  encrypted_data: Buffer;         // 加密数据（bytea）
  wrapped_key: Buffer;            // 包装密钥（bytea）
  wrap_iv: Buffer;                // 包装 IV（bytea）
  kdf_params: {                   // KDF 参数（jsonb）
    algorithm: 'PBKDF2-SHA256';
    iterations: number;
    salt: string;                 // Base64 编码
  };
  metadata: {                     // 元数据（jsonb，可选）
    noteCount?: number;
    folderCount?: number;
    deviceInfo?: string;
  };
  created_at: string;             // timestamptz
}
```

---

## 4. API 接口设计

**登录**
```http
POST https://<project-ref>.supabase.co/auth/v1/otp
Content-Type: application/json
apikey: <anon-key>

{ "email": "user@example.com" }

Response: { "message": "Check your email for the login link" }
```

```http
POST https://<project-ref>.supabase.co/auth/v1/verify
Content-Type: application/json
apikey: <anon-key>

{ "email": "user@example.com", "token": "123456", "type": "email" }

Response: { "access_token": "...", "refresh_token": "...", "user": {...} }
```

**上传快照**（直接用 Supabase JS Client，不用 Edge Function）
```typescript
// 1. 查询当前版本
const { data: metadata } = await supabase
  .from('sync_metadata')
  .select('current_version')
  .eq('user_id', userId)
  .single();

const nextVersion = (metadata?.current_version || 0) + 1;

// 2. 插入新快照（UNIQUE 约束会防止并发冲突）
const { error: insertError } = await supabase
  .from('sync_snapshots')
  .insert({
    user_id: userId,
    version: nextVersion,
    encrypted_data: encryptedData,
    wrapped_key: wrappedKey,
    wrap_iv: wrapIv,
    kdf_params: kdfParams,
    metadata: { noteCount, folderCount }
  });

if (insertError?.code === '23505') {
  // UNIQUE 冲突，说明另一设备已上传此版本
  throw new Error('version_conflict');
}

// 3. 更新 metadata（upsert）
await supabase
  .from('sync_metadata')
  .upsert({
    user_id: userId,
    current_version: nextVersion,
    last_sync_at: new Date().toISOString()
  });
```

**下载快照**
```typescript
// 下载最新版本
const { data } = await supabase
  .from('sync_snapshots')
  .select('*')
  .eq('user_id', userId)
  .order('version', { ascending: false })
  .limit(1)
  .single();

// 下载指定版本
const { data } = await supabase
  .from('sync_snapshots')
  .select('*')
  .eq('user_id', userId)
  .eq('version', targetVersion)
  .single();
```

**列出历史版本**
```typescript
const { data } = await supabase
  .from('sync_snapshots')
  .select('version, created_at, metadata')
  .eq('user_id', userId)
  .order('version', { ascending: false })
  .limit(5);

// 计算大小（length 只能在 Postgres 函数里调用，或者在客户端读 encrypted_data.length）
```

---

## 5. UI 流程

### 首次登录流程
1. 用户点"云同步" → 进入登录页
2. 输入邮箱 → 点"发送验证码"（调用 Supabase `auth.signInWithOtp`）
3. 输入 6 位验证码 → 验证成功（`auth.verifyOtp`）
4. **首次登录**（云端没有 wrapped key）：
   - 提示"设置同步口令"
     - 至少 12 位
     - 不能等于登录邮箱密码
     - 如果有保险箱，提示"建议与保险箱主密码不同"
   - 输入口令 → 确认口令
   - 生成数据密钥（32 字节随机）和恢复密钥（32 字节随机）
   - 显示恢复密钥（**复用保险箱格式**：Base32 编码，10 组每组 5 字符，带校验和）
     - 页面样式复用 `vault/components/recovery-key-groups.ts`
     - 文件格式复用 `vault/components/recovery-key-file.ts`
   - 强制用户保存：下载 `.txt` 文件或手动复制
   - 勾选"我已保存恢复密钥"才能点"完成"
   - 分别用口令和恢复密钥包装数据密钥
   - 本地存口令包装版，云端存两个包装版（版本 0）
   - **明确告知**："此恢复密钥仅用于云同步，与保险箱恢复密钥独立"
5. **已登录设备**（云端已有 wrapped key）：
   - 提示"输入同步口令解锁"
   - 输入口令 → 从云端下载 wrapped key → 解包数据密钥
   - 检查本地和云端：
     - `sync_last_synced_version == cloudVersion`：已同步，无需操作
     - `sync_last_synced_version < cloudVersion && sync_local_last_modified == null`：云端更新，本地未修改 → 自动下载
     - `sync_last_synced_version < cloudVersion && sync_local_last_modified > cloudLastSyncAt`：冲突 → 弹窗选择
     - `sync_last_synced_version == cloudVersion && sync_local_last_modified > cloudLastSyncAt`：本地更新 → 自动上传
6. 完成 → 返回设置页，显示"已登录"

### 自动同步流程（debounce）
- 用户保存笔记后，记录 `sync_local_last_modified = now`
- 启动 5 秒倒计时，倒计时期间再次修改会重置倒计时
- 5 秒后无新修改 → 检查网络和登录状态：
  - 离线 → 标记 `sync_pending_upload = true`，显示离线提示
  - 在线且已登录已解锁 → 自动上传
  - 上传成功 → 更新 `sync_last_synced_version`，清除 `sync_pending_upload`
  - 上传失败（版本冲突） → 在设置页显示红点提示，等用户手动解决
  - 上传失败（网络错误） → 标记 `sync_pending_upload = true`，下次在线时重试

### 离线恢复在线流程
- 监听 `navigator.onLine` 事件（`window.addEventListener('online', ...)`）
- 恢复在线时：
  - 检查 `sync_pending_upload == true`
  - 检查冲突（云端版本可能已更新）
  - 无冲突 → 自动上传
  - 有冲突 → 显示红点提示，等用户手动解决

### 冲突解决流程
```
sync_last_synced_version: 5
cloudVersion: 7
sync_local_last_modified: 2026-11-26 10:05:00
cloudLastSyncAt: 2026-11-26 10:10:00

→ 冲突判定：版本不同且双方都有修改

→ 冲突提示弹窗：
"云同步冲突

本地和云端都有修改：
- 本地：42 条笔记，最后修改 10:05
- 云端：45 条笔记，最后修改 10:10（版本 7）

选择保留哪一份数据？另一份会被覆盖。
（被覆盖的数据会保留在历史版本中，可在"查看历史"中找回）

[用云端覆盖本地] [用本地覆盖云端] [查看历史版本]
"

- 点"用云端"：下载版本 7，调用 restoreBackup，更新 sync_last_synced_version = 7
- 点"用本地"：强制上传（忽略版本检查），生成版本 8
- 点"查看历史"：显示最近 5 个版本列表，可预览和恢复
```

---

## 6. 安全考量

### 威胁模型
| 威胁 | 防护措施 |
|---|---|
| 服务器被攻破 | 端到端加密，服务器只有密文 |
| 数据库泄露 | 同上，密文无价值 |
| 中间人攻击 | HTTPS + Supabase 的 TLS |
| 用户忘记同步口令 | 恢复密钥可解包数据密钥，强制保存 |
| 恢复密钥也丢失 | 无法恢复云端数据，本地数据不受影响 |
| 口令暴力破解 | PBKDF2 60 万次，单次解包慢 |
| 重放攻击 | 版本号单调递增，旧版本不会覆盖新版本 |
| 篡改密文 | AES-GCM 认证，篡改解密失败 |

### 密钥管理
- **数据密钥**：32 字节随机，AES-256-GCM 加密快照
- **同步口令**：用户设置，PBKDF2-SHA256 60 万次派生包装密钥
- **恢复密钥**：32 字节随机，HKDF-SHA256 派生包装密钥（无需慢 KDF）
- **包装后的数据密钥**：分别用口令和恢复密钥各包一份，存本地和云端

### 保险箱同步的额外风险
- 保险箱已有主密码加密（PBKDF2 60 万次）
- 云端再加一层同步口令加密
- 服务器要先破解同步口令，再破解主密码，才能读到明文
- **但是**：如果同步口令和主密码相同，安全性降回单层
- 界面要提示"同步口令应与保险箱主密码不同"

---

## 7. 测试重点

### 单元测试（阶段 1）
- 加解密可逆
- 口令错误解包失败
- 篡改密文解密失败
- 旧版本 KDF 参数能正常解包

### 集成测试（阶段 3）
- 登录 → 设置口令 → 上传 → 另一设备下载 → 数据一致
- 冲突场景：两台设备同时修改 → 后同步的被拒绝 → 用户选择覆盖方向
- 网络断开时上传失败 → 恢复后重试成功
- 恢复密钥可用：忘记同步口令 → 用恢复密钥解锁

### 安全测试
- 抓包验证密文不可读
- 篡改数据库行 → 客户端解密失败
- 旧版本号覆盖新版本 → 被拒绝

---

## 8. 已知风险与限制

| 风险 | 影响 | 缓解 |
|---|---|---|
| 忘记同步口令和恢复密钥 | 云端数据永久无法恢复，本地数据不受影响 | 强制保存恢复密钥，可下载 `.txt`；复用保险箱恢复密钥格式 |
| Supabase 免费档闲置 1 周被暂停 | 同步失败，用户以为数据丢了 | 公开前升级 Pro；免费档只用于开发和内测 |
| 加固定 `key` 后老用户 ID 变 | **数据永久丢失**，统计 ID 重复 | 先发 v1.0.1 提示版（一周缓冲），再发 v1.1.0；安装说明加⚠️横幅 |
| 整份快照在多设备下互相覆盖 | 冲突频繁时体验差 | 保留最近 5 版，选错可回滚。未来可升级到按条同步 |
| Supabase Auth 邮件限流 | 验证码发不出 | 配置自定义 SMTP |
| 快照过大（超 1 MB） | 上传慢 | 未来可压缩。Supabase 免费档数据库 500 MB，够用 |
| 同步口令和主密码相同 | 保险箱安全性降回单层 | 界面提示"应不同" |
| 保险箱同步未经单独审查 | 可能有安全漏洞 | 拆到阶段 4，单独审查后再发布 |

---

## 9. 未来可能的改进

- 按条同步（CRDT 或 OT），减少冲突
- 压缩快照（gzip）
- 自动备份到本地文件（下载目录）
- 多设备管理：显示所有已登录设备，可远程登出
- 分享链接：生成只读链接，可分享给其他人
- 团队协作：多人共享一个笔记库

---

## 10. 交付检查清单

**阶段 0**
- [ ] 在 `manifest.json` 加固定 `key`
- [ ] 更新 `INSTALLATION.md`：已装用户需先导出再导入
- [ ] Supabase 创建项目（免费档）
- [ ] 配置自定义 SMTP
- [ ] 验证邮件能发送到测试邮箱

**阶段 1**
- [ ] `sync-crypto.ts` 实现完成
- [ ] 单元测试通过（Jest）
- [ ] 加解密性能测试（1 MB 快照 < 1 秒）

**阶段 2**
- [ ] Supabase 表创建完成
- [ ] RLS 策略测试通过（其他用户读不到我的数据）
- [ ] Edge Functions 部署并测试

**阶段 3**
- [ ] `sync-service.ts` 实现完成
- [ ] 登录页 UI 完成
- [ ] 设置页云同步区块完成
- [ ] 自动同步逻辑测试通过
- [ ] 冲突解决流程测试通过
- [ ] 恢复密钥可用性测试通过

**阶段 5**
- [ ] 落地页文案更新
- [ ] `SYNC.md` 文档完成
- [ ] `INSTALLATION.md` 更新

**发布前**
- [ ] Supabase 升级 Pro（$25/月，不暂停，7 天备份）
- [ ] 安全审查（代码、数据流、密钥管理）
- [ ] 内测（至少 3 人，至少 7 天）：
  - 多设备同步测试
  - 冲突场景测试
  - 离线恢复在线测试
  - 恢复密钥可用性测试
- [ ] 性能测试：
  - 大快照（> 1 MB）加解密时间 < 2 秒
  - 慢网络（3G）上传时间可接受
  - PBKDF2 60 万次在低端设备上 < 1 秒
- [ ] 恢复密钥流程用户测试（确认可理解）
- [ ] 匿名统计补充：
  - 新增事件：`sync_login`、`sync_upload`、`sync_download`、`sync_conflict`
  - 不带账号信息，只记录事件名和计数

---

## 11. 时间估算（修正）

| 阶段 | 预计时间 | 细分 |
|---|---|---|
| 阶段 0 | 3 小时 | 评估影响 (0.5h) + 发布 v1.0.1 提示版 (1h) + Supabase 创建 (0.5h) + SMTP 配置 (0.5h) + manifest key (0.5h) |
| 阶段 1 | 5 小时 | 加密模块 (3h) + 测试 (2h) |
| 阶段 2 | 2 小时 | Supabase 表 (1h) + RLS + 触发器 (1h) |
| 阶段 3 | 14 小时 | 登录 UI (3h) + sync-service (5h) + 设置页改动 (2h) + 自动同步和离线处理 (3h) + 冲突解决 (1h) |
| 阶段 5 | 2 小时 | 文案更新 (0.5h) + SYNC.md (1h) + 安装说明 (0.5h) |
| 测试和修复 | 6 小时 | 集成测试 (3h) + 安全测试 (1h) + 边界情况 (2h) |
| **总计** | **32 小时** | |

阶段 4（保险箱同步）单独评估，预计 8 小时（读保险箱代码 2h + 实现 4h + 安全审查 2h）。

**风险缓冲**：实际可能需要 35-40 小时（调试、返工、文档完善）。

---

## 附录 A：为什么不用 Google Drive appdata

**优点**：
- 不需要自己的后端
- 数据在用户自己的 Drive 里
- 不需要服务器成本

**缺点**：
- 依赖固定的扩展 ID（需要加 `key`，这个我们要做）
- 依赖 Google OAuth 客户端注册（需要验证域名所有权）
- 不能用邮箱验证码登录（只能 Google 账号）
- `appdata` 文件夹用户看不到，不能手动下载备份
- 多设备冲突处理要自己写
- 版本历史要自己管理

端到端加密 + Supabase 能给我们完全的控制权，代价是每月 $25（Pro）。如果以后用户量大、成本成为问题，可以考虑迁移到 Drive。

---

## 附录 B：为什么不用 Cloudflare Workers + D1

**优点**：
- 更便宜（D1 免费额度很大）
- 更轻（Workers 冷启动快）
- 中国大陆访问更快

**缺点**：
- 登录、验证码、限流要自己写（Supabase 已有 Auth）
- D1 还在 beta，API 可能变化
- 没有现成的 Row Level Security，要手动在每个查询里检查
- 没有自动备份（需要自己写 Cron 任务）

Supabase 免费档能覆盖早期需求，Pro 也不贵。等成本成为瓶颈再考虑迁移。

---

## 附录 C：数据库修改时更新本地时间戳

每次修改 `SidecarDB` 时，自动更新 `sync_local_last_modified`：

```typescript
// 在 service-worker.ts 的 savePrompt 函数里
async function savePrompt(data: {...}) {
  // ... 现有保存逻辑 ...
  
  // 更新本地修改时间（用于冲突检测）
  await chrome.storage.local.set({
    sync_local_last_modified: new Date().toISOString()
  });
  
  // 上报保存事件
  await trackSavePrompt();
  
  return { success: true, data: {...} };
}
```

其他修改数据的地方也要更新（deletePrompt、updatePrompt、importBackup 等）。

---

## 附录 D：生成固定 manifest key

```bash
# 生成 128 字符 Base64 key
openssl genrsa 2048 | openssl rsa -pubout -outform DER | openssl base64 -A
```

或者用在线工具：https://developer.chrome.com/docs/extensions/mv3/manifest/key/

生成后加到 `manifest.json`：
```json
{
  "manifest_version": 3,
  "name": "Riddle Notes",
  "version": "1.1.0",
  "key": "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA...",
  ...
}
```

**注意**：加 key 后扩展 ID 会变，务必在本地先测试加载。

---

## 附录 E：Supabase 自定义 SMTP 配置

Supabase 免费档的默认邮件服务每小时只能发 4 封，Pro 也只是每小时 30 封。自定义 SMTP 可以用你自己的邮件服务（Gmail、SendGrid、AWS SES 等）。

**配置位置**：
Supabase Dashboard → Authentication → Email Templates → SMTP Settings

**Gmail 示例**：
- SMTP Host: `smtp.gmail.com`
- SMTP Port: `587`
- SMTP User: `your-email@gmail.com`
- SMTP Password: 应用专用密码（不是 Gmail 密码）
- Sender Email: `your-email@gmail.com`
- Sender Name: `Riddle Notes`

Gmail 免费账号每天可发 500 封，够早期使用。如果用户量大，可以换成 SendGrid（免费额度每天 100 封）或 AWS SES（每月前 62,000 封免费）。

---

**方案结束。确认后开始实施阶段 0。**
