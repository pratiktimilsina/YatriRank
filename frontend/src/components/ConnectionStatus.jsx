import { useState } from 'react';
import { api } from '../api';
import { useApi } from '../useApi';
import './ConnectionStatus.css';

export default function ConnectionStatus() {
  const [attempt, setAttempt] = useState(0);
  const { data, error, loading } = useApi(api.health, attempt);

  let status = 'checking';
  let label = 'Checking…';
  if (!loading && data) { status = 'connected'; label = 'Backend connected'; }
  else if (!loading && error?.status === 0) { status = 'disconnected'; label = 'Backend unreachable'; }
  else if (!loading && error) { status = 'disconnected'; label = 'Data files not ready'; }

  const detail = error ? error.message : label;
  return (
    <button className={`conn-status conn-status-${status}`} onClick={() => setAttempt((n) => n + 1)} title={`${detail} (click to recheck)`}>
      <span className="conn-dot" />
      <span>{label}</span>
      <span className="conn-refresh" aria-hidden="true">↻</span>
    </button>
  );
}
