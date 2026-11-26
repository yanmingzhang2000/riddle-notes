/**
 * Supabase 客户端配置
 * 
 * 环境变量（生产环境需要配置）：
 * - VITE_SUPABASE_URL: Supabase 项目 URL
 * - VITE_SUPABASE_ANON_KEY: Supabase anon public key
 * 
 * 开发环境硬编码（仅用于测试，生产环境必须用环境变量）
 */

import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

// 开发环境配置（硬编码仅用于开发）
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://ajeefldvgbzejewucosj.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFqZWVmbGR2Z2J6ZWpld3Vjb3NqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTU2Nzk0ODksImV4cCI6MjExMTI1NTQ4OX0.N7QtGYD0gpId2WOPSi3Ubofq5lhC0YgEGy6iXiewTHw';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error('Missing Supabase configuration. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY');
}

/**
 * Supabase 客户端单例
 * 
 * 注意：
 * - anon key 是公开的，可以提交到 GitHub
 * - RLS 策略保证用户只能访问自己的数据
 * - service_role key 永远不能暴露到前端
 */
export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    // 使用 localStorage 持久化 session（浏览器扩展环境）
    storage: typeof chrome !== 'undefined' && chrome.storage
      ? {
          getItem: (key) => {
            return chrome.storage.local.get(key).then(result => result[key]);
          },
          setItem: (key, value) => {
            return chrome.storage.local.set({ [key]: value });
          },
          removeItem: (key) => {
            return chrome.storage.local.remove(key);
          },
        }
      : undefined, // 使用默认 localStorage（测试环境）
    // 自动刷新 token
    autoRefreshToken: true,
    // 检测 session（扩展环境不需要）
    detectSessionInUrl: false,
    // 持久化 session
    persistSession: true,
  },
});

/**
 * 获取当前用户 ID
 * 返回 null 表示未登录
 */
export async function getCurrentUserId(): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id ?? null;
}

/**
 * 检查用户是否已登录
 */
export async function isAuthenticated(): Promise<boolean> {
  const userId = await getCurrentUserId();
  return userId !== null;
}
