"""YatriRank API.

A read-only serving layer over notebook.ipynb. Every number this API returns
is read from the notebook's saved files in ../outputs, or produced live by
the notebook's saved models in ../models. Nothing here re-derives the
notebook's methodology; the only arithmetic done is aggregation for display
(counts, sums, review-weighted means) over those saved files.
"""

import importlib.metadata as metadata
import inspect
import math
import os
import re
import unicodedata
from contextlib import asynccontextmanager
from functools import lru_cache
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

BASE_DIR = Path(__file__).resolve().parent.parent
MODELS_DIR = BASE_DIR / "models"
OUTPUTS_DIR = BASE_DIR / "outputs"

OVERALL_RANKING_CSV = OUTPUTS_DIR / "rankings" / "overall_place_ranking.csv"
ASPECT_AGGREGATE_CSV = OUTPUTS_DIR / "rankings" / "aspect_aggregate.csv"

MIN_ASPECT_REVIEWS = 5
TRANSFORMER_MAX_LENGTH = 256

TRANSFORMERS = {"distilbert": "distilbert_sentiment", "bert_en": "bert_en_sentiment"}


def require_file(path: Path) -> Path:
    if not path.exists():
        raise HTTPException(
            status_code=503,
            detail=f"Expected file not found: {path.relative_to(BASE_DIR)}. "
                   f"backend/ must sit inside the YatriRank folder next to models/ and outputs/.",
        )
    return path


def read_csv(path: Path, required: set) -> pd.DataFrame:
    df = pd.read_csv(require_file(path))
    missing = required - set(df.columns)
    if missing:
        raise HTTPException(
            status_code=503,
            detail=f"{path.name} is missing column(s) {sorted(missing)}. "
                   f"Re-export it from notebook.ipynb.",
        )
    return df


@lru_cache
def load_overall_ranking() -> pd.DataFrame:
    return read_csv(OVERALL_RANKING_CSV, {"city", "domain", "place", "mean_rating", "n_reviews"})


@lru_cache
def load_aspect_aggregate() -> pd.DataFrame:
    return read_csv(
        ASPECT_AGGREGATE_CSV,
        {
            "city", "domain", "place", "aspect", "unique_reviews", "mean_tfidf_score",
            "mean_distilbert_score", "mean_bert_en_score", "mean_vader_score",
        },
    )


@lru_cache
def load_tfidf_model():
    pipe = joblib.load(require_file(MODELS_DIR / "tfidf_lr_pipeline.joblib"))
    encoder = joblib.load(require_file(MODELS_DIR / "label_encoder.joblib"))
    if not hasattr(pipe, "predict_proba"):
        raise HTTPException(503, "models/tfidf_lr_pipeline.joblib has no predict_proba method.")
    if not hasattr(encoder, "classes_"):
        raise HTTPException(503, "models/label_encoder.joblib has no classes_ attribute.")
    return pipe, encoder


def transformer_dependency_status() -> dict:
    """Check the runtime dependencies needed to load the saved transformers.

    Keep this separate from model loading so the UI can explain dependency
    problems accurately before a prediction is attempted.
    """
    def installed(package: str):
        try:
            return metadata.version(package)
        except metadata.PackageNotFoundError:
            return None

    torch_version = installed("torch")
    transformers_version = installed("transformers")

    try:
        import torch
    except Exception as e:
        return {
            "available": False,
            "reason": f"PyTorch could not be imported: {e}",
            "torch_version": torch_version,
            "transformers_version": transformers_version,
        }

    transformers_module = None
    try:
        import transformers as transformers_module
        from transformers import AutoModelForSequenceClassification, AutoTokenizer  # noqa: F401
    except Exception as e:
        return {
            "available": False,
            "reason": (
                "The installed Transformers package cannot provide "
                f"AutoModelForSequenceClassification/AutoTokenizer: {e}. "
                "Reinstall the pinned dependencies with `pip install -r requirements.txt`."
            ),
            "torch_version": torch_version,
            "transformers_version": getattr(transformers_module, "__version__", transformers_version),
        }

    return {
        "available": True,
        "reason": None,
        "torch_version": getattr(torch, "__version__", torch_version),
        "transformers_version": getattr(transformers_module, "__version__", transformers_version),
    }


