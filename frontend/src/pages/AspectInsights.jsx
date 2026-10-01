import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import { api } from '../api';
import { useApi } from '../useApi';
import { allCitiesLabel, formatScore, placeKey, pluralDomain, prettyAspect } from '../format';
import './AspectInsights.css';

const ALL_CITIES = '';
const ROW_HEIGHT = 42;
const truncate = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function ValueLabel({ x, y, width, height, value }) {
  if (value == null) return null;
  const zeroX = value >= 0 ? Math.min(x, x + width) : Math.max(x, x + width);
  const positive = value >= 0;
  return (
    <text x={positive ? zeroX - 6 : zeroX + 6} y={y + height / 2} dy="0.35em" textAnchor={positive ? 'end' : 'start'} fill="var(--ink-dim)" fontSize={11}>
      {formatScore(value)}
    </text>
  );
}

export default function AspectInsights({ overview }) {
  const [city, setCity] = useState(overview.cities[0] ?? ALL_CITIES);
  const [domain, setDomain] = useState(overview.domains[0]);
  const [chosenAspect, setChosenAspect] = useState('');
  const [chosenKey, setChosenKey] = useState(null);
  const minReviews = overview.min_aspect_reviews;

  const aspectReq = useApi(api.aspectList, domain, city);
  const aspects = aspectReq.data?.aspects ?? [];
  const available = aspects.filter((a) => a.places > 0);
  const aspect = available.some((a) => a.aspect === chosenAspect) ? chosenAspect : available[0]?.aspect ?? '';

  const { data, error, loading } = useApi(aspect ? api.aspectRanking : null, domain, aspect, city);
  const rows = useMemo(() => {
    const places = data?.places ?? [];
    const counts = places.reduce((m, p) => m.set(p.place, (m.get(p.place) || 0) + 1), new Map());
    return places.map((p) => ({ ...p, key: placeKey(p), label: counts.get(p.place) > 1 ? `${truncate(p.place, 20)} (${p.city})` : truncate(p.place, 28) }));
  }, [data]);
  const selected = rows.find((r) => r.key === chosenKey) ?? rows[0];
  const anyError = aspectReq.error || error;

  return (
    <div className="dashboard-page aspect-insights-page">
      <aside className="insights-side card">
        <div className="module-heading"><span>Filters</span></div>
        <label>
          City
          <select value={city} onChange={(e) => setCity(e.target.value)}>
            {overview.cities.map((c) => <option key={c} value={c}>{c}</option>)}
            <option value={ALL_CITIES}>{allCitiesLabel(overview.cities)}</option>
          </select>
        </label>
        <label>
          Domain
          <select value={domain} onChange={(e) => setDomain(e.target.value)}>
            {overview.domains.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </label>
        <div className="module-heading aspect-heading"><span>Aspects</span><small>{available.length} of {aspects.length} with data</small></div>
        <div className="aspect-pills">
          {aspects.map(({ aspect: a, places }) => (
            <button
              key={a}
              className={`aspect-pill ${aspect === a ? 'aspect-pill-active' : ''}`}
              onClick={() => setChosenAspect(a)}
              disabled={places === 0}
              title={places ? `${prettyAspect(a)}: ${places} place${places === 1 ? '' : 's'} with ${minReviews}+ reviews` : `No place here has ${minReviews}+ reviews mentioning ${prettyAspect(a)}`}
            >
              <span>{prettyAspect(a)}</span><small>{places}</small>
            </button>
          ))}
        </div>
      </aside>

      <section className="card chart-panel">
        <div className="panel-title-row">
          <div>
            <h2>{aspect ? prettyAspect(aspect) : 'Aspect'} · {pluralDomain(domain)}</h2>
            <span>{city || allCitiesLabel(overview.cities)} · TF-IDF + Logistic Regression directional score, −1 to +1</span>
          </div>
          <strong>{rows.length} place{rows.length === 1 ? '' : 's'}</strong>
        </div>
        <div className="threshold-notice">Only places where at least <strong>{minReviews} different reviews</strong> mention this aspect are shown.</div>
        {anyError && <div className="empty-state error-text">{anyError.message}</div>}
        {!anyError && (loading || aspectReq.loading) && <div className="empty-state">Loading…</div>}
        {!anyError && data && rows.length === 0 && (
          <div className="empty-state">No place in this selection has {minReviews}+ reviews mentioning this aspect.</div>
        )}
        {!anyError && data && rows.length > 0 && (
          <div className="scroll-area">
            <ResponsiveContainer width="100%" height={Math.max(320, rows.length * ROW_HEIGHT)}>
              <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 40, top: 4, bottom: 4 }} barCategoryGap="20%">
                <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" horizontal={false} />
                <XAxis type="number" domain={[-1, 1]} ticks={[-1, -0.5, 0, 0.5, 1]} stroke="var(--ink-faint)" fontSize={11} />
                <YAxis type="category" dataKey="key" tickFormatter={(k) => rows.find((r) => r.key === k)?.label ?? k} width={210} stroke="var(--ink-faint)" fontSize={11} interval={0} tick={{ fill: 'var(--ink-dim)' }} />
                <ReferenceLine x={0} stroke="var(--ink-dim)" strokeWidth={1.5} />
                <Bar dataKey="score" radius={[0, 4, 4, 0]} barSize={24} cursor="pointer" onClick={(bar) => setChosenKey(bar.payload.key)}>
                  {rows.map((r) => (
                    <Cell
                      key={r.key}
                      fill={r.score >= 0 ? 'var(--lake)' : 'var(--rhododendron)'}
                      stroke={r.key === selected?.key ? 'var(--ink)' : 'none'}
                      strokeWidth={r.key === selected?.key ? 1.5 : 0}
                    />
                  ))}
                  <LabelList dataKey="score" content={<ValueLabel />} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <aside className="card insight-details">
        <div className="module-heading"><span>Details</span><small>click a bar to switch</small></div>
        {selected ? (
          <div>
            <strong className="place-details-name">{selected.place}</strong>
            <span className="place-details-city">{selected.city}</span>
            <div className="place-details-stat"><span>Directional score</span><strong>{formatScore(selected.score)}</strong></div>
            <div className="place-details-stat"><span>Reviews mentioning</span><strong>{selected.unique_reviews}</strong></div>
            <div className="aspect-block">
              <span className="aspect-block-label">Supporting signals</span>
              <p className="supporting-note">The same aspect scored by the two fine-tuned transformers, and by VADER, a lexicon-based scorer whose compound score is on its own −1 to +1 scale.</p>
              <div className="supporting-row"><span>DistilBERT</span><b>{formatScore(selected.supporting_scores.distilbert)}</b></div>
              <div className="supporting-row"><span>BERT-en</span><b>{formatScore(selected.supporting_scores.bert_en)}</b></div>
              <div className="supporting-row"><span>VADER</span><b>{formatScore(selected.supporting_scores.vader)}</b></div>
            </div>
          </div>
        ) : (
          <div className="empty-state">Select a bar to see its details.</div>
        )}
        <div className="insight-method">
          <strong>How to read this</strong>
          <p>+1 means reviews mentioning this aspect are consistently positive, −1 consistently negative, 0 balanced or neutral. Scores compare places on one aspect; they are not star ratings.</p>
        </div>
      </aside>
    </div>
  );
}
