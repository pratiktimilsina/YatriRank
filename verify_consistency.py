"""Check that dataset/, models/ and outputs/ match the notebook run, and that
backend/main.py reproduces the notebook's predictions.

Run from the YatriRank folder:
    python verify_consistency.py            # file checks only (fast)
    python verify_consistency.py --models   # also re-run all 3 models on the test set via backend code
    python verify_consistency.py --models --n 300   # transformers on a 300-review sample only
"""

import argparse
import inspect
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "dataset" / "nepal_tourism_reviews.csv"
RANK = ROOT / "outputs" / "rankings"
MET = ROOT / "outputs" / "metrics"
FIG = ROOT / "outputs" / "figures"
MODELS = ROOT / "models"

# Values printed in notebook.ipynb outputs (the run the web app should reflect).
EXPECTED = {
    "n_reviews": 10536,
    "labels": {"positive": 6274, "neutral": 2899, "negative": 1363},
    "groups": {("Kathmandu", "Attraction"): (3197, 6), ("Kathmandu", "Hotel"): (2695, 9),
               ("Pokhara", "Attraction"): (2955, 6), ("Pokhara", "Hotel"): (1689, 7)},
    "splits": {"train_fit": 5872, "val": 1675, "test": 2989},
    "coverage_raw": 9501 / 10536, "coverage": 9470 / 10536, "n_dropped": 289,
    "accuracy": {"tfidf_lr": 0.7263, "distilbert": 0.6879, "bert_en": 0.7400,
                 "llama_3.1_8b": 0.7200, "qwen2.5_14b": 0.7605},
    "macro_f1": {"tfidf_lr": 0.6598, "distilbert": 0.6365, "bert_en": 0.6967,
                 "llama_3.1_8b": 0.7011, "qwen2.5_14b": 0.7293},
    "n_all_wrong": 260,
    "top_directional": ("Pokhara", "Hotel", "OR2K Pokhara", "view", 0.845501, 137, 143),
    "tfidf": {"C": 5.0, "ngram_range": (1, 2), "class_weight": "balanced"},
    "versions": {"transformers": "5.0.0", "scikit-learn": "1.6.1"},
    "n_figures": 58,
}

fails = 0


def check(ok, msg):
    global fails
    print(("  OK   " if ok else "  FAIL ") + msg)
    fails += 0 if ok else 1


def close(a, b, tol=1e-6):
    return abs(float(a) - float(b)) <= tol


def section(title):
    print(f"\n== {title}")


