import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../api';
import { useApi } from '../useApi';
import { allCitiesLabel, formatNumber, formatRating, formatScore, placeKey, pluralDomain, prettyAspect } from '../format';
import './ComparePlaces.css';

const ALL_CITIES = '';
const COLOR_A = 'var(--marigold)';
const COLOR_B = 'var(--lake)';

function SummaryRow({ label, place, color, scope }) {
  if (!place) return null;
  return (
    <div className="compare-summary-row">
      <span className="compare-summary-label" style={{ color }}>{label}</span>
      <div className="compare-summary-name">{place.place}</div>
      <span className="place-details-city">{place.city}</span>
      <div className="compare-summary-meta">
        <b style={{ color }}>{formatRating(place.mean_rating)} ★</b><span>place mean star rating</span>
        <span>{formatNumber(place.n_reviews)} reviews · rank #{place.rank} in {scope}</span>
      </div>
    </div>
  );
}

function ChartTooltip({ active, payload, placeA, placeB }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload.row;
  const line = (p, score, n, s) => (
    <div>
      <b>{p.place}</b> ({p.city}): {formatScore(score)} · {n} reviews
      <small>DistilBERT {formatScore(s.distilbert)} · BERT-en {formatScore(s.bert_en)} · VADER {formatScore(s.vader)}</small>
    </div>
  );
  return (
    <div className="chart-tooltip">
      <strong>{prettyAspect(row.aspect)}</strong>
      {line(placeA, row.a_score, row.a_unique_reviews, row.a_supporting_scores)}
      {line(placeB, row.b_score, row.b_unique_reviews, row.b_supporting_scores)}
    </div>
  );
}

export default function ComparePlaces({ overview, preset }) {
  const [city, setCity] = useState(preset ? preset.scope : overview.cities[0] ?? ALL_CITIES);
  const [domain, setDomain] = useState(preset ? preset.domain : overview.domains[0]);
  const [chosenA, setChosenA] = useState(preset ? placeKey(preset) : '');
  const [chosenB, setChosenB] = useState('');

  const placesReq = useApi(api.rankings, domain, city);
  const places = useMemo(() => placesReq.data?.places ?? [], [placesReq.data]);
  const byKey = useMemo(() => new Map(places.map((p) => [placeKey(p), p])), [places]);

  const keyA = byKey.has(chosenA) ? chosenA : places[0] ? placeKey(places[0]) : '';
  const firstOther = places.find((p) => placeKey(p) !== keyA);
  const keyB = byKey.has(chosenB) && chosenB !== keyA ? chosenB : firstOther ? placeKey(firstOther) : '';
  const placeA = byKey.get(keyA);
  const placeB = byKey.get(keyB);

  const cmp = useApi(placeA && placeB ? api.compare : null, domain, placeA?.city, placeA?.place, placeB?.city, placeB?.place);
  const chartData = (cmp.data?.aspects ?? []).map((row) => ({ aspect: prettyAspect(row.aspect), a_score: row.a_score, b_score: row.b_score, row }));

  const nameCounts = useMemo(() => places.reduce((acc, p) => acc.set(p.place, (acc.get(p.place) || 0) + 1), new Map()), [places]);
  const optionLabel = (p) => (nameCounts.get(p.place) > 1 ? `${p.place} (${p.city})` : p.place);
  const minReviews = overview.min_aspect_reviews;
  const scopeLabel = `${city || allCitiesLabel(overview.cities).toLowerCase()} ${pluralDomain(domain).toLowerCase()}`;

  return (
    <div className="dashboard-page compare-places-page">
      <aside className="card compare-left">
        <div className="module-heading"><span>Choose places to compare</span></div>
        <div className="compare-selects">
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
          <label>
            Place A
            <select value={keyA} onChange={(e) => setChosenA(e.target.value)}>
              {places.map((p) => <option key={placeKey(p)} value={placeKey(p)}>{optionLabel(p)}</option>)}
            </select>
          </label>
          <label>
            Place B
            <select value={keyB} onChange={(e) => setChosenB(e.target.value)} disabled={!firstOther}>
              {places.filter((p) => placeKey(p) !== keyA).map((p) => <option key={placeKey(p)} value={placeKey(p)}>{optionLabel(p)}</option>)}
            </select>
          </label>
        </div>
        <div className="threshold-notice">Only aspects mentioned in at least <strong>{minReviews} different reviews of each place</strong> are compared.</div>
        {placesReq.error && <div className="error-text">{placesReq.error.message}</div>}

        <div className="compare-summary-stack">
          <SummaryRow label="Place A" place={placeA} color={COLOR_A} scope={scopeLabel} />
          {placeB && <div className="compare-divider" />}
          <SummaryRow label="Place B" place={placeB} color={COLOR_B} scope={scopeLabel} />
        </div>
      </aside>

      <section className="card chart-panel">
        <div className="panel-title-row">
          <div>
            <h2>Aspect sentiment comparison</h2>
            <span>TF-IDF + Logistic Regression directional score, −1 to +1</span>
          </div>
          {chartData.length > 0 && <strong>{chartData.length} shared aspect{chartData.length === 1 ? '' : 's'}</strong>}
        </div>

        {placesReq.data && !firstOther ? (
          <div className="empty-state">
            {city ? `${city} has only one ${domain.toLowerCase()} in the data. Switch City to “${allCitiesLabel(overview.cities)}” to compare it with places elsewhere.` : 'This domain has fewer than two places.'}
          </div>
        ) : cmp.error ? (
          <div className="empty-state error-text">{cmp.error.message}</div>
        ) : cmp.loading || placesReq.loading ? (
          <div className="empty-state">Loading comparison…</div>
        ) : cmp.data && chartData.length === 0 ? (
          <div className="empty-state">These two places share no aspect with {minReviews}+ reviews each.</div>
        ) : cmp.data ? (
          <>
            <div className="compare-legend">
              <span><i style={{ background: COLOR_A }} />{placeA.place} · {placeA.city}</span>
              <span><i style={{ background: COLOR_B }} />{placeB.place} · {placeB.city}</span>
            </div>
            <div className="scroll-area">
              <ResponsiveContainer width="100%" height={Math.max(360, chartData.length * 48)}>
                <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }} barCategoryGap="20%" barGap={2}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" horizontal={false} />
                  <XAxis type="number" domain={[-1, 1]} ticks={[-1, -0.5, 0, 0.5, 1]} stroke="var(--ink-faint)" fontSize={11} />
                  <YAxis type="category" dataKey="aspect" width={150} stroke="var(--ink-faint)" fontSize={11} interval={0} tick={{ fill: 'var(--ink-dim)' }} />
                  <ReferenceLine x={0} stroke="var(--ink-dim)" strokeWidth={1.5} />
                  <Tooltip content={<ChartTooltip placeA={placeA} placeB={placeB} />} cursor={{ fill: 'rgba(63,167,150,.06)' }} />
                  <Bar dataKey="a_score" fill={COLOR_A} radius={[0, 4, 4, 0]} />
                  <Bar dataKey="b_score" fill={COLOR_B} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </>
        ) : null}
      </section>
    </div>
  );
}
