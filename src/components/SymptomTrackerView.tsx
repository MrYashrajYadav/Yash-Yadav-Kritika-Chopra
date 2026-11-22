import React, { useMemo, useState } from 'react';
import { Activity, Plus, Sparkles, Trash2 } from 'lucide-react';
import type {
  LearnedMemory,
  PatientProfile,
  SymptomLog,
  SynthesizeApiResponse,
} from '../types/healthcare';
import {
  createManualMemory,
  createSymptomLog,
  deleteSymptomLog,
  updatePatientCareSummary,
} from '../lib/firestoreService';

interface Props {
  uid: string;
  profile: PatientProfile | null;
  memories: LearnedMemory[];
  symptomLogs: SymptomLog[];
  onSynthesisComplete: (result: SynthesizeApiResponse) => void;
}

export const SymptomTrackerView: React.FC<Props> = ({
  uid,
  profile,
  memories,
  symptomLogs,
  onSynthesisComplete,
}) => {
  const [symptom, setSymptom] = useState('');
  const [severity, setSeverity] = useState(4);
  const [sleepHours, setSleepHours] = useState(7.0);
  const [triggers, setTriggers] = useState('');
  const [notes, setNotes] = useState('');
  const [loggedDate, setLoggedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [isSaving, setIsSaving] = useState(false);

  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [synthMessage, setSynthMessage] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const chartLogs = useMemo(() => {
    return [...symptomLogs].sort((a, b) => a.loggedDate.localeCompare(b.loggedDate)).slice(-14);
  }, [symptomLogs]);

  const handleLogSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!symptom.trim() || isSaving) return;
    setIsSaving(true);
    setErrorMsg(null);
    try {
      await createSymptomLog(uid, {
        symptom: symptom.trim(),
        severity,
        sleepHours,
        triggers: triggers.trim(),
        notes: notes.trim(),
        loggedDate,
      });
      setSymptom('');
      setTriggers('');
      setNotes('');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to save symptom log.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSynthesize = async () => {
    if (isSynthesizing) return;
    setIsSynthesizing(true);
    setErrorMsg(null);
    setSynthMessage(null);
    try {
      const activeMemories = memories.filter((m) => m.status === 'active');
      const res = await fetch('/api/agent/synthesize-patterns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symptomLogs: symptomLogs.slice(0, 20),
          memories: activeMemories,
          profile: {
            displayName: profile?.displayName || 'Patient',
            communicationStyle: profile?.communicationStyle || 'plain_language',
            preferredUnits: profile?.preferredUnits || 'metric',
          },
        }),
      });
      const data = (await res.json()) as SynthesizeApiResponse & { error?: string };
      if (!res.ok) {
        throw new Error(data.error || 'Pattern synthesis failed.');
      }

      let addedCount = 0;
      for (const pattern of (data.discoveredPatterns || []).slice(0, 3)) {
        const duplicate = activeMemories.some(
          (m) => m.title.toLowerCase() === pattern.title.toLowerCase()
        );
        if (!duplicate) {
          await createManualMemory(uid, {
            category: pattern.category || 'trigger',
            title: pattern.title,
            detail: pattern.detail,
            source: 'pattern_synthesis',
            confidence: pattern.confidence === 'high' ? 'high' : 'medium',
            evidenceQuote: pattern.evidenceQuote || 'Discovered via longitudinal symptom synthesis',
          });
          addedCount++;
        }
      }

      if (profile && data.careSummary) {
        await updatePatientCareSummary(
          uid,
          data.careSummary,
          (profile.learningCount || 0) + Math.max(1, addedCount)
        );
      }

      onSynthesisComplete(data);
      setSynthMessage(
        `Pattern synthesis complete: updated Care Playbook and stored ${addedCount} newly discovered longitudinal insight(s).`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Pattern synthesis error.');
    } finally {
      setIsSynthesizing(false);
    }
  };

  // SVG Chart Geometry
  const width = 680;
  const height = 220;
  const padX = 44;
  const padY = 24;
  const plotW = width - padX * 2;
  const plotH = height - padY * 2;

  const getX = (idx: number, total: number) => {
    if (total <= 1) return padX + plotW / 2;
    return padX + (idx / (total - 1)) * plotW;
  };
  const getSeverityY = (sev: number) => padY + plotH - ((sev - 1) / 9) * plotH;
  const getSleepY = (hrs: number) => padY + plotH - (Math.min(12, Math.max(0, hrs)) / 12) * plotH;

  const severityPoints = chartLogs.map((l, i) => `${getX(i, chartLogs.length)},${getSeverityY(l.severity)}`).join(' ');
  const sleepPoints = chartLogs.map((l, i) => `${getX(i, chartLogs.length)},${getSleepY(l.sleepHours)}`).join(' ');

  return (
    <div className="max-w-[1280px] mx-auto px-4 lg:px-6 py-8 space-y-8">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold font-display text-slate-900">Symptom &amp; Sleep Log</h1>
          <p className="text-sm text-slate-600 mt-1 max-w-2xl">
            Log daily symptom severity alongside sleep and suspected triggers so Meridian Care can detect longitudinal
            patterns.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void handleSynthesize()}
          disabled={isSynthesizing || (symptomLogs.length === 0 && memories.length === 0)}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
        >
          <Sparkles className="w-4 h-4" />
          {isSynthesizing ? 'Synthesizing Patterns...' : 'Synthesize Patterns'}
        </button>
      </div>

      {synthMessage && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-sm text-emerald-900">
          {synthMessage}
        </div>
      )}

      {errorMsg && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-sm text-rose-800">{errorMsg}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left: Log Entry Form */}
        <form
          onSubmit={handleLogSubmit}
          className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-4"
        >
          <h2 className="text-base font-semibold font-display text-slate-900">Log Daily Check-In</h2>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Symptom or Observation</label>
            <input
              type="text"
              required
              value={symptom}
              onChange={(e) => setSymptom(e.target.value)}
              placeholder="e.g., Afternoon tension headache"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-teal-700"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Severity (<span className="font-mono">{severity}/10</span>)
              </label>
              <input
                type="range"
                min={1}
                max={10}
                value={severity}
                onChange={(e) => setSeverity(Number(e.target.value))}
                className="w-full accent-teal-700 mt-2"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Sleep Hours</label>
              <input
                type="number"
                step="0.5"
                min={0}
                max={24}
                value={sleepHours}
                onChange={(e) => setSleepHours(Number(e.target.value))}
                className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg focus:outline-none focus:border-teal-700"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Date</label>
              <input
                type="date"
                value={loggedDate}
                onChange={(e) => setLoggedDate(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg focus:outline-none focus:border-teal-700"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Suspected Triggers</label>
              <input
                type="text"
                value={triggers}
                onChange={(e) => setTriggers(e.target.value)}
                placeholder="e.g., Late espresso, screen glare"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-teal-700"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Context Notes</label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Hydration, medication timing, recovery response..."
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-teal-700"
            />
          </div>

          <button
            type="submit"
            disabled={isSaving}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-50 rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            {isSaving ? 'Saving Check-In...' : 'Save Check-In'}
          </button>
        </form>

        {/* Right: Dual-Metric Trend Visualization */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold font-display text-slate-900">
                Severity vs. Sleep Correlation
              </h2>
              <p className="text-xs text-slate-500">
                Solid Teal: Symptom Severity (1–10) · Dashed Slate: Sleep Hours (0–12h)
              </p>
            </div>
            {hoveredIndex !== null && chartLogs[hoveredIndex] && (
              <div className="text-xs font-mono text-slate-700 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-lg">
                {chartLogs[hoveredIndex].loggedDate} · Sev {chartLogs[hoveredIndex].severity}/10 ·{' '}
                {chartLogs[hoveredIndex].sleepHours}h
              </div>
            )}
          </div>

          {chartLogs.length === 0 ? (
            <div className="h-[220px] flex flex-col items-center justify-center border border-dashed border-slate-200 rounded-lg text-center p-6">
              <Activity className="w-7 h-7 text-slate-400 mb-2" />
              <p className="text-sm font-medium text-slate-700">No check-ins recorded yet</p>
              <p className="text-xs text-slate-500 mt-1">
                Log your first symptom check-in to plot severity and sleep trends.
              </p>
            </div>
          ) : (
            <div className="w-full overflow-x-auto">
              <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto min-w-[480px]">
                {[0, 0.25, 0.5, 0.75, 1].map((t) => {
                  const y = padY + plotH * t;
                  return (
                    <line
                      key={t}
                      x1={padX}
                      x2={width - padX}
                      y1={y}
                      y2={y}
                      stroke="#e2e8f0"
                      strokeWidth="1"
                    />
                  );
                })}

                <text x="8" y={padY + 4} className="fill-slate-400 text-[10px] font-mono">
                  10
                </text>
                <text x="12" y={padY + plotH / 2 + 4} className="fill-slate-400 text-[10px] font-mono">
                  5
                </text>
                <text x="14" y={padY + plotH + 4} className="fill-slate-400 text-[10px] font-mono">
                  1
                </text>

                {chartLogs.length > 1 && (
                  <>
                    <polyline
                      fill="none"
                      stroke="#64748b"
                      strokeWidth="2"
                      strokeDasharray="5 4"
                      points={sleepPoints}
                    />
                    <polyline fill="none" stroke="#0d9488" strokeWidth="2.5" points={severityPoints} />
                  </>
                )}

                {chartLogs.map((log, i) => {
                  const cx = getX(i, chartLogs.length);
                  const cySev = getSeverityY(log.severity);
                  const cySleep = getSleepY(log.sleepHours);
                  return (
                    <g
                      key={log.id}
                      onMouseEnter={() => setHoveredIndex(i)}
                      onMouseLeave={() => setHoveredIndex(null)}
                      className="cursor-crosshair"
                    >
                      <line
                        x1={cx}
                        x2={cx}
                        y1={padY}
                        y2={padY + plotH}
                        stroke={hoveredIndex === i ? '#94a3b8' : 'transparent'}
                        strokeWidth="1"
                      />
                      <circle cx={cx} cy={cySleep} r="3.5" fill="#64748b" />
                      <circle cx={cx} cy={cySev} r="4.5" fill="#0d9488" stroke="#ffffff" strokeWidth="1.5" />
                      <text
                        x={cx}
                        y={height - 6}
                        textAnchor="middle"
                        className="fill-slate-400 text-[9px] font-mono"
                      >
                        {log.loggedDate.slice(5)}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
          )}
        </div>
      </div>

      {/* High-Density Clinical Check-In Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200">
          <h2 className="text-base font-semibold font-display text-slate-900">Recorded Episodes</h2>
        </div>
        {symptomLogs.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            Episodes logged via this form or detected during chat appear here.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                  <th className="py-3 px-4">Date</th>
                  <th className="py-3 px-4">Symptom</th>
                  <th className="py-3 px-4 text-right">Severity</th>
                  <th className="py-3 px-4 text-right">Sleep</th>
                  <th className="py-3 px-4">Triggers</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {symptomLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50/70">
                    <td className="py-3 px-4 font-mono text-xs text-slate-600 whitespace-nowrap">
                      {log.loggedDate}
                    </td>
                    <td className="py-3 px-4 font-medium text-slate-900">
                      <p>{log.symptom}</p>
                      {log.notes && <p className="text-xs text-slate-500 font-normal mt-0.5">{log.notes}</p>}
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-slate-900 whitespace-nowrap">
                      {log.severity}/10
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-slate-700 whitespace-nowrap">
                      {log.sleepHours}h
                    </td>
                    <td className="py-3 px-4 text-slate-600 text-xs">{log.triggers || '—'}</td>
                    <td className="py-3 px-4 text-right">
                      <button
                        type="button"
                        aria-label={`Delete log ${log.symptom}`}
                        onClick={() => void deleteSymptomLog(uid, log.id)}
                        className="p-1.5 text-slate-400 hover:text-rose-600 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
