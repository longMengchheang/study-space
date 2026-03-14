import { useRef } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  FileText,
  FolderKanban,
  LibraryBig,
  Plus,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { ArtifactRecord, CollectionSummary, DocumentRecord } from './api';

type UploadStatus = 'idle' | 'uploading' | 'success' | 'error';

type SidebarProps = {
  collections: CollectionSummary[];
  activeCollectionId: string;
  documents: DocumentRecord[];
  artifacts: ArtifactRecord[];
  newCollectionName: string;
  uploadStatus: UploadStatus;
  uploadMessage: string;
  isDragging: boolean;
  deletingDocument: string | null;
  onSelectCollection: (id: string) => void;
  onChangeNewName: (name: string) => void;
  onCreateCollection: (e: React.FormEvent<HTMLFormElement>) => void;
  onFileUpload: (file: File) => void;
  onDeleteDocument: (name: string) => void;
  onDragStateChange: (dragging: boolean) => void;
  onClose: () => void;
};

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatArtifactKind(kind: string): string {
  return kind.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}

export default function Sidebar(props: SidebarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeCollection =
    props.collections.find((c) => c.id === props.activeCollectionId) ?? null;

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    props.onDragStateChange(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    props.onDragStateChange(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    props.onDragStateChange(false);
    const file = e.dataTransfer.files?.[0];
    if (file) props.onFileUpload(file);
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      props.onFileUpload(file);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="logo-icon">
          <LibraryBig size={18} />
        </div>
        <div>
          <h2>Study RAG</h2>
          <p className="sidebar-subtitle">Collections, sources, and study outputs</p>
        </div>
        <button className="sidebar-close" onClick={props.onClose}>
          <X size={20} />
        </button>
      </div>

      <div className="sidebar-content">
        {/* Collections */}
        <section className="sidebar-section">
          <h3 className="section-title">Study Collections</h3>
          <div className="collection-list">
            {props.collections.map((collection) => (
              <button
                key={collection.id}
                className={`collection-item ${collection.id === props.activeCollectionId ? 'active' : ''}`}
                onClick={() => props.onSelectCollection(collection.id)}
              >
                <div className="collection-name-row">
                  <FolderKanban size={16} />
                  <span>{collection.name}</span>
                </div>
                <div className="collection-meta">
                  <span>{collection.document_count} docs</span>
                  <span>{collection.artifact_count} artifacts</span>
                </div>
              </button>
            ))}
          </div>

          <form className="inline-form" onSubmit={props.onCreateCollection}>
            <input
              className="collection-input"
              value={props.newCollectionName}
              onChange={(e) => props.onChangeNewName(e.target.value)}
              placeholder="New study collection"
            />
            <button className="secondary-button" type="submit">
              <Plus size={16} />
            </button>
          </form>
        </section>

        {/* Upload */}
        <section className="sidebar-section">
          <h3 className="section-title">Upload Document</h3>
          <div
            className={`upload-area ${props.isDragging ? 'drag-active' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              type="file"
              accept=".pdf,.txt,.md,.html"
              className="hidden"
              ref={fileInputRef}
              onChange={handleFileInput}
            />

            {props.uploadStatus === 'idle' && (
              <>
                <Upload size={24} className="upload-icon" />
                <div className="upload-text">
                  Drop a file into <strong>{activeCollection?.name ?? 'this collection'}</strong>
                </div>
              </>
            )}

            {props.uploadStatus === 'uploading' && (
              <>
                <div className="typing-indicator upload-dots">
                  <div className="typing-dot artifact-dot" />
                  <div className="typing-dot artifact-dot" />
                  <div className="typing-dot artifact-dot" />
                </div>
                <div className="upload-text upload-accent">{props.uploadMessage}</div>
              </>
            )}

            {props.uploadStatus === 'success' && (
              <>
                <CheckCircle2 size={24} className="text-success" />
                <div className="upload-text text-success">{props.uploadMessage}</div>
              </>
            )}

            {props.uploadStatus === 'error' && (
              <>
                <AlertCircle size={24} className="text-danger" />
                <div className="upload-text text-danger">{props.uploadMessage}</div>
              </>
            )}
          </div>
        </section>

        {/* Documents */}
        <section className="sidebar-section">
          <h3 className="section-title">Collection Documents ({props.documents.length})</h3>
          <div className="document-list">
            {props.documents.length === 0 ? (
              <div className="empty-panel">No documents uploaded for this collection yet.</div>
            ) : (
              props.documents.map((doc) => (
                <div key={doc.name} className="document-item">
                  <div className="document-main">
                    <FileText size={16} className="document-icon" />
                    <div className="document-copy">
                      <span className="truncate">{doc.name}</span>
                      <span className="document-size">{formatBytes(doc.size)}</span>
                    </div>
                  </div>
                  <button
                    className="icon-button"
                    onClick={() => props.onDeleteDocument(doc.name)}
                    disabled={props.deletingDocument === doc.name}
                    title="Delete document"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Artifacts */}
        <section className="sidebar-section">
          <h3 className="section-title">Saved Artifacts ({props.artifacts.length})</h3>
          <div className="artifact-list">
            {props.artifacts.length === 0 ? (
              <div className="empty-panel">No generated study artifacts yet.</div>
            ) : (
              props.artifacts.map((artifact) => (
                <div key={artifact.filename} className="artifact-list-item">
                  <div className="artifact-list-copy">
                    <span>{formatArtifactKind(artifact.kind)}</span>
                    <span className="artifact-list-meta">{artifact.filename}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </aside>
  );
}
