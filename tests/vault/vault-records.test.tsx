/**
 * 列表、详情、编辑三个页面。
 *
 * 用真实的 VaultService 和内存里的 IndexedDB。重点是安全相关的行为:
 * 列表只碰 summary、详情默认不渲染明文、离开和锁定时明文立刻从页面和 store 里消失、
 * 搜索词不进 URL 和存储、编辑页不会把"当前类型没有的字段"存进去、记录损坏时的文案不说"密码错误"。
 *
 * 注意:这里没有路由守卫。"锁定时整个页面被卸载"那部分由守卫负责,在 vault-routing 测试里验证。
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useLayoutEffect, type ReactNode } from 'react';
import { NotFoundError } from '../../src/vault/crypto/errors';
import { VaultRuntimeProvider } from '../../src/vault/hooks/VaultRuntimeProvider';
import VaultDetail from '../../src/vault/pages/VaultDetail';
import VaultEditor from '../../src/vault/pages/VaultEditor';
import VaultList from '../../src/vault/pages/VaultList';
import { createVaultRuntime, type VaultRuntime } from '../../src/vault/runtime';
import { SECRET_PLACEHOLDER } from '../../src/vault/components/SecretField';
import {
  PASSWORD,
  createGate,
  createInitializedVault,
  createTestVault,
  disposeTestVaults,
  type TestVault,
} from '../helpers/vault';

vi.setConfig({ testTimeout: 15_000 });

const runtimes: VaultRuntime[] = [];

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  for (const runtime of runtimes.splice(0)) runtime.store.dispose();
  await disposeTestVaults();
  localStorage.clear();
  sessionStorage.clear();
});

const MARK = {
  openai: 'sk-OPENAI-plaintext-marker-1',
  bank: 'bank-pw-plaintext-marker-2',
  pg: 'postgres://admin:plaintext-marker-3@db.example.com/prod',
  note: 'note-line-one-marker-4\nnote-line-two-marker-4',
  username: 'zhang-username-marker-5',
  url: 'https://bank.example/url-marker-6',
  notes: 'free-text-notes-marker-7',
};

async function seed(vault: TestVault) {
  const { service } = vault;
  return {
    openai: await service.createRecord({
      type: 'api_key',
      title: 'OpenAI',
      secret: MARK.openai,
      url: 'https://api.openai.com',
      tags: ['AI', '工作'],
    }),
    bank: await service.createRecord({
      type: 'password',
      title: '银行',
      secret: MARK.bank,
      username: MARK.username,
      url: MARK.url,
      notes: MARK.notes,
      tags: ['个人'],
    }),
    pg: await service.createRecord({
      type: 'database',
      title: 'Postgres 生产库',
      secret: MARK.pg,
      username: 'admin',
      url: 'db.example.com',
    }),
    note: await service.createRecord({ type: 'secure_note', title: '恢复码', secret: MARK.note }),
  };
}

/** 把某条记录的某一段密文改坏一个字节,模拟数据损坏 */
async function corrupt(vault: TestVault, id: string, segment: 'summary' | 'secret') {
  const row = (await vault.db.vaultRecords.get(id))!;
  row[segment].data[0] ^= 1;
  await vault.db.vaultRecords.put(row);
}

function Probe() {
  const location = useLocation();
  return <div data-testid="loc">{location.pathname + location.search}</div>;
}
const loc = () => screen.getByTestId('loc').textContent;

/**
 * 每次提交(DOM 刚更新完、passive effect 还没执行)时记一份页面文本。
 * act() 会把 effect 全部刷完才返回,普通断言看不到"路由变了、清理还没跑"的那一帧,这里能看到。
 */
function CommitSnapshots({ into }: { into: string[] }) {
  useLocation(); // 路由变化时和页面在同一次提交里重新渲染
  useLayoutEffect(() => {
    into.push(document.body.textContent ?? '');
  });
  return null;
}

function Go({ to }: { to: string }) {
  const navigate = useNavigate();
  return <button onClick={() => navigate(to)}>{`go ${to}`}</button>;
}

function mountVault(vault: TestVault, entry: string, extra?: ReactNode) {
  const runtime = createVaultRuntime({ session: vault.session, service: vault.service });
  runtimes.push(runtime);
  const result = render(
    <VaultRuntimeProvider runtime={runtime}>
      <MemoryRouter initialEntries={[entry]}>
        <Probe />
        {extra}
        <Routes>
          <Route path="/vault" element={<VaultList />} />
          <Route path="/vault/new" element={<VaultEditor />} />
          <Route path="/vault/:id" element={<VaultDetail />} />
          <Route path="/vault/:id/edit" element={<VaultEditor />} />
          <Route path="*" element={<div>other</div>} />
        </Routes>
      </MemoryRouter>
    </VaultRuntimeProvider>
  );
  return { runtime, ...result };
}

