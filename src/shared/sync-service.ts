/**
 * 云同步服务
 * 
 * 职责：
 * 1. 上传快照：加密 → 上传到 Supabase
 * 2. 下载快照：从 Supabase 下载 → 解密
 * 3. 冲突检测：版本号比对
 * 4. 认证管理：Supabase Auth
 */

import { supabase, getCurrentUserId } from './supabase-client';
import {
  generateSyncKey,
  createDefaultKdf,
  deriveSyncWrapKey,
  wrapSyncKey,
  unwrapSyncKey,
  encryptSnapshot,
  decryptSnapshot,
  wipe,
  SyncAuthError,
  type SyncKdfParams,
  type SyncWrappedKey,
} from './sync-crypto';
import { createBackup, type BackupFile } from './backup';
import type { Database } from './database.types';

type SyncSnapshot = Database['public']['Tables']['sync_snapshots']['Row'];
type SyncMetadata = Database['public']['Tables']['sync_metadata']['Row'];

/** 同步错误基类 */
export class SyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SyncError';
  }
}

/** 未登录错误 */
export class NotAuthenticatedError extends SyncError {
  constructor() {
    super('请先登录云同步账号');
    this.name = 'NotAuthenticatedError';
  }
}

/** 冲突错误（本地版本低于云端） */
export class ConflictError extends SyncError {
  constructor(
    public readonly localVersion: number,
    public readonly remoteVersion: number
  ) {
    super(`版本冲突：本地 v${localVersion}，云端 v${remoteVersion}`);
    this.name = 'ConflictError';
  }
}

/** 网络错误 */
export class NetworkError extends SyncError {
  constructor(message: string) {
    super(`网络错误：${message}`);
    this.name = 'NetworkError';
  }
}

// ============================================================================
// 认证管理
// ============================================================================

/**
 * 注册账号（邮箱 + 密码）
 * Supabase 会发送验证邮件到用户邮箱
 */
export async function signUp(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signUp({ email, password });
  if (error) throw new SyncError(`注册失败：${error.message}`);
}

/**
 * 登录
 */
export async function signIn(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    if (error.message.includes('Invalid login')) {
      throw new SyncAuthError();
    }
    throw new SyncError(`登录失败：${error.message}`);
  }
}

/**
 * 登出
 */
export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) throw new SyncError(`登出失败：${error.message}`);
}

/**
 * 获取当前用户邮箱
 */
export async function getCurrentUserEmail(): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser();
  return user?.email ?? null;
}

// ============================================================================
// 快照管理
// ============================================================================

/**
 * 上传快照
 * 
 * 流程：
 * 1. 检查登录状态
 * 2. 生成数据密钥
 * 3. 派生包装密钥（从同步口令）
 * 4. 包装数据密钥
 * 5. 加密快照
 * 6. 上传到 Supabase
 * 7. 更新元数据
 * 
 * @param backup 备份数据（来自 backup.ts）
 * @param passphrase 同步口令
 * @param expectedVersion 期望的版本号（用于乐观锁，防止覆盖更新的数据）
 * @returns 新版本号
 */
export async function uploadSnapshot(
  backup: BackupFile,
  passphrase: string,
  expectedVersion: number = 0
): Promise<number> {
  const userId = await getCurrentUserId();
  if (!userId) throw new NotAuthenticatedError();

  // 检查云端版本
  const remoteVersion = await getLatestVersion(userId);
  if (remoteVersion > expectedVersion) {
    throw new ConflictError(expectedVersion, remoteVersion);
  }

  const newVersion = remoteVersion + 1;

  // 生成数据密钥
  const dataKey = generateSyncKey();
  
  try {
    // 派生包装密钥
    const kdf = createDefaultKdf();
    const wrapKey = await deriveSyncWrapKey(passphrase, kdf);

    // 包装数据密钥
    const wrappedDataKey = await wrapSyncKey(dataKey, wrapKey);

    // 加密快照
    const encryptedData = await encryptSnapshot(backup, dataKey);

    // 上传到 Supabase
    const { error: insertError } = await supabase
      .from('sync_snapshots')
      .insert({
        user_id: userId,
        version: newVersion,
        encrypted_data: encryptedData,
        wrapped_key: wrappedDataKey.wrappedKey,
        wrap_iv: wrappedDataKey.iv,
        kdf_algorithm: kdf.algorithm,
        kdf_iterations: kdf.iterations,
        kdf_salt: kdf.salt,
        size_bytes: encryptedData.length,
      });

    if (insertError) {
      if (insertError.code === '23505') { // unique_violation
        throw new ConflictError(expectedVersion, remoteVersion);
      }
      throw new NetworkError(insertError.message);
    }

    // 更新元数据
    await updateMetadata(userId, newVersion);

    return newVersion;
  } finally {
    wipe(dataKey);
  }
}

