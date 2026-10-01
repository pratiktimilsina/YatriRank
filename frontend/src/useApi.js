import { useEffect, useState } from 'react';

export function useApi(fn, ...args) {
  const key = fn ? JSON.stringify(args) : null;
  const [state, setState] = useState({ key: null, data: null, error: null });

  useEffect(() => {
    if (!fn) return undefined;
    let active = true;
    fn(...JSON.parse(key))
      .then((data) => { if (active) setState({ key, data, error: null }); })
      .catch((error) => { if (active) setState({ key, data: null, error }); });
    return () => { active = false; };
  }, [fn, key]);

  const current = key !== null && state.key === key;
  return {
    data: current ? state.data : null,
    error: current ? state.error : null,
    loading: key !== null && !current,
  };
}
