/**
 * Vault 的组合根:把 Session、Service、Store 接在一起,并负责"让自动锁定真的生效"的那几个监听。
 *
 * 为什么单独放一个文件:
 *   - Session 和 Service 只管逻辑,不碰 window;谁来监听按键、谁来在页面销毁时锁定,必须有一个地方负责;
 *   - 测试可以注入自己的 session / service,不用碰真实的 IndexedDB 和 BroadcastChannel 频道。
 *
 * 隔离:这个文件只能被 Side Panel 的页面引用,不能出现在 background / content script 的 import 图里
 * (tests/vault/isolation.test.ts 会检查)。
 */
import { VaultService } from './services/vault-service';
import { VaultSession, trackActivity } from './services/vault-session';
import { VaultStore } from './services/vault-store';

export interface VaultRuntime {
  readonly session: VaultSession;
  readonly service: VaultService;
  readonly store: VaultStore;
  /**
   * 开始监听:空闲检查、按键/点击计为活动、页面销毁时本地锁定。返回停止函数。
   * 幂等:已经在运行时再调用不会重复挂监听,返回的仍是同一个停止函数。
   * 可以反复启停(React StrictMode 会在开发模式下先 mount、cleanup、再 mount)。
   */
  start(): () => void;
}

export interface VaultRuntimeOptions {
  session?: VaultSession;
  service?: VaultService;
  store?: VaultStore;
}

export function createVaultRuntime(options: VaultRuntimeOptions = {}): VaultRuntime {
  const session = options.session ?? new VaultSession();
  const service = options.service ?? new VaultService({ session });
  const store = options.store ?? new VaultStore(session, service);

  let stopRunning: (() => void) | null = null;

  const start = (): (() => void) => {
    if (stopRunning) return stopRunning;

    session.startIdleWatch();
    const stopActivity = trackActivity(session);
    // Side Panel 被关闭时页面应当被销毁,内存随之消失。这个假设没有在真实 Chrome 里验证过(技术方案 R4),
    // 所以多做一层:页面一旦收到 pagehide 就把本地会话清掉。只清本地,不广播:
    // 关掉一个面板不应该把另一个面板也锁了。
    const onPageHide = () => session.lockLocal();
    window.addEventListener('pagehide', onPageHide);

    const stop = () => {
      // 只有当前这一次的 stop 才有效,避免过期的停止函数把后来重新启动的监听停掉
      if (stopRunning !== stop) return;
      stopRunning = null;
      session.stopIdleWatch();
      stopActivity();
      window.removeEventListener('pagehide', onPageHide);
    };
    stopRunning = stop;
    return stop;
  };

  return { session, service, store, start };
}

let defaultRuntime: VaultRuntime | null = null;

/** 真实环境用的单例:真实的 IndexedDB(vaultDb)和默认的广播频道 */
export function getDefaultVaultRuntime(): VaultRuntime {
  defaultRuntime ??= createVaultRuntime();
  return defaultRuntime;
}
