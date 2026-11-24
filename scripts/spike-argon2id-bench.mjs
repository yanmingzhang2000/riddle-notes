#!/usr/bin/env node
/**
 * Task 1.0 spike:Argon2id 在 Node 里的耗时、峰值内存和事件循环卡顿。
 *
 * 用法:
 *   node scripts/spike-argon2id-bench.mjs                 全部配置,默认每个配置 5 个冷启动样本(noble 为 3 个)
 *   node scripts/spike-argon2id-bench.mjs --runs 10       调整冷启动样本数
 *   node scripts/spike-argon2id-bench.mjs --only hash-wasm,pbkdf2
 *   node scripts/spike-argon2id-bench.mjs --out result.txt   结果同时写入 UTF-8 文件(拷到低端机上跑时用这个)
 *
 * 为什么每个样本都开一个独立子进程:
 *   方案里"Side Panel 关闭即锁定",每次解锁都是全新页面,WASM 要重新编译。
 *   所以"冷启动"(子进程里的第一次调用)才是用户感受到的耗时,"稳态"只作参考。
 *   独立子进程还让每个样本的峰值内存互不污染。
 *
 * 局限(结果里也会重复提醒):
 *   - 这是 Node,不是 Chrome。V8 相同,但 Side Panel 里的 WASM 内存上限、后台节流、Worker 开销都没测。
 *   - 数据只代表运行这个脚本的机器。要回答"低端设备 ≤1s",请把脚本拷到目标机器上跑。
 */
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';
import { argon2id as hashWasmArgon2id } from 'hash-wasm';
import { argon2id as nobleArgon2id, argon2idAsync as nobleArgon2idAsync } from '@noble/hashes/argon2.js';

const SELF = fileURLToPath(import.meta.url);
const PASSWORD = new TextEncoder().encode('correct horse battery staple');
const TARGET_MS = 1000;

/** m 单位是 KiB */
const CONFIGS = [
  { name: 'OWASP 最低 A', m: 19 * 1024, t: 2, p: 1 },
  { name: 'OWASP 最低 B', m: 47104, t: 1, p: 1 },
  { name: '方案起点', m: 64 * 1024, t: 3, p: 1 },
];

const LIBS = [
  { id: 'hash-wasm', label: 'hash-wasm (WASM)', argon: true, defaultRuns: 5, warm: 2 },
  { id: 'noble-sync', label: 'noble 同步 (纯 JS)', argon: true, defaultRuns: 3, warm: 0 },
  { id: 'noble-async', label: 'noble 异步 (纯 JS)', argon: true, defaultRuns: 3, warm: 0 },
  { id: 'pbkdf2', label: 'PBKDF2-SHA256 600k (WebCrypto)', argon: false, defaultRuns: 5, warm: 2 },
];

// ———————————————————————————— 子进程:跑一个配置 ————————————————————————————

function makeRunner(lib, { m, t, p }, salt) {
  switch (lib) {
    case 'hash-wasm':
      return () =>
        hashWasmArgon2id({
          password: PASSWORD,
          salt,
          parallelism: p,
          iterations: t,
          memorySize: m,
          hashLength: 32,
          outputType: 'binary',
        });
    case 'noble-sync':
      return async () => nobleArgon2id(PASSWORD, salt, { t, m, p, dkLen: 32 });
    case 'noble-async':
      return () => nobleArgon2idAsync(PASSWORD, salt, { t, m, p, dkLen: 32 });
    case 'pbkdf2':
      return async () => {
        const base = await webcrypto.subtle.importKey('raw', PASSWORD, 'PBKDF2', false, ['deriveBits']);
        return new Uint8Array(
          await webcrypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 600_000, hash: 'SHA-256' }, base, 256)
        );
      };
    default:
      throw new Error(`未知的库: ${lib}`);
  }
}

/** 计时,并用 5ms 的 setInterval 记录事件循环被占住的最长时间 */
async function timed(fn) {
  let last = performance.now();
  let maxGap = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    maxGap = Math.max(maxGap, now - last);
    last = now;
  }, 5);
  const start = performance.now();
  await fn();
  const end = performance.now();
  // 如果整个调用都在占线,定时器一次都没机会触发,这一段要补进去
  maxGap = Math.max(maxGap, end - last);
  clearInterval(timer);
  return { ms: end - start, lagMs: maxGap };
}

async function runChild([lib, m, t, p, warm]) {
  const cfg = { m: Number(m), t: Number(t), p: Number(p) };
  if (cfg.m === 0) {
    // 基线:只加载模块,不做计算,用来扣掉运行时本身占的内存
    console.log('RESULT:' + JSON.stringify({ maxRssKB: process.resourceUsage().maxRSS }));
    return;
  }
  const salt = webcrypto.getRandomValues(new Uint8Array(16));
  const run = makeRunner(lib, cfg, salt);

  const cold = await timed(run);
  const warmMs = [];
  for (let i = 0; i < Number(warm); i++) warmMs.push((await timed(run)).ms);

  console.log(
    'RESULT:' +
      JSON.stringify({
        coldMs: cold.ms,
        coldLagMs: cold.lagMs,
        warmMs,
        maxRssKB: process.resourceUsage().maxRSS,
      })
  );
}

// ———————————————————————————— 父进程:调度与汇总 ————————————————————————————

