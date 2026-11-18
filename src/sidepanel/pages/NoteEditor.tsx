import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Save } from 'lucide-react';
import { createManualNote, updateManualNote, NoteError } from '@shared/notes';
import { db } from '@db/schema';

const NoteEditor: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const isEdit = Boolean(id);

  useEffect(() => {
    if (id) {
      loadNote(parseInt(id));
    }
  }, [id]);

  const loadNote = async (noteId: number) => {
    try {
      const note = await db.prompts.get(noteId);
      if (!note) {
        setError('笔记不存在，可能已被删除');
        return;
      }
      if (note.type !== 'manual') {
        setError('AI 对话笔记不能编辑');
        return;
      }
      setTitle(note.title);
      setContent(note.content || '');
    } catch (err) {
      console.error('Failed to load note:', err);
      setError('加载笔记失败');
    }
  };

  const handleSave = async () => {
    setError('');
    setLoading(true);

    try {
      if (isEdit) {
        await updateManualNote(parseInt(id!), { title, content });
        navigate(`/prompts/${id}`);
      } else {
        const newId = await createManualNote({ title, content });
        navigate(`/prompts/${newId}`);
      }
    } catch (err) {
      if (err instanceof NoteError) {
        setError(err.message);
      } else {
        console.error('Save failed:', err);
        setError('保存失败，请重试');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    if (isEdit) {
      navigate(`/prompts/${id}`);
    } else {
      navigate('/prompts');
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <header className="page-header">
        <div className="flex items-center gap-4 mb-2">
          <button
            onClick={handleCancel}
            className="btn-icon"
            disabled={loading}
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h2 className="page-title text-lg flex-1">
            {isEdit ? '编辑笔记' : '新建笔记'}
          </h2>
          <button
            onClick={handleSave}
            disabled={loading}
            className="btn-primary text-xs px-3 py-1.5 min-h-0 gap-1"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{loading ? '保存中...' : '保存'}</span>
          </button>
        </div>
        {error && (
          <div className="text-xs text-seal mt-2">{error}</div>
        )}
      </header>

      {/* Editor */}
      <div className="flex-1 overflow-y-auto p-6 bg-parchment">
        <div className="max-w-3xl mx-auto space-y-4">
          {/* Title Input */}
          <div>
            <label htmlFor="note-title" className="block text-sm font-medium text-brown mb-2">
              标题（选填，留空时自动取正文第一行）
            </label>
            <input
              id="note-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="输入标题..."
              className="input"
              disabled={loading}
            />
          </div>

          {/* Content Textarea */}
          <div className="flex-1">
            <label htmlFor="note-content" className="block text-sm font-medium text-brown mb-2">
              正文
            </label>
            <textarea
              id="note-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="输入笔记内容..."
              className="textarea font-mono text-sm"
              style={{ height: '24rem' }}
              disabled={loading}
            />
          </div>

          {/* Tips */}
          <div className="paper-panel text-sm meta space-y-1">
            <p>💡 支持 Markdown 语法（查看时会渲染）</p>
            <p>💡 标题和正文不能都为空</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default NoteEditor;