def main(args):
    section("dataset vs Kaggle description / notebook")
    df = pd.read_csv(DATA)
    check(len(df) == EXPECTED["n_reviews"], f"rows = {len(df)}")
    check(df["label"].value_counts().to_dict() == EXPECTED["labels"], "label counts")
    for (c, d), (n, p) in EXPECTED["groups"].items():
        sub = df[(df.city == c) & (df.domain == d)]
        check(len(sub) == n and sub.place.nunique() == p, f"{c}/{d}: {len(sub)} reviews, {sub.place.nunique()} places")

    section("overall_place_ranking.csv (used by the web app)")
    overall = pd.read_csv(RANK / "overall_place_ranking.csv")
    re_overall = (df.groupby(["city", "domain", "place"])
                  .agg(mean_rating=("rating", "mean"), n_reviews=("rating", "count")).reset_index())
    m = overall.merge(re_overall, on=["city", "domain", "place"], how="outer", suffixes=("", "_re"), indicator=True)
    check((m["_merge"] == "both").all(), f"same {len(re_overall)} places as dataset")
    both = m[m["_merge"] == "both"]
    check(np.allclose(both.mean_rating, both.mean_rating_re) and (both.n_reviews == both.n_reviews_re).all(),
          "mean_rating and n_reviews match the dataset")

    section("aspect_aggregate.csv (used by the web app) vs aspect_clauses.csv")
    clauses = pd.read_csv(RANK / "aspect_clauses.csv")
    agg = pd.read_csv(RANK / "aspect_aggregate.csv")
    keys = ["city", "domain", "place", "aspect"]
    scores = ["tfidf_lr_score", "distilbert_score", "bert_en_score", "vader_score"]
    rl = clauses.groupby(keys + ["review_id"])[scores].mean().reset_index()
    re_agg = (rl.groupby(keys).agg(mean_tfidf_score=("tfidf_lr_score", "mean"),
                                   mean_distilbert_score=("distilbert_score", "mean"),
                                   mean_bert_en_score=("bert_en_score", "mean"),
                                   mean_vader_score=("vader_score", "mean"),
                                   unique_reviews=("review_id", "count")).reset_index()
              .merge(clauses.groupby(keys).size().reset_index(name="aspect_count"), on=keys))
    m = agg.merge(re_agg, on=keys, how="outer", suffixes=("", "_re"), indicator=True)
    check((m["_merge"] == "both").all(), f"same {len(re_agg)} place-aspect rows")
    both = m[m["_merge"] == "both"]
    for col in ["mean_tfidf_score", "mean_distilbert_score", "mean_bert_en_score", "mean_vader_score"]:
        check(np.allclose(both[col], both[col + "_re"], atol=1e-9), f"{col} recomputes")
    check((both.unique_reviews == both.unique_reviews_re).all() and (both.aspect_count == both.aspect_count_re).all(),
          "unique_reviews / aspect_count recompute")
    check(set(agg.place) <= set(df.place), "every aspect place exists in the dataset")

    section("aspect_directional_rankings.csv and aspect_pipeline_summary.json")
    top = pd.read_csv(RANK / "aspect_directional_rankings.csv")
    r = top.iloc[0]
    exp = EXPECTED["top_directional"]
    check((r.city, r.domain, r.place, r.aspect) == exp[:4] and close(r.mean_tfidf_score, exp[4])
          and r.unique_reviews == exp[5] and r.aspect_count == exp[6],
          f"first row = {r.place} / {r.aspect} {r.mean_tfidf_score:.6f} (notebook printed {exp[2]} / {exp[3]} {exp[4]})")
    s = json.loads((MET / "aspect_pipeline_summary.json").read_text())
    check(s["n_reviews"] == EXPECTED["n_reviews"], "summary n_reviews")
    check(close(s["aspect_coverage"], EXPECTED["coverage"]) and close(s["aspect_coverage_raw"], EXPECTED["coverage_raw"]),
          f"coverage {s['aspect_coverage']:.4f} / raw {s['aspect_coverage_raw']:.4f}")
    check(s["n_dropped_other_place_mentions"] == EXPECTED["n_dropped"], "dropped other-place pairs = 289")
    check(s["n_aspect_clause_pairs"] == len(clauses), f"n_aspect_clause_pairs = len(aspect_clauses.csv) = {len(clauses)}")

    section("metrics")
    split = pd.read_csv(MET / "split_assignments.csv")
    check(split.split.value_counts().to_dict() == EXPECTED["splits"], f"split sizes {split.split.value_counts().to_dict()}")
    bench = json.loads((MET / "five_way_benchmark.json").read_text())
    for k in EXPECTED["accuracy"]:
        a, f1 = bench["results"][k]["accuracy"], bench["results"][k]["macro_f1"]
        check(close(a, EXPECTED["accuracy"][k], 5e-5) and close(f1, EXPECTED["macro_f1"][k], 5e-5),
              f"{k}: acc {a:.4f}, macro-F1 {f1:.4f}")
    check(bench["n_test"] == 2989 and bench["n_all_wrong"] == EXPECTED["n_all_wrong"], "n_test / n_all_wrong")
    test = pd.read_csv(MET / "test_predictions.csv")
    hard = pd.read_csv(MET / "hard_cases_all_wrong.csv")
    check(len(test) == 2989 and len(hard) == EXPECTED["n_all_wrong"], "test_predictions / hard_cases row counts")
    check(set(test.review) == set(split[split.split == "test"].review), "test_predictions reviews = test split")

    section("figures")
    want = {f"aspect_{c.lower()}_{d.lower()}_{a}.png"
            for (c, d, a), g in agg.groupby(["city", "domain", "aspect"]) if (g.unique_reviews >= 5).any()}
    want |= {"confusion_matrices.png", "model_comparison.png"}
    have = {p.name for p in FIG.glob("*.png")}
    check(len(want) - 2 == EXPECTED["n_figures"], f"{len(want) - 2} aspect charts expected (notebook saved 58)")
    check(not (want - have), f"{len(want - have)} expected figure(s) missing")
    check(not (have - want), f"{len(have - want)} figure(s) not produced by this notebook (stale), e.g. {sorted(have - want)[:3]}")

    section("saved models")
    import joblib
    pipe = joblib.load(MODELS / "tfidf_lr_pipeline.joblib")
    le = joblib.load(MODELS / "label_encoder.joblib")
    t = EXPECTED["tfidf"]
    check(list(le.classes_) == ["negative", "neutral", "positive"], f"label encoder classes {list(le.classes_)}")
    check(pipe.named_steps["clf"].C == t["C"] and tuple(pipe.named_steps["tfidf"].ngram_range) == t["ngram_range"]
          and pipe.named_steps["clf"].class_weight == t["class_weight"], "TF-IDF+LR hyper-parameters = selected config")
    for sub in ["distilbert_sentiment", "bert_en_sentiment"]:
        cfg = json.loads((MODELS / sub / "config.json").read_text())
        check(cfg.get("transformers_version") == EXPECTED["versions"]["transformers"],
              f"{sub}: saved with transformers {cfg.get('transformers_version')}")

    section("installed versions vs training environment")
    from importlib import metadata
    for pkg, want_v in EXPECTED["versions"].items():
        try:
            got = metadata.version(pkg)
        except metadata.PackageNotFoundError:
            got = None
        check(got == want_v, f"{pkg}: installed {got}, trained with {want_v}")

    if args.models:
        rerun_models(test, args.n)

    print(f"\n{fails} check(s) failed." if fails else "\nAll checks passed.")
    sys.exit(1 if fails else 0)


