/**
 * Vault 与 Service Worker / content script 的隔离守卫。技术方案 §7 Task 2.2。
 *
 * 为什么需要:content script 跑在 ChatGPT、Claude 这些第三方页面里,Service Worker 的消息处理
 * 完全不检查 sender。只要 Vault 的逻辑不进这两个包,页面上的脚本就没有任何办法碰到它。
 * 这个文件分两层守这件事:
 *   静态:从 manifest 里的入口出发,沿 import 图走完所有可达模块,不能出现 Vault 的代码或依赖。
 *   动态:驱动真实的 service-worker.ts,发 VAULT_* 消息,必须被拒绝,而且不会打开 Vault 的库。
 * 两层都各有一条"自检",证明守卫自己真的会报警。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const ROOT = resolve(__dirname, '..', '..');
const SRC = join(ROOT, 'src');

// ———————————————————————————— 静态:import 图 ————————————————————————————

/** 与 vitest.config.ts / vite.config.ts 里的别名一致 */
const ALIASES: Array<[string, string]> = [
  ['@background', join(SRC, 'background')],
  ['@content', join(SRC, 'content')],
  ['@sidepanel', join(SRC, 'sidepanel')],
  ['@shared', join(SRC, 'shared')],
  ['@db', join(SRC, 'db')],
  ['@ai', join(SRC, 'ai')],
  ['@', SRC],
];

/** 只有 Vault 会用到的第三方包:它们出现在 SW 或 content script 的包里,同样说明隔离被破坏了 */
const VAULT_ONLY_PACKAGES = ['@zxcvbn-ts/', 'hash-wasm', '@noble/hashes'];

const EXTENSIONS = ['.ts', '.tsx', '.js', '.mjs', '/index.ts', '/index.tsx', '/index.js'];

function isVaultFile(absPath: string): boolean {
  const rel = relative(SRC, absPath).split(sep).join('/');
  return rel.startsWith('vault/') || rel === 'db/vault-schema.ts';
}

/** 取出一个源文件里所有 import / export-from / 动态 import 的路径。`import type` 编译后会被擦掉,不算 */
function importSpecifiers(source: string): string[] {
  const specs: string[] = [];
  const statement = /(?:^|\n)\s*(import|export)\s+(type\s+)?([^'";]*?\bfrom\s*)?['"]([^'"]+)['"]/g;
  for (const m of source.matchAll(statement)) {
    if (m[2]) continue; // import type / export type
    specs.push(m[4]);
  }
  for (const m of source.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) specs.push(m[1]);
  return specs;
}

function resolveSpecifier(spec: string, fromFile: string): string | 'external' | null {
  let base: string | null = null;
  if (spec.startsWith('.')) {
    base = resolve(dirname(fromFile), spec);
  } else {
    for (const [alias, target] of ALIASES) {
      if (spec === alias || spec.startsWith(alias + '/')) {
        base = join(target, spec.slice(alias.length));
        break;
      }
    }
    if (base === null) return 'external';
  }
  if (existsSync(base) && statSync(base).isFile()) return base;
  for (const ext of EXTENSIONS) if (existsSync(base + ext)) return base + ext;
  return null;
}

interface Reachable {
  files: Set<string>;
  externals: Set<string>;
  unresolved: string[];
  /** 谁引用了谁,用来在失败时说清楚是哪条路径把 Vault 带进来的 */
  via: Map<string, string>;
}

function walkImports(entry: string): Reachable {
  const result: Reachable = { files: new Set(), externals: new Set(), unresolved: [], via: new Map() };
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (result.files.has(file)) continue;
    result.files.add(file);
    for (const spec of importSpecifiers(readFileSync(file, 'utf8'))) {
      const resolved = resolveSpecifier(spec, file);
      if (resolved === 'external') {
        result.externals.add(spec);
      } else if (resolved === null) {
        result.unresolved.push(`${relative(ROOT, file)} -> ${spec}`);
      } else {
        if (!result.via.has(resolved)) result.via.set(resolved, file);
        queue.push(resolved);
      }
    }
  }
  return result;
}

