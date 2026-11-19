/**
 * 设置页的导入导出流程(src/sidepanel/pages/Settings.tsx)。
 *
 * 使用真实的 Dexie 和内存里的 fake-indexeddb。浏览器相关的部分
 * (文件选择、下载、对话框)用 jsdom 里的桩替代,每个测试开始前重置数据库。
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { db, initializeDefaultData } from '../src/db/schema';
import * as B from '../src/shared/backup';
import Settings from '../src/sidepanel/pages/Settings';
import { resetDb, snapshotDb, TABLE_NAMES } from './helpers/db';

// 真实的 UpdateService 是单例,Settings 的 useEffect 依赖它。
// 假实现必须每次返回同一个对象,否则会无限重渲染。
const updateAppSettings = vi.hoisted(() => vi.fn());
const singleton = vi.hoisted(() => ({
  getCurrentVersion: () => '1.0.0',
  getAppSettings: async () => ({ updateCheckEnabled: true, updateManifestUrl: 'https://example.com/m.json' }),
  updateAppSettings: undefined as any,
  checkForUpdates: () => undefined as any,
}));
vi.mock('@shared/update-service', () => {
  singleton.updateAppSettings = updateAppSettings;
  return { UpdateService: { getInstance: () => singleton } };
});

const d = (s: string) => new Date(s);

function seedRows() {
  const t1 = d('2026-11-01T08:00:00.000Z');
  const t2 = d('2026-11-05T09:30:00.000Z');
  return {
    folders: [
      { id: 1, name: '未分类', sortOrder: 0, createdAt: t1, updatedAt: t1 },
      { id: 2, name: '工作', sortOrder: 1, createdAt: t1, updatedAt: t2 },
    ],
    tags: [{ id: 1, name: '高频使用', createdAt: t1 }],
    // 和升级到 v3 之后的真实数据一致:每条笔记都有 uid 和 type
    prompts: [
      { id: 1, uid: 'uid-0001', type: 'ai', title: '第一条', description: '摘要一', folderId: 1, sourcePlatform: 'chatgpt', isFavorite: true, createdAt: t1, updatedAt: t1 },
      { id: 2, uid: 'uid-0002', type: 'ai', title: '第二条', description: '摘要二', folderId: 2, sourcePlatform: 'claude', isFavorite: false, createdAt: t2, updatedAt: t2 },
      { id: 3, uid: 'uid-0003', type: 'ai', title: '第三条', description: '摘要三', folderId: 1, sourcePlatform: 'gemini', isFavorite: false, createdAt: t2, updatedAt: t2 },
    ],
    promptVersions: [
      { id: 1, promptId: 1, versionNumber: 1, content: '提问一', createdAt: t1 },
      { id: 2, promptId: 2, versionNumber: 1, content: '提问二', createdAt: t2 },
      { id: 3, promptId: 3, versionNumber: 1, content: '提问三', createdAt: t2 },
    ],
    runs: [
      { id: 1, promptId: 1, promptVersionId: 1, inputText: '提问一', outputText: '回复一', sourcePlatform: 'chatgpt', createdAt: t1 },
      { id: 2, promptId: 2, promptVersionId: 2, inputText: '提问二', outputText: '回复二', sourcePlatform: 'claude', createdAt: t2 },
      { id: 3, promptId: 3, promptVersionId: 3, inputText: '提问三', outputText: '回复三', sourcePlatform: 'gemini', createdAt: t2 },
    ],
  };
}

async function seed() {
  const rows = seedRows() as Record<string, any[]>;
  for (const name of TABLE_NAMES) {
    if (rows[name]?.length) await (db as any)[name].bulkAdd(rows[name]);
  }
}

const legacyFile = () => ({
  version: '1.0.0',
  exportedAt: '2026-11-09T00:00:00.000Z',
  folders: [{ id: 1, name: '未分类', sortOrder: 0, createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z' }],
  tags: [],
  prompts: [
    { id: 1, title: '旧笔记', description: 'd', folderId: 1, sourcePlatform: 'chatgpt', isFavorite: false, createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z' },
  ],
  promptVersions: [{ id: 1, promptId: 1, versionNumber: 1, content: 'q', createdAt: '2026-11-01T00:00:00.000Z' }],
  runs: [{ id: 1, promptId: 1, promptVersionId: 1, inputText: 'q', outputText: 'a', sourcePlatform: 'chatgpt', createdAt: '2026-11-01T00:00:00.000Z' }],
});

const readBlobText = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsText(blob);
  });

const SAFETY_NAME = /^riddle-notes-backup-before-import-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.json$/;

describe('Settings 页面的导入导出流程', () => {
  let downloads: string[];
  let blobs: Blob[];
  let inputs: HTMLInputElement[];
  let alertSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  const originals = {
    createObjectURL: (URL as any).createObjectURL,
    revokeObjectURL: (URL as any).revokeObjectURL,
  };

  beforeEach(async () => {
    await resetDb();
    downloads = [];
    blobs = [];
    inputs = [];
    (URL as any).createObjectURL = vi.fn((b: Blob) => {
      blobs.push(b);
      return 'blob:test';
    });
    (URL as any).revokeObjectURL = vi.fn();
    // 记录每次下载使用的文件名,不真的触发导航
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(this.download);
    });
    // 捕获页面里创建的文件选择框,不真的弹出系统对话框
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string, opts?: any) => {
      const el = realCreate(tag, opts);
      if (tag === 'input') {
        inputs.push(el as HTMLInputElement);
        vi.spyOn(el, 'click').mockImplementation(() => {});
      }
      return el;
    }) as any);
    alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    // 导入成功后页面会调用 window.location.reload(),jsdom 里没有实现,会打印一条
    // "Not implemented: navigation"。这里只放过这类已知输出,其他 console.error 会让测试失败
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    const unexpected = errorSpy.mock.calls
      .map(args => String((args[0] as any)?.message ?? args[0]))
      .filter(msg => !/Not implemented: navigation|Import failed:|Export failed:/.test(msg));
    cleanup();
    vi.restoreAllMocks();
    (URL as any).createObjectURL = originals.createObjectURL;
    (URL as any).revokeObjectURL = originals.revokeObjectURL;
    expect(unexpected).toEqual([]);
  });

  const mount = () =>
    render(
      <MemoryRouter initialEntries={['/settings']}>
        <Settings />
      </MemoryRouter>
    );

  /** 点「导入数据」并模拟用户选择了文件,返回 onchange 处理完成的 Promise */
  async function pickFile(content: string | null) {
    mount();
    fireEvent.click(await screen.findByText('导入数据'));
    const input = inputs[inputs.length - 1];
    expect(input).toBeTruthy();
    expect(input.type).toBe('file');
    const files = content === null ? [] : [{ text: async () => content }];
    return (input as any).onchange({ target: { files } });
  }

  // -------------------------------------------------------------------------
  describe('导出', () => {
    it('文件名带本地日期,内容能被再次解析,提示笔记条数', async () => {
      await seed();
      mount();
      fireEvent.click(await screen.findByText('导出所有数据 (JSON)'));
      await waitFor(() => expect(alertSpy).toHaveBeenCalled());

      expect(downloads).toHaveLength(1);
      expect(downloads[0]).toMatch(/^riddle-notes-export-\d{4}-\d{2}-\d{2}\.json$/);
      expect(alertSpy.mock.calls[0][0]).toBe('导出成功！共 3 条笔记');
      const parsed = B.parseBackup(await readBlobText(blobs[0]));
      expect(parsed.preview.counts.prompts).toBe(3);
      expect(parsed.preview.legacyFormat).toBe(false);
    });

    it('导出不会改动现有数据', async () => {
      await seed();
      const before = await snapshotDb();
      mount();
      fireEvent.click(await screen.findByText('导出所有数据 (JSON)'));
      await waitFor(() => expect(alertSpy).toHaveBeenCalled());
      expect(await snapshotDb()).toEqual(before);
    });
  });

  // -------------------------------------------------------------------------
  describe('导入:文件有问题', () => {
    it('不是备份文件:提示失败,不弹确认,不下载,数据不变,不提备份', async () => {
      await seed();
      const before = await snapshotDb();
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);

      await pickFile('this is not a backup');

      expect(confirm).not.toHaveBeenCalled();
      expect(downloads).toHaveLength(0); // 即使现有数据非空,校验失败时也不生成备份
      const message = alertSpy.mock.calls[0][0] as string;
      expect(message).toContain('导入失败');
      expect(message).toContain('现有数据没有被改动。');
      // 没有生成备份,就不该出现「自动下载的备份文件没用上」这句话
      expect(message).not.toContain('导入前自动下载的备份文件');
      expect(await snapshotDb()).toEqual(before);
    });

    it('是合法 JSON 但不是备份:同样被拒绝', async () => {
      await seed();
      const before = await snapshotDb();
      await pickFile('{"hello": 1}');
      expect(downloads).toHaveLength(0);
      expect(alertSpy.mock.calls[0][0]).toContain('导入失败');
      expect(await snapshotDb()).toEqual(before);
    });

    it('没有选择文件(关闭了选择框):什么都不发生', async () => {
      await seed();
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
      await pickFile(null);
      expect(confirm).not.toHaveBeenCalled();
      expect(alertSpy).not.toHaveBeenCalled();
      expect(downloads).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  describe('导入:已有数据时覆盖', () => {
    it('确认弹窗里展示备份内容和覆盖提示', async () => {
      await seed();
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
      await pickFile(JSON.stringify(legacyFile()));
      expect(confirm).toHaveBeenCalledTimes(1);
      const shown = confirm.mock.calls[0][0] as string;
      expect(shown).toContain('1 条笔记');
      expect(shown).toContain('完全覆盖现有数据（3 条笔记');
      expect(shown).toContain('先自动下载一份现有数据的备份');
    });

    it('用户取消:不下载,数据不变,没有任何提示', async () => {
      await seed();
      const before = await snapshotDb();
      vi.spyOn(window, 'confirm').mockReturnValue(false);
      await pickFile(JSON.stringify(legacyFile()));
      expect(downloads).toHaveLength(0);
      expect(alertSpy).not.toHaveBeenCalled();
      expect(await snapshotDb()).toEqual(before);
    });

    it('确认导入:先自动备份一份(文件名带时间戳),再覆盖,并在提示里告知备份文件名', async () => {
      await seed();
      vi.spyOn(window, 'confirm').mockReturnValue(true);

      await pickFile(JSON.stringify(legacyFile()));

      // 恰好下载了一个文件,文件名是带时间戳的覆盖前备份
      expect(downloads).toHaveLength(1);
      expect(downloads[0]).toMatch(SAFETY_NAME);

      // 数据已被覆盖
      expect((await snapshotDb()).prompts.map(p => p.title)).toEqual(['旧笔记']);

      // 成功提示里包含备份文件名
      expect(alertSpy).toHaveBeenCalledTimes(1);
      expect(alertSpy.mock.calls[0][0]).toBe(
        `导入成功！\n- 笔记: 1\n- 文件夹: 1\n\n导入前的数据已自动备份，文件 ${downloads[0]} 已下载到浏览器的下载目录。`
      );
    });

    it('下载的备份文件里是被覆盖前的数据,能把它们完整恢复回来', async () => {
      await seed();
      const before = await snapshotDb();
      vi.spyOn(window, 'confirm').mockReturnValue(true);

      await pickFile(JSON.stringify(legacyFile()));
      expect((await snapshotDb()).prompts).toHaveLength(1);

      const safety = B.parseBackup(await readBlobText(blobs[0]));
      await B.restoreBackup(db, safety.data);
      expect(await snapshotDb()).toEqual(before);
    });

    it('覆盖后新旧数据不混合', async () => {
      await seed();
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      await pickFile(JSON.stringify(legacyFile()));
      const after = await snapshotDb();
      expect(after.prompts).toHaveLength(1);
      expect(after.tags).toEqual([]);
      expect(after.folders.map(f => f.name)).toEqual(['未分类']);
    });
  });

  // -------------------------------------------------------------------------
  describe('导入:没有旧数据时', () => {
    it('刚安装扩展(只有系统预置的文件夹,没有笔记):不生成备份,也不提覆盖', async () => {
      // 真实 Chrome 里验证出的场景:全新安装的库不是空的(有 1 个「未分类」文件夹),但没有任何笔记
      await initializeDefaultData();
      expect(await B.getBackupCounts(db)).toMatchObject({ folders: 1, tags: 0, prompts: 0 });
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);

      await pickFile(JSON.stringify(legacyFile()));

      const shown = confirm.mock.calls[0][0] as string;
      expect(shown).toContain('当前没有数据');
      expect(shown).not.toContain('覆盖');
      expect(downloads).toHaveLength(0);
      expect(alertSpy.mock.calls[0][0]).toBe('导入成功！\n- 笔记: 1\n- 文件夹: 1');
      expect((await snapshotDb()).prompts).toHaveLength(1);
    });

    it('早期版本装的老用户(有 3 个预置标签,没有笔记):同样不生成备份,也不提覆盖', async () => {
      await initializeDefaultData();
      await db.tags.bulkAdd([
        { name: '高频使用', createdAt: new Date() },
        { name: '待改进', createdAt: new Date() },
        { name: '效果很好', createdAt: new Date() },
      ]);
      expect(await B.getBackupCounts(db)).toMatchObject({ folders: 1, tags: 3, prompts: 0 });
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);

      await pickFile(JSON.stringify(legacyFile()));

      const shown = confirm.mock.calls[0][0] as string;
      expect(shown).toContain('当前没有数据');
      expect(shown).not.toContain('覆盖');
      expect(downloads).toHaveLength(0);
    });

    it('首次导入:不生成备份,提示里也不提备份', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      const confirmText = () => (window.confirm as any).mock.calls[0][0] as string;

      await pickFile(JSON.stringify(legacyFile()));

      expect(downloads).toHaveLength(0);
      expect((await snapshotDb()).prompts).toHaveLength(1);
      expect(confirmText()).toContain('当前没有数据');
      expect(confirmText()).not.toContain('自动下载');
      expect(alertSpy.mock.calls[0][0]).toBe('导入成功！\n- 笔记: 1\n- 文件夹: 1');
    });
  });

  // -------------------------------------------------------------------------
  describe('导入:写入失败', () => {
    it('备份已下载但写入失败:整体回滚,提示备份文件没用上、可以删除', async () => {
      await seed();
      const before = await snapshotDb();
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      // 模拟写入到一半磁盘配额用尽等情况:前面的表已经写入,轮到回复表时失败
      vi.spyOn(db.runs, 'bulkAdd').mockRejectedValueOnce(new Error('QuotaExceededError'));

      await pickFile(JSON.stringify(legacyFile()));

      expect(downloads).toHaveLength(1);
      expect(downloads[0]).toMatch(SAFETY_NAME);
      const message = alertSpy.mock.calls[0][0] as string;
      expect(message).toContain('导入失败：QuotaExceededError');
      expect(message).toContain('现有数据没有被改动。');
      expect(message).toContain(`导入前自动下载的备份文件（${downloads[0]}）没有用上，可以删除。`);
      expect(message).not.toContain('导入成功');
      // 事务回滚:现有数据与导入前完全一致
      expect(await snapshotDb()).toEqual(before);
    });
  });

  // -------------------------------------------------------------------------
  describe('页面文案', () => {
    it('有覆盖与备份的说明,不再出现 Prompt', async () => {
      mount();
      await screen.findByText('导入数据');
      const body = document.body.textContent || '';
      expect(body).toContain('导入会覆盖现有数据。导入前会先自动下载一份现有数据的备份。');
      expect(body).not.toContain('Prompt');
    });
  });
});
