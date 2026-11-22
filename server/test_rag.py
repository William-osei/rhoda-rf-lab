"""Focused tests for semantic and dependency-free RAG retrieval."""

from pathlib import Path

from rag.rag import RetrievalIndex


CORPUS = Path(__file__).parent / "rag" / "corpus"


def test_retrieval_loads_without_optional_embedding_dependency():
    index = RetrievalIndex(corpus_dir=CORPUS)
    assert len(index.docs) == 15
    assert index.method in {"lexical", "semantic"}
    status = index.status()
    assert status["documents"] == 15
    assert status["categories"] == {"fault": 3, "procedure": 9, "safety": 3}
    assert len(status["corpus_version"]) == 16


def test_retrieval_returns_relevant_procedure():
    index = RetrievalIndex(corpus_dir=CORPUS)
    result = index.retrieve("how do I measure a 1 kHz sine wave", category="procedure")
    assert result["chunks"]
    assert result["chunks"][0]["source"] == "measure_1khz_sine_wave"
    assert result["chunks"][0]["category"] == "procedure"
    assert result["chunks"][0]["path"].endswith("measure_1khz_sine_wave.md")


def test_category_filter_and_input_guards():
    index = RetrievalIndex(corpus_dir=CORPUS)
    index.model = None
    index.embeddings = None
    result = index.retrieve("voltage limit", top_k=4, category="safety")
    assert result["chunks"]
    assert all(chunk["source"] in {
        "function_safety_limits",
        "oscilloscope_safety_checklist",
        "rtb2_voltage_limits",
    } for chunk in result["chunks"])
    assert index.retrieve("", top_k=3)["chunks"] == []
    assert index.retrieve("test", top_k=0)["chunks"] == []
    assert index.retrieve("qzxv blorp 991", top_k=3)["chunks"] == []