function violations(reach: Reachable): string[] {
  const out: string[] = [];
  for (const file of reach.files) {
    if (isVaultFile(file)) {
      const parent = reach.via.get(file);
      out.push(`${relative(ROOT, file)}(由 ${parent ? relative(ROOT, parent) : '入口'} 引入)`);
    }
  }
  for (const spec of reach.externals) {
    if (VAULT_ONLY_PACKAGES.some(p => spec === p || spec.startsWith(p))) out.push(`依赖 ${spec}`);
  }
  return out;
}

const manifest = JSON.parse(readFileSync(join(ROOT, 'public', 'manifest.json'), 'utf8'));
const entries: Array<[string, string]> = [
  ['Service Worker', join(ROOT, manifest.background.service_worker)],
  ...(manifest.content_scripts as Array<{ js: string[] }>).flatMap(
    (cs, i) => cs.js.map((js): [string, string] => [`content script #${i + 1}`, join(ROOT, js)])
  ),
];

describe('静态守卫:Vault 的代码和依赖不会进 Service Worker / content script 的包', () => {
  test('入口来自 manifest,而且确实存在(否则下面的检查是空转)', () => {
    expect(entries.length).toBeGreaterThanOrEqual(2);
    for (const [, file] of entries) expect(existsSync(file), file).toBe(true);
  });

  test.each(entries)('%s:沿 import 图可达的所有模块里没有 Vault', (_name, entry) => {
    const reach = walkImports(entry);
    expect(reach.files.size).toBeGreaterThan(1); // 确实走了 import 图,不是只看了入口一个文件
    expect(violations(reach)).toEqual([]);
  });

  test.each(entries)('%s:没有无法解析的 import(解析不到就没法保证它不引入 Vault)', (_name, entry) => {
    expect(walkImports(entry).unresolved).toEqual([]);
  });

  test('已知应当可达的模块确实被走到了(证明遍历没有漏掉别名路径)', () => {
    const sw = walkImports(join(ROOT, manifest.background.service_worker));
    const rel = [...sw.files].map(f => relative(SRC, f).split(sep).join('/'));
    expect(rel).toContain('db/schema.ts'); // 经 @db/schema 别名
    expect(rel).toContain('shared/onboarding.ts'); // 经 @shared/onboarding 别名
  });

  // —— 自检:守卫自己得会报警 ——

  test('自检:从 Vault 自己的入口出发,守卫会报告违规', () => {
    const reach = walkImports(join(SRC, 'vault', 'services', 'vault-service.ts'));
    expect(violations(reach).length).toBeGreaterThan(0);
  });

  test('自检:能识别经别名引入的 Vault 数据库与 Vault 专用依赖', () => {
    expect(isVaultFile(join(SRC, 'db', 'vault-schema.ts'))).toBe(true);
    expect(isVaultFile(join(SRC, 'db', 'schema.ts'))).toBe(false);
    expect(resolveSpecifier('@db/vault-schema', join(SRC, 'background', 'service-worker.ts'))).toBe(
      join(SRC, 'db', 'vault-schema.ts')
    );
    expect(resolveSpecifier('@/vault/types', join(SRC, 'content', 'content-script.ts'))).toBe(
      join(SRC, 'vault', 'types.ts')
    );
    const fake: Reachable = {
      files: new Set(),
      externals: new Set(['@zxcvbn-ts/core', 'react']),
      unresolved: [],
      via: new Map(),
    };
    expect(violations(fake)).toEqual(['依赖 @zxcvbn-ts/core']);
  });

  test('自检:import 解析能识别各种写法,并且不把 import type 当成运行时依赖', () => {
    const specs = importSpecifiers(`
      import a from './a';
      import { b } from "@db/schema";
      import type { T } from '../vault/types';
      export { c } from './c';
      export type { D } from '../vault/types';
      const lazy = () => import('../vault/lazy');
      import './side-effect';
    `);
    expect(specs.sort()).toEqual(['./a', './c', './side-effect', '../vault/lazy', '@db/schema'].sort());
  });
});

// ———————————————————————————— 动态:驱动真实的 service-worker.ts ————————————————————————————

