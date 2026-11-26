-- Riddle Notes 云同步数据库 schema
-- 在 Supabase Dashboard → SQL Editor 中执行
-- 或保存为 migration 文件

-- ============================================================================
-- 表 1: sync_snapshots（快照表）
-- ============================================================================
CREATE TABLE IF NOT EXISTS sync_snapshots (
  id BIGSERIAL PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  version BIGINT NOT NULL,
  encrypted_data BYTEA NOT NULL,
  wrapped_key BYTEA NOT NULL,
  wrap_iv BYTEA NOT NULL,
  kdf_algorithm TEXT NOT NULL DEFAULT 'PBKDF2-SHA256',
  kdf_iterations INT NOT NULL DEFAULT 600000,
  kdf_salt BYTEA NOT NULL,
  size_bytes INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- 唯一约束：同一用户的 version 不能重复
  CONSTRAINT unique_user_version UNIQUE (user_id, version)
);

-- 索引：按用户查询最新版本
CREATE INDEX IF NOT EXISTS idx_snapshots_user_version ON sync_snapshots(user_id, version DESC);

-- RLS 策略
ALTER TABLE sync_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own snapshots" 
  ON sync_snapshots FOR SELECT 
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own snapshots" 
  ON sync_snapshots FOR INSERT 
  WITH CHECK (auth.uid() = user_id);

-- 不允许更新和删除（快照不可变）
-- 旧版本清理由触发器自动完成

-- ============================================================================
-- 表 2: sync_metadata（元数据表）
-- ============================================================================
CREATE TABLE IF NOT EXISTS sync_metadata (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  current_version BIGINT NOT NULL DEFAULT 0,
  last_sync_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  device_count INT NOT NULL DEFAULT 1
);

-- RLS 策略
ALTER TABLE sync_metadata ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own metadata" 
  ON sync_metadata FOR SELECT 
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own metadata" 
  ON sync_metadata FOR INSERT 
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own metadata" 
  ON sync_metadata FOR UPDATE 
  USING (auth.uid() = user_id);

-- ============================================================================
-- 触发器：自动清理旧快照（保留最新 5 个版本）
-- ============================================================================
CREATE OR REPLACE FUNCTION cleanup_old_snapshots()
RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM sync_snapshots
  WHERE user_id = NEW.user_id
    AND version NOT IN (
      SELECT version
      FROM sync_snapshots
      WHERE user_id = NEW.user_id
      ORDER BY version DESC
      LIMIT 5
    );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_cleanup_old_snapshots ON sync_snapshots;

CREATE TRIGGER trigger_cleanup_old_snapshots
AFTER INSERT ON sync_snapshots
FOR EACH ROW
EXECUTE FUNCTION cleanup_old_snapshots();

-- ============================================================================
-- 表 3: sync_recovery_keys（恢复密钥表，可选）
-- ============================================================================
-- 存储恢复密钥的包装版本（用于忘记口令时恢复）
-- 注意：恢复密钥本身不存储在服务器，只存储用它包装的数据密钥
CREATE TABLE IF NOT EXISTS sync_recovery_keys (
  id BIGSERIAL PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  wrapped_key BYTEA NOT NULL,
  wrap_iv BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- 一个用户只能有一个恢复密钥包装版本
  CONSTRAINT unique_user_recovery_key UNIQUE (user_id)
);

-- RLS 策略
ALTER TABLE sync_recovery_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own recovery keys" 
  ON sync_recovery_keys FOR SELECT 
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own recovery keys" 
  ON sync_recovery_keys FOR INSERT 
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own recovery keys" 
  ON sync_recovery_keys FOR UPDATE 
  USING (auth.uid() = user_id);

-- ============================================================================
-- 验证查询（执行完后运行，验证表已创建）
-- ============================================================================
-- SELECT 
--   tablename, 
--   schemaname 
-- FROM pg_tables 
-- WHERE tablename IN ('sync_snapshots', 'sync_metadata', 'sync_recovery_keys')
-- ORDER BY tablename;

-- 验证 RLS 策略
-- SELECT 
--   schemaname, 
--   tablename, 
--   policyname 
-- FROM pg_policies 
-- WHERE tablename IN ('sync_snapshots', 'sync_metadata', 'sync_recovery_keys')
-- ORDER BY tablename, policyname;