const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const html = () => document.body.innerHTML;

/** 保存新记录之后会进入 /vault/<新 id>。注意 /vault/new 本身也长得像 /vault/<id>,要排除掉 */
async function savedRecordId(): Promise<string> {
  await waitFor(() => expect(loc()).toMatch(/^\/vault\/(?!new$)[^/]+$/));
  return loc()!.split('/')[2];
}

// ===========================================================================
describe('VaultList', () => {
  test('按类型分组,顺序固定,每组带数量', async () => {
    const vault = await createInitializedVault();
    await seed(vault);
    mountVault(vault, '/vault');

    await screen.findByText('OpenAI');

    const labels = screen.getAllByRole('region').map(region => region.getAttribute('aria-label'));
    expect(labels).toEqual(['API Key', '账号密码', '数据库', '安全笔记']);
    expect(screen.getByRole('region', { name: '账号密码' })).toHaveTextContent('银行');
    expect(screen.getByRole('region', { name: '数据库' })).toHaveTextContent('Postgres 生产库');
    // 标题行就是"类型名 + 数量",用整行匹配,不会被日期里的数字误中
    expect(screen.getByRole('heading', { name: /API Key/ })).toHaveTextContent(/^API Key1$/);
    expect(screen.getByRole('heading', { name: /安全笔记/ })).toHaveTextContent(/^安全笔记1$/);
  });

  test('只显示 summary:不读取任何记录的 secret,页面里没有任何明文、用户名、网址或备注', async () => {
    const vault = await createInitializedVault();
    await seed(vault);
    const getSecret = vi.spyOn(vault.service, 'getSecret');
    mountVault(vault, '/vault');

    await screen.findByText('OpenAI');

    expect(getSecret).not.toHaveBeenCalled();
    for (const marker of Object.values(MARK)) {
      for (const line of marker.split('\n')) expect(html()).not.toContain(line);
    }
    expect(screen.getByText('AI')).toBeInTheDocument(); // 标签属于 summary,可以显示
  });

  test('空保险箱:提示并给出新建入口', async () => {
    const vault = await createInitializedVault();
    mountVault(vault, '/vault');

    expect(await screen.findByText('保险箱里还没有记录。')).toBeInTheDocument();
    click('添加第一条');

    expect(loc()).toBe('/vault/new');
  });

  test('点一条进入详情;点"新建"进入新建页', async () => {
    const vault = await createInitializedVault();
    const ids = await seed(vault);
    mountVault(vault, '/vault');
    await screen.findByText('银行');

    click(/银行/);
    expect(loc()).toBe(`/vault/${ids.bank}`);
  });

  test('"新建"按钮', async () => {
    const vault = await createInitializedVault();
    mountVault(vault, '/vault');
    await screen.findByText('保险箱里还没有记录。');

    click('新建');

    expect(loc()).toBe('/vault/new');
  });

  test('搜索:按标题和标签过滤,大小写不敏感;没有匹配时提示;清空后恢复', async () => {
    const vault = await createInitializedVault();
    await seed(vault);
    mountVault(vault, '/vault');
    await screen.findByText('OpenAI');

    type('搜索保险箱', 'openai');
    expect(screen.getByText('OpenAI')).toBeInTheDocument();
    expect(screen.queryByText('银行')).toBeNull();

    type('搜索保险箱', '个人');
    expect(screen.getByText('银行')).toBeInTheDocument();
    expect(screen.queryByText('OpenAI')).toBeNull();

    type('搜索保险箱', 'zzz-no-match');
    expect(screen.getByText('没有匹配的记录。')).toBeInTheDocument();

    type('搜索保险箱', '');
    expect(screen.getByText('OpenAI')).toBeInTheDocument();
    expect(screen.getByText('银行')).toBeInTheDocument();
  });

  test('搜索词不进 URL、不进存储、不用 <form>,输入框关闭自动填充;重新进入页面是空的', async () => {
    const vault = await createInitializedVault();
    await seed(vault);
    const { container, unmount, runtime } = mountVault(vault, '/vault');
    await screen.findByText('OpenAI');

    type('搜索保险箱', 'secret-looking-keyword');

    expect(loc()).toBe('/vault');
    expect(container.querySelector('form')).toBeNull();
    expect(screen.getByLabelText('搜索保险箱')).toHaveAttribute('autocomplete', 'off');
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain('secret-looking-keyword');
    unmount();

    // 同一个 runtime 重新进入:搜索词不在 store 里,也没有被别处记住
    render(
      <VaultRuntimeProvider runtime={runtime}>
        <MemoryRouter initialEntries={['/vault']}>
          <Routes>
            <Route path="/vault" element={<VaultList />} />
          </Routes>
        </MemoryRouter>
      </VaultRuntimeProvider>
    );
    await screen.findByText('OpenAI');
    expect(screen.getByLabelText('搜索保险箱')).toHaveValue('');
  });

  test('解不开的记录:单独一组显示,不影响其他记录;有搜索词时不显示', async () => {
    const vault = await createInitializedVault();
    const ids = await seed(vault);
    await corrupt(vault, ids.note, 'summary');
    mountVault(vault, '/vault');

    await screen.findByText('OpenAI');

    const bad = screen.getByRole('region', { name: '无法读取' });
    expect(bad).toHaveTextContent('（无法读取）');
    expect(screen.getByRole('region', { name: 'API Key' })).toHaveTextContent('OpenAI');
    type('搜索保险箱', 'OpenAI');
    expect(screen.queryByRole('region', { name: '无法读取' })).toBeNull();
  });

  test('读取失败:显示错误和重试,不显示"空保险箱"', async () => {
    const vault = await createInitializedVault();
    await seed(vault);
    vi.spyOn(vault.service, 'listSummaries').mockRejectedValueOnce(new Error('db unavailable'));
    mountVault(vault, '/vault');

    expect(await screen.findByRole('alert')).toHaveTextContent('操作失败，请重试');
    expect(screen.queryByText('保险箱里还没有记录。')).toBeNull();
    expect(document.body.textContent).not.toContain('db unavailable');
    click('重试');

    expect(await screen.findByText('OpenAI')).toBeInTheDocument();
  });

  test('锁定的那一刻,页面上的标题立刻消失(store 同步清空)', async () => {
    const vault = await createInitializedVault();
    await seed(vault);
    mountVault(vault, '/vault');
    await screen.findByText('OpenAI');

    act(() => vault.session.lock());

    expect(screen.queryByText('OpenAI')).toBeNull();
    expect(screen.queryByText('银行')).toBeNull();
    expect(document.body.textContent).not.toContain('Postgres');
  });

  test('另一个面板新增了记录之后,重新进入列表能看到(每次进入都重新加载)', async () => {
    const vault = await createInitializedVault();
    await seed(vault);
    const { unmount, runtime } = mountVault(vault, '/vault');
    await screen.findByText('OpenAI');
    unmount();
    await vault.service.createRecord({ type: 'password', title: '后来加的', secret: 'x' });

    render(
      <VaultRuntimeProvider runtime={runtime}>
        <MemoryRouter initialEntries={['/vault']}>
          <Routes>
            <Route path="/vault" element={<VaultList />} />
          </Routes>
        </MemoryRouter>
      </VaultRuntimeProvider>
    );

    expect(await screen.findByText('后来加的')).toBeInTheDocument();
  });
});

