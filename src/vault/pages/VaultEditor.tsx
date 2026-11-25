import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { VAULT_TYPE_FIELDS, VAULT_TYPE_LABELS } from '../components/record-types';
import { VaultPage } from '../components/VaultPage';
import { describeVaultError } from '../error-messages';
import { useVaultStore } from '../hooks/useVaultStore';
import { VAULT_RECORD_TYPES, type VaultRecordType } from '../types';
import {
  emptyForm,
  formFromSecret,
  toRecordInput,
  validateForm,
  type EditorErrors,
  type EditorForm,
} from './editor-model';

/**
 * 新建和编辑共用。路由 `new` 没有 :id,`:id/edit` 有。
 *
 * 编辑时表单里要有一份明文才能改,这是避免不了的。能做的是:
 *   - 读出来放进表单之后,马上把 store 里那一份清掉,同一时刻内存里只留一份;
 *   - 锁定时守卫会把整个页面卸载(key=epoch),表单 state 随之销毁,没保存的修改会丢失。
 *
 * 类型在编辑时不能改:类型参与记录的认证数据(AAD),改类型等于换一条记录。
 */
export default function VaultEditor() {
  const { id } = useParams<{ id: string }>();
  const editing = id !== undefined;
  const navigate = useNavigate();
  const { secret, store } = useVaultStore();

  const [form, setForm] = useState<EditorForm | null>(editing ? null : emptyForm());
  const [errors, setErrors] = useState<EditorErrors>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showSecret, setShowSecret] = useState(false);

  // 路由里的 id 变了(同一个路由,React Router 会复用这个组件实例):表单必须重新来过。
  // 否则表单里还是上一条的内容,而"保存"会拿它去覆盖新 id 对应的那条记录。
  // 渲染期间重置:React 会在提交之前立刻用新状态重新渲染,不会闪出一帧上一条的内容
  const [formId, setFormId] = useState(id);
  if (formId !== id) {
    setFormId(id);
    setForm(id === undefined ? emptyForm() : null);
    setErrors({});
    setSaveError(null);
  }

  // 编辑:读出这条记录
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoadError(null);
    store.loadSecret(id).catch(caught => {
      if (!cancelled) setLoadError(describeVaultError(caught, 'record'));
    });
    return () => {
      cancelled = true;
      store.clearSecret();
    };
  }, [id, store]);

  // 编辑:读到之后填进表单,只填一次,并且立刻清掉 store 里的那一份。
  //
  // secret.id === id 的比对是纵深防御:id 变化的那次提交里,表单被重置为 null,但这个 effect 的闭包里
  // 拿到的 secret 是渲染时的值,理论上可能还是上一条的。没有这个比对,上一条的内容会被填进表单,
  // 保存时去覆盖新 id 对应的那条记录。目前没有测试能单独抓到去掉它的变异(我没能构造出这个窗口),
  // 但它没有任何代价,后果却是静默覆盖数据,所以保留。
  useEffect(() => {
    if (editing && form === null && secret && secret.id === id) {
      setForm(formFromSecret(secret));
      store.clearSecret();
    }
  }, [editing, form, secret, id, store]);

  const leave = () => navigate(editing ? `/vault/${id}` : '/vault');

  if (loadError) {
    return (
      <VaultPage title="编辑记录" onBack={() => navigate('/vault')}>
        <div role="alert" className="paper-panel paper-panel--seal p-4 text-sm text-brown space-y-3">
          <p>{loadError}</p>
          <button type="button" className="btn-secondary" onClick={() => navigate('/vault')}>
            返回列表
          </button>
        </div>
      </VaultPage>
    );
  }

  if (form === null) {
    return (
      <VaultPage title="编辑记录" onBack={() => navigate('/vault')}>
        <p role="status" className="text-sm text-soft">
          正在解密…
        </p>
      </VaultPage>
    );
  }

  const fields = VAULT_TYPE_FIELDS[form.type];
  const update = (patch: Partial<EditorForm>) => {
    setForm(current => (current ? { ...current, ...patch } : current));
    // 改动之后,对应字段的旧错误提示就不再准确了
    setErrors({});
  };

  // 保存进行中不会被重复触发:唯一的入口是"保存"按钮,它在 saving 时是禁用的
  const save = async () => {
    const found = validateForm(form);
    setErrors(found);
    if (found.title || found.secret) return;

    setSaving(true);
    setSaveError(null);
    try {
      const input = toRecordInput(form);
      if (editing) {
        await store.updateRecord(id, input);
        navigate(`/vault/${id}`, { replace: true });
      } else {
        const newId = await store.createRecord(input);
        navigate(`/vault/${newId}`, { replace: true });
      }
    } catch (caught) {
      setSaveError(describeVaultError(caught));
      setSaving(false);
    }
  };

  return (
    <VaultPage
      title={editing ? '编辑记录' : '新建记录'}
      onBack={leave}
      footer={
        <div className="flex items-center gap-3">
          <button type="button" className="btn-primary" disabled={saving} onClick={() => void save()}>
            {saving ? '正在保存…' : '保存'}
          </button>
          <button type="button" className="btn-secondary" disabled={saving} onClick={leave}>
            取消
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        <FormRow id="editor-type" label="类型">
          {editing ? (
            <p className="text-sm text-ink">{VAULT_TYPE_LABELS[form.type]}</p>
          ) : (
            <select
              id="editor-type"
              className="input"
              value={form.type}
              onChange={event => update({ type: event.target.value as VaultRecordType })}
            >
              {VAULT_RECORD_TYPES.map(type => (
                <option key={type} value={type}>
                  {VAULT_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          )}
        </FormRow>

        <FormRow id="editor-title" label="标题" error={errors.title}>
          <input
            id="editor-title"
            type="text"
            className="input"
            value={form.title}
            onChange={event => update({ title: event.target.value })}
            autoComplete="off"
            aria-invalid={errors.title !== undefined}
            aria-describedby={errors.title ? 'editor-title-error' : undefined}
          />
        </FormRow>

        {fields.usernameLabel && (
          <FormRow id="editor-username" label={fields.usernameLabel}>
            <input
              id="editor-username"
              type="text"
              className="input"
              value={form.username}
              onChange={event => update({ username: event.target.value })}
              autoComplete="off"
              spellCheck={false}
            />
          </FormRow>
        )}

        <FormRow id="editor-secret" label={fields.secretLabel} error={errors.secret}>
          {fields.multiline ? (
            <textarea
              id="editor-secret"
              className="textarea"
              rows={8}
              value={form.secret}
              onChange={event => update({ secret: event.target.value })}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={errors.secret !== undefined}
              aria-describedby={errors.secret ? 'editor-secret-error' : undefined}
            />
          ) : (
            <div className="flex items-center gap-2">
              <input
                id="editor-secret"
                type={showSecret ? 'text' : 'password'}
                className="input font-mono"
                value={form.secret}
                onChange={event => update({ secret: event.target.value })}
                autoComplete="off"
                spellCheck={false}
                aria-invalid={errors.secret !== undefined}
                aria-describedby={errors.secret ? 'editor-secret-error' : undefined}
              />
              <button
                type="button"
                className="btn-icon"
                aria-label={showSecret ? `隐藏${fields.secretLabel}` : `显示${fields.secretLabel}`}
                onClick={() => setShowSecret(shown => !shown)}
              >
                {showSecret ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
              </button>
            </div>
          )}
        </FormRow>

        {fields.urlLabel && (
          <FormRow id="editor-url" label={fields.urlLabel}>
            <input
              id="editor-url"
              type="text"
              className="input"
              value={form.url}
              onChange={event => update({ url: event.target.value })}
              autoComplete="off"
              spellCheck={false}
            />
          </FormRow>
        )}

        {fields.notes && (
          <FormRow id="editor-notes" label="备注">
            <textarea
              id="editor-notes"
              className="textarea"
              rows={4}
              value={form.notes}
              onChange={event => update({ notes: event.target.value })}
              autoComplete="off"
            />
          </FormRow>
        )}

        <FormRow id="editor-tags" label="标签">
          <input
            id="editor-tags"
            type="text"
            className="input"
            value={form.tags}
            onChange={event => update({ tags: event.target.value })}
            autoComplete="off"
            placeholder="用逗号分隔，例如：工作, 云服务"
          />
        </FormRow>

        {saveError && (
          <p role="alert" className="text-xs text-seal">
            {saveError}
          </p>
        )}
      </div>
    </VaultPage>
  );
}

function FormRow({ id, label, error, children }: { id: string; label: string; error?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-brown mb-2">
        {label}
      </label>
      {children}
      {error && (
        <p id={`${id}-error`} className="text-xs text-seal mt-1">
          {error}
        </p>
      )}
    </div>
  );
}
