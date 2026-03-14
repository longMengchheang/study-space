"""
rag_pipeline.py - Shared RAG pipeline factory.

Provides a single function to build the LangChain retrieval-augmented
generation chain so that both api.py and rag_assistant.py share the
same logic without duplication.
"""

from __future__ import annotations

import logging
from typing import Any

from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.runnables import RunnableLambda, RunnablePassthrough
from langchain_ollama import ChatOllama, OllamaEmbeddings
from langchain_qdrant import QdrantVectorStore

from config import LLM_TEMP, LLM_TIMEOUT, TOP_K
from ollama_utils import resolve_ollama_model
from rag_utils import normalize_question, retrieve_context

logger = logging.getLogger(__name__)

CHAT_TEMPLATE = """\
Answer in a friendly, clear way.
Use ONLY the following context to answer. If you don't know, say
"I don't have info on that in my documents."

Context:
{context}

Question: {question}

Answer:"""


def build_rag_runtime(
    *,
    collection_name: str,
    qdrant_dir: str,
    embed_model: str,
    llm_model: str,
) -> dict[str, Any]:
    """Build a complete RAG runtime dict (chain, retriever, llm, prompt)."""
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
    retriever = vectorstore.as_retriever(search_kwargs={"k": TOP_K})
    llm = ChatOllama(
        model=resolved_llm,
        temperature=LLM_TEMP,
        timeout=LLM_TIMEOUT,
    )

    prompt = ChatPromptTemplate.from_template(CHAT_TEMPLATE)
    context_builder = RunnableLambda(lambda question: retrieve_context(question, retriever))
    question_builder = RunnableLambda(normalize_question)

    chain = (
        {
            "context": RunnablePassthrough() | context_builder,
            "question": RunnablePassthrough() | question_builder,
        }
        | prompt
        | llm
        | StrOutputParser()
    )

    return {
        "chain": chain,
        "retriever": retriever,
        "llm": llm,
        "prompt": prompt,
    }
