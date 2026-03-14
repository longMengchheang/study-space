import { NotebookPen, Sparkles } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import type { ArtifactKind } from './api';

type ArtifactStatus = 'idle' | 'working' | 'error';

const ARTIFACT_BUTTONS: Array<{ kind: ArtifactKind; label: string }> = [
  { kind: 'summary', label: 'Summary' },
  { kind: 'flashcards', label: 'Flashcards' },
  { kind: 'quiz', label: 'Quiz' },
  { kind: 'study_guide', label: 'Study Guide' },
];

type ArtifactPanelProps = {
  artifactPrompt: string;
  artifactStatus: ArtifactStatus;
  artifactTitle: string;
  artifactMessage: string;
  artifactContent: string;
  artifactSavedPath: string;
  busyArtifactKind: ArtifactKind | null;
  onPromptChange: (value: string) => void;
  onGenerate: (kind: ArtifactKind) => void;
};

export default function ArtifactPanel(props: ArtifactPanelProps) {
  return (
    <section className="artifact-panel">
      <div className="artifact-panel-header">
        <div>
      <div className="panel-kicker">RAG study artifacts</div>
          <h3>Create Study Outputs</h3>
        </div>
        <NotebookPen size={18} className="panel-icon" />
      </div>
      <p className="panel-copy">
        Generate reusable study material from the currently selected collection.
      </p>
      <textarea
        className="artifact-prompt"
        value={props.artifactPrompt}
        onChange={(e) => props.onPromptChange(e.target.value)}
        placeholder="Optional focus, e.g. key formulas, chapter 2, exam review..."
        rows={2}
      />
      <div className="artifact-grid">
        {ARTIFACT_BUTTONS.map((artifact) => (
          <button
            key={artifact.kind}
            className="artifact-button"
            onClick={() => props.onGenerate(artifact.kind)}
            disabled={props.busyArtifactKind !== null}
          >
            <Sparkles size={16} />
            <span>
              {props.busyArtifactKind === artifact.kind ? 'Working...' : artifact.label}
            </span>
          </button>
        ))}
      </div>

      {(props.artifactContent || props.artifactStatus !== 'idle') && (
        <div className={`artifact-result ${props.artifactStatus === 'error' ? 'error' : ''}`}>
          <div className="artifact-result-header">
            <div>
              <div className="artifact-title">{props.artifactTitle}</div>
              <div className="artifact-caption">{props.artifactMessage}</div>
            </div>
            {props.artifactSavedPath && (
              <span className="artifact-path">Saved: {props.artifactSavedPath}</span>
            )}
          </div>
          {props.artifactStatus === 'working' ? (
            <div className="typing-indicator">
              <div className="typing-dot artifact-dot" />
              <div className="typing-dot artifact-dot" />
              <div className="typing-dot artifact-dot" />
            </div>
          ) : (
            <ReactMarkdown>{props.artifactContent}</ReactMarkdown>
          )}
        </div>
      )}
    </section>
  );
}
