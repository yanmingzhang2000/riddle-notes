import { afterEach, describe, expect, test, vi } from 'vitest';
import { NotFoundError, VaultLockedError } from '../../src/vault/crypto/errors';
import type { VaultService } from '../../src/vault/services/vault-service';
import { VaultStore } from '../../src/vault/services/vault-store';
import {
  PASSWORD,
  createGate,
  createInitializedVault,
  createTestVault,
  disposeTestVaults,
} from '../helpers/vault';

const stores: VaultStore[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const store of stores.splice(0)) store.dispose();
  await disposeTestVaults();
});

const SECRET_A = 'sk-AAA-plaintext-marker';
const SECRET_B = 'pw-BBB-plaintext-marker';

/** 已初始化、会话打开、库里有两条记录,store 还没加载任何东西 */
async function setup() {
  const vault = await createInitializedVault();
  const store = new VaultStore(vault.session, vault.service);
  stores.push(store);
  const a = await vault.service.createRecord({
    type: 'api_key',
    title: 'OpenAI',
    secret: SECRET_A,
    tags: ['ai'],
  });
  const b = await vault.service.createRecord({
    type: 'password',
    title: 'Bank',
    secret: SECRET_B,
    username: 'me',
  });
  return { ...vault, store, a, b };
}

/** 把 service.getSecret 包一层:真正解密完成后再停在门口,让测试能在"结果已算好、还没写回"时锁定 */
function holdGetSecretAfterDecrypt(service: VaultService) {
  const real = service.getSecret.bind(service);
  const reached = createGate();
  const proceed = createGate();
  vi.spyOn(service, 'getSecret').mockImplementation(async id => {
    const result = await real(id);
    reached.release();
    await proceed.wait();
    return result;
  });
  return { reached: reached.wait, proceed: proceed.release };
}

/** 读 session 当前有多少订阅者,用来确认 dispose 真的摘掉了订阅(私有字段,只在测试里看一眼) */
function subscriberCount(session: unknown): number {
  return (session as { subscribers: Set<unknown> }).subscribers.size;
}

describe('读取', () => {
  test('初始状态是空的', async () => {
    const { store } = await setup();
    expect(store.getState().summaries).toBeNull();
    expect(store.getState().secret).toBeNull();
  });

  test('loadSummaries 只填列表,不带任何 secret 段内容', async () => {
    const { store } = await setup();

    await store.loadSummaries();

    const { summaries, secret } = store.getState();
    expect(summaries?.map(s => s.title).sort()).toEqual(['Bank', 'OpenAI']);
    expect(secret).toBeNull();
    const serialized = JSON.stringify(summaries);
    expect(serialized).not.toContain(SECRET_A);
    expect(serialized).not.toContain(SECRET_B);
  });

  test('loadSecret 填入完整明文', async () => {
    const { store, a } = await setup();

    await store.loadSecret(a);

    expect(store.getState().secret).toMatchObject({ id: a, title: 'OpenAI', secret: SECRET_A });
  });

  test('记录不存在抛 NotFoundError,状态不变', async () => {
    const { store } = await setup();

    await expect(store.loadSecret('no-such-id')).rejects.toBeInstanceOf(NotFoundError);

    expect(store.getState().secret).toBeNull();
  });

  test('会话未打开时 loadSummaries / loadSecret 抛 VaultLockedError', async () => {
    const { store, session, a } = await setup();
    session.lock();

    await expect(store.loadSummaries()).rejects.toBeInstanceOf(VaultLockedError);
    await expect(store.loadSecret(a)).rejects.toBeInstanceOf(VaultLockedError);

    expect(store.getState().summaries).toBeNull();
    expect(store.getState().secret).toBeNull();
  });
});