function spawnChild(args) {
  const res = spawnSync(process.execPath, [SELF, '--child', ...args.map(String)], {
    encoding: 'utf8',
    timeout: 15 * 60 * 1000,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (res.error) throw res.error;
  const line = (res.stdout || '').split(/\r?\n/).find(l => l.startsWith('RESULT:'));
  if (res.status !== 0 || !line) {
    throw new Error(`子进程失败 (exit ${res.status}): ${(res.stderr || res.stdout || '').trim().slice(0, 500)}`);
  }
  return JSON.parse(line.slice('RESULT:'.length));
}

const median = xs => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
const fmtMs = x => (x == null ? '-' : x >= 100 ? x.toFixed(0) : x.toFixed(1)).padStart(7);
const mb = kb => (kb / 1024).toFixed(0);

/** 两个库在相同参数下必须算出同样的 32 字节,否则后面的耗时对比没有意义 */
async function crossCheck() {
  const salt = new Uint8Array(16).map((_, i) => i + 1);
  const cfg = { m: 1024, t: 2, p: 1 };
  const [a, b, c] = await Promise.all([
    makeRunner('hash-wasm', cfg, salt)(),
    makeRunner('noble-sync', cfg, salt)(),
    makeRunner('noble-async', cfg, salt)(),
  ]);
  const hex = u => Buffer.from(u).toString('hex');
  const ok = hex(a) === hex(b) && hex(b) === hex(c);
  console.log(`交叉校验(m=1MiB, t=2, p=1): ${ok ? '三种实现输出一致' : '输出不一致!'}  ${hex(a).slice(0, 16)}…`);
  if (!ok) {
    console.log({ hashWasm: hex(a), nobleSync: hex(b), nobleAsync: hex(c) });
    process.exit(2);
  }
}

function parseArgs(argv) {
  const out = { runs: null, only: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--runs') out.runs = Number(argv[++i]);
    else if (argv[i] === '--only') out.only = argv[++i].split(',');
    else if (argv[i] === '--out') out.out = argv[++i];
  }
  return out;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  // 同时把结果记下来,结束时由脚本自己按 UTF-8 写文件。
  // Windows PowerShell 5 会把 Node 的 UTF-8 输出按 GBK 解码,重定向到文件会变成乱码,所以不要靠 `> file`。
  const captured = [];
  const originalLog = console.log;
  console.log = (...args) => {
    originalLog(...args);
    captured.push(args.map(String).join(' '));
  };
  const libs = LIBS.filter(l => !opts.only || opts.only.includes(l.id) || (opts.only.includes('noble') && l.id.startsWith('noble')));

  const cpu = os.cpus()[0];
  console.log('=== 环境 ===');
  console.log(`Node ${process.version} (V8 ${process.versions.v8}) | ${os.platform()} ${os.arch()}`);
  console.log(`CPU: ${cpu?.model?.trim()} x${os.cpus().length} | 内存: ${(os.totalmem() / 1024 ** 3).toFixed(1)} GiB`);
  console.log(`目标: 冷启动中位数 ≤ ${TARGET_MS} ms`);
  console.log('');
  await crossCheck();
  console.log('');

  // 每个库的内存基线(模块加载后的 maxRSS)
  const baseline = {};
  for (const lib of libs) baseline[lib.id] = spawnChild([lib.id, 0, 0, 0, 0]).maxRssKB;

  const rows = [];
  for (const lib of libs) {
    const configs = lib.argon ? CONFIGS : [{ name: '600k 迭代', m: 1, t: 1, p: 1 }];
    for (const cfg of configs) {
      const n = opts.runs ?? lib.defaultRuns;
      process.stdout.write(`测试 ${lib.label} / ${cfg.name} ... `);
      const samples = [];
      for (let i = 0; i < n; i++) samples.push(spawnChild([lib.id, cfg.m, cfg.t, cfg.p, lib.warm]));
      const cold = samples.map(s => s.coldMs);
      const warm = samples.flatMap(s => s.warmMs);
      rows.push({
        lib: lib.label,
        cfg: lib.argon ? `${cfg.name} m=${cfg.m / 1024 >= 1 ? (cfg.m / 1024).toFixed(0) + 'MiB' : cfg.m + 'KiB'} t=${cfg.t} p=${cfg.p}` : cfg.name,
        n,
        coldMed: median(cold),
        coldMin: Math.min(...cold),
        coldMax: Math.max(...cold),
        warmMed: warm.length ? median(warm) : null,
        lag: median(samples.map(s => s.coldLagMs)),
        rssDelta: Math.max(...samples.map(s => s.maxRssKB)) - baseline[lib.id],
      });
      console.log(`冷启动中位数 ${rows.at(-1).coldMed.toFixed(0)} ms`);
    }
  }

  console.log('\n=== 结果(耗时单位 ms;内存是该进程峰值 RSS 减去只加载模块的基线,单位 MiB)===');
  console.log(
    ['库', '配置', '样本', '冷启动中位', '最小', '最大', '稳态中位', '最长卡顿', '峰值内存+', `≤${TARGET_MS}ms`].join(' | ')
  );
  for (const r of rows) {
    console.log(
      [
        r.lib,
        r.cfg,
        String(r.n).padStart(2),
        fmtMs(r.coldMed),
        fmtMs(r.coldMin),
        fmtMs(r.coldMax),
        fmtMs(r.warmMed),
        fmtMs(r.lag),
        mb(r.rssDelta).padStart(4),
        r.coldMed <= TARGET_MS ? '达标' : '超出',
      ].join(' | ')
    );
  }
  console.log('\n"最长卡顿" = 计算期间事件循环最长一次没机会处理其他任务的时间。接近冷启动耗时,说明会整段占住线程(Side Panel 里就是冻结 UI),需要放进 Worker。');
  console.log('提醒: 以上是本机 Node 的数据,不是低端设备,也不是 Chrome。');

  if (opts.out) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(opts.out, captured.join('\n') + '\n', 'utf8');
    originalLog(`\n结果已写入 ${opts.out}`);
  }
}

const argv = process.argv.slice(2);
if (argv[0] === '--child') {
  runChild(argv.slice(1)).catch(err => {
    console.error(err);
    process.exit(1);
  });
} else {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