@lru_cache
def load_transformer(subdir: str):
    model_path = require_file(MODELS_DIR / subdir)
    if not (model_path / "config.json").exists():
        raise HTTPException(503, f"models/{subdir} has no config.json.")

    deps = transformer_dependency_status()
    if not deps["available"]:
        raise HTTPException(503, deps["reason"])

    try:
        from transformers import AutoModelForSequenceClassification, AutoTokenizer
        tokenizer = AutoTokenizer.from_pretrained(str(model_path))
        model = AutoModelForSequenceClassification.from_pretrained(str(model_path))
        model.eval()
    except Exception as e:
        raise HTTPException(503, f"Saved transformer model '{subdir}' could not be loaded: {e}") from e
    return model, tokenizer


def transformer_labels(model, fallback: list) -> list:
    """Label for each logit index. The notebook (§6) fine-tunes with
    num_labels=3 on LabelEncoder ids and sets no id2label, so the saved
    config holds generic LABEL_0..LABEL_2 and the encoder's classes_
    (negative, neutral, positive) define the order. Real names in
    id2label, if a future run adds them, take precedence."""
    id2label = getattr(model.config, "id2label", None) or {}
    names = [str(id2label.get(i, "")) for i in range(model.config.num_labels)]
    if names and all(n and not n.upper().startswith("LABEL_") for n in names):
        return names
    if len(fallback) != model.config.num_labels:
        raise HTTPException(
            503,
            f"Model has {model.config.num_labels} outputs but label_encoder has {len(fallback)} classes.",
        )
    return fallback


def describe_tfidf(pipe) -> str | None:
    """Hyper-parameters the notebook's grid search (§5) selected, read from the
    saved pipeline itself rather than restated by hand."""
    try:
        vec, clf = pipe.named_steps["tfidf"], pipe.named_steps["clf"]
        lo, hi = vec.ngram_range
        return f"{lo}–{hi}-grams, C={clf.C:g}, class_weight={clf.class_weight}"
    except (AttributeError, KeyError, TypeError, ValueError):
        return None


def num(value):
    """JSON-safe float: NaN/inf in a CSV becomes null instead of a 500."""
    value = float(value)
    return None if math.isnan(value) or math.isinf(value) else value


def supporting_scores(row) -> dict:
    return {
        "distilbert": num(row["mean_distilbert_score"]),
        "bert_en": num(row["mean_bert_en_score"]),
        "vader": num(row["mean_vader_score"]),
    }


def weighted_mean_rating(df: pd.DataFrame):
    total = df["n_reviews"].sum()
    return num((df["mean_rating"] * df["n_reviews"]).sum() / total) if total else None


def reportable_aspects(df: pd.DataFrame) -> pd.DataFrame:
    return df[df["unique_reviews"] >= MIN_ASPECT_REVIEWS]


_URL_RE = re.compile(r"http\S+|www\.\S+")
_EMAIL_RE = re.compile(r"\S+@\S+\.\S+")
_HTML_RE = re.compile(r"<.*?>")
_REPEAT_CHAR_RE = re.compile(r"(.)\1{2,}")
_SPECIAL_RE = re.compile(r"[^a-z0-9\s.,!?']")
_MULTISPACE_RE = re.compile(r"\s+")

_nltk_status = {"ready": False, "error": None}