describe('锁定时清空', () => {
  test('session.lock() 返回的那一刻,明文和列表就已经没了(同步,不等任何 await)', async () => {
    const { store, session, a } = await setup();
    await store.loadSummaries();
    await store.loadSecret(a);
    expect(store.getState().secret?.secret).toBe(SECRET_A);

    session.lock();
    // 这里故意不 await 任何东西

    expect(store.getState().secret).toBeNull();
    expect(store.getState().summaries).toBeNull();
  });

  test('组件订阅 session 收到锁定通知时,读到的 store 已经是空的(store 先于组件被通知)', async () => {
    const { store, session, a } = await setup();
    await store.loadSecret(a);
    // 模拟 React 组件:store 构造之后才订阅 session
    const seenAtNotification: Array<string | null> = [];
    session.subscribe(() => seenAtNotification.push(store.getState().secret?.secret ?? null));

    session.lock();

    expect(seenAtNotification).toEqual([null]);
  });

  test('另一个面板广播锁定,本面板的明文也被清掉', async () => {
    const ctx = await setup();
    const { store, a } = ctx;
    await store.loadSecret(a);
    await store.loadSummaries();
    // 另一个 Side Panel:同一个库、同一个频道
    const peer = createTestVault({ peerOf: ctx });
    await peer.service.unlockWithMasterPassword(PASSWORD);

    peer.session.lock();

    await vi.waitFor(() => expect(store.getState().secret).toBeNull());
    expect(store.getState().summaries).toBeNull();
  });

  test('锁定后再次解锁,锁定前的数据不会重新出现', async () => {
    const { store, session, service, a } = await setup();
    await store.loadSummaries();
    await store.loadSecret(a);
    session.lock();

    await service.unlockWithMasterPassword(PASSWORD);

    expect(session.isOpen()).toBe(true);
    expect(store.getState().secret).toBeNull();
    expect(store.getState().summaries).toBeNull();
  });

  test('已经是空的时候再锁定,不会白白通知订阅者', async () => {
    const { store, session } = await setup();
    const listener = vi.fn();
    store.subscribe(listener);

    session.lock();
    session.lock();

    expect(listener).not.toHaveBeenCalled();
  });

  test('有数据时锁定,订阅者恰好被通知一次', async () => {
    const { store, session, a } = await setup();
    await store.loadSummaries();
    await store.loadSecret(a);
    const listener = vi.fn();
    store.subscribe(listener);

    session.lock();

    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('在途请求不能在锁定后写回', () => {
  test('loadSecret 解密完成后、写回之前被锁定:结果丢弃,状态保持为空', async () => {
    const { store, session, service, a } = await setup();
    const hold = holdGetSecretAfterDecrypt(service);

    const pending = store.loadSecret(a);
    await hold.reached(); // 明文已经在内存里了
    session.lock();
    hold.proceed();
    await pending;

    expect(store.getState().secret).toBeNull();
  });

  test('loadSummaries 同理', async () => {
    const { store, session, service } = await setup();
    const real = service.listSummaries.bind(service);
    const reached = createGate();
    const proceed = createGate();
    vi.spyOn(service, 'listSummaries').mockImplementation(async () => {
      const result = await real();
      reached.release();
      await proceed.wait();
      return result;
    });

    const pending = store.loadSummaries();
    await reached.wait();
    session.lock();
    proceed.release();
    await pending;

    expect(store.getState().summaries).toBeNull();
  });

  test('被别的面板广播锁定,在途结果同样丢弃', async () => {
    const ctx = await setup();
    const { store, session, service, a } = ctx;
    const peer = createTestVault({ peerOf: ctx });
    await peer.service.unlockWithMasterPassword(PASSWORD);
    const hold = holdGetSecretAfterDecrypt(service);

    const pending = store.loadSecret(a);
    await hold.reached();
    peer.session.lock();
    await vi.waitFor(() => expect(session.isOpen()).toBe(false));
    hold.proceed();
    await pending;

    expect(store.getState().secret).toBeNull();
  });

  test('锁定后又很快解锁(epoch 已经变了):旧会话的在途结果仍然丢弃', async () => {
    const { store, session, service, a } = await setup();
    const hold = holdGetSecretAfterDecrypt(service);

    const pending = store.loadSecret(a);
    await hold.reached();
    session.lock();
    await service.unlockWithMasterPassword(PASSWORD); // 会话又是打开的了
    expect(session.isOpen()).toBe(true);
    hold.proceed();
    await pending;

    expect(store.getState().secret).toBeNull();
  });

  test('连续加载两条:先发出的后返回,也不会盖掉后发出的', async () => {
    const { store, service, a, b } = await setup();
    const real = service.getSecret.bind(service);
    const firstGate = createGate();
    vi.spyOn(service, 'getSecret').mockImplementation(async id => {
      const result = await real(id);
      if (id === a) await firstGate.wait(); // a 慢
      return result;
    });

    const first = store.loadSecret(a);
    const second = store.loadSecret(b);
    await second;
    expect(store.getState().secret?.id).toBe(b);

    firstGate.release();
    await first;

    expect(store.getState().secret?.id).toBe(b);
  });

  test('loadSummaries 连续调用:先发出的后返回,不会盖掉后发出的', async () => {
    const { store, service } = await setup();
    const real = service.listSummaries.bind(service);
    const firstGate = createGate();
    let calls = 0;
    vi.spyOn(service, 'listSummaries').mockImplementation(async () => {
      const n = ++calls;
      const result = await real();
      if (n === 1) {
        await firstGate.wait();
        return result.slice(0, 1); // 旧结果,故意和新结果不同
      }
      return result;
    });

    const first = store.loadSummaries();
    const second = store.loadSummaries();
    await second;
    expect(store.getState().summaries).toHaveLength(2);

    firstGate.release();
    await first;

    expect(store.getState().summaries).toHaveLength(2);
  });

  test('离开详情页(clearSecret)后,还没返回的 loadSecret 不会再把明文放回来', async () => {
    const { store, service, a } = await setup();
    const hold = holdGetSecretAfterDecrypt(service);

    const pending = store.loadSecret(a);
    await hold.reached();
    store.clearSecret();
    hold.proceed();
    await pending;

    expect(store.getState().secret).toBeNull();
  });
});

describe('clearSecret / invalidate', () => {
  test('clearSecret 只清明文,列表保留', async () => {
    const { store, a } = await setup();
    await store.loadSummaries();
    await store.loadSecret(a);

    store.clearSecret();

    expect(store.getState().secret).toBeNull();
    expect(store.getState().summaries).toHaveLength(2);
  });

  test('clearSecret 在没有明文时不通知订阅者', async () => {
    const { store } = await setup();
    const listener = vi.fn();
    store.subscribe(listener);

    store.clearSecret();

    expect(listener).not.toHaveBeenCalled();
  });

  test('invalidate 让列表和明文都作废', async () => {
    const { store, a } = await setup();
    await store.loadSummaries();
    await store.loadSecret(a);

    store.invalidate();

    expect(store.getState().summaries).toBeNull();
    expect(store.getState().secret).toBeNull();
  });

  test('invalidate 也让在途的明文加载作废', async () => {
    const { store, service, a } = await setup();
    const hold = holdGetSecretAfterDecrypt(service);

    const pending = store.loadSecret(a);
    await hold.reached();
    store.invalidate();
    hold.proceed();
    await pending;

    expect(store.getState().secret).toBeNull();
  });

  test('invalidate 也让在途的列表加载作废', async () => {
    const { store, service } = await setup();
    const real = service.listSummaries.bind(service);
    const reached = createGate();
    const proceed = createGate();
    vi.spyOn(service, 'listSummaries').mockImplementation(async () => {
      const result = await real();
      reached.release();
      await proceed.wait();
      return result;
    });

    const pending = store.loadSummaries();
    await reached.wait();
    store.invalidate();
    proceed.release();
    await pending;

    expect(store.getState().summaries).toBeNull();
  });
});

describe('写入包装', () => {
  test('createRecord 返回 id,并让旧列表作废;重新加载后能看到新记录', async () => {
    const { store } = await setup();
    await store.loadSummaries();
    expect(store.getState().summaries).toHaveLength(2);

    const id = await store.createRecord({ type: 'secure_note', title: 'Note', secret: 'n' });

    expect(typeof id).toBe('string');
    expect(store.getState().summaries).toBeNull();
    await store.loadSummaries();
    expect(store.getState().summaries?.map(s => s.id)).toContain(id);
  });

  test('updateRecord 让缓存的明文和列表都作废,重新加载后是新内容', async () => {
    const { store, a } = await setup();
    await store.loadSummaries();
    await store.loadSecret(a);

    await store.updateRecord(a, { type: 'api_key', title: 'OpenAI v2', secret: 'sk-new' });

    expect(store.getState().secret).toBeNull();
    expect(store.getState().summaries).toBeNull();
    await store.loadSecret(a);
    expect(store.getState().secret).toMatchObject({ title: 'OpenAI v2', secret: 'sk-new' });
  });

  test('deleteRecord 之后,旧列表和已删记录的明文立刻消失,重新加载后列表里没有这一条', async () => {
    const { store, a } = await setup();
    await store.loadSummaries();
    await store.loadSecret(a);
    expect(store.getState().secret?.secret).toBe(SECRET_A);

    await store.deleteRecord(a);

    // 删完立刻检查:不能靠"之后会重新加载"来掩盖旧缓存还在
    expect(store.getState().summaries).toBeNull();
    expect(store.getState().secret).toBeNull();
    await store.loadSummaries();
    expect(store.getState().summaries?.map(s => s.id)).not.toContain(a);
    expect(store.getState().summaries).toHaveLength(1);
    await expect(store.loadSecret(a)).rejects.toBeInstanceOf(NotFoundError);
  });

  test('写入失败时不清缓存,错误原样抛出', async () => {
    const { store, a } = await setup();
    await store.loadSummaries();
    await store.loadSecret(a);

    await expect(
      store.updateRecord('no-such-id', { type: 'api_key', title: 'x', secret: 'y' })
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(store.getState().summaries).toHaveLength(2);
    expect(store.getState().secret?.id).toBe(a);
  });
});

describe('订阅与快照', () => {
  test('没有变化时 getState 返回同一个对象(useSyncExternalStore 的要求)', async () => {
    const { store } = await setup();
    expect(store.getState()).toBe(store.getState());

    await store.loadSummaries();
    const afterLoad = store.getState();
    expect(store.getState()).toBe(afterLoad);
  });

  test('状态变化时换成新对象,旧对象不被改动', async () => {
    const { store, a } = await setup();
    await store.loadSummaries();
    const before = store.getState();

    await store.loadSecret(a);
    const after = store.getState();

    expect(after).not.toBe(before);
    expect(before.secret).toBeNull();
    expect(Object.isFrozen(after)).toBe(true);
  });

  test('subscribe 返回的函数能取消订阅', async () => {
    const { store } = await setup();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    await store.loadSummaries();
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    store.invalidate();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test('subscribe / getState 脱离 store 单独调用也能工作(React 就是这样调用它们的)', async () => {
    const { store } = await setup();
    const { subscribe, getState } = store; // 解构后 this 丢失
    const listener = vi.fn();

    const unsubscribe = subscribe(listener);
    await store.loadSummaries();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(getState().summaries).toHaveLength(2);
    unsubscribe();
  });

  test('subscribe / getState 每次取到的是同一个函数', async () => {
    const { store } = await setup();
    expect(store.subscribe).toBe(store.subscribe);
    expect(store.getState).toBe(store.getState);
  });

  test('一个订阅者抛错,不影响其他订阅者收到"已清空"', async () => {
    const { store, session, a } = await setup();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await store.loadSecret(a);
    const after = vi.fn();
    store.subscribe(() => {
      throw new Error(`boom ${SECRET_A}`);
    });
    store.subscribe(after);

    session.lock();

    expect(after).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).toContain('listener failed');
    expect(logged).not.toContain(SECRET_A); // 错误内容不进日志
  });
});

describe('dispose', () => {
  test('dispose 清空状态并停止响应 session', async () => {
    const { store, session, a } = await setup();
    await store.loadSecret(a);
    const listener = vi.fn();
    store.subscribe(listener);

    store.dispose();
    expect(store.getState().secret).toBeNull();

    session.lock();
    expect(listener).not.toHaveBeenCalled();
  });

  test('dispose 真的把 store 从 session 的订阅里摘掉了(不会随会话反复开关而泄漏)', async () => {
    const { session, service } = await setup();
    const before = subscriberCount(session);

    const extra = new VaultStore(session, service);
    expect(subscriberCount(session)).toBe(before + 1);

    extra.dispose();
    expect(subscriberCount(session)).toBe(before);
  });
});