def rerun_models(test, n):
    """Run backend/main.py's own cleaning and model code on the saved test set."""
    sys.path.insert(0, str(ROOT / "backend"))
    import main as backend
    import torch

    backend.check_nltk()
    section("backend cleaning = notebook cleaning")
    lc = test.review.map(backend.light_clean)
    check((lc == test.sentence_review.fillna("")).all(), f"light_clean matches on {(lc == test.sentence_review).mean():.2%}")
    dc = test.review.map(backend.deep_clean)
    same = dc == test.clean_review.fillna("")
    check(same.all(), f"deep_clean matches on {same.mean():.2%}")
    for got, want in list(zip(dc[~same], test.clean_review[~same]))[:3]:
        diff = [(w, g) for w, g in zip(want.split(), got.split()) if w != g][:5]
        print(f"         notebook -> backend: {diff}")

    section("backend models reproduce notebook test predictions")
    pipe, enc = backend.load_tfidf_model()
    pred = enc.inverse_transform(pipe.predict(dc.tolist()))
    agree = (pred == test.tfidf_lr_pred).mean()
    check(agree == 1.0, f"tfidf_lr agreement {agree:.2%}")

    sample = test if not n or n >= len(test) else test.sample(n, random_state=0)
    for key, col in [("distilbert", "distilbert_pred"), ("bert_en", "bert_en_pred")]:
        model, tok = backend.load_transformer(backend.TRANSFORMERS[key])
        names = backend.transformer_labels(model, [str(c) for c in enc.classes_])
        texts = sample.review.map(backend.light_clean).tolist()
        accepted = set(inspect.signature(model.forward).parameters)
        out = []
        with torch.no_grad():
            for i in range(0, len(texts), 32):
                b = tok(texts[i:i + 32], truncation=True, padding=True,
                        max_length=backend.TRANSFORMER_MAX_LENGTH, return_tensors="pt")
                b = {k: v for k, v in b.items() if k in accepted}
                out.extend(model(**b).logits.argmax(-1).tolist())
        agree = (np.array([names[i] for i in out]) == sample[col].to_numpy()).mean()
        check(agree >= 0.995, f"{key} agreement {agree:.2%} on {len(sample)} test reviews")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", action="store_true", help="re-run the saved models through backend code")
    ap.add_argument("--n", type=int, default=0, help="transformer sample size (0 = full test set)")
    main(ap.parse_args())
