/**
 * 解密后的明文放在这里,而且只放在这里。技术方案 §4.4 第 4 条。
 *
 * 为什么要有这个类:如果每个页面都把解密结果放进自己的 useState,锁定时就得指望每个组件
 * 都记得清掉,漏一个就是漏明文。这里集中成一份,组件只读它,不自己存副本。
 *
 * 它订阅 Session:会话 epoch 一变(锁定、被别的面板广播锁定、重新打开),就在**同一次通知里**
 * 同步清空。Session 是先通知 store(构造时订阅),再通知 React 组件,所以组件重新渲染时
 * 读到的已经是空的。
 *
 * 在途的请求有两道防线:
 *   - epoch:请求开始时记下 epoch,返回时对不上说明期间锁定过,结果直接丢弃;
 *   - 请求序号:连续点两条记录时,先发出的那个即使后返回,也不会盖掉后发出的。
 *
 * 这里不做的事:不缓存搜索词(搜索词只放组件 state,见 §6.2),不持久化任何东西。
 */
import type { VaultRecordInput, VaultSecret, VaultSummary } from '../types';
import type { VaultService } from './vault-service';
import type { VaultSession } from './vault-session';

export interface VaultStoreState {
  /** 列表项(只有标题等 summary 段)。null = 还没加载,或已作废 */
  readonly summaries: readonly VaultSummary[] | null;
  /** 当前打开的那一条的完整明文。只有详情页和编辑页在用,离开即清除 */
  readonly secret: VaultSecret | null;
}

const EMPTY: VaultStoreState = Object.freeze({ summaries: null, secret: null });

export class VaultStore {
  private state: VaultStoreState = EMPTY;
  private readonly listeners = new Set<() => void>();
  private readonly unsubscribeSession: () => void;
  private epoch: number;
  private summariesRequest = 0;
  private secretRequest = 0;

  constructor(
    private readonly session: VaultSession,
    private readonly service: VaultService
  ) {
    this.epoch = session.getEpoch();
    // 必须在构造时就订阅:这样它排在所有 React 组件的订阅前面,锁定时先于它们清空
    this.unsubscribeSession = session.subscribe(() => this.onSessionChange());
  }

  // —— 给 useSyncExternalStore 用。箭头函数保证引用稳定;没有变化时 getState 返回同一个对象 ——

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getState = (): VaultStoreState => this.state;

  // —— 读取 ————————————————————————————————————————————

  /** 重新加载列表。会话未打开时抛 VaultLockedError;过期的结果静默丢弃 */
  async loadSummaries(): Promise<void> {
    const epoch = this.session.getEpoch();
    const request = ++this.summariesRequest;

    const summaries = await this.service.listSummaries();

    if (epoch !== this.session.getEpoch() || request !== this.summariesRequest) return;
    this.setState({ summaries });
  }

  /** 加载一条记录的完整明文。记录不存在抛 NotFoundError;过期的结果静默丢弃 */
  async loadSecret(id: string): Promise<void> {
    const epoch = this.session.getEpoch();
    const request = ++this.secretRequest;

    const secret = await this.service.getSecret(id);

    if (epoch !== this.session.getEpoch() || request !== this.secretRequest) return;
    this.setState({ secret });
  }

  /** 详情页、编辑页卸载时调用。让还在途中的 loadSecret 也作废 */
  clearSecret(): void {
    this.secretRequest++;
    if (this.state.secret !== null) this.setState({ secret: null });
  }

  /** 让列表作废,下次进列表页会重新加载。在途的加载也作废 */
  invalidate(): void {
    this.summariesRequest++;
    this.secretRequest++;
    this.reset();
  }

  // —— 写入:写完让缓存作废,避免页面读到旧的 ——————————————————

  async createRecord(input: VaultRecordInput): Promise<string> {
    const id = await this.service.createRecord(input);
    this.invalidate();
    return id;
  }

  async updateRecord(id: string, input: VaultRecordInput): Promise<void> {
    await this.service.updateRecord(id, input);
    this.invalidate();
  }

  async deleteRecord(id: string): Promise<void> {
    await this.service.deleteRecord(id);
    this.invalidate();
  }

  dispose(): void {
    this.unsubscribeSession();
    this.listeners.clear();
    this.reset(false);
  }

  // —— 内部 ————————————————————————————————————————————

  private onSessionChange(): void {
    const epoch = this.session.getEpoch();
    if (epoch === this.epoch) return;
    this.epoch = epoch;
    // 不管这次是锁定还是重新打开:旧会话的数据不能带到新会话里。
    // 在途的请求不用在这里作废,它们返回时会拿自己开始时的 epoch 对比
    this.reset();
  }

  private reset(notify = true): void {
    if (this.state === EMPTY) return;
    this.state = EMPTY;
    if (notify) this.emit();
  }

  private setState(patch: Partial<VaultStoreState>): void {
    this.state = Object.freeze({ ...this.state, ...patch });
    this.emit();
  }

  private emit(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch {
        // 固定文案,不带错误内容。一个监听者抛错不能让其他监听者收不到"已清空"的通知
        console.error('Vault store listener failed');
      }
    }
  }
}
