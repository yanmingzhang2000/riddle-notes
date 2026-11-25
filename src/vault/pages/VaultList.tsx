import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search } from 'lucide-react';
import { VaultTypeIcon, labelFor } from '../components/VaultBadge';
import { VaultPage } from '../components/VaultPage';
import { describeVaultError } from '../error-messages';
import { useVaultStore } from '../hooks/useVaultStore';
import { filterSummaries, groupSummaries } from './list-model';
import { formatDate } from './format';

/**
 * 列表:按类型分组,只显示 summary(标题、标签、时间)。
 *
 * 搜索词只放在组件 state 里:不写进 URL(Notes 的搜索会写进 URL,这里不能照搬,
 * 关键词可能暴露记录里的内容),也不用 <form>,autoComplete="off"。
 * 过滤在内存里对已经解密的 summary 做,不再碰数据库。
 */
export default function VaultList() {
  const navigate = useNavigate();
  const { summaries, store } = useVaultStore();
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      await store.loadSummaries();
    } catch (caught) {
      setError(describeVaultError(caught));
    }
  }, [store]);

  // 每次进入都重新加载:从详情页或编辑页回来时,列表要反映刚才的修改
  useEffect(() => {
    void load();
  }, [load]);

  const groups = useMemo(
    () => (summaries ? groupSummaries(filterSummaries(summaries, query)) : []),
    [summaries, query]
  );

  const newButton = (
    <button type="button" className="btn-primary text-xs px-3 py-1.5 min-h-0" onClick={() => navigate('/vault/new')}>
      <Plus size={14} aria-hidden="true" />
      新建
    </button>
  );

  return (
    <VaultPage title="保险箱" actions={newButton}>
      <div className="space-y-5">
        <div className="relative">
          <input
            type="text"
            className="input pr-10"
            aria-label="搜索保险箱"
            placeholder="搜索标题或标签"
            value={query}
            onChange={event => setQuery(event.target.value)}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
          <Search
            size={16}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none"
            aria-hidden="true"
          />
        </div>

        {error && (
          <div role="alert" className="paper-panel paper-panel--seal p-4 text-sm text-brown space-y-3">
            <p>{error}</p>
            <button type="button" className="btn-secondary" onClick={() => void load()}>
              重试
            </button>
          </div>
        )}

        {!error && summaries === null && (
          <p role="status" className="text-sm text-soft">
            正在加载…
          </p>
        )}

        {summaries !== null && summaries.length === 0 && (
          <div className="paper-panel p-4 text-sm text-brown space-y-3">
            <p>保险箱里还没有记录。</p>
            <button type="button" className="btn-secondary" onClick={() => navigate('/vault/new')}>
              添加第一条
            </button>
          </div>
        )}

        {summaries !== null && summaries.length > 0 && groups.length === 0 && (
          <p role="status" className="text-sm text-soft">
            没有匹配的记录。
          </p>
        )}

        {groups.map(group => (
          <section key={group.key} aria-label={group.key === 'unreadable' ? '无法读取' : labelFor(group.key)}>
            <h3 className="eyebrow mb-2 flex items-center gap-2">
              {group.key !== 'unreadable' && <VaultTypeIcon type={group.key} size={14} />}
              {group.key === 'unreadable' ? '无法读取' : labelFor(group.key)}
              <span className="meta">{group.items.length}</span>
            </h3>
            {group.key === 'unreadable' && (
              <p className="meta mb-2">这些记录解不开，数据可能已损坏。点开可以删除它们。</p>
            )}
            <div className="space-y-2">
              {group.items.map(item => (
                <button
                  key={item.id}
                  type="button"
                  className="note-card w-full text-left"
                  onClick={() => navigate(`/vault/${item.id}`)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-ink truncate">
                      {item.unreadable ? '（无法读取）' : item.title || '（无标题）'}
                    </span>
                    <span className="meta shrink-0">{formatDate(item.updatedAt)}</span>
                  </div>
                  {item.tags && item.tags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {item.tags.map(tag => (
                        <span key={tag} className="badge">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </VaultPage>
  );
}
