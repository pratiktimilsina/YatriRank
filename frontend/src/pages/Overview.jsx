import { PAGES } from '../pageRegistry';
import { formatNumber, formatRating, pluralDomain } from '../format';
import './Overview.css';

const listJoin = (items) =>
  items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

export default function Overview({ overview }) {
  const { groups, domain_aspects: domainAspects, cities, domains } = overview;
  const minReviews = overview.min_aspect_reviews;
  const domainWords = listJoin(domains.map((d) => pluralDomain(d).toLowerCase()));
  const guidePages = PAGES.filter((p) => p.summary);

  return (
    <div className="dashboard-page overview-page">
      <article className="card about-card">
        <div className="module-heading"><span>About YatriRank</span></div>
        <p className="about-lead">
          YatriRank analyses {formatNumber(overview.total_reviews)} English-language TripAdvisor reviews of
          {' '}{formatNumber(overview.total_places)} {domainWords} in {listJoin(cities)} and answers two questions.
        </p>
        <div className="about-questions">
          <div>
            <h3>How do reviewers rate a place?</h3>
            <p>
              Places are ranked by their <b>place mean star rating</b> within the selected city and domain. The place mean star rating is the average star rating across all reviews for an individual place within the selected city and domain.
            </p>
          </div>
          <div>
            <h3>What do reviewers say about specific aspects?</h3>
            <p>
              For aspects such as staff, cleanliness or view, a sentiment model scores what reviewers say, from
              <b> −1</b> (negative) to <b>+1</b> (positive). A score is shown only when at least <b>{minReviews} different
              reviews</b> mention the aspect.
            </p>
          </div>
        </div>
        <ul className="page-guide">
          {guidePages.map((p) => <li key={p.id}><b>{p.label}</b> · {p.summary}</li>)}
        </ul>
      </article>

      <div className="overview-tables">
        <div className="card">
          <div className="module-heading"><span>City and domain overview</span></div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>City</th><th>Domain</th><th className="num">Places</th><th className="num">Reviews</th><th className="num">City-domain mean star rating</th></tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <tr key={`${g.city}-${g.domain}`}>
                    <td>{g.city}</td>
                    <td><span className="domain-badge">{g.domain}</span></td>
                    <td className="num">{formatNumber(g.places)}</td>
                    <td className="num">{formatNumber(g.reviews)}</td>
                    <td className="num rating-cell">{formatRating(g.mean_rating)} ★</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="section-help"><b>City-domain mean star rating</b> is the average star rating across all reviews for all places in the selected city and domain.</p>
        </div>

        <div className="card aspect-coverage-card">
          <div className="module-heading"><span>Aspect coverage</span></div>
          <p className="section-help">Aspect coverage shows how many aspects and place–aspect combinations have enough review evidence to receive a sentiment score.</p>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>Domain</th><th className="num">Aspects mentioned</th><th className="num">Place–aspect pairs shown</th></tr>
              </thead>
              <tbody>
                {domainAspects.map((d) => (
                  <tr key={d.domain}>
                    <td><span className="domain-badge">{d.domain}</span></td>
                    <td className="num">{formatNumber(d.aspects)}</td>
                    <td className="num">{formatNumber(d.reportable_pairs)} of {formatNumber(d.all_pairs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="section-help">A place–aspect pair is shown only when at least <b>{minReviews} different reviews</b> mention the aspect.</p>
        </div>
      </div>
    </div>
  );
}
