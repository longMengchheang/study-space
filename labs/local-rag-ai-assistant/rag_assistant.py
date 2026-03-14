"""
rag_assistant.py — Local RAG AI Assistant (Gradio interface).

Connects to the Qdrant vector store created by ingest.py and serves
a Gradio chat UI powered by Ollama.

Usage:
    python rag_assistant.py
"""

import logging

import gradio as gr

from config import EMBED_MODEL, LLM_MODEL
from rag_pipeline import build_rag_runtime

logger = logging.getLogger(__name__)

# ── Configuration ───────────────────────────────────────────────
QDRANT_DIR = "./qdrant_db"
QDRANT_COLLECTION = "rag_documents"

# ── Build the RAG runtime once via the shared factory (#2) ──────
runtime = build_rag_runtime(
    collection_name=QDRANT_COLLECTION,
    qdrant_dir=QDRANT_DIR,
    embed_model=EMBED_MODEL,
    llm_model=LLM_MODEL,
)
rag_chain = runtime["chain"]


# ── Gradio callback ─────────────────────────────────────────────
def rag_chat(message: str, history: list) -> str:
    """Stream-less version: returns the full answer."""
    return rag_chain.invoke(message)


# ── Launch ──────────────────────────────────────────────────────
demo = gr.ChatInterface(
    fn=rag_chat,
    title="🧠 Your Personal RAG AI Assistant",
    description=(
        "Upload docs once → ask anything. "
        "Works offline. Built for your future career!"
    ),
    examples=[
        "Summarize my literature notes",
        "What are the key points from my Data Structures lecture PDF?",
        "Help me prepare for interview: explain RAG simply",
    ],
    theme=gr.themes.Soft(),
)

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    demo.launch(share=True)