// ===========================================================================
describe('VaultDetail', () => {
  test('显示标题、类型、标签、用户名、网址、备注;秘密默认隐藏,页面里没有明文', async () => {
    const vault = await createInitializedVault();
    const ids = await seed(vault);
    mountVault(vault, `/vault/${ids.bank}`);

    await screen.findByRole('heading', { name: '银行' });

    expect(screen.getByText('个人')).toBeInTheDocument();
    expect(screen.getByText(MARK.username)).toBeInTheDocument();
    expect(screen.getByText(MARK.url)).toBeInTheDocument();
    expect(screen.getByText(MARK.notes)).toBeInTheDocument();
    expect(screen.getByText(SECRET_PLACEHOLDER)).toBeInTheDocument();
    expect(html()).not.toContain(MARK.bank);
  });

  test('点"显示"出现明文,点"隐藏"之后明文从页面消失', async () => {
    const vault = await createInitializedVault();
    const ids = await seed(vault);
    mountVault(vault, `/vault/${ids.bank}`);
    await screen.findByRole('heading', { name: '银行' });

    click('显示密码');
    expect(screen.getByText(MARK.bank)).toBeInTheDocument();
    click('隐藏密码');

    expect(html()).not.toContain(MARK.bank);
  });

  test.each([
    ['openai', 'API Key', ['接口地址'], ['用户名']],
    ['bank', '密码', ['用户名', '网址'], ['接口地址']],
    ['pg', '密码或连接串', ['用户名', '主机或连接地址'], []],
    ['note', '内容', [], ['用户名', '网址', '备注']],
  ] as const)('%s:显示的字段按类型决定(%s)', async (key, secretLabel, shown, hidden) => {
    const vault = await createInitializedVault();
    const ids = await seed(vault);
    mountVault(vault, `/vault/${ids[key]}`);
    await screen.findByRole('button', { name: `显示${secretLabel}` });

    for (const label of shown) expect(screen.getByText(label)).toBeInTheDocument();
    for (const label of hidden) expect(screen.queryByText(label)).toBeNull();
  });

  test('库里存着"当前类型本来没有"的字段(例如安全笔记里有用户名、网址、备注):照样显示,不把已存的数据藏起来', async () => {
    const vault = await createInitializedVault();
    const id = await vault.service.createRecord({
      type: 'secure_note',
      title: '带了多余字段',
      secret: 'body',
      username: 'stored-username',
      url: 'stored-url',
      notes: 'stored-notes',
    });
    mountVault(vault, `/vault/${id}`);
    await screen.findByRole('button', { name: '显示内容' });

    expect(screen.getByText('stored-username')).toBeInTheDocument();
    expect(screen.getByText('stored-url')).toBeInTheDocument();
    expect(screen.getByText('stored-notes')).toBeInTheDocument();
  });

  test('安全笔记的多行内容保留换行', async () => {
    const vault = await createInitializedVault();
    const ids = await seed(vault);
    mountVault(vault, `/vault/${ids.note}`);
    await screen.findByRole('button', { name: '显示内容' });

    click('显示内容');

    expect(screen.getByText(/note-line-one-marker-4/).textContent).toBe(MARK.note);
  });

  test('离开页面(卸载):store 里的明文立刻清除', async () => {
    const vault = await createInitializedVault();
    const ids = await seed(vault);
    const { unmount, runtime } = mountVault(vault, `/vault/${ids.bank}`);
    await screen.findByRole('heading', { name: '银行' });
    expect(runtime.store.getState().secret?.secret).toBe(MARK.bank);

    unmount();

    expect(runtime.store.getState().secret).toBeNull();
  });

  test('从一条记录切到另一条:上一条的明文不再显示,"已显示"状态也复位', async () => {
    const vault = await createInitializedVault();
    const ids = await seed(vault);
    mountVault(vault, `/vault/${ids.bank}`, <Go to={`/vault/${ids.openai}`} />);
    await screen.findByRole('heading', { name: '银行' });
    click('显示密码');
    expect(screen.getByText(MARK.bank)).toBeInTheDocument();

    click(`go /vault/${ids.openai}`);
    await screen.findByRole('heading', { name: 'OpenAI' });

    expect(html()).not.toContain(MARK.bank);
    expect(html()).not.toContain(MARK.openai); // 新记录也是默认隐藏的
    expect(screen.getByText(SECRET_PLACEHOLDER)).toBeInTheDocument();
  });

  test('切到另一条、新记录还在加载的这段时间里:上一条的明文已经不在页面上(不会把别人的内容当成这一条显示)', async () => {
    const vault = await createInitializedVault();
    const ids = await seed(vault);
    const gate = createGate();
    const real = vault.service.getSecret.bind(vault.service);
    vi.spyOn(vault.service, 'getSecret').mockImplementation(async id => {
      if (id === ids.openai) await gate.wait(); // 新记录加载得很慢
      return real(id);
    });
    const snapshots: string[] = [];
    mountVault(
      vault,
      `/vault/${ids.bank}`,
      <>
        <Go to={`/vault/${ids.openai}`} />
        <CommitSnapshots into={snapshots} />
      </>
    );
    await screen.findByRole('heading', { name: '银行' });
    click('显示密码');
    expect(screen.getByText(MARK.bank)).toBeInTheDocument();
    const before = snapshots.length;

    click(`go /vault/${ids.openai}`);

    // 新记录还没回来:页面不能还停留在上一条的内容上,更不能把上一条的字段当作新记录的字段
    expect(screen.getByText('正在解密…')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(MARK.bank);
    expect(document.body.textContent).not.toContain(MARK.username);
    expect(screen.queryByRole('heading', { name: '银行' })).toBeNull();
    // 路由刚变的那一次提交(清理 effect 还没把旧明文清掉)也不能显示上一条的内容
    const afterNavigation = snapshots.slice(before);
    expect(afterNavigation.length).toBeGreaterThan(0);
    for (const text of afterNavigation) {
      expect(text).not.toContain(MARK.bank);
      expect(text).not.toContain('银行');
    }
    gate.release();
    await screen.findByRole('heading', { name: 'OpenAI' });
  });

  test('正在查看(已点显示)时锁定:明文立刻从页面消失', async () => {
    const vault = await createInitializedVault();
    const ids = await seed(vault);
    const { runtime } = mountVault(vault, `/vault/${ids.bank}`);
    await screen.findByRole('heading', { name: '银行' });
    click('显示密码');
    expect(screen.getByText(MARK.bank)).toBeInTheDocument();

    act(() => vault.session.lock());

    expect(document.body.textContent).not.toContain(MARK.bank);
    expect(document.body.textContent).not.toContain(MARK.username);
    expect(runtime.store.getState().secret).toBeNull();
  });

  test('另一个面板广播锁定:本面板正在显示的明文同样消失', async () => {
    const vault = await createInitializedVault();
    const ids = await seed(vault);
    mountVault(vault, `/vault/${ids.bank}`);
    await screen.findByRole('heading', { name: '银行' });
    click('显示密码');
    const peer = createTestVault({ peerOf: vault });
    await peer.service.unlockWithMasterPassword(PASSWORD);

    act(() => peer.session.lock());

    await waitFor(() => expect(document.body.textContent).not.toContain(MARK.bank));
  });

  test('记录不存在:提示"找不到",没有删除按钮', async () => {
    const vault = await createInitializedVault();
    mountVault(vault, '/vault/no-such-id');

    expect(await screen.findByRole('alert')).toHaveTextContent('找不到这条记录，可能已被删除');
    expect(screen.queryByRole('button', { name: /删除/ })).toBeNull();
    click('返回列表');
    expect(loc()).toBe('/vault');
  });

  test('记录解不开(密文损坏):用"记录"的措辞,不说密码错误;允许删除它', async () => {
    const vault = await createInitializedVault();
    const ids = await seed(vault);
    await corrupt(vault, ids.bank, 'secret');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mountVault(vault, `/vault/${ids.bank}`);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('这条记录无法解密，数据可能已损坏');
    expect(alert).not.toHaveTextContent('密码错误');
    click('删除这条记录');

    await waitFor(() => expect(loc()).toBe('/vault'));
    await expect(vault.service.getSecret(ids.bank)).rejects.toBeInstanceOf(NotFoundError);
  });

  test('会话已锁定时打开详情:提示已锁定,没有删除按钮', async () => {
    const vault = await createInitializedVault();
    const ids = await seed(vault);
    vault.session.lock();
    mountVault(vault, `/vault/${ids.bank}`);

    expect(await screen.findByRole('alert')).toHaveTextContent('保险箱已锁定');
    expect(screen.queryByRole('button', { name: /删除/ })).toBeNull();
  });

  test('删除:确认之后删掉并回到列表;取消确认则什么都不做', async () => {
    const vault = await createInitializedVault();
    const ids = await seed(vault);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const deleteRecord = vi.spyOn(vault.service, 'deleteRecord');
    mountVault(vault, `/vault/${ids.bank}`);
    await screen.findByRole('heading', { name: '银行' });

    click('删除');
    expect(confirm).toHaveBeenCalledTimes(1);
    // 删除是异步的:让它有机会执行完,再确认记录确实还在(否则"取消也删"的错误会被时序掩盖)
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
    });
    expect(loc()).toBe(`/vault/${ids.bank}`);
    expect((await vault.service.getSecret(ids.bank)).title).toBe('银行');
    expect(deleteRecord).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    click('删除');
    await waitFor(() => expect(loc()).toBe('/vault'));
    await expect(vault.service.getSecret(ids.bank)).rejects.toBeInstanceOf(NotFoundError);
  });

  test('删除失败:显示错误,留在原页面,记录还在', async () => {
    const vault = await createInitializedVault();
    const ids = await seed(vault);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.spyOn(vault.service, 'deleteRecord').mockRejectedValueOnce(new Error('db unavailable'));
    mountVault(vault, `/vault/${ids.bank}`);
    await screen.findByRole('heading', { name: '银行' });

    click('删除');

    expect(await screen.findByRole('alert')).toHaveTextContent('操作失败，请重试');
    expect(loc()).toBe(`/vault/${ids.bank}`);
    expect((await vault.service.getSecret(ids.bank)).title).toBe('银行');
  });

  test('"编辑"进入编辑页', async () => {
    const vault = await createInitializedVault();
    const ids = await seed(vault);
    mountVault(vault, `/vault/${ids.bank}`);
    await screen.findByRole('heading', { name: '银行' });

    click('编辑');

    expect(loc()).toBe(`/vault/${ids.bank}/edit`);
  });
});

