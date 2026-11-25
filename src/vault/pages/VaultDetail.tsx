import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Pencil, Trash2 } from 'lucide-react';
import { VAULT_TYPE_FIELDS } from '../components/record-types';
import { SecretField } from '../components/SecretField';
import { VaultBadge } from '../components/VaultBadge';
import { VaultPage } from '../components/VaultPage';
import { VaultError } from '../crypto/errors';
import { describeVaultError } from '../error-messages';
import { useVaultStore } from '../hooks/useVaultStore';
import { formatDateTime } from './format';

interface LoadFailure {
  message: string;
  /** 记录不存在时不提供删除 */
  deletable: boolean;
}

/**
 * 详情:这里才解密 secret,离开页面立刻清除(卸载时 clearSecret)。
 * 秘密默认隐藏,点"显示"才渲染成文本(SecretField)。
 *
 * 解不开的记录(数据损坏)也能进到这里:显示原因,并且允许删除,否则它会永远留在列表里。
 */
export default function VaultDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { secret, store } = useVaultStore();
  const [failure, setFailure] = useState<LoadFailure | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setFailure(null);
    store.loadSecret(id).catch(caught => {
      if (cancelled) return;
      setFailure({
        message: describeVaultError(caught, 'record'),
        deletable: !(caught instanceof VaultError && (caught.kind === 'not-found' || caught.kind === 'locked')),
      });
    });
    return () => {
      cancelled = true;
      // 离开即清除。同时让还在途中的加载作废
      store.clearSecret();
    };
  }, [id, store]);

  const remove = async () => {
    if (!id) return;
    if (!window.confirm('确定删除这条记录吗？此操作无法撤销。')) return;
    setDeleteError(null);
    try {
      await store.deleteRecord(id);
      navigate('/vault', { replace: true });
    } catch (caught) {
      setDeleteError(describeVaultError(caught, 'record'));
    }
  };

  const back = () => navigate('/vault');
  const record = secret && secret.id === id ? secret : null;

  if (failure) {
    return (
      <VaultPage title="记录" onBack={back}>
        <div role="alert" className="paper-panel paper-panel--seal p-4 text-sm text-brown space-y-3">
          <p>{failure.message}</p>
          {deleteError && <p>{deleteError}</p>}
          <div className="flex items-center gap-3">
            <button type="button" className="btn-secondary" onClick={back}>
              返回列表
            </button>
            {failure.deletable && (
              <button type="button" className="btn-secondary" onClick={() => void remove()}>
                删除这条记录
              </button>
            )}
          </div>
        </div>
      </VaultPage>
    );
  }

  if (!record) {
    return (
      <VaultPage title="记录" onBack={back}>
        <p role="status" className="text-sm text-soft">
          正在解密…
        </p>
      </VaultPage>
    );
  }

  const fields = VAULT_TYPE_FIELDS[record.type];

  return (
    <VaultPage
      title={record.title || '（无标题）'}
      onBack={back}
      actions={
        <div className="flex items-center gap-1">
          <button type="button" className="btn-icon" aria-label="编辑" onClick={() => navigate(`/vault/${record.id}/edit`)}>
            <Pencil size={16} aria-hidden="true" />
          </button>
          <button type="button" className="btn-icon" aria-label="删除" onClick={() => void remove()}>
            <Trash2 size={16} aria-hidden="true" />
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="flex items-center gap-2">
          <VaultBadge type={record.type} />
          {record.tags?.map(tag => (
            <span key={tag} className="badge badge-gold">
              {tag}
            </span>
          ))}
        </div>

        {deleteError && (
          <p role="alert" className="text-xs text-seal">
            {deleteError}
          </p>
        )}

        {/* 有值就显示:类型只决定字段叫什么。库里存着的数据不能因为"这个类型本来没有这个字段"而被藏起来 */}
        {record.username && (
          <Field label={fields.usernameLabel ?? '用户名'}>
            <p className="text-sm text-ink break-all">{record.username}</p>
          </Field>
        )}

        <Field label={fields.secretLabel}>
          <SecretField label={fields.secretLabel} value={record.secret} resetKey={record.id} />
        </Field>

        {record.url && (
          <Field label={fields.urlLabel ?? '网址'}>
            <p className="text-sm text-ink break-all">{record.url}</p>
          </Field>
        )}

        {record.notes && (
          <Field label="备注">
            <p className="text-sm text-ink whitespace-pre-wrap break-words">{record.notes}</p>
          </Field>
        )}

        <p className="meta">
          创建于 {formatDateTime(record.createdAt)} · 更新于 {formatDateTime(record.updatedAt)}
        </p>
      </div>
    </VaultPage>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="block text-sm font-medium text-brown mb-2">{label}</p>
      {children}
    </div>
  );
}
