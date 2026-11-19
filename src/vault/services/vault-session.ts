/**
 * Vault 的运行时会话。接口见技术方案 §4.2。
 *
 * 会话只存在于 Side Panel 页面的 JS 内存里,页面销毁时随之消失("关闭即锁定",该假设待 Task 1.0 实测)。
 * 会话里只有一个不可导出的 CryptoKey 和它的 keyId,不缓存任何解密后的记录。
 *
 * 多个 Side Panel 实例各有一个会话,通过 BroadcastChannel 同步。
 * lock() 与 lockLocal() 必须分开:收到广播的一方只清本地,不再广播,否则两个实例会无限互相触发。
 */
import { DEFAULT_AUTO_LOCK_TIMEOUT_MS } from '../types';
import { VaultLockedError } from '../crypto/errors';
import { KEY_ID_LENGTH } from '../crypto/crypto-service';

export const VAULT_CHANNEL_NAME = 'riddle-vault';
export const IDLE_CHECK_INTERVAL_MS = 10_000;

/** 其他实例收到后都会立刻本地锁定 */
export type SessionBroadcast = 'lock' | 'wrapper-changed' | 'imported';
const BROADCAST_TYPES: readonly string[] = ['lock', 'wrapper-changed', 'imported'];

export interface VaultSessionOptions {
  /** 返回当前自动锁定的毫秒数,0 表示 Never。每次检查都会调用,所以设置改了立即生效 */
  getTimeoutMs?: () => number;
  channelName?: string;
  /** 测试时注入假时钟 */
  now?: () => number;
}

export class VaultSession {
  private key: CryptoKey | null = null;
  private keyId: Uint8Array | null = null;
  private epoch = 0;
  private lastActivity = 0;

  private readonly subscribers = new Set<() => void>();
  private readonly channel: BroadcastChannel | null;
  private readonly getTimeoutMs: () => number;
  private readonly now: () => number;

  private idleTimer: ReturnType<typeof setInterval> | null = null;
  private visibilityCleanup: (() => void) | null = null;

  constructor(options: VaultSessionOptions = {}) {
    this.getTimeoutMs = options.getTimeoutMs ?? (() => DEFAULT_AUTO_LOCK_TIMEOUT_MS);
    this.now = options.now ?? Date.now;

    this.channel =
      typeof BroadcastChannel === 'undefined'
        ? null
        : new BroadcastChannel(options.channelName ?? VAULT_CHANNEL_NAME);
    if (this.channel) {
      this.channel.onmessage = (event: MessageEvent) => {
        // 只做本地锁定,不再广播
        if (BROADCAST_TYPES.includes(event.data?.type)) this.lockLocal();
      };
    }
  }

  // —— 订阅,供 useSyncExternalStore 使用。箭头函数保证引用稳定 ——————————

  subscribe = (callback: () => void): (() => void) => {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  };

  getEpoch = (): number => this.epoch;

  isOpen(): boolean {
    return this.key !== null;
  }

  // —— 打开与锁定 ————————————————————————————————————————

  /**
   * key 必须是 extractable:false 导入的。
   * expectedEpoch:调用方在开始(比如跑 KDF)之前读到的 epoch。如果期间会话被锁定过,
   * 说明这次结果可能已经过期,拒绝打开。
   */
  open(key: CryptoKey, keyId: Uint8Array, options: { expectedEpoch?: number } = {}): void {
    if (key.extractable) throw new TypeError('Session key must not be extractable');
    if (keyId.length !== KEY_ID_LENGTH) throw new TypeError('Invalid keyId length');
    if (options.expectedEpoch !== undefined && options.expectedEpoch !== this.epoch) {
      throw new VaultLockedError();
    }

    this.key = key;
    this.keyId = keyId.slice();
    this.lastActivity = this.now();
    this.epoch++;
    this.notify();
  }

