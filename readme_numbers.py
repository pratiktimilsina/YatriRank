"""Print every number quoted in README.md, derived only from outputs/.

Run from the YatriRank folder:  python readme_numbers.py
"""

import json
from pathlib import Path

import pandas as pd

OUT = Path(__file__).resolve().parent / "outputs"
MET, RANK, FIG = OUT / "metrics", OUT / "rankings", OUT / "figures"

bench = json.loads((MET / "five_way_benchmark.json").read_text())
sig = json.loads((MET / "cluster_significance.json").read_text())
summ = json.loads((MET / "aspect_pipeline_summary.json").read_text())
split = pd.read_csv(MET / "split_assignments.csv")
test = pd.read_csv(MET / "test_predictions.csv")
hard = pd.read_csv(MET / "hard_cases_all_wrong.csv")
agg = pd.read_csv(RANK / "aspect_aggregate.csv")
clauses = pd.read_csv(RANK / "aspect_clauses.csv")


def head(t):
    print(f"\n== {t}")


head("Dataset and split  (split_assignments.csv)")
n = len(split)
counts = split.split.value_counts()
print(f"reviews {n:,} | places {split.place_id.nunique()}")
print(f"train_fit {counts['train_fit']:,} / val {counts['val']:,} / test {counts['test']:,}")
print(f"test places {split[split.split == 'test'].place_id.nunique()}")
print(f"TF-IDF trained on {counts['train_fit'] + counts['val']:,} ({(counts['train_fit'] + counts['val']) / n:.0%}); "
      f"transformers on {counts['train_fit']:,} ({counts['train_fit'] / n:.0%})")

head("Main results  (five_way_benchmark.json)")
for name, r in bench["results"].items():
    a, (alo, ahi) = r["accuracy"], r["accuracy_ci95"]
    f, (flo, fhi) = r["macro_f1"], r["macro_f1_ci95"]
    print(f"{name:<13} acc {a:.3f} ({float(alo):.3f}-{float(ahi):.3f})  macro-F1 {f:.3f} ({float(flo):.3f}-{float(fhi):.3f})")

head("Significance  (cluster_significance.json)")
print(f"smallest Holm p = {min(r['p_value_holm'] for r in sig):.4f}; "
      f"significant pairs = {sum(r['significant_p05'] for r in sig)} of {len(sig)}")

head("Per-class F1  (five_way_benchmark.json)")
for name, r in bench["results"].items():
    rep = r["report"]
    print(f"{name:<13} neg {rep['negative']['f1-score']:.3f}  neu {rep['neutral']['f1-score']:.3f}  "
          f"pos {rep['positive']['f1-score']:.3f}")

head("TF-IDF accuracy by city/domain  (five_way_benchmark.json)")
for row in bench["breakdown_by_city_domain"]:
    print(f"{row['city']:<10} {row['domain']:<11} {row['tfidf_lr_accuracy']:.3f}")

head("Agreement, Cohen's kappa  (five_way_benchmark.json)")
kappas = sorted(bench["agreement"].items(), key=lambda kv: kv[1])
print(f"highest {kappas[-1][0]} = {kappas[-1][1]:.3f}")
print(f"lowest  {kappas[0][0]} = {kappas[0][1]:.3f}")

head("Hard cases  (hard_cases_all_wrong.csv, test_predictions.csv)")
print(f"{len(hard)} of {len(test)} ({len(hard) / len(test):.1%})")
print(f"negative share: hard cases {(hard.label == 'negative').mean():.1%} vs test set {(test.label == 'negative').mean():.1%}")
print("star ratings:", hard.rating.value_counts().sort_index().to_dict())

head("Aspect analysis  (aspect_pipeline_summary.json, aspect_aggregate.csv, aspect_clauses.csv)")
nr = summ["n_reviews"]
print(f"reviews with an aspect {round(summ['aspect_coverage'] * nr):,} of {nr:,} ({summ['aspect_coverage']:.1%})")
print(f"aspect-clause pairs {summ['n_aspect_clause_pairs']:,} (aspect_clauses.csv rows: {len(clauses):,})")
print(f"dropped other-place pairs {summ['n_dropped_other_place_mentions']}")
print("aspects per domain:", agg.groupby("domain").aspect.nunique().to_dict())
print(f"place-aspect scores {len(agg)}")
c = summ["scorer_correlations"]
print(f"distilbert-bert_en {c['distilbert_score']['bert_en_score']:.3f} | "
      f"tfidf-distilbert {c['tfidf_lr_score']['distilbert_score']:.3f} | "
      f"tfidf-bert_en {c['tfidf_lr_score']['bert_en_score']:.3f}")
vader = [c["vader_score"][k] for k in ("tfidf_lr_score", "distilbert_score", "bert_en_score")]
print(f"VADER with others {min(vader):.3f}-{max(vader):.3f}")
print(f"aspect charts {len(list(FIG.glob('aspect_*.png')))}")
