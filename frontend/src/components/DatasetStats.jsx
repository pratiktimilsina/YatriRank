import { formatNumber } from '../format';
import './DatasetStats.css';

const DATASET_URL = 'https://www.kaggle.com/datasets/pratiktimilsina/nepal-tourism-reviews';

export default function DatasetStats({ overview }) {
  const stats = [
    { value: formatNumber(overview.total_reviews), label: 'Reviews' },
    { value: overview.cities.length, label: 'Cities', detail: overview.cities.join(', ') },
    { value: overview.domains.length, label: 'Domains', detail: overview.domains.join(', ') },
    { value: formatNumber(overview.total_places), label: 'Places' },
  ];
  return (
    <section className="dataset-stats" aria-label="Dataset totals">
      {stats.map((s) => (
        <div className="dataset-stat" key={s.label}>
          <span className="dataset-stat-value">{s.value}</span>
          <span className="dataset-stat-label">{s.label}{s.detail && <small>{s.detail}</small>}</span>
        </div>
      ))}
      <div className="dataset-source">
        <span>Dataset</span>
        <a href={DATASET_URL} target="_blank" rel="noopener noreferrer">Nepal Tourism Reviews <span aria-hidden="true">↗</span></a>
      </div>
    </section>
  );
}
