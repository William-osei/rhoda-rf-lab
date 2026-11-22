"""
RAG / Context Layer for the R&S Virtual Lab Assistant (Core 2, owner: Gregory).

Loads the hand-authored corpus under corpus/{procedure,safety,fault}/*.md,
embeds each doc once at startup, and exposes retrieve() matching the
RETRIEVE_REQUEST / RETRIEVE_RESULT contract from the build spec:

    retrieve(query: str, top_k: int = 3, category: str | None = None)
    -> {"chunks": [{"text": str, "source": str, "score": float}, ...]}
"""

import re
import hashlib
from collections import Counter
from pathlib import Path

CORPUS_DIR = Path(__file__).parent / "corpus"
MODEL_NAME = "all-MiniLM-L6-v2"
_TOKEN_RE = re.compile(r"[a-z0-9]+")
_STOP_WORDS = {
    "a", "an", "and", "are", "be", "do", "for", "how", "i", "in", "is",
    "it", "me", "my", "no", "of", "on", "or", "the", "to", "what", "with",
}

_FRONTMATTER_RE = re.compile(r"^---\n(.*?)\n---\n(.*)$", re.DOTALL)


def _parse_doc(path: Path) -> dict:
    raw = path.read_text(encoding="utf-8")
    match = _FRONTMATTER_RE.match(raw)
    if not match:
        raise ValueError(f"{path} is missing frontmatter")
    front, body = match.groups()
    meta = dict(line.split(":", 1) for line in front.strip().splitlines())
    meta = {k.strip(): v.strip() for k, v in meta.items()}
    return {
        "text": body.strip(),
        "source": meta["source"],
        "category": meta["category"],
        "path": path.as_posix(),
    }


def _tokens(text: str) -> list[str]:
    return [
        token
        for token in _TOKEN_RE.findall(text.casefold())
        if token not in _STOP_WORDS
    ]


class RetrievalIndex:
    def __init__(self, corpus_dir: Path = CORPUS_DIR, model_name: str = MODEL_NAME):
        self.docs = []
        for path in sorted(corpus_dir.glob("*/*.md")):
            document = _parse_doc(path)
            document["path"] = path.relative_to(corpus_dir).as_posix()
            self.docs.append(document)
        if not self.docs:
            raise RuntimeError(f"No corpus docs found under {corpus_dir}")
        self.corpus_dir = corpus_dir
        digest = hashlib.sha256()
        for document in self.docs:
            digest.update(document["path"].encode())
            digest.update(document["text"].encode())
        self.corpus_version = digest.hexdigest()[:16]
        self.category_counts = Counter(document["category"] for document in self.docs)
        self.model = None
        self.embeddings = None
        self.method = "lexical"
        self._doc_tokens = [_tokens(f"{d['source']} {d['text']}") for d in self.docs]
        self._doc_term_counts = [Counter(tokens) for tokens in self._doc_tokens]
        self._document_frequency = Counter(
            token for tokens in self._doc_tokens for token in set(tokens)
        )
        try:
            from sentence_transformers import SentenceTransformer

            self.model = SentenceTransformer(model_name)
            self.embeddings = self.model.encode(
                [d["text"] for d in self.docs], normalize_embeddings=True
            )
            self.method = "semantic"
        except (ImportError, OSError, RuntimeError) as error:
            self.initialization_error = str(error)

    def status(self) -> dict:
        return {
            "available": True,
            "method": self.method,
            "model": MODEL_NAME if self.method == "semantic" else None,
            "documents": len(self.docs),
            "categories": dict(sorted(self.category_counts.items())),
            "corpus_version": self.corpus_version,
        }

    def retrieve(self, query: str, top_k: int = 3, category: str | None = None) -> dict:
        if not isinstance(query, str) or not query.strip():
            return {"chunks": []}
        if type(top_k) is not int or top_k < 1:
            return {"chunks": []}
        indices = [i for i, d in enumerate(self.docs) if category is None or d["category"] == category]
        if not indices:
            return {"chunks": []}

        if self.model is not None and self.embeddings is not None:
            query_emb = self.model.encode([query], normalize_embeddings=True)[0]
            sims = self.embeddings[indices] @ query_emb
            ranked = sorted(zip(indices, sims), key=lambda pair: (-float(pair[1]), self.docs[pair[0]]["source"]))[:top_k]
        else:
            query_terms = Counter(_tokens(query))
            ranked = sorted(
                (
                    (
                        i,
                        self._lexical_score(query_terms, self._doc_term_counts[i]),
                    )
                    for i in indices
                ),
                key=lambda pair: (-pair[1], self.docs[pair[0]]["source"]),
            )
            ranked = [pair for pair in ranked if pair[1] > 0][:top_k]

        return {
            "chunks": [
                {
                    "text": self.docs[i]["text"],
                    "source": self.docs[i]["source"],
                    "category": self.docs[i]["category"],
                    "path": self.docs[i]["path"],
                    "score": float(score),
                }
                for i, score in ranked
            ]
        }

    def _lexical_score(self, query_terms: Counter, document_terms: Counter) -> float:
        if not query_terms:
            return 0.0
        total_documents = len(self.docs)
        score = 0.0
        for term, query_count in query_terms.items():
            document_count = document_terms.get(term, 0)
            if not document_count:
                continue
            inverse_frequency = 1.0 + (total_documents / (1 + self._document_frequency[term]))
            score += min(query_count, document_count) * inverse_frequency
        return score / max(1, sum(query_terms.values()))


def _repl():
    """Interactive standalone demo of the mini-agent — type a query, get chunks back.
    Optionally prefix with 'procedure:', 'safety:', or 'fault:' to filter by category.
    """
    index = RetrievalIndex()
    print(f"Loaded {len(index.docs)} docs: {[d['source'] for d in index.docs]}")
    print("Type a query (optionally prefixed 'procedure:'/'safety:'/'fault:'), or 'quit'.\n")

    while True:
        raw = input("query> ").strip()
        if raw.lower() in ("quit", "exit", ""):
            break

        category = None
        for cat in ("procedure", "safety", "fault"):
            prefix = f"{cat}:"
            if raw.lower().startswith(prefix):
                category = cat
                raw = raw[len(prefix):].strip()
                break

        result = index.retrieve(raw, top_k=3, category=category)
        if not result["chunks"]:
            print("  (no matches)\n")
            continue
        for chunk in result["chunks"]:
            print(f"  [{chunk['score']:.3f}] {chunk['source']}: {chunk['text'][:100]}...")
        print()


if __name__ == "__main__":
    _repl()
