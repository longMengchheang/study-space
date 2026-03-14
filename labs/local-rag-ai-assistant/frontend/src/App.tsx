import { useCallback, useEffect, useState } from 'react';
import { Menu } from 'lucide-react';
import './index.css';

import * as api from './api';
import type { ArtifactKind, ArtifactRecord, CollectionSummary, DocumentRecord } from './api';
import ArtifactPanel from './ArtifactPanel';
import ChatPanel, { type Message } from './ChatPanel';
import InputBar from './InputBar';
import Sidebar from './Sidebar';

type BackendStatus = 'checking' | 'online' | 'offline';
type UploadStatus = 'idle' | 'uploading' | 'success' | 'error';
type ArtifactStatus = 'idle' | 'working' | 'error';

const STARTER_MESSAGE: Message = {
  id: '1',
  role: 'ai',
  content:
    'Hello. Pick a study collection, upload documents into it, and I can chat over that material or generate study artifacts like summaries, flashcards, quizzes, and study guides.',
};

function formatArtifactKind(kind: string): string {
  return kind.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}

export default function App() {
  // Core state
  const [messages, setMessages] = useState<Message[]>([STARTER_MESSAGE]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);

  // Collections & documents
  const [collections, setCollections] = useState<CollectionSummary[]>([]);
  const [activeCollectionId, setActiveCollectionId] = useState('general');
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [artifacts, setArtifacts] = useState<ArtifactRecord[]>([]);

  // UI state
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [backendStatus, setBackendStatus] = useState<BackendStatus>('checking');
  const [isDragging, setIsDragging] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>('idle');
  const [uploadMessage, setUploadMessage] = useState('');
  const [newCollectionName, setNewCollectionName] = useState('');
  const [deletingDocument, setDeletingDocument] = useState<string | null>(null);

  // Artifact panel state
  const [artifactPrompt, setArtifactPrompt] = useState('');
  const [artifactStatus, setArtifactStatus] = useState<ArtifactStatus>('idle');
  const [artifactMessage, setArtifactMessage] = useState('');
  const [artifactContent, setArtifactContent] = useState('');
  const [artifactTitle, setArtifactTitle] = useState('');
  const [artifactSavedPath, setArtifactSavedPath] = useState('');
  const [busyArtifactKind, setBusyArtifactKind] = useState<ArtifactKind | null>(null);

  const activeCollection =
    collections.find((c) => c.id === activeCollectionId) ?? null;

  // ── Effects ────────────────────────────────────────────────────

  useEffect(() => {
    void initializeApp();
  }, [initializeApp]);

  useEffect(() => {
    if (activeCollectionId) {
      void refreshDocumentsAndArtifacts(activeCollectionId);
    }
  }, [activeCollectionId]);

  // ── Data fetching ──────────────────────────────────────────────

  const loadCollections = useCallback(async (preferredId?: string) => {
    try {
      const result = await api.fetchCollections();
      setCollections(result);
      setBackendStatus('online');
      setActiveCollectionId((current) => {
        const preferred = preferredId ?? current;
        if (result.some((c) => c.id === preferred)) return preferred;
        return result[0]?.id ?? 'general';
      });
    } catch {
      setBackendStatus('offline');
    }
  }, []);

  const initializeApp = useCallback(async () => {
    const healthy = await api.checkHealth();
    setBackendStatus(healthy ? 'online' : 'offline');
    await loadCollections();
  }, [loadCollections]);

  async function refreshDocumentsAndArtifacts(collectionId: string) {
    try {
      const [docs, arts] = await Promise.all([
        api.fetchDocuments(collectionId),
        api.fetchArtifacts(collectionId),
      ]);
      setDocuments(docs);
      setArtifacts(arts);
      setBackendStatus('online');
    } catch {
      setBackendStatus('offline');
    }
  }

  async function refreshAll(collectionId: string = activeCollectionId) {
    await Promise.all([
      loadCollections(collectionId),
      refreshDocumentsAndArtifacts(collectionId),
    ]);
  }

  // ── Handlers ──────────────────────────────────────────────────

  async function handleCreateCollection(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = newCollectionName.trim();
    if (!name) return;

    try {
      const created = await api.createCollection(name);
      setNewCollectionName('');
      setArtifactContent('');
      setArtifactSavedPath('');
      setArtifactTitle('');
      setArtifactMessage('');
      await loadCollections(created.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to create collection.';
      setArtifactStatus('error');
      setArtifactTitle('Collection error');
      setArtifactMessage(msg);
      setArtifactContent(msg);
    }
  }

  async function handleSend() {
    if (!input.trim()) return;

    const userMessage: Message = { id: Date.now().toString(), role: 'user', content: input };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsTyping(true);

    try {
      const result = await api.sendChat(userMessage.content, activeCollectionId);
      setBackendStatus('online');
      setMessages((prev) => [
        ...prev,
        { id: `${Date.now()}-ai`, role: 'ai', content: result.reply },
      ]);
    } catch (err) {
      setBackendStatus('offline');
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setMessages((prev) => [
        ...prev,
        { id: `${Date.now()}-error`, role: 'ai', content: `I could not complete that request. ${msg}` },
      ]);
    } finally {
      setIsTyping(false);
    }
  }

  async function handleFileUpload(file: File) {
    const allowed = ['.pdf', '.txt', '.md', '.html'];
    const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
    if (!allowed.includes(ext)) {
      setUploadStatus('error');
      setUploadMessage(`Unsupported file type. Allowed: ${allowed.join(', ')}`);
      window.setTimeout(() => setUploadStatus('idle'), 2500);
      return;
    }

    setUploadStatus('uploading');
    setUploadMessage(`Uploading into ${activeCollection?.name ?? 'collection'}...`);

    try {
      const result = await api.uploadFile(activeCollectionId, file);
      setUploadStatus('success');
      setUploadMessage(`Saved ${result.filename} and indexed ${result.chunks_added} chunks.`);
      await refreshAll(activeCollectionId);
      window.setTimeout(() => setUploadStatus('idle'), 2500);
    } catch (err) {
      setBackendStatus('offline');
      setUploadStatus('error');
      setUploadMessage(err instanceof Error ? err.message : 'Upload failed.');
      window.setTimeout(() => setUploadStatus('idle'), 3000);
    }
  }

  async function handleDeleteDocument(documentName: string) {
    setDeletingDocument(documentName);
    try {
      const docs = await api.deleteDocument(activeCollectionId, documentName);
      setDocuments(docs);
      await loadCollections(activeCollectionId);
    } catch (err) {
      setArtifactStatus('error');
      setArtifactTitle('Document error');
      const msg = err instanceof Error ? err.message : 'Unable to delete document.';
      setArtifactMessage(msg);
      setArtifactContent(msg);
    } finally {
      setDeletingDocument(null);
    }
  }

  async function handleGenerateArtifact(kind: ArtifactKind) {
    setArtifactStatus('working');
    setArtifactTitle(`Generating ${formatArtifactKind(kind)}...`);
    setArtifactMessage('Building a study artifact from the active collection.');
    setArtifactContent('');
    setArtifactSavedPath('');
    setBusyArtifactKind(kind);

    try {
      const result = await api.generateArtifact(
        activeCollectionId,
        kind,
        artifactPrompt.trim() || undefined,
      );
      setArtifactStatus('idle');
      setArtifactTitle(formatArtifactKind(kind));
      setArtifactMessage('Artifact ready.');
      setArtifactContent(result.content);
      setArtifactSavedPath(result.saved_path);
      await refreshDocumentsAndArtifacts(activeCollectionId);
      await loadCollections(activeCollectionId);
    } catch (err) {
      setArtifactStatus('error');
      setArtifactTitle('Artifact error');
      const msg = err instanceof Error ? err.message : 'Artifact generation failed.';
      setArtifactMessage(msg);
      setArtifactContent(msg);
    } finally {
      setBusyArtifactKind(null);
    }
  }

  // ── Render ────────────────────────────────────────────────────

  return (
    <div className="app-container">
      {!sidebarOpen && (
        <button className="mobile-sidebar-toggle" onClick={() => setSidebarOpen(true)}>
          <Menu size={20} />
        </button>
      )}

      {sidebarOpen && (
        <Sidebar
          collections={collections}
          activeCollectionId={activeCollectionId}
          documents={documents}
          artifacts={artifacts}
          newCollectionName={newCollectionName}
          uploadStatus={uploadStatus}
          uploadMessage={uploadMessage}
          isDragging={isDragging}
          deletingDocument={deletingDocument}
          onSelectCollection={setActiveCollectionId}
          onChangeNewName={setNewCollectionName}
          onCreateCollection={handleCreateCollection}
          onFileUpload={(file) => void handleFileUpload(file)}
          onDeleteDocument={(name) => void handleDeleteDocument(name)}
          onDragStateChange={setIsDragging}
          onClose={() => setSidebarOpen(false)}
        />
      )}

      <main className="main-chat">
        <header className="chat-header">
          <div className="header-status">
            <div className={`status-dot ${backendStatus}`} />
            <span>
              {backendStatus === 'online' && `Connected to ${activeCollection?.name ?? 'collection'}`}
              {backendStatus === 'checking' && 'Checking backend...'}
              {backendStatus === 'offline' && 'Backend offline'}
            </span>
          </div>
          <div className="header-pill">
            {activeCollection
              ? `${activeCollection.document_count} docs / ${activeCollection.artifact_count} artifacts`
              : 'No collection selected'}
          </div>
        </header>

        <ChatPanel
          messages={messages}
          isTyping={isTyping}
          scrollTrigger={artifactContent}
        >
          <ArtifactPanel
            artifactPrompt={artifactPrompt}
            artifactStatus={artifactStatus}
            artifactTitle={artifactTitle}
            artifactMessage={artifactMessage}
            artifactContent={artifactContent}
            artifactSavedPath={artifactSavedPath}
            busyArtifactKind={busyArtifactKind}
            onPromptChange={setArtifactPrompt}
            onGenerate={(kind) => void handleGenerateArtifact(kind)}
          />
        </ChatPanel>

        <InputBar
          value={input}
          placeholder={`Ask about ${activeCollection?.name ?? 'your study collection'}...`}
          disabled={isTyping}
          onChange={setInput}
          onSend={() => void handleSend()}
        />
      </main>
    </div>
  );
}