describe('动态守卫:从 content script 或扩展页面发 VAULT_* 消息都被拒绝', () => {
  type Sender = Record<string, unknown>;
  let listener: (message: unknown, sender: Sender, respond: (r: unknown) => void) => unknown;

  /** content script 的 sender 带 tab;扩展自己的页面(Side Panel)没有 */
  const FROM_CONTENT_SCRIPT: Sender = { id: 'ext-id', tab: { id: 7 }, url: 'https://chatgpt.com/c/1' };
  const FROM_EXTENSION_PAGE: Sender = { id: 'ext-id', url: 'chrome-extension://ext-id/src/sidepanel/index.html' };

  const send = (message: unknown, sender: Sender) =>
    new Promise<any>(resolveResponse => listener(message, sender, resolveResponse));

  beforeEach(async () => {
    const runtime = (globalThis as any).chrome.runtime;
    runtime.onInstalled = { addListener: vi.fn() };
    runtime.onMessage.addListener.mockClear();

    vi.resetModules();
    // service-worker.ts 在导入时注册监听器,这里取出它注册的函数来驱动
    await import('../../src/background/service-worker');
    listener = runtime.onMessage.addListener.mock.calls[0][0];
  });

  const VAULT_MESSAGES = [
    'VAULT_UNLOCK',
    'VAULT_LOCK',
    'VAULT_INITIALIZE',
    'VAULT_GET_SECRET',
    'VAULT_LIST',
    'VAULT_CREATE_RECORD',
    'VAULT_CHANGE_MASTER_PASSWORD',
    'VAULT_VERIFY_RECOVERY_KEY',
    'vault:unlock', // 换个写法也一样
    'UNLOCK_VAULT',
  ];
  const SECRET = 'sk-this-must-never-be-echoed-1234567890';

  test.each(VAULT_MESSAGES)('%s 从 content script 发来:被拒绝,响应里没有任何内容', async type => {
    const response = await send(
      { type, payload: { masterPassword: SECRET, id: 'r1', secret: SECRET } },
      FROM_CONTENT_SCRIPT
    );

    expect(response).toEqual({ success: false, error: 'Unknown message type' });
    expect(JSON.stringify(response)).not.toContain(SECRET);
  });

  test.each(VAULT_MESSAGES)('%s 从扩展页面发来:同样被拒绝(Vault 不走 Service Worker 的消息路由)', async type => {
    const response = await send({ type, payload: { masterPassword: SECRET } }, FROM_EXTENSION_PAGE);
    expect(response).toEqual({ success: false, error: 'Unknown message type' });
  });

  test('畸形的消息也不会抛出,更不会泄露内容', async () => {
    for (const message of [null, undefined, {}, { type: null }, { type: { toString: () => 'VAULT_UNLOCK' } }, 'VAULT_UNLOCK']) {
      const response = await send(message, FROM_CONTENT_SCRIPT);
      expect(response.success).toBe(false);
      expect(JSON.stringify(response)).not.toContain(SECRET);
    }
  });

  test('这些消息不会打开 Vault 的数据库(Service Worker 根本没有它的句柄)', async () => {
    for (const type of VAULT_MESSAGES) await send({ type }, FROM_CONTENT_SCRIPT);

    const names = (await indexedDB.databases()).map(d => d.name);
    expect(names).not.toContain('RiddleVaultDB');
  });

  test('监听器对未知消息仍然返回 true 保持通道(现有行为不变),所以拒绝是通过响应体表达的', () => {
    const result = listener({ type: 'VAULT_UNLOCK' }, FROM_CONTENT_SCRIPT, () => {});
    expect(result).toBe(true);
  });

  // —— 自检:这个动态守卫能区分"被处理"和"被拒绝" ——

  test('自检:现有的合法消息(GET_PROMPTS)确实会被处理,不会被当成未知消息', async () => {
    const response = await send({ type: 'GET_PROMPTS', payload: {} }, FROM_EXTENSION_PAGE);
    expect(response.success).toBe(true);
    expect(response.error).toBeUndefined();
  });
});
