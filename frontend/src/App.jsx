import { useState } from 'react';
import Nav from './components/Nav';
import ConnectionStatus from './components/ConnectionStatus';
import Overview from './pages/Overview';
import Rankings from './pages/Rankings';
import AspectInsights from './pages/AspectInsights';
import ComparePlaces from './pages/ComparePlaces';
import AnalyzeReview from './pages/AnalyzeReview';
import { PAGES } from './pageRegistry';
import { api } from './api';
import { useApi } from './useApi';

export default function App() {
  const [pageId, setPageId] = useState(PAGES[0].id);
  const [comparePreset, setComparePreset] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const { data: overview, error } = useApi(api.overview, attempt);

  const navigate = (next) => { setComparePreset(null); setPageId(next); };
  const goToComparePlaces = ({ scope, domain, city, place }) => {
    setComparePreset({ scope, domain, city, place, token: Date.now() });
    setPageId('compare-places');
  };

  const page = PAGES.find((p) => p.id === pageId);
  let content;
  if (error) {
    content = (
      <div className="card load-failure">
        <strong>The dashboard data could not be loaded.</strong>
        <p className="error-text">{error.message}</p>
        <button className="btn btn-primary" onClick={() => setAttempt((n) => n + 1)}>Try again</button>
      </div>
    );
  } else if (!overview) {
    content = <div className="empty-state">Loading dataset…</div>;
  } else {
    content = (
      <>
        {pageId === 'overview' && <Overview overview={overview} />}
        {pageId === 'rankings' && <Rankings overview={overview} onCompareRequest={goToComparePlaces} />}
        {pageId === 'aspect-insights' && <AspectInsights overview={overview} />}
        {pageId === 'compare-places' && <ComparePlaces key={comparePreset?.token ?? 'default'} overview={overview} preset={comparePreset} />}
        {pageId === 'analyze-review' && <AnalyzeReview />}
      </>
    );
  }

  return (
    <div className="app-shell">
      <Nav current={pageId} onNavigate={navigate} overview={overview} />
      <main className="app-main">
        <header className="topbar">
          <div>
            <h1 className="topbar-title">{page.label}</h1>
            <span className="topbar-subtitle">{page.subtitle}</span>
          </div>
          <ConnectionStatus />
        </header>
        <div className="page-viewport">{content}</div>
      </main>
    </div>
  );
}
