# Supabase 数据库部署指南

## 步骤 1：执行 SQL 迁移

1. 访问 Supabase Dashboard：https://supabase.com/dashboard/project/ajeefldvgbzejewucosj
2. 点左侧 **SQL Editor**
3. 点 **New query**
4. 复制 `supabase-migration.sql` 的全部内容
5. 粘贴到编辑器
6. 点右下角 **Run** 按钮执行
7. 等待执行完成（应该显示 "Success. No rows returned"）

## 步骤 2：验证表已创建

在 SQL Editor 中执行以下查询：

```sql
SELECT 
  tablename, 
  schemaname 
FROM pg_tables 
WHERE tablename IN ('sync_snapshots', 'sync_metadata', 'sync_recovery_keys')
ORDER BY tablename;
```

应该返回 3 行：
- sync_metadata
- sync_recovery_keys
- sync_snapshots

## 步骤 3：验证 RLS 策略

执行以下查询：

```sql
SELECT 
  schemaname, 
  tablename, 
  policyname 
FROM pg_policies 
WHERE tablename IN ('sync_snapshots', 'sync_metadata', 'sync_recovery_keys')
ORDER BY tablename, policyname;
```

应该返回多行策略，确保每个表都有 RLS 保护。

## 表结构说明

### sync_snapshots（快照表）
存储加密的备份快照。

字段：
- `id`: 自增主键
- `user_id`: 用户 UUID（关联 auth.users）
- `version`: 快照版本号（单调递增）
- `encrypted_data`: 加密的快照数据（BYTEA）
- `wrapped_key`: 包装后的数据密钥（BYTEA）
- `wrap_iv`: AES-GCM IV（BYTEA）
- `kdf_algorithm`: KDF 算法（'PBKDF2-SHA256'）
- `kdf_iterations`: PBKDF2 迭代次数（60 万）
- `kdf_salt`: KDF 盐值（BYTEA）
- `size_bytes`: 快照大小（字节）
- `created_at`: 创建时间

约束：
- 唯一约束：(user_id, version)
- 触发器：自动清理旧版本（保留最新 5 个）

### sync_metadata（元数据表）
存储用户的同步状态。

字段：
- `user_id`: 用户 UUID（主键）
- `current_version`: 当前版本号
- `last_sync_at`: 最后同步时间
- `device_count`: 设备数量（预留）

### sync_recovery_keys（恢复密钥表）
存储恢复密钥包装的数据密钥（可选）。

字段：
- `id`: 自增主键
- `user_id`: 用户 UUID
- `wrapped_key`: 用恢复密钥包装的数据密钥（BYTEA）
- `wrap_iv`: AES-GCM IV（BYTEA）
- `created_at`: 创建时间

约束：
- 唯一约束：user_id（一个用户只能有一个恢复密钥版本）

## RLS 安全策略

所有表都启用了 Row Level Security (RLS)：
- 用户只能读取、插入、更新自己的数据
- 通过 `auth.uid() = user_id` 验证身份
- anon key 是公开的，但 RLS 保证数据隔离
- service_role key 能绕过 RLS，永远不能暴露到前端

## 触发器

**cleanup_old_snapshots**：每次插入新快照时，自动删除该用户的旧版本快照（保留最新 5 个）。

逻辑：
```sql
DELETE FROM sync_snapshots
WHERE user_id = NEW.user_id
  AND version NOT IN (
    SELECT version
    FROM sync_snapshots
    WHERE user_id = NEW.user_id
    ORDER BY version DESC
    LIMIT 5
  );
```

## 下一步

表创建完成后，回到代码继续开发：
- sync-service.ts：已实现上传、下载、认证
- 下一阶段：UI 集成（设置页、同步按钮）

## 测试连接

在 SQL Editor 执行：

```sql
-- 查看表是否为空
SELECT 'sync_snapshots' AS table_name, COUNT(*) AS row_count FROM sync_snapshots
UNION ALL
SELECT 'sync_metadata', COUNT(*) FROM sync_metadata
UNION ALL
SELECT 'sync_recovery_keys', COUNT(*) FROM sync_recovery_keys;
```

应该返回 3 行，row_count 都是 0（新数据库）。

## 故障排查

**执行 SQL 时报错**：
- 检查是否已登录 Supabase Dashboard
- 确认项目处于 active 状态（不是暂停）
- 重新刷新页面后重试

**RLS 策略测试失败**：
- 确认 `auth.users` 表存在（Supabase 自动创建）
- 检查项目是否启用了 Authentication 功能

**性能问题**：
- 免费计划有限制：500MB 存储，50k MAU
- 快照自动清理只保留 5 个版本（节省空间）
- 如需更多版本，修改触发器中的 `LIMIT 5`
