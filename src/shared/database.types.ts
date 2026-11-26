/**
 * Supabase 数据库类型定义
 * 
 * 对应 supabase-migration.sql 中的表结构
 */

export interface Database {
  public: {
    Tables: {
      sync_snapshots: {
        Row: {
          id: number;
          user_id: string;
          version: number;
          encrypted_data: Uint8Array;
          wrapped_key: Uint8Array;
          wrap_iv: Uint8Array;
          kdf_algorithm: string;
          kdf_iterations: number;
          kdf_salt: Uint8Array;
          size_bytes: number;
          created_at: string;
        };
        Insert: {
          id?: never;
          user_id: string;
          version: number;
          encrypted_data: Uint8Array;
          wrapped_key: Uint8Array;
          wrap_iv: Uint8Array;
          kdf_algorithm?: string;
          kdf_iterations?: number;
          kdf_salt: Uint8Array;
          size_bytes: number;
          created_at?: string;
        };
        Update: {
          id?: never;
          user_id?: never;
          version?: never;
          encrypted_data?: never;
          wrapped_key?: never;
          wrap_iv?: never;
          kdf_algorithm?: never;
          kdf_iterations?: never;
          kdf_salt?: never;
          size_bytes?: never;
          created_at?: never;
        };
      };
      sync_metadata: {
        Row: {
          user_id: string;
          current_version: number;
          last_sync_at: string;
          device_count: number;
        };
        Insert: {
          user_id: string;
          current_version?: number;
          last_sync_at?: string;
          device_count?: number;
        };
        Update: {
          user_id?: never;
          current_version?: number;
          last_sync_at?: string;
          device_count?: number;
        };
      };
      sync_recovery_keys: {
        Row: {
          id: number;
          user_id: string;
          wrapped_key: Uint8Array;
          wrap_iv: Uint8Array;
          created_at: string;
        };
        Insert: {
          id?: never;
          user_id: string;
          wrapped_key: Uint8Array;
          wrap_iv: Uint8Array;
          created_at?: string;
        };
        Update: {
          id?: never;
          user_id?: never;
          wrapped_key?: Uint8Array;
          wrap_iv?: Uint8Array;
          created_at?: never;
        };
      };
    };
  };
}