  /** 用户点击或超时触发:本地锁定并通知其他实例 */
  lock(): void {
    this.lockLocal();
    this.channel?.postMessage({ type: 'lock' } satisfies { type: SessionBroadcast });
  }

  /**
   * 只清本地,不广播。收到广播时调用。
   * 即使已经是锁定状态也递增 epoch:让正在进行的异步操作(例如解锁中的 KDF)失效。
   */
  lockLocal(): void {
    this.key = null;
    this.keyId = null;
    this.lastActivity = 0;
    this.epoch++;
    this.notify();
  }

  /** 改主密码、Recovery、KDF 重包装提交之后调用 wrapper-changed;覆盖导入提交之后调用 imported */
  announce(type: 'wrapper-changed' | 'imported'): void {
    this.channel?.postMessage({ type } satisfies { type: SessionBroadcast });
  }

  // —— 读取 ————————————————————————————————————————————

  /** 未打开时抛 VaultLockedError。服务方法开头调用,之后每次 await 都要 assertEpoch */
  requireKey(): { key: CryptoKey; keyId: Uint8Array; epoch: number } {
    if (!this.key || !this.keyId) throw new VaultLockedError();
    return { key: this.key, keyId: this.keyId.slice(), epoch: this.epoch };
  }

  /** await 之后调用:epoch 变了说明期间被锁定过,丢弃结果 */
  assertEpoch(epoch: number): void {
    if (epoch !== this.epoch) throw new VaultLockedError();
  }

  // —— 自动锁定 ————————————————————————————————————————

  /** 有效活动:按键、点击、Vault 内的查看/编辑。渲染、轮询、自动刷新不要调用 */
  touch(): void {
    if (this.key) this.lastActivity = this.now();
  }

  /** 对比时间戳而不是依赖 setTimeout 的精度:系统休眠时计时器可能不推进 */
  checkIdle(): void {
    if (!this.key) return;
    const timeout = this.getTimeoutMs();
    if (timeout > 0 && this.now() - this.lastActivity >= timeout) this.lock();
  }

  /** 每隔 intervalMs 检查一次,并在页面重新可见时立即检查一次 */
  startIdleWatch(intervalMs: number = IDLE_CHECK_INTERVAL_MS): void {
    this.stopIdleWatch();
    this.idleTimer = setInterval(() => this.checkIdle(), intervalMs);

    if (typeof document !== 'undefined') {
      const onVisible = () => {
        // 回调里不 await,只调同步的 checkIdle
        if (document.visibilityState === 'visible') this.checkIdle();
      };
      document.addEventListener('visibilitychange', onVisible);
      this.visibilityCleanup = () => document.removeEventListener('visibilitychange', onVisible);
    }
  }

  stopIdleWatch(): void {
    if (this.idleTimer !== null) clearInterval(this.idleTimer);
    this.idleTimer = null;
    this.visibilityCleanup?.();
    this.visibilityCleanup = null;
  }

  /** 页面卸载或测试结束时调用。清本地会话,不广播 */
  dispose(): void {
    this.stopIdleWatch();
    this.lockLocal();
    this.subscribers.clear();
    if (this.channel) {
      this.channel.onmessage = null;
      this.channel.close();
    }
  }

  private notify(): void {
    // 一个订阅者抛错不能让其他订阅者收不到锁定通知
    for (const callback of [...this.subscribers]) {
      try {
        callback();
      } catch {
        console.error('Vault session subscriber failed');
      }
    }
  }
}

/**
 * 把按键和点击接到 session.touch()。返回清理函数。
 * 只监听 keydown 和 pointerdown,不监听 scroll、mousemove 这类可能被页面自动触发的事件。
 */
export function trackActivity(
  session: VaultSession,
  target: EventTarget = window
): () => void {
  const handler = () => session.touch();
  const events = ['keydown', 'pointerdown'] as const;
  for (const name of events) target.addEventListener(name, handler, { passive: true, capture: true });
  return () => {
    for (const name of events) target.removeEventListener(name, handler, { capture: true });
  };
}