def check_nltk():
    """Verify, without downloading anything, that the NLTK resources used by
    deep_clean() are installed. It exercises the real calls because the
    resource names differ between NLTK versions (punkt vs punkt_tab,
    averaged_perceptron_tagger vs averaged_perceptron_tagger_eng)."""
    try:
        from nltk import pos_tag, word_tokenize
        from nltk.stem import WordNetLemmatizer

        WordNetLemmatizer().lemmatize("rooms")
        pos_tag(word_tokenize("the rooms were clean"))
        _nltk_status.update(ready=True, error=None)
    except LookupError as e:
        lines = str(e).strip().splitlines()
        resource = next((ln.strip() for ln in lines if "Resource" in ln), "an NLTK resource")
        _nltk_status.update(
            ready=False,
            error=f"{resource} is not installed. Run once: python -m nltk.downloader "
                  f"punkt punkt_tab wordnet averaged_perceptron_tagger averaged_perceptron_tagger_eng",
        )
    except Exception as e:
        _nltk_status.update(ready=False, error=f"NLTK is unavailable: {e}")


def light_clean(text: str) -> str:
    text = unicodedata.normalize("NFKC", text)
    text = _URL_RE.sub(" ", text)
    text = _EMAIL_RE.sub(" ", text)
    text = _HTML_RE.sub(" ", text)
    text = _REPEAT_CHAR_RE.sub(r"\1\1", text)
    return _MULTISPACE_RE.sub(" ", text).strip()


def deep_clean(text: str) -> str:
    if not _nltk_status["ready"]:
        raise HTTPException(503, _nltk_status["error"] or "NLTK resources are not ready.")
    from nltk import pos_tag, word_tokenize
    from nltk.corpus import wordnet
    from nltk.stem import WordNetLemmatizer

    def wn_pos(tag):
        if tag.startswith("J"):
            return wordnet.ADJ
        if tag.startswith("V"):
            return wordnet.VERB
        if tag.startswith("R"):
            return wordnet.ADV
        return wordnet.NOUN

    text = light_clean(text).lower()
    text = _MULTISPACE_RE.sub(" ", _SPECIAL_RE.sub(" ", text)).strip()
    if not text:
        return ""
    lemmatizer = WordNetLemmatizer()
    return " ".join(lemmatizer.lemmatize(tok, wn_pos(tag)) for tok, tag in pos_tag(word_tokenize(text)))


@asynccontextmanager
async def lifespan(_app: FastAPI):
    check_nltk()
    yield


app = FastAPI(title="YatriRank API", lifespan=lifespan)

