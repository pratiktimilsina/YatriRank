import { useState } from 'react';
import { api } from '../api';
import { useApi } from '../useApi';
import './AnalyzeReview.css';

const MODELS = [
  { key: 'tfidf_lr', name: 'TF-IDF + Logistic Regression', base: null },
  { key: 'distilbert', name: 'DistilBERT (multilingual)', base: 'distilbert-base-multilingual-cased, fine-tuned' },
  { key: 'bert_en', name: 'BERT-en (English-only)', base: 'bert-base-uncased, fine-tuned' },
];

const EXAMPLES = [
  { label: 'Positive', text: 'Absolutely loved our stay. The staff went out of their way to help, the room was spotless, and the view was unbeatable.' },
  { label: 'Negative', text: 'Disappointing visit. The place was dirty, poorly maintained, and not worth the time.' },
  { label: 'Neutral', text: 'The hotel is a short walk from the main square. Rooms are an average size, breakfast is included, and check-in starts at 2 pm.' },
];

const tone = (label) => {
  const l = String(label).toLowerCase();
  return ['positive', 'neutral', 'negative'].includes(l) ? l : 'other';
};

function ModelResult({ name, base, result }) {
  const rows = Object.entries(result.probabilities).sort((a, b) => b[1] - a[1]);
  return (
    <div className="card model-result">
      <div className="model-title">
        <span>{name}{base && <small>{base}</small>}</span>
        <b className={`tone-${tone(result.label)}`}>{result.label}</b>
      </div>
      <div className="prob-list">
        {rows.map(([label, p]) => (
          <div className="prob-row" key={label}>
            <span className="prob-name">{label}</span>
            <span className="prob-track"><span className={`prob-fill fill-${tone(label)}`} style={{ width: `${p * 100}%` }} /></span>
            <strong>{(p * 100).toFixed(1)}%</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AnalyzeReview() {
  const [text, setText] = useState('');
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);
  const statusReq = useApi(api.modelsStatus);
  const status = statusReq.data?.models;
  const tfidfUnavailable = status?.tfidf_lr?.available === false;
  const unavailableModels = status
    ? MODELS.filter((m) => status[m.key] && !status[m.key].available && m.key !== 'tfidf_lr')
    : [];
  const runtimeErrors = result
    ? Object.entries(result.errors || {}).filter(([key]) => status?.[key]?.available)
    : [];

  const analyze = () => {
    if (!text.trim() || running || tfidfUnavailable) return;
    setRunning(true);
    setError(null);
    api.predict(text)
      .then(setResult)
      .catch((e) => { setResult(null); setError(e.message); })
      .finally(() => setRunning(false));
  };
  const clear = () => { setText(''); setResult(null); setError(null); };

  return (
    <div className="dashboard-page analyze-review-page">
      <section className="card">
        <div className="module-heading"><span>Review text</span></div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) analyze(); }}
          placeholder="Paste or type an English review of a hotel or attraction…"
        />
        <div className="review-actions">
          <button className="btn btn-primary" onClick={analyze} disabled={running || !text.trim() || tfidfUnavailable}>{running ? 'Analyzing…' : 'Analyze'}</button>
          <button className="btn btn-ghost" onClick={clear}>Clear</button>
        </div>
        <div className="example-row">
          <span className="example-label">Try an example</span>
          {EXAMPLES.map((ex) => (
            <button key={ex.label} className="example-chip" onClick={() => { setText(ex.text); setResult(null); }}>{ex.label}</button>
          ))}
        </div>
        {error && <p className="error-text">{error}</p>}
      </section>

      <section className="card">
        <div className="module-heading"><span>Model availability</span></div>
        {statusReq.error && <p className="error-text">{statusReq.error.message}</p>}
        {statusReq.loading && <p className="muted">Loading models, which can take a moment on first start…</p>}
        {status && (
          <div className="model-status-row">
            {MODELS.map(({ key, name }) => {
              const s = status[key];
              if (!s) return null;
              return (
                <span key={key} className={`model-status-chip ${s.available ? 'status-ok' : 'status-down'}`} title={s.available ? 'Loaded' : s.reason}>
                  <span className="status-dot" />{name}{!s.available && ' · unavailable'}
                </span>
              );
            })}
          </div>
        )}
        {status?.tfidf_lr?.available === false && (
          <p className="error-text">TF-IDF + Logistic Regression is unavailable, so Analyze is disabled. {status.tfidf_lr.reason}</p>
        )}
        {unavailableModels.length > 0 && (
          <p className="error-text">Unavailable models: {unavailableModels.map((m) => `${m.name} — ${status[m.key].reason}`).join(' · ')}</p>
        )}
      </section>

      {runtimeErrors.length > 0 && (
        <p className="error-text" role="alert">One or more models failed during analysis: {runtimeErrors.map(([key, message]) => `${key}: ${message}`).join(' · ')}</p>
      )}

      {result && (
        <section className="results-grid" aria-label="Analysis result">
          {MODELS.filter((m) => result.models[m.key]).map((m) => (
            <ModelResult key={m.key} name={m.name} base={m.base ?? status?.[m.key]?.details} result={result.models[m.key]} />
          ))}
        </section>
      )}
    </div>
  );
}
