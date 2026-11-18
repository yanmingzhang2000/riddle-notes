import { db } from '../../src/db/schema';

/**
 * 删除并重建数据库,让测试从一个全新的空库开始。
 * 在 beforeEach 里调用,避免上一个测试留下的数据影响下一个测试。
 */
export async function resetDb(): Promise<void> {
  await db.delete();
  await db.open();
}

export const TABLE_NAMES = [
  'folders',
  'tags',
  'prompts',
  'promptVersions',
  'runs',
  'attachments',
  'improvementRequests',
] as const;

/** 读取所有表的当前内容(按主键顺序),用于比较前后是否一致 */
export async function snapshotDb(): Promise<Record<(typeof TABLE_NAMES)[number], any[]>> {
  const out: Record<string, any[]> = {};
  for (const name of TABLE_NAMES) {
    out[name] = await (db as any)[name].toArray();
  }
  return out as Record<(typeof TABLE_NAMES)[number], any[]>;
}