/**
 * 下载最新快照
 * 
 * @param passphrase 同步口令
 * @returns 解密后的备份数据 + 版本号，如果云端没有数据返回 null
 */
export async function downloadLatestSnapshot(
  passphrase: string
): Promise<{ backup: BackupFile; version: number } | null> {
  const userId = await getCurrentUserId();
  if (!userId) throw new NotAuthenticatedError();

  // 查询最新版本
  const { data: snapshots, error: selectError } = await supabase
    .from('sync_snapshots')
    .select('*')
    .eq('user_id', userId)
    .order('version', { ascending: false })
    .limit(1);

  if (selectError) throw new NetworkError(selectError.message);
  if (!snapshots || snapshots.length === 0) return null;

  const snapshot = snapshots[0];

  // 重建 KDF 参数
  const kdf: SyncKdfParams = {
    algorithm: snapshot.kdf_algorithm as 'PBKDF2-SHA256',
    iterations: snapshot.kdf_iterations,
    salt: new Uint8Array(snapshot.kdf_salt),
  };

  // 派生包装密钥
  const wrapKey = await deriveSyncWrapKey(passphrase, kdf);

  // 解包数据密钥
  const wrappedDataKey: SyncWrappedKey = {
    wrappedKey: new Uint8Array(snapshot.wrapped_key),
    iv: new Uint8Array(snapshot.wrap_iv),
  };

  let dataKey: Uint8Array;
  try {
    dataKey = await unwrapSyncKey(wrappedDataKey, wrapKey);
  } catch (error) {
    if (error instanceof SyncAuthError) {
      throw new SyncError('同步口令错误');
    }
    throw error;
  }

  try {
    // 解密快照
    const backup = await decryptSnapshot(new Uint8Array(snapshot.encrypted_data), dataKey);
    return { backup, version: snapshot.version };
  } finally {
    wipe(dataKey);
  }
}

/**
 * 获取用户的最新版本号
 * 返回 0 表示用户还没有上传过快照
 */
export async function getLatestVersion(userId?: string): Promise<number> {
  const uid = userId ?? await getCurrentUserId();
  if (!uid) throw new NotAuthenticatedError();

  const { data, error } = await supabase
    .from('sync_metadata')
    .select('current_version')
    .eq('user_id', uid)
    .single();

  if (error) {
    if (error.code === 'PGRST116') { // no rows returned
      return 0;
    }
    throw new NetworkError(error.message);
  }

  return data?.current_version ?? 0;
}

/**
 * 更新元数据
 */
async function updateMetadata(userId: string, version: number): Promise<void> {
  const { error } = await supabase
    .from('sync_metadata')
    .upsert({
      user_id: userId,
      current_version: version,
      last_sync_at: new Date().toISOString(),
    });

  if (error) throw new NetworkError(error.message);
}

/**
 * 获取同步元数据
 */
export async function getSyncMetadata(): Promise<SyncMetadata | null> {
  const userId = await getCurrentUserId();
  if (!userId) throw new NotAuthenticatedError();

  const { data, error } = await supabase
    .from('sync_metadata')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw new NetworkError(error.message);
  }

  return data;
}

/**
 * 列出所有快照版本（调试用）
 */
export async function listSnapshots(): Promise<Array<{ version: number; createdAt: string; sizeBytes: number }>> {
  const userId = await getCurrentUserId();
  if (!userId) throw new NotAuthenticatedError();

  const { data, error } = await supabase
    .from('sync_snapshots')
    .select('version, created_at, size_bytes')
    .eq('user_id', userId)
    .order('version', { ascending: false });

  if (error) throw new NetworkError(error.message);

  return (data ?? []).map(s => ({
    version: s.version,
    createdAt: s.created_at,
    sizeBytes: s.size_bytes,
  }));
}