// ===========================================================================
describe('VaultEditor', () => {
  test('新建:默认是"账号密码",有用户名、网址、备注字段;没有 <form>', async () => {
    const vault = await createInitializedVault();
    const { container } = mountVault(vault, '/vault/new');

    expect(await screen.findByLabelText('类型')).toHaveValue('password');
    for (const label of ['标题', '用户名', '密码', '网址', '备注', '标签']) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    expect(container.querySelector('form')).toBeNull();
  });

  test('换类型,字段跟着变:API Key 没有用户名;安全笔记只有标题、内容、标签,内容是多行输入', async () => {
    const vault = await createInitializedVault();
    mountVault(vault, '/vault/new');
    await screen.findByLabelText('类型');

    type('类型', 'api_key');
    expect(screen.queryByLabelText('用户名')).toBeNull();
    expect(screen.getByLabelText('API Key')).toBeInTheDocument();
    expect(screen.getByLabelText('接口地址')).toBeInTheDocument();

    type('类型', 'secure_note');
    expect(screen.getByLabelText('内容').tagName).toBe('TEXTAREA');
    for (const label of ['用户名', '网址', '接口地址', '备注']) expect(screen.queryByLabelText(label)).toBeNull();
    expect(screen.getByLabelText('标签')).toBeInTheDocument();
  });

  test('秘密输入框默认遮住,关闭自动填充;点"显示"可以看清,再点遮住', async () => {
    const vault = await createInitializedVault();
    mountVault(vault, '/vault/new');
    await screen.findByLabelText('类型');
    const input = screen.getByLabelText('密码');

    expect(input).toHaveAttribute('type', 'password');
    expect(input).toHaveAttribute('autocomplete', 'off');
    click('显示密码');
    expect(screen.getByLabelText('密码')).toHaveAttribute('type', 'text');
    click('隐藏密码');
    expect(screen.getByLabelText('密码')).toHaveAttribute('type', 'password');
  });

  test('标题和秘密都为空:两条提示一起出现,不会调用服务层', async () => {
    const vault = await createInitializedVault();
    const create = vi.spyOn(vault.service, 'createRecord');
    mountVault(vault, '/vault/new');
    await screen.findByLabelText('类型');

    click('保存');

    expect(screen.getByText('请填写标题')).toBeInTheDocument();
    expect(screen.getByText('请填写密码')).toBeInTheDocument();
    expect(screen.getByLabelText('标题')).toHaveAttribute('aria-invalid', 'true');
    expect(create).not.toHaveBeenCalled();
    expect(loc()).toBe('/vault/new');
  });

  test('只填标题不填秘密:只提示秘密,不会保存;改动之后提示消失', async () => {
    const vault = await createInitializedVault();
    const create = vi.spyOn(vault.service, 'createRecord');
    mountVault(vault, '/vault/new');
    await screen.findByLabelText('类型');
    type('标题', '只有标题');

    click('保存');
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 30)); // 给"错误地保存了"留出发生的时间
    });

    expect(screen.queryByText('请填写标题')).toBeNull();
    expect(screen.getByText('请填写密码')).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
    expect(loc()).toBe('/vault/new');
    type('密码', 'x');
    expect(screen.queryByText('请填写密码')).toBeNull();
  });

  test('只填秘密不填标题(或标题只有空格):只提示标题,不会保存', async () => {
    const vault = await createInitializedVault();
    const create = vi.spyOn(vault.service, 'createRecord');
    mountVault(vault, '/vault/new');
    await screen.findByLabelText('类型');
    type('标题', '   ');
    type('密码', 'only-secret');

    click('保存');
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 30));
    });

    expect(screen.getByText('请填写标题')).toBeInTheDocument();
    expect(screen.queryByText('请填写密码')).toBeNull();
    expect(create).not.toHaveBeenCalled();
    expect(loc()).toBe('/vault/new');
  });

  test('编辑页还在解密时就离开:在途的加载被作废,之后不会有明文留在 store 里', async () => {
    const vault = await createInitializedVault();
    const ids = await seed(vault);
    const gate = createGate();
    const real = vault.service.getSecret.bind(vault.service);
    vi.spyOn(vault.service, 'getSecret').mockImplementation(async id => {
      const result = await real(id);
      await gate.wait(); // 已经解密出来了,还没交给 store
      return result;
    });
    const { runtime, unmount } = mountVault(vault, `/vault/${ids.bank}/edit`);
    await waitFor(() => expect(vault.service.getSecret).toHaveBeenCalled());

    unmount();
    gate.release();
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 30));
    });

    expect(runtime.store.getState().secret).toBeNull();
  });

  test('路由里的记录 id 变了(React Router 复用同一个编辑组件):表单换成新记录的内容,保存的是新记录,不会拿上一条去覆盖它', async () => {
    const vault = await createInitializedVault();
    const ids = await seed(vault);
    const gate = createGate();
    const real = vault.service.getSecret.bind(vault.service);
    vi.spyOn(vault.service, 'getSecret').mockImplementation(async id => {
      if (id === ids.openai) await gate.wait(); // 新记录加载得慢,这段时间表单不能还是上一条的内容
      return real(id);
    });
    const update = vi.spyOn(vault.service, 'updateRecord');
    mountVault(vault, `/vault/${ids.bank}/edit`, <Go to={`/vault/${ids.openai}/edit`} />);
    await screen.findByDisplayValue('银行');

    click(`go /vault/${ids.openai}/edit`);

    // 新记录还没回来:上一条的表单已经不在了,并且没有"保存"按钮可以按
    expect(screen.queryByDisplayValue('银行')).toBeNull();
    expect(screen.queryByDisplayValue(MARK.bank)).toBeNull();
    expect(screen.queryByRole('button', { name: '保存' })).toBeNull();
    gate.release();
    expect(await screen.findByDisplayValue('OpenAI')).toBeInTheDocument();
    expect(screen.getByLabelText('API Key')).toHaveValue(MARK.openai);

    type('标题', 'OpenAI 改名');
    click('保存');
    await waitFor(() => expect(loc()).toBe(`/vault/${ids.openai}`));
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0]).toBe(ids.openai);
    expect(update.mock.calls[0][1]).toMatchObject({ type: 'api_key', title: 'OpenAI 改名', secret: MARK.openai });
    expect((await vault.service.getSecret(ids.bank)).title).toBe('银行'); // 银行那条没被碰
    expect((await vault.service.getSecret(ids.bank)).secret).toBe(MARK.bank);
  });

  test('保存新记录:按类型整理输入、解析标签,进入这条记录的详情,库里能解密回来', async () => {
    const vault = await createInitializedVault();
    const create = vi.spyOn(vault.service, 'createRecord');
    mountVault(vault, '/vault/new');
    await screen.findByLabelText('类型');

    type('标题', '  我的银行  ');
    type('用户名', 'zhang');
    type('密码', '  p@ss word  ');
    type('网址', 'https://bank.example');
    type('备注', '一些备注');
    type('标签', '个人, 金融，个人');
    click('保存');

    const id = await savedRecordId();
    expect(create).toHaveBeenCalledWith({
      type: 'password',
      title: '我的银行',
      secret: '  p@ss word  ',
      username: 'zhang',
      url: 'https://bank.example',
      notes: '一些备注',
      tags: ['个人', '金融'],
    });
    expect(await vault.service.getSecret(id)).toMatchObject({ title: '我的银行', secret: '  p@ss word  ', username: 'zhang' });
  });

  test('先填了用户名、网址、备注又把类型改成安全笔记:这些隐藏字段不会被保存', async () => {
    const vault = await createInitializedVault();
    mountVault(vault, '/vault/new');
    await screen.findByLabelText('类型');
    type('用户名', 'should-not-be-saved');
    type('网址', 'https://should-not-be-saved');
    type('备注', 'should-not-be-saved');

    type('类型', 'secure_note');
    type('标题', '笔记');
    type('内容', '正文');
    click('保存');

    const saved = await vault.service.getSecret(await savedRecordId());
    expect(saved.type).toBe('secure_note');
    expect(saved.username).toBeUndefined();
    expect(saved.url).toBeUndefined();
    expect(saved.notes).toBeUndefined();
  });

  test('保存进行中:按钮禁用,重复点击只创建一条', async () => {
    const vault = await createInitializedVault();
    const gate = createGate();
    const real = vault.service.createRecord.bind(vault.service);
    const create = vi.spyOn(vault.service, 'createRecord').mockImplementation(async input => {
      await gate.wait();
      return real(input);
    });
    mountVault(vault, '/vault/new');
    await screen.findByLabelText('类型');
    type('标题', 'T');
    type('密码', 'S');

    click('保存');
    await screen.findByRole('button', { name: '正在保存…' });
    fireEvent.click(screen.getByRole('button', { name: '正在保存…' }));

    expect(screen.getByRole('button', { name: '正在保存…' })).toBeDisabled();
    expect(create).toHaveBeenCalledTimes(1);
    gate.release();
    await savedRecordId();
  });

  test('保存失败:显示错误,已经填的内容还在,可以重试', async () => {
    const vault = await createInitializedVault();
    vi.spyOn(vault.service, 'createRecord').mockRejectedValueOnce(new Error('db unavailable'));
    mountVault(vault, '/vault/new');
    await screen.findByLabelText('类型');
    type('标题', '不能丢');
    type('密码', 'keep-me');

    click('保存');

    expect(await screen.findByRole('alert')).toHaveTextContent('操作失败，请重试');
    expect(screen.getByLabelText('标题')).toHaveValue('不能丢');
    expect(screen.getByLabelText('密码')).toHaveValue('keep-me');
    expect(screen.getByRole('button', { name: '保存' })).toBeEnabled();
    click('保存');
    await savedRecordId();
  });

  test('取消:新建回到列表,编辑回到详情,都不保存', async () => {
    const vault = await createInitializedVault();
    const ids = await seed(vault);
    const create = vi.spyOn(vault.service, 'createRecord');
    const update = vi.spyOn(vault.service, 'updateRecord');
    const first = mountVault(vault, '/vault/new');
    await screen.findByLabelText('类型');
    type('标题', '不会保存');
    click('取消');
    expect(loc()).toBe('/vault');
    first.unmount();

    mountVault(vault, `/vault/${ids.bank}/edit`);
    await screen.findByDisplayValue('银行');
    type('标题', '也不会保存');
    click('取消');

    expect(loc()).toBe(`/vault/${ids.bank}`);
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect((await vault.service.getSecret(ids.bank)).title).toBe('银行');
  });

  test('编辑:把已有内容填进表单,类型不能改(只显示文字,没有下拉)', async () => {
    const vault = await createInitializedVault();
    const ids = await seed(vault);
    mountVault(vault, `/vault/${ids.bank}/edit`);

    expect(await screen.findByDisplayValue('银行')).toBeInTheDocument();
    expect(screen.getByLabelText('用户名')).toHaveValue(MARK.username);
    expect(screen.getByLabelText('密码')).toHaveValue(MARK.bank);
    expect(screen.getByLabelText('网址')).toHaveValue(MARK.url);
    expect(screen.getByLabelText('备注')).toHaveValue(MARK.notes);
    expect(screen.getByLabelText('标签')).toHaveValue('个人');
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByText('账号密码')).toBeInTheDocument();
  });

  test('编辑:表单拿到内容之后,store 里的那一份明文立刻清掉(内存里只留一份)', async () => {
    const vault = await createInitializedVault();
    const ids = await seed(vault);
    const { runtime } = mountVault(vault, `/vault/${ids.bank}/edit`);

    await screen.findByDisplayValue('银行');

    expect(runtime.store.getState().secret).toBeNull();
  });

  test('编辑:离开页面(卸载)时 store 里也没有明文', async () => {
    const vault = await createInitializedVault();
    const ids = await seed(vault);
    const { runtime, unmount } = mountVault(vault, `/vault/${ids.bank}/edit`);
    await screen.findByDisplayValue('银行');

    unmount();

    expect(runtime.store.getState().secret).toBeNull();
  });

  test('编辑并保存:更新到库里,回到详情,创建时间保持不变', async () => {
    const vault = await createInitializedVault();
    const ids = await seed(vault);
    const before = await vault.service.getSecret(ids.bank);
    const update = vi.spyOn(vault.service, 'updateRecord');
    mountVault(vault, `/vault/${ids.bank}/edit`);
    await screen.findByDisplayValue('银行');

    type('标题', '新银行');
    type('密码', 'new-password-value');
    click('保存');

    await waitFor(() => expect(loc()).toBe(`/vault/${ids.bank}`));
    expect(update).toHaveBeenCalledWith(
      ids.bank,
      expect.objectContaining({ type: 'password', title: '新银行', secret: 'new-password-value' })
    );
    const after = await vault.service.getSecret(ids.bank);
    expect(after).toMatchObject({ title: '新银行', secret: 'new-password-value', username: MARK.username });
    expect(after.createdAt).toBe(before.createdAt);
  });

  test('编辑时保存失败:显示错误,表单内容保留', async () => {
    const vault = await createInitializedVault();
    const ids = await seed(vault);
    vi.spyOn(vault.service, 'updateRecord').mockRejectedValueOnce(new NotFoundError());
    mountVault(vault, `/vault/${ids.bank}/edit`);
    await screen.findByDisplayValue('银行');
    type('标题', '改到一半');

    click('保存');

    expect(await screen.findByRole('alert')).toHaveTextContent('找不到这条记录，可能已被删除');
    expect(screen.getByLabelText('标题')).toHaveValue('改到一半');
  });

  test('编辑不存在的记录:显示错误,没有表单', async () => {
    const vault = await createInitializedVault();
    mountVault(vault, '/vault/no-such-id/edit');

    expect(await screen.findByRole('alert')).toHaveTextContent('找不到这条记录，可能已被删除');
    expect(screen.queryByLabelText('标题')).toBeNull();
  });

  test('编辑一条解不开的记录:用"记录"的措辞,没有表单', async () => {
    const vault = await createInitializedVault();
    const ids = await seed(vault);
    await corrupt(vault, ids.bank, 'summary');
    mountVault(vault, `/vault/${ids.bank}/edit`);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('这条记录无法解密，数据可能已损坏');
    expect(alert).not.toHaveTextContent('密码错误');
    expect(screen.queryByLabelText('标题')).toBeNull();
  });
});
