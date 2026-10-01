import { useMemo, useState } from 'react';
import { api } from '../api';
import { useApi } from '../useApi';
import { allCitiesLabel, formatNumber, formatRating, formatScore, placeKey, pluralDomain, prettyAspect } from '../format';
import './Rankings.css';

const ALL_CITIES = '';

const SORT_OPTIONS = [
  { value: 'rank', label: 'Rank' },
  { value: 'rating_asc', label: 'Place mean star rating, low to high' },
  { value: 'reviews_desc', label: 'Most reviews' },
  { value: 'reviews_asc', label: 'Fewest reviews' },
  { value: 'name_asc', label: 'Name A–Z' },
];

const SORTERS = {
  rank: (a, b) => a.rank - b.rank,
  rating_asc: (a, b) => a.mean_rating - b.mean_rating || a.rank - b.rank,
  reviews_desc: (a, b) => b.n_reviews - a.n_reviews || a.rank - b.rank,
  reviews_asc: (a, b) => a.n_reviews - b.n_reviews || a.rank - b.rank,
  name_asc: (a, b) => a.place.localeCompare(b.place) || a.city.localeCompare(b.city),
};

function AspectList({ title, items }) {
  if (!items.length) return null;
  return (
    <div className="aspect-block">
      <span className="aspect-block-label">{title}</span>
      {items.map((a) => (
        <div className="aspect-line" key={a.aspect}>
          <span>{prettyAspect(a.aspect)}</span>
          <b className={a.score >= 0 ? 'score-pos' : 'score-neg'}>{formatScore(a.score)}</b>
        </div>
      ))}
    </div>
  );
}

export default function Rankings({ overview, onCompareRequest }) {
  const [city, setCity] = useState(overview.cities[0] ?? ALL_CITIES);
  const [domain, setDomain] = useState(overview.domains[0]);
  const [sortBy, setSortBy] = useState('rank');
  const [selectedKey, setSelectedKey] = useState(null);

  const { data, error, loading } = useApi(api.rankings, domain, city);
  const rows = useMemo(() => data?.places ?? [], [data]);
  const summary = data?.summary;
  const sortedRows = useMemo(() => [...rows].sort(SORTERS[sortBy]), [rows, sortBy]);

  const selected = rows.find((r) => placeKey(r) === selectedKey);
  const aspectsReq = useApi(selected ? api.placeAspects : null, domain, selected?.city, selected?.place);
  const aspects = aspectsReq.data?.aspects ?? [];
  const strongest = aspects.slice(0, 3);
  const weakest = aspects.slice(Math.max(strongest.length, aspects.length - 3)).reverse();
  const minReviews = overview.min_aspect_reviews;

  return (
    <div className="dashboard-page rankings-page">
      <aside className="dashboard-side card">
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
        <label>
          Sort by
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
            {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <p className="side-note">Places are ranked by their place mean star rating within the selected city and domain. Sorting changes only the order of the list.</p>
      </aside>

      <section className="card ranking-panel">
        <div className="panel-title-row">
          <div>
            <h2>{pluralDomain(domain)} · {city || allCitiesLabel(overview.cities)}</h2>
            <span>{rows.length} place{rows.length === 1 ? '' : 's'} · click a place for details</span>
          </div>
        </div>
        {loading && <div className="empty-state">Loading rankings…</div>}
        {error && <div className="empty-state error-text">{error.message}</div>}
        {data && !rows.length && <div className="empty-state">No places in this selection.</div>}
        {data && rows.length > 0 && (
          <div className="scroll-area">
            {sortedRows.map((place) => {
              const key = placeKey(place);
              return (
                <button key={key} className={`ranking-row ${selectedKey === key ? 'ranking-row-selected' : ''}`} onClick={() => setSelectedKey(key)}>
                  <span className={`rank-badge ${place.rank === 1 ? 'rank-badge-first' : ''}`}>{place.rank}</span>
                  <div className="ranking-main">
                    <div className="ranking-top-line">
                      <strong>{place.place}</strong>
                      <b>{formatRating(place.mean_rating)} ★</b>
                    </div>
                    <div className="ranking-sub-line">{place.city} · {formatNumber(place.n_reviews)} reviews</div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      <aside className="dashboard-side card ranking-details">
        <div className="module-heading"><span>Summary</span></div>
        {summary && summary.places > 0 ? (
          <>
            <div className="detail-stat"><span>Places</span><strong>{formatNumber(summary.places)}</strong></div>
            <div className="detail-stat"><span>Reviews</span><strong>{formatNumber(summary.reviews)}</strong></div>
            <div className="detail-stat"><span>City-domain mean star rating</span><strong>{formatRating(summary.mean_rating)} ★</strong></div>
            <div className="detail-stat"><span>Highest place mean star rating</span><strong>{formatRating(summary.max_rating)} ★</strong></div>
            <div className="detail-stat"><span>Lowest place mean star rating</span><strong>{formatRating(summary.min_rating)} ★</strong></div>
          </>
        ) : (
          <div className="empty-state">No data.</div>
        )}

        {selected && (
          <div className="place-details">
            <div className="module-heading"><span>Place details</span></div>
            <strong className="place-details-name">{selected.place}</strong>
            <span className="place-details-city">{selected.city}</span>
            <div className="place-tiles">
              <div><strong>#{selected.rank}<small> of {rows.length}</small></strong><span>Rank</span></div>
              <div><strong>{formatRating(selected.mean_rating)} ★</strong><span>Place mean star rating</span></div>
              <div><strong>{formatNumber(selected.n_reviews)}</strong><span>Reviews</span></div>
            </div>

            {aspectsReq.loading && <p className="aspect-note">Loading aspects…</p>}
            {aspectsReq.error && <p className="error-text aspect-note">{aspectsReq.error.message}</p>}
            {aspects.length > 0 && (
              <div className="aspect-columns">
                <AspectList title="Highest scores" items={strongest} />
                <AspectList title="Lowest scores" items={weakest} />
              </div>
            )}
            {aspectsReq.data && !aspects.length && (
              <p className="aspect-note">No aspect is mentioned in {minReviews}+ reviews of this place.</p>
            )}
            {aspects.length > 0 && <p className="aspect-note">Directional score, −1 to +1 (TF-IDF + Logistic Regression).</p>}

            <button className="btn btn-ghost full-width" onClick={() => onCompareRequest({ scope: city, domain, city: selected.city, place: selected.place })}>
              Open in Compare Places →
            </button>
          </div>
        )}
      </aside>
    </div>
  );
}
