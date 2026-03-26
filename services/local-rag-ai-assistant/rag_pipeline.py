"""
rag_pipeline.py - Shared RAG pipeline factory.

Provides a single function to build the LangChain retrieval-augmented
generation chain so that both api.py and rag_assistant.py share the
same logic without duplication.

Features:
- History-aware retrieval: the question is contextualised against the
  chat history before being sent to the retriever, enabling multi-turn
  conversations ("explain that further", "what about X?").
- MMR (Maximal Marginal Relevance) retrieval: diversifies the retrieved
  context so the LLM receives a broader coverage of the document instead
  of near-duplicate chunks.
- Structured answer prompt: instructs the model to use markdown and
  to cite its sources explicitly.
"""

from __future__ import annotations

import logging
from typing import Any

from langchain.chains import create_history_aware_retriever, create_retrieval_chain
from langchain.chains.combine_documents import create_stuff_documents_chain
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_ollama import ChatOllama, OllamaEmbeddings
from langchain_qdrant import QdrantVectorStore

from config import LLM_TEMP, LLM_TIMEOUT, TOP_K
from ollama_utils import resolve_ollama_model

logger = logging.getLogger(__name__)

# ── Prompts ───────────────────────────────────────────────────────

# Rewrites the user's latest question into a standalone question that
# can be understood without the surrounding chat history.
_CONTEXTUALIZE_Q_SYSTEM = (
    "Given the chat history and the latest user question, which may reference "
    "earlier messages, formulate a standalone question that can be understood "
    "on its own. Do NOT answer the question — only reformulate it when needed, "
    "otherwise return it exactly as-is."
)

_CONTEXTUALIZE_Q_PROMPT = ChatPromptTemplate.from_messages(
    [
        ("system", _CONTEXTUALIZE_Q_SYSTEM),
        MessagesPlaceholder("chat_history"),
        ("human", "{input}"),
    ]
)

# Answers the contextualised question using retrieved document chunks.
_ANSWER_SYSTEM = """\
You are a helpful study assistant. Answer the user's question using ONLY
the context provided below. If the context does not contain enough
information to answer, say so clearly — do not make up facts.

Guidelines:
- Use markdown formatting (headers, bullets, code blocks) when it improves clarity.
- Keep answers focused and concise; avoid padding.
- When a statement comes from a specific document, reference it naturally
  (e.g. "According to <filename>…").

Context:
{context}"""

_ANSWER_PROMPT = ChatPromptTemplate.from_messages(
    [
        ("system", _ANSWER_SYSTEM),
        MessagesPlaceholder("chat_history"),
        ("human", "{input}"),
    ]
)


def build_rag_runtime(
    *,
    collection_name: str,
    qdrant_dir: str,
    embed_model: str,
    llm_model: str,
) -> dict[str, Any]:
    """Build a complete RAG runtime dict (rag_chain, retriever, llm, prompt).

    The returned ``rag_chain`` accepts ``{"input": str, "chat_history": list}``
    and returns ``{"answer": str, "context": list[Document]}``.
    The ``prompt`` entry holds the answer-stage prompt for the source-filtered
    path in the chat endpoint.
    """
    resolved_embed = resolve_ollama_model(embed_model, "OLLAMA_EMBED_MODEL")
    resolved_llm = resolve_ollama_model(llm_model, "OLLAMA_LLM_MODEL")
    logger.info(
        "Building RAG pipeline  embed=%s  llm=%s  collection=%s",
        resolved_embed,
        resolved_llm,
        collection_name,
    )

    embeddings = OllamaEmbeddings(model=resolved_embed)
    vectorstore = QdrantVectorStore.from_existing_collection(
        collection_name=collection_name,
        embedding=embeddings,
        path=qdrant_dir,
    )

    # MMR diversifies retrieved chunks so the LLM sees a broader slice of
    # the collection instead of near-duplicate passages.
    retriever = vectorstore.as_retriever(
        search_type="mmr",
        search_kwargs={"k": TOP_K, "fetch_k": max(TOP_K * 3, 12)},
    )

    llm = ChatOllama(
        model=resolved_llm,
        temperature=LLM_TEMP,
        timeout=LLM_TIMEOUT,
    )

    # Step 1 – rewrite the question to be history-aware
    history_aware_retriever = create_history_aware_retriever(
        llm, retriever, _CONTEXTUALIZE_Q_PROMPT
    )

    # Step 2 – stuff retrieved docs into the answer prompt and call the LLM
    qa_chain = create_stuff_documents_chain(llm, _ANSWER_PROMPT)

    # Combined chain: accepts {input, chat_history} → {answer, context, ...}
    rag_chain = create_retrieval_chain(history_aware_retriever, qa_chain)

    return {
        "rag_chain": rag_chain,
        "retriever": retriever,
        "llm": llm,
        "prompt": _ANSWER_PROMPT,  # kept for the source-filtered chat path
    }
