import NepalFlagIcon from './NepalFlagIcon';
import DatasetStats from './DatasetStats';
import { PAGES } from '../pageRegistry';
import './Nav.css';

export default function Nav({ current, onNavigate, overview }) {
  return (
    <aside className="sidebar">
      <button className="brand" onClick={() => onNavigate(PAGES[0].id)}>
        <NepalFlagIcon height={34} />
        <span className="brand-text">
          <strong>YatriRank</strong>
          <small>Tourism review intelligence</small>
        </span>
      </button>
      <nav className="side-nav" aria-label="Main navigation">
        {PAGES.map((p) => (
          <button
            key={p.id}
            className={`side-nav-link ${current === p.id ? 'side-nav-link-active' : ''}`}
            aria-current={current === p.id ? 'page' : undefined}
            onClick={() => onNavigate(p.id)}
          >
            <span className="side-nav-dot" />{p.label}
          </button>
        ))}
      </nav>
      {overview && <DatasetStats overview={overview} />}
    </aside>
  );
}
