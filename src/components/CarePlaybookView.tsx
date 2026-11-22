import React, { useEffect, useState } from 'react';
import { Printer, RefreshCw, Save } from 'lucide-react';
import type {
  CommunicationStyle,
  LearnedMemory,
  PatientProfile,
  PreferredUnits,
  SymptomLog,
  SynthesizeApiResponse,
} from '../types/healthcare';
import {
  createManualMemory,
  updatePatientCareSummary,
  updatePatientPreferences,
} from '../lib/firestoreService';

interface Props {
  uid: string;
  profile: PatientProfile | null;
  memories: LearnedMemory[];
  symptomLogs: SymptomLog[];
  synthesis: SynthesizeApiResponse | null;
  onSynthesisComplete: (result: SynthesizeApiResponse) => void;
}

export const CarePlaybookView: React.FC<Props> = ({
  uid,
  profile,
  memories,
  symptomLogs,
  synthesis,
  onSynthesisComplete,
}) => {
  const [displayName, setDisplayName] = useState(profile?.displayName || '');
  const [communicationStyle, setCommunicationStyle] = useState<CommunicationStyle>(
    profile?.communicationStyle || 'plain_language'
  );
  const [preferredUnits, setPreferredUnits] = useState<PreferredUnits>(
    profile?.preferredUnits || 'metric'
  );
  const [isSavingPrefs, setIsSavingPrefs] = useState(false);
  const [prefsSavedMsg, setPrefsSavedMsg] = useState<string | null>(null);

  const [isGenerating, setIsGenerating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (profile) {
      setDisplayName(profile.displayName);
      setCommunicationStyle(profile.communicationStyle);
      setPreferredUnits(profile.preferredUnits);
    }
  }, [profile]);

  const handleSavePrefs = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim() || isSavingPrefs) return;
    setIsSavingPrefs(true);
    setPrefsSavedMsg(null);
    setErrorMsg(null);
    try {
      await updatePatientPreferences(uid, {
        displayName: displayName.trim(),
        communicationStyle,
        preferredUnits,
      });
      setPrefsSavedMsg('Agent communication preferences updated for all future consultations.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to save preferences.');
    } finally {
      setIsSavingPrefs(false);
    }
  };

  const handleRefreshPlaybook = async () => {
    if (isGenerating) return;
    setIsGenerating(true);
    setErrorMsg(null);
    try {
      const activeMemories = memories.filter((m) => m.status === 'active');
      const res = await fetch('/api/agent/synthesize-patterns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symptomLogs: symptomLogs.slice(0, 20),
          memories: activeMemories,
          profile: {
            displayName: profile?.displayName || displayName || 'Patient',
            communicationStyle,
            preferredUnits,
          },
        }),
      });
      const data = (await res.json()) as SynthesizeApiResponse & { error?: string };
      if (!res.ok) {
        throw new Error(data.error || 'Could not synthesize playbook.');
      }

      let added = 0;
      for (const pattern of (data.discoveredPatterns || []).slice(0, 3)) {
        const exists = activeMemories.some(
          (m) => m.title.toLowerCase() === pattern.title.toLowerCase()
        );
        if (!exists) {
          await createManualMemory(uid, {
            category: pattern.category || 'trigger',
            title: pattern.title,
            detail: pattern.detail,
            source: 'pattern_synthesis',
            confidence: pattern.confidence === 'high' ? 'high' : 'medium',
            evidenceQuote: pattern.evidenceQuote || 'Synthesized into Care Playbook',
          });
          added++;
        }
      }

      if (data.careSummary) {
        await updatePatientCareSummary(
          uid,
          data.careSummary,
          (profile?.learningCount || 0) + Math.max(1, added)
        );
      }

      onSynthesisComplete(data);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to refresh playbook.');
    } finally {
      setIsGenerating(false);
    }
  };

  const activeMemories = memories.filter((m) => m.status === 'active');

  return (
    <div className="max-w-[1280px] mx-auto px-4 lg:px-6 py-8 space-y-8">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 no-print">
        <div>
          <h1 className="text-2xl font-semibold font-display text-slate-900">
            Care Playbook &amp; Adaptation Settings
          </h1>
          <p className="text-sm text-slate-600 mt-1 max-w-2xl">
            Configure how Meridian Care communicates with you and generate an updated clinical summary for physician
            visits.
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => void handleRefreshPlaybook()}
            disabled={isGenerating}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-4 h-4 ${isGenerating ? 'animate-spin' : ''}`} />
            {isGenerating ? 'Synthesizing...' : 'Generate Playbook'}
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <Printer className="w-4 h-4" />
            Print Summary
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-sm text-rose-800">{errorMsg}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left: Care Overview & Playbook */}
        <div className="lg:col-span-7 space-y-6">
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold font-display text-slate-900">Synthesized Patient Overview</h2>
              <span className="text-xs font-mono text-slate-500">
                {profile?.learningCount ?? 0} learning cycles · {activeMemories.length} active facts
              </span>
            </div>
            <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-line">
              {synthesis?.careSummary ||
                profile?.careSummary ||
                'Generate your playbook once you have shared health context or logged symptom check-ins.'}
            </p>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <h2 className="text-base font-semibold font-display text-slate-900">Personalized Care Actions</h2>
            {!synthesis?.carePlaybook || synthesis.carePlaybook.length === 0 ? (
              <p className="text-sm text-slate-500 leading-relaxed">
                Click Generate Playbook above to synthesize actionable daily protocols from your learned memories and
                symptom logs.
              </p>
            ) : (
              <div className="divide-y divide-slate-200">
                {synthesis.carePlaybook.map((item, idx) => (
                  <div key={idx} className="py-3.5 first:pt-0 last:pb-0">
                    <p className="text-xs font-mono text-teal-700 mb-1">{item.phase}</p>
                    <p className="text-sm font-medium text-slate-900">{item.action}</p>
                    <p className="text-xs text-slate-600 mt-1 leading-relaxed">{item.rationale}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
            <h2 className="text-base font-semibold font-display text-slate-900">
              Questions for Your Next Physician Visit
            </h2>
            {!synthesis?.clinicianQuestions || synthesis.clinicianQuestions.length === 0 ? (
              <p className="text-sm text-slate-500">
                Synthesize your playbook to generate tailored clinical questions grounded in your history.
              </p>
            ) : (
              <ol className="list-decimal pl-5 space-y-2 text-sm text-slate-700">
                {synthesis.clinicianQuestions.map((q, idx) => (
                  <li key={idx} className="pl-1 leading-relaxed">
                    {q}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>

        {/* Right: Adaptive Agent Preferences */}
        <form
          onSubmit={handleSavePrefs}
          className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-4 no-print"
        >
          <h2 className="text-base font-semibold font-display text-slate-900">Agent Adaptation Settings</h2>
          <p className="text-xs text-slate-500 leading-relaxed">
            These rules govern how the agent frames explanations, clinical depth, and measurement units in every
            consultation.
          </p>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Preferred Name</label>
            <input
              type="text"
              required
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-teal-700"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Communication Style</label>
            <select
              value={communicationStyle}
              onChange={(e) => setCommunicationStyle(e.target.value as CommunicationStyle)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:border-teal-700"
            >
              <option value="plain_language">Plain Language (Warm, jargon-free)</option>
              <option value="concise">Concise (Short action checklists)</option>
              <option value="detailed">Detailed (Physiological rationale included)</option>
              <option value="clinical">Clinical (Structured medical terminology)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Measurement Units</label>
            <select
              value={preferredUnits}
              onChange={(e) => setPreferredUnits(e.target.value as PreferredUnits)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:border-teal-700"
            >
              <option value="metric">Metric (°C, kg, ml)</option>
              <option value="imperial">Imperial (°F, lbs, fl oz)</option>
            </select>
          </div>

          <button
            type="submit"
            disabled={isSavingPrefs}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-50 rounded-lg transition-colors"
          >
            <Save className="w-4 h-4" />
            {isSavingPrefs ? 'Saving Preferences...' : 'Save Agent Settings'}
          </button>

          {prefsSavedMsg && (
            <p className="text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg p-3">
              {prefsSavedMsg}
            </p>
          )}
        </form>
      </div>
    </div>
  );
};
