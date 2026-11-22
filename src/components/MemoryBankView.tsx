import React, { useMemo, useState } from 'react';
import { Archive, CheckCircle2, Edit3, Plus, RotateCcw, Search, Trash2 } from 'lucide-react';
import type {
  FeedbackEvent,
  LearnedMemory,
  MemoryCategory,
  MemoryConfidence,
} from '../types/healthcare';
import {
  createManualMemory,
  deleteMemory,
  toggleMemoryArchive,
  updateMemoryManual,
} from '../lib/firestoreService';

interface Props {
  uid: string;
  memories: LearnedMemory[];
  feedbackEvents: FeedbackEvent[];
}

const CATEGORIES: Array<{ id: 'all' | MemoryCategory; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'condition', label: 'Conditions' },
  { id: 'medication', label: 'Medications' },
  { id: 'allergy', label: 'Allergies' },
  { id: 'trigger', label: 'Triggers' },
  { id: 'lifestyle', label: 'Lifestyle' },
  { id: 'preference', label: 'Preferences' },
  { id: 'goal', label: 'Goals' },
];

const SOURCE_LABELS: Record<string, string> = {
  auto_learned: 'Auto-learned',
  feedback_rule: 'Feedback Rule',
  user_taught: 'Patient Taught',
  pattern_synthesis: 'Pattern Synthesis',
};

