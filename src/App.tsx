/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ErrorBoundary } from './components/ErrorBoundary';
import { ResearchNetworkView } from './components/ResearchNetworkView';

export default function App() {
  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-[#090d16] text-slate-100 flex flex-col">
        <main className="flex-1 flex flex-col">
          <ResearchNetworkView />
        </main>
      </div>
    </ErrorBoundary>
  );
}
