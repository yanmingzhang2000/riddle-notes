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
      <header className="p-6 border-b border-gray-200 bg-white">
        <div className="flex items-center gap-4 mb-2">
          <button
            onClick={handleCancel}
            className="p-2 hover:bg-gray-100 rounded-lg"
            disabled={loading}
          >
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </button>
          <h2 className="text-xl font-bold text-gray-900 flex-1">
            {isEdit ? '编辑笔记' : '新建笔记'}
          </h2>
          <button
            onClick={handleSave}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Save className="w-4 h-4" />
            <span className="text-sm font-medium">{loading ? '保存中...' : '保存'}</span>
          </button>
        </div>
        {error && (
          <div className="text-sm text-red-600 mt-2">{error}</div>
        )}
      </header>

      {/* Editor */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto space-y-4">
          {/* Title Input */}
          <div>
            <label htmlFor="note-title" className="block text-sm font-medium text-gray-700 mb-2">
              标题（选填，留空时自动取正文第一行）
            </label>
            <input
              id="note-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="输入标题..."
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
              disabled={loading}
            />
          </div>

          {/* Content Textarea */}
          <div className="flex-1">
            <label htmlFor="note-content" className="block text-sm font-medium text-gray-700 mb-2">
              正文
            </label>
            <textarea
              id="note-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="输入笔记内容..."
              className="w-full h-96 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 font-mono text-sm resize-none"
              disabled={loading}
            />
          </div>

          {/* Tips */}
          <div className="text-sm text-gray-500 space-y-1">
            <p>💡 支持 Markdown 语法（查看时会渲染）</p>
            <p>💡 标题和正文不能都为空</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default NoteEditor;
