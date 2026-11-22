import React, { useState } from 'react';
import { ArrowRight, BrainCircuit, ShieldCheck, Stethoscope } from 'lucide-react';

interface Props {
  onSignIn: () => Promise<void>;
  isSigningIn: boolean;
  authError: string | null;
}

export const WelcomeScreen: React.FC<Props> = ({ onSignIn, isSigningIn, authError }) => {
  const [imageError, setImageError] = useState(false);

  return (
    <div className="min-h-screen bg-[#090d16] text-slate-100 flex flex-col">
      {/* Top Bar Contract: 3 zones separated by gap-8 */}
      <header className="border-b border-slate-800/80 bg-[#090d16]/90 backdrop-blur-md">
        <div className="max-w-[1280px] mx-auto px-6 py-4 flex items-center justify-between gap-8">
          <a
            href="#top"
            className="text-lg font-semibold font-display tracking-tight text-slate-100 whitespace-nowrap shrink-0"
          >
            Meridian Care
          </a>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-400">
            <a
              href="#learning-loop"
              className="hover:text-slate-100 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Learning Loop
            </a>
            <a
              href="#memory-governance"
              className="hover:text-slate-100 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Memory Governance
            </a>
            <a
              href="#clinical-safety"
              className="hover:text-slate-100 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Clinical Safety
            </a>
          </nav>

          <div className="flex items-center shrink-0">
            <button
              type="button"
              onClick={onSignIn}
              disabled={isSigningIn}
              className="px-4 py-2 text-sm font-medium text-white bg-teal-600 hover:bg-teal-500 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              {isSigningIn ? 'Signing In...' : 'Sign In'}
            </button>
          </div>
        </div>
      </header>

      <main id="top" className="flex-1">
        {/* Hero Split */}
        <section className="max-w-[1280px] mx-auto px-6 py-12 lg:py-16">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-stretch">
            <div className="lg:col-span-6 flex flex-col justify-center">
              <p className="text-xs font-medium text-teal-400 mb-3">
                Longitudinal Health Intelligence · Personal Care Workspace
              </p>
              <h1
                className="text-4xl lg:text-5xl font-semibold font-display tracking-tight text-white leading-[1.12] mb-5"
                style={{ textWrap: 'balance' }}
              >
                A healthcare AI agent that learns how your body responds.
              </h1>
              <p className="text-base text-slate-300 leading-relaxed max-w-[58ch] mb-8">
                Meridian Care remembers your medications, sensitivities, recurring triggers, and communication
                preferences across sessions—improving every consultation through transparent memory extraction,
                correction-driven rules, and longitudinal symptom synthesis.
              </p>

              <div className="flex flex-wrap items-center gap-4">
                <button
                  type="button"
                  onClick={onSignIn}
                  disabled={isSigningIn}
                  className="inline-flex items-center gap-2.5 px-6 py-3 text-sm font-medium text-white bg-teal-600 hover:bg-teal-500 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  <span>{isSigningIn ? 'Connecting Account...' : 'Continue with Google'}</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
                <span className="text-xs text-slate-400">
                  Private per-user storage · Full memory inspection &amp; delete control
                </span>
              </div>

              {authError && (
                <div className="mt-4 p-3 bg-rose-950/60 border border-rose-800/70 rounded-lg text-sm text-rose-200">
                  {authError}
                </div>
              )}
            </div>

            <div className="lg:col-span-6 flex">
              <div className="w-full rounded-xl overflow-hidden border border-slate-800 bg-slate-900/70">
                {!imageError ? (
                  <img
                    src="/src/assets/images/clinical_care_hero_1795360550194.jpg"
                    alt="Minimalist clinical research workspace with natural morning daylight"
                    referrerPolicy="no-referrer"
                    onError={() => setImageError(true)}
                    className="w-full h-72 lg:h-full object-cover opacity-90"
                  />
                ) : (
                  <div className="w-full h-72 lg:h-full min-h-[340px] bg-gradient-to-br from-slate-900 to-teal-950/60 flex flex-col items-center justify-center p-8 text-center">
                    <Stethoscope className="w-10 h-10 text-teal-400 mb-3" />
                    <p className="text-sm font-medium text-slate-200">Meridian Care Clinical Studio</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Architecture Pillars */}
        <section id="learning-loop" className="border-t border-slate-800/80 bg-slate-900/40">
          <div className="max-w-[1280px] mx-auto px-6 py-12 lg:py-16">
            <div className="mb-10 max-w-2xl">
              <h2 className="text-2xl font-semibold font-display text-white mb-2">
                Three closed-loop learning mechanisms
              </h2>
              <p className="text-sm text-slate-400 leading-relaxed">
                Instead of starting from zero every chat, the agent continuously distills durable facts, adapts to your
                corrections, and correlates logged symptoms over time.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <div className="border-t border-slate-800 pt-5">
                <p className="text-xs font-mono text-teal-400 mb-2">01. Autonomous Extraction</p>
                <h3 className="text-base font-semibold font-display text-slate-100 mb-2">
                  Learns &amp; reinforces from dialogue
                </h3>
                <p className="text-sm text-slate-400 leading-relaxed">
                  Medications, sensitivities, conditions, and lifestyle triggers mentioned during consultations are
                  automatically distilled into structured memories with source quotes and reinforcement counts.
                </p>
              </div>

              <div id="memory-governance" className="border-t border-slate-800 pt-5">
                <p className="text-xs font-mono text-teal-400 mb-2">02. Feedback Distillation</p>
                <h3 className="text-base font-semibold font-display text-slate-100 mb-2">
                  Adapts permanently to corrections
                </h3>
                <p className="text-sm text-slate-400 leading-relaxed">
                  Correct any reply—such as preferring plain language or avoiding specific remedies—and the agent
                  extracts a permanent behavioral rule applied to all future consultations.
                </p>
              </div>

              <div id="clinical-safety" className="border-t border-slate-800 pt-5">
                <p className="text-xs font-mono text-teal-400 mb-2">03. Pattern Synthesis</p>
                <h3 className="text-base font-semibold font-display text-slate-100 mb-2">
                  Correlates symptoms &amp; sleep
                </h3>
                <p className="text-sm text-slate-400 leading-relaxed">
                  Structured symptom check-ins are analyzed alongside learned triggers to generate personalized care
                  playbooks and focused questions for your physician.
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-800/80 bg-[#090d16] py-6">
        <div className="max-w-[1280px] mx-auto px-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs text-slate-400">
          <div className="flex items-center gap-2">
            <BrainCircuit className="w-4 h-4 text-teal-400 shrink-0" />
            <span>Meridian Care · Educational clinical guidance only — not a substitute for licensed medical diagnosis.</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <ShieldCheck className="w-4 h-4 text-slate-500 shrink-0" />
            <span>Owner-isolated Firestore memory</span>
          </div>
        </div>
      </footer>
    </div>
  );
};
