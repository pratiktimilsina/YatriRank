export const formatNumber = (v) => (v == null ? '—' : Number(v).toLocaleString());
export const formatRating = (v) => (v == null ? '—' : Number(v).toFixed(2));
export const formatScore = (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${Number(v).toFixed(2)}`);
export const prettyAspect = (a) => a.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
export const allCitiesLabel = (cities) => (cities.length === 2 ? 'Both cities' : 'All cities');
export const pluralDomain = (d) => (d.endsWith('s') ? d : `${d}s`);
export const placeKey = (p) => `${p.city}||${p.place}`;
