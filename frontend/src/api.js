const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

async function request(path, options = {}) {
  let res;
  try {
    res = await fetch(`${BASE_URL}${path}`, options);
  } catch {
    const err = new Error(`Cannot reach the backend at ${BASE_URL}. Is uvicorn running?`);
    err.status = 0;
    throw err;
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const detail = Array.isArray(body.detail) ? body.detail.map((d) => d.msg).join('; ') : body.detail;
    const err = new Error(detail || `Request failed: ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

const query = (params) => {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v) q.set(k, v); });
  return q.toString();
};

export const api = {
  health: () => request('/api/health'),
  modelsStatus: () => request('/api/models/status'),
  overview: () => request('/api/overview'),
  rankings: (domain, city) => request(`/api/rankings?${query({ domain, city })}`),
  aspectList: (domain, city) => request(`/api/aspects?${query({ domain, city })}`),
  aspectRanking: (domain, aspect, city) =>
    request(`/api/aspects/${encodeURIComponent(domain)}/${encodeURIComponent(aspect)}?${query({ city })}`),
  placeAspects: (domain, city, place) => request(`/api/place-aspects?${query({ domain, city, place })}`),
  compare: (domain, cityA, placeA, cityB, placeB) =>
    request(`/api/compare?${query({ domain, city_a: cityA, place_a: placeA, city_b: cityB, place_b: placeB })}`),
  predict: (text) => request('/api/predict', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  }),
};