_origins = os.environ.get(
    "YATRIRANK_CORS_ORIGINS",
    "http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in _origins.split(",") if o.strip()],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


@app.get("/api/health")
def health():
    load_overall_ranking()
    load_aspect_aggregate()
    return {"status": "ok"}


@app.get("/api/models/status")
def models_status():
    """Availability of the three models this backend runs live. The Llama and
    Qwen labels are columns of the dataset itself; the notebook only evaluates
    them, and they are never run here."""
    status = {}
    try:
        pipe, _ = load_tfidf_model()
        status["tfidf_lr"] = {"available": True, "reason": None, "details": describe_tfidf(pipe)}
    except Exception as e:
        status["tfidf_lr"] = {"available": False, "reason": getattr(e, "detail", str(e))}

    deps = transformer_dependency_status()
    for key, subdir in TRANSFORMERS.items():
        model_path = MODELS_DIR / subdir
        if not model_path.exists():
            status[key] = {"available": False, "reason": f"models/{subdir} is missing."}
            continue
        if not deps["available"]:
            status[key] = {"available": False, "reason": deps["reason"]}
            continue
        try:
            load_transformer(subdir)
            status[key] = {"available": True, "reason": None}
        except Exception as e:
            status[key] = {"available": False, "reason": getattr(e, "detail", str(e))}

    return {"models": status, "transformer_dependencies": deps}


@app.get("/api/overview")
def overview():
    aggregate = load_aspect_aggregate()
    overall = load_overall_ranking()

    groups = []
    for (city, domain), group in overall.groupby(["city", "domain"], sort=True):
        groups.append({
            "city": city,
            "domain": domain,
            "places": int(len(group)),
            "reviews": int(group["n_reviews"].sum()),
            "mean_rating": weighted_mean_rating(group),
        })

    domain_aspects = [
        {
            "domain": domain,
            "aspects": int(sub["aspect"].nunique()),
            "reportable_pairs": int(len(reportable_aspects(sub))),
            "all_pairs": int(len(sub)),
        }
        for domain, sub in aggregate.groupby("domain", sort=True)
    ]

    return {
        "total_reviews": int(overall["n_reviews"].sum()),
        "total_places": int(overall[["city", "domain", "place"]].drop_duplicates().shape[0]),
        "cities": sorted(overall["city"].dropna().unique().tolist()),
        "domains": sorted(overall["domain"].dropna().unique().tolist()),
        "groups": groups,
        "domain_aspects": domain_aspects,
        "min_aspect_reviews": MIN_ASPECT_REVIEWS,
    }


@app.get("/api/rankings")
def rankings(domain: str = Query(...), city: str | None = None):
    df = load_overall_ranking()
    sub = df[df["domain"] == domain]
    if city:
        sub = sub[sub["city"] == city]

    sub = sub.sort_values(["mean_rating", "place", "city"], ascending=[False, True, True]).reset_index(drop=True)
    sub = sub.assign(rank=sub["mean_rating"].rank(method="min", ascending=False).astype(int))

    places = [
        {
            "city": r["city"],
            "place": r["place"],
            "mean_rating": num(r["mean_rating"]),
            "n_reviews": int(r["n_reviews"]),
            "rank": int(r["rank"]),
        }
        for _, r in sub.iterrows()
    ]
    summary = {
        "places": int(len(sub)),
        "reviews": int(sub["n_reviews"].sum()),
        "mean_rating": weighted_mean_rating(sub),
        "max_rating": num(sub["mean_rating"].max()) if len(sub) else None,
        "min_rating": num(sub["mean_rating"].min()) if len(sub) else None,
    }
    return {"places": places, "summary": summary}


@app.get("/api/aspects")
def aspect_list(domain: str = Query(...), city: str | None = None):
    """The domain's aspect vocabulary, each with the number of places in the
    selected scope that pass the review threshold. Some pairs have none
    (notebook §9 skips e.g. Kathmandu/Attraction/boat for this reason)."""
    df = load_aspect_aggregate()
    sub = df[df["domain"] == domain]
    scoped = reportable_aspects(sub[sub["city"] == city] if city else sub)
    counts = scoped.groupby("aspect").size()
    return {
        "aspects": [
            {"aspect": a, "places": int(counts.get(a, 0))}
            for a in sorted(sub["aspect"].unique().tolist())
        ]
    }


@app.get("/api/aspects/{domain}/{aspect}")
def aspect_ranking(domain: str, aspect: str, city: str | None = None):
    df = load_aspect_aggregate()
    sub = reportable_aspects(df[(df["domain"] == domain) & (df["aspect"] == aspect)])
    if city:
        sub = sub[sub["city"] == city]
    sub = sub.sort_values(["mean_tfidf_score", "place"], ascending=[False, True])
    places = [
        {
            "place": r["place"],
            "city": r["city"],
            "score": num(r["mean_tfidf_score"]),
            "unique_reviews": int(r["unique_reviews"]),
            "supporting_scores": supporting_scores(r),
        }
        for _, r in sub.iterrows()
    ]
    return {"places": places}


@app.get("/api/place-aspects")
def place_aspects(domain: str = Query(...), city: str = Query(...), place: str = Query(...)):
    """Reportable aspects of one place, sorted by directional score. Used to
    explain a place's profile, not as a ranking of its own."""
    df = load_aspect_aggregate()
    sub = reportable_aspects(df[(df["domain"] == domain) & (df["city"] == city) & (df["place"] == place)])
    sub = sub.sort_values(["mean_tfidf_score", "aspect"], ascending=[False, True])
    aspects = [
        {"aspect": r["aspect"], "score": num(r["mean_tfidf_score"]), "unique_reviews": int(r["unique_reviews"])}
        for _, r in sub.iterrows()
    ]
    return {"aspects": aspects}


@app.get("/api/compare")
def compare(
    domain: str = Query(...),
    city_a: str = Query(...),
    place_a: str = Query(...),
    city_b: str = Query(...),
    place_b: str = Query(...),
):
    overall = load_overall_ranking()
    agg = load_aspect_aggregate()

    def summary(city: str, place: str):
        row = overall[(overall["city"] == city) & (overall["domain"] == domain) & (overall["place"] == place)]
        if row.empty:
            raise HTTPException(404, f"Place not found: {place} ({city}, {domain})")
        r = row.iloc[0]
        return {"place": place, "city": city, "mean_rating": num(r["mean_rating"]), "n_reviews": int(r["n_reviews"])}

    def aspects_of(city: str, place: str) -> pd.DataFrame:
        sub = agg[(agg["city"] == city) & (agg["domain"] == domain) & (agg["place"] == place)]
        return reportable_aspects(sub).set_index("aspect")

    a_rows, b_rows = aspects_of(city_a, place_a), aspects_of(city_b, place_b)
    aspects = []
    for aspect in sorted(set(a_rows.index) & set(b_rows.index)):
        a, b = a_rows.loc[aspect], b_rows.loc[aspect]
        aspects.append({
            "aspect": aspect,
            "a_score": num(a["mean_tfidf_score"]),
            "b_score": num(b["mean_tfidf_score"]),
            "a_unique_reviews": int(a["unique_reviews"]),
            "b_unique_reviews": int(b["unique_reviews"]),
            "a_supporting_scores": supporting_scores(a),
            "b_supporting_scores": supporting_scores(b),
        })

    return {"place_a": summary(city_a, place_a), "place_b": summary(city_b, place_b), "aspects": aspects}


class PredictRequest(BaseModel):
    text: str


@app.post("/api/predict")
def predict(payload: PredictRequest):
    text = payload.text.strip()
    if not text:
        raise HTTPException(400, "Text is empty.")

    try:
        pipe, encoder = load_tfidf_model()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(503, f"TF-IDF+LR model could not be loaded: {e}") from e

    classes = [str(c) for c in encoder.classes_]
    cleaned = deep_clean(text)
    if not cleaned:
        raise HTTPException(400, "The text contains no words the models can read.")

    proba = pipe.predict_proba([cleaned])[0]
    pipe_classes = getattr(pipe, "classes_", np.arange(len(classes)))
    labels = [str(c) if isinstance(c, str) else classes[int(c)] for c in pipe_classes]
    results = {
        "tfidf_lr": {
            "label": labels[int(np.argmax(proba))],
            "probabilities": {lbl: float(p) for lbl, p in zip(labels, proba)},
        }
    }

    light = light_clean(text)
    errors = {}
    for key, subdir in TRANSFORMERS.items():
        try:
            model, tokenizer = load_transformer(subdir)
            import torch

            enc = tokenizer(light, truncation=True, max_length=TRANSFORMER_MAX_LENGTH, return_tensors="pt")
            accepted = set(inspect.signature(model.forward).parameters)
            enc = {k: v for k, v in enc.items() if k in accepted}
            with torch.no_grad():
                probs = torch.softmax(model(**enc).logits, dim=-1).numpy()[0]
            names = transformer_labels(model, classes)
            results[key] = {
                "label": names[int(np.argmax(probs))],
                "probabilities": {n: float(p) for n, p in zip(names, probs)},
            }
        except Exception as e:
            errors[key] = getattr(e, "detail", str(e))

    return {"models": results, "errors": errors}