export const MemoryBankView: React.FC<Props> = ({ uid, memories, feedbackEvents }) => {
  const [categoryFilter, setCategoryFilter] = useState<'all' | MemoryCategory>('all');
  const [statusFilter, setStatusFilter] = useState<'active' | 'archived'>('active');
  const [searchQuery, setSearchQuery] = useState('');

  const [showAddForm, setShowAddForm] = useState(false);
  const [newCategory, setNewCategory] = useState<MemoryCategory>('preference');
  const [newTitle, setNewTitle] = useState('');
  const [newDetail, setNewDetail] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDetail, setEditDetail] = useState('');
  const [editCategory, setEditCategory] = useState<MemoryCategory>('lifestyle');

  const stats = useMemo(() => {
    const active = memories.filter((m) => m.status === 'active');
    return {
      activeCount: active.length,
      verifiedCount: active.filter((m) => m.confidence === 'verified').length,
      autoCount: active.filter((m) => m.source === 'auto_learned').length,
      feedbackCount: active.filter((m) => m.source === 'feedback_rule').length,
    };
  }, [memories]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return memories.filter((m) => {
      if (m.status !== statusFilter) return false;
      if (categoryFilter !== 'all' && m.category !== categoryFilter) return false;
      if (q && !m.title.toLowerCase().includes(q) && !m.detail.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [memories, statusFilter, categoryFilter, searchQuery]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newDetail.trim() || isSaving) return;
    setIsSaving(true);
    try {
      await createManualMemory(uid, {
        category: newCategory,
        title: newTitle.trim(),
        detail: newDetail.trim(),
        source: 'user_taught',
        confidence: 'verified',
        evidenceQuote: 'Directly entered in Learned Memory',
      });
      setNewTitle('');
      setNewDetail('');
      setShowAddForm(false);
    } finally {
      setIsSaving(false);
    }
  };

  const startEdit = (mem: LearnedMemory) => {
    setEditingId(mem.id);
    setEditTitle(mem.title);
    setEditDetail(mem.detail);
    setEditCategory(mem.category);
  };

  const saveEdit = async (mem: LearnedMemory) => {
    if (!editTitle.trim() || !editDetail.trim()) return;
    await updateMemoryManual(uid, mem.id, {
      title: editTitle.trim(),
      detail: editDetail.trim(),
      category: editCategory,
      confidence: 'verified',
    });
    setEditingId(null);
  };

  const verifyMemory = async (mem: LearnedMemory) => {
    const nextConfidence: MemoryConfidence = mem.confidence === 'verified' ? 'high' : 'verified';
    await updateMemoryManual(uid, mem.id, {
      title: mem.title,
      detail: mem.detail,
      category: mem.category,
      confidence: nextConfidence,
    });
  };

  return (
    <div className="max-w-[1280px] mx-auto px-4 lg:px-6 py-8 space-y-8">
      {/* Header & Metrics */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold font-display text-slate-900">Learned Clinical Memory</h1>
          <p className="text-sm text-slate-600 mt-1 max-w-2xl">
            Every fact, contraindication, trigger, and communication preference the agent has learned about you.
            Verify, refine, or forget any item at any time.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowAddForm((v) => !v)}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
        >
          <Plus className="w-4 h-4" />
          Teach Agent Fact
        </button>
      </div>

      {/* Tabular Summary Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 bg-white border border-slate-200 rounded-xl divide-y lg:divide-y-0 lg:divide-x divide-slate-200">
        <div className="p-5">
          <p className="text-xs text-slate-500">Active Memories</p>
          <p className="text-2xl font-semibold font-mono text-slate-900 mt-1">{stats.activeCount}</p>
        </div>
        <div className="p-5">
          <p className="text-xs text-slate-500">Verified by You</p>
          <p className="text-2xl font-semibold font-mono text-emerald-700 mt-1">{stats.verifiedCount}</p>
        </div>
        <div className="p-5">
          <p className="text-xs text-slate-500">Auto-Learned from Chat</p>
          <p className="text-2xl font-semibold font-mono text-slate-900 mt-1">{stats.autoCount}</p>
        </div>
        <div className="p-5">
          <p className="text-xs text-slate-500">Feedback Rules</p>
          <p className="text-2xl font-semibold font-mono text-teal-700 mt-1">{stats.feedbackCount}</p>
        </div>
      </div>

      {/* Teach Agent Form */}
      {showAddForm && (
        <form onSubmit={handleCreate} className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <h2 className="text-base font-semibold font-display text-slate-900">Teach the Agent a New Fact or Rule</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Category</label>
              <select
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value as MemoryCategory)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:border-teal-700"
              >
                {CATEGORIES.filter((c) => c.id !== 'all').map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1">Short Title</label>
              <input
                type="text"
                required
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="e.g., Penicillin allergy, or Prefer evening routine tips"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-teal-700"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Detailed Clinical Context / Rule</label>
            <textarea
              rows={2}
              required
              value={newDetail}
              onChange={(e) => setNewDetail(e.target.value)}
              placeholder="Explain the exact condition, dosage, sensitivity, or instruction the agent should follow..."
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-teal-700"
            />
          </div>
          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 border border-slate-200 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="px-4 py-2 text-xs font-medium text-white bg-teal-700 hover:bg-teal-800 rounded-lg"
            >
              {isSaving ? 'Saving...' : 'Save to Memory'}
            </button>
          </div>
        </form>
      )}

      {/* Filter & Search Toolbar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => setCategoryFilter(cat.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                categoryFilter === cat.id
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <div className="relative flex-1 sm:w-64">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search memories..."
              className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-teal-700"
            />
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg shrink-0">
            <button
              type="button"
              onClick={() => setStatusFilter('active')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                statusFilter === 'active' ? 'bg-white text-slate-900' : 'text-slate-600'
              }`}
            >
              Active
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('archived')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                statusFilter === 'archived' ? 'bg-white text-slate-900' : 'text-slate-600'
              }`}
            >
              Archived
            </button>
          </div>
        </div>
      </div>

      {/* Memories List */}
      <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-200">
        {filtered.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm font-medium text-slate-900 mb-1">No memories match this view</p>
            <p className="text-xs text-slate-500 mb-4">
              Chat with the Consultation agent or click Teach Agent Fact to add health context.
            </p>
            {statusFilter === 'active' && (
              <button
                type="button"
                onClick={() => setShowAddForm(true)}
                className="px-4 py-2 text-xs font-medium text-white bg-teal-700 hover:bg-teal-800 rounded-lg"
              >
                Teach First Fact
              </button>
            )}
          </div>
        ) : (
          filtered.map((mem) => {
            const isEditing = editingId === mem.id;
            return (
              <div key={mem.id} className="p-5">
                {isEditing ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <select
                        value={editCategory}
                        onChange={(e) => setEditCategory(e.target.value as MemoryCategory)}
                        className="px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
                      >
                        {CATEGORIES.filter((c) => c.id !== 'all').map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                      <input
                        type="text"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        className="md:col-span-2 px-3 py-2 text-sm border border-slate-200 rounded-lg"
                      />
                    </div>
                    <textarea
                      rows={2}
                      value={editDetail}
                      onChange={(e) => setEditDetail(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="px-3 py-1.5 text-xs font-medium text-slate-600 border border-slate-200 rounded-lg"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => void saveEdit(mem)}
                        className="px-3 py-1.5 text-xs font-medium text-white bg-teal-700 rounded-lg"
                      >
                        Save &amp; Verify
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                    <div className="space-y-1.5 max-w-3xl">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        <span className="font-medium text-slate-700 capitalize">{mem.category}</span>
                        <span aria-hidden="true">·</span>
                        <span>{SOURCE_LABELS[mem.source] || mem.source}</span>
                        <span aria-hidden="true">·</span>
                        <span
                          className={
                            mem.confidence === 'verified'
                              ? 'text-emerald-700 font-medium'
                              : mem.confidence === 'high'
                              ? 'text-teal-700 font-medium'
                              : 'text-amber-700 font-medium'
                          }
                        >
                          {mem.confidence === 'verified'
                            ? 'Verified'
                            : mem.confidence === 'high'
                            ? 'High Confidence'
                            : 'Needs Verification'}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono">Reinforced {mem.reinforcementCount}×</span>
                      </div>

                      <h3 className="text-base font-semibold font-display text-slate-900">{mem.title}</h3>
                      <p className="text-sm text-slate-700 leading-relaxed">{mem.detail}</p>
                      {mem.evidenceQuote && (
                        <p className="text-xs text-slate-500 pt-1">Source note: &ldquo;{mem.evidenceQuote}&rdquo;</p>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => void verifyMemory(mem)}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                          mem.confidence === 'verified'
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                            : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        {mem.confidence === 'verified' ? 'Verified' : 'Verify'}
                      </button>

                      <button
                        type="button"
                        onClick={() => startEdit(mem)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        Edit
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          void toggleMemoryArchive(uid, mem.id, mem.status === 'active' ? 'archived' : 'active')
                        }
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
                      >
                        {mem.status === 'active' ? (
                          <>
                            <Archive className="w-3.5 h-3.5" />
                            Archive
                          </>
                        ) : (
                          <>
                            <RotateCcw className="w-3.5 h-3.5" />
                            Restore
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => void deleteMemory(uid, mem.id)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 text-rose-700 hover:bg-rose-50 transition-colors whitespace-nowrap shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Forget
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Feedback Distillation Audit Log */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold font-display text-slate-900">Feedback-Driven Learning History</h2>
        <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-200">
          {feedbackEvents.length === 0 ? (
            <div className="p-6 text-sm text-slate-500">
              Rate or correct any agent response in Consultation to see distilled behavioral adaptations here.
            </div>
          ) : (
            feedbackEvents.slice(0, 10).map((ev) => (
              <div key={ev.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-1">
                  <p className="text-xs text-slate-500 capitalize">
                    {ev.rating === 'helpful' ? 'Positive Reinforcement' : 'Correction Distilled'}
                  </p>
                  <p className="text-sm font-medium text-slate-900">{ev.distilledRule}</p>
                  {ev.userCorrection && <p className="text-xs text-slate-600">Input: &ldquo;{ev.userCorrection}&rdquo;</p>}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
