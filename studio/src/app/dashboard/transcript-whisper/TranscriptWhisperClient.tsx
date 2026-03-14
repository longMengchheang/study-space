"use client";

import { useEffect, useRef, useState } from "react";
import {
  Activity,
  AudioLines,
  FileAudio2,
  FileText,
  FolderSearch,
  Loader,
  RefreshCw,
} from "lucide-react";

const MODEL_OPTIONS = ["tiny", "base", "small", "medium", "large"] as const;
const TASK_OPTIONS = ["transcribe", "translate"] as const;
const OUTPUT_OPTIONS = ["txt", "srt", "vtt", "tsv", "json", "all"] as const;

type HealthState = {
  connected: boolean;
  status: string;
  detail?: string;
};

type UploadResult = {
  text: string;
};

type ProcessResult = {
  audio_path: string;
  transcript_paths: Record<string, string>;
  text?: string | null;
};

type JobAcceptedResponse = {
  job_id: string;
  status: string;
};

type JobStatusResponse = {
  job_id: string;
  status: "queued" | "running" | "completed" | "failed" | "canceled";
  phase: string;
  percent: number;
  message: string;
  cancel_requested: boolean;
  error?: string | null;
  result?: UploadResult | ProcessResult | null;
};

type ProgressState = {
  active: boolean;
  phase: string;
  percent: number;
  message: string;
};

const IDLE_PROGRESS: ProgressState = {
  active: false,
  phase: "idle",
  percent: 0,
  message: "",
};

function clampProgress(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function formatPhaseLabel(phase: string): string {
  switch (phase) {
    case "uploading":
      return "Uploading";
    case "extracting":
      return "Extracting";
    case "transcribing":
      return "Transcribing";
    case "writing":
      return "Writing";
    case "completed":
      return "Complete";
    case "canceled":
      return "Canceled";
    case "failed":
      return "Failed";
    default:
      return "Queued";
  }
}

export default function TranscriptWhisperClient() {
  const [health, setHealth] = useState<HealthState>({
    connected: false,
    status: "checking",
  });
  const [mode, setMode] = useState<"upload" | "path">("upload");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadModel, setUploadModel] = useState<(typeof MODEL_OPTIONS)[number]>("small");
  const [uploadTask, setUploadTask] = useState<(typeof TASK_OPTIONS)[number]>("transcribe");
  const [uploadLanguage, setUploadLanguage] = useState("");
  const [pathInput, setPathInput] = useState("");
  const [outputDir, setOutputDir] = useState("");
  const [pathModel, setPathModel] = useState<(typeof MODEL_OPTIONS)[number]>("small");
  const [pathTask, setPathTask] = useState<(typeof TASK_OPTIONS)[number]>("transcribe");
  const [pathLanguage, setPathLanguage] = useState("");
  const [outputFormat, setOutputFormat] = useState<(typeof OUTPUT_OPTIONS)[number]>("txt");
  const [audioFormat, setAudioFormat] = useState("mp3");
  const [audioBitrate, setAudioBitrate] = useState("192k");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [processResult, setProcessResult] = useState<ProcessResult | null>(null);
  const [progress, setProgress] = useState<ProgressState>(IDLE_PROGRESS);
  const uploadRequestRef = useRef<XMLHttpRequest | null>(null);
  const activeJobIdRef = useRef<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  async function refreshHealth() {
    setHealth({ connected: false, status: "checking" });

    try {
      const response = await fetch("/api/transcript-whisper/health", { cache: "no-store" });
      const data = (await response.json()) as HealthState;

      if (!response.ok) {
        setHealth({
          connected: false,
          status: data.status || "offline",
          detail: data.detail || "Transcript Whisper did not respond normally.",
        });
        return;
      }

      setHealth({
        connected: Boolean(data.connected),
        status: data.status || "ok",
        detail: data.detail,
      });
    } catch (error) {
      setHealth({
        connected: false,
        status: "offline",
        detail: error instanceof Error ? error.message : "Transcript Whisper is unavailable.",
      });
    }
  }

  useEffect(() => {
    void refreshHealth();
    return () => {
      uploadRequestRef.current?.abort();
      eventSourceRef.current?.close();
    };
  }, []);

  async function streamJobUntilFinished<T>(jobId: string): Promise<T> {
    activeJobIdRef.current = jobId;

    return new Promise<T>((resolve, reject) => {
      const source = new EventSource(`/api/transcript-whisper/jobs/${jobId}/events`);
      eventSourceRef.current = source;

      source.onmessage = (event) => {
        const data = JSON.parse(event.data) as JobStatusResponse;

        setProgress({
          active: true,
          phase: data.phase,
          percent: clampProgress(data.percent),
          message: data.message,
        });

        if (data.status === "completed") {
          activeJobIdRef.current = null;
          eventSourceRef.current?.close();
          eventSourceRef.current = null;
          resolve(data.result as T);
          return;
        }

        if (data.status === "failed") {
          activeJobIdRef.current = null;
          eventSourceRef.current?.close();
          eventSourceRef.current = null;
          reject(new Error(data.error || data.message || "Job failed."));
          return;
        }

        if (data.status === "canceled") {
          activeJobIdRef.current = null;
          eventSourceRef.current?.close();
          eventSourceRef.current = null;
          reject(new Error("Request canceled."));
        }
      };

      source.onerror = () => {
        activeJobIdRef.current = null;
        eventSourceRef.current?.close();
        eventSourceRef.current = null;
        reject(new Error("Progress stream disconnected."));
      };
    });
  }

  async function createPathJob(): Promise<JobAcceptedResponse> {
    const response = await fetch("/api/transcript-whisper/process", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input_path: pathInput.trim(),
        output_dir: outputDir.trim() || undefined,
        audio_format: audioFormat.trim(),
        audio_bitrate: audioBitrate.trim(),
        model: pathModel,
        language: pathLanguage.trim() || undefined,
        task: pathTask,
        output_format: outputFormat,
      }),
    });

    const data = (await response.json()) as JobAcceptedResponse & { detail?: string };
    if (!response.ok) {
      throw new Error(data.detail || "Path transcription failed.");
    }

    return data;
  }

  async function createUploadJob(formData: FormData): Promise<JobAcceptedResponse> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      uploadRequestRef.current = xhr;
      xhr.open("POST", "/api/transcript-whisper/upload");
      xhr.responseType = "json";

      xhr.onloadstart = () => {
        setProgress({
          active: true,
          phase: "uploading",
          percent: 0,
          message: "Starting upload...",
        });
      };

      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) {
          setProgress({
            active: true,
            phase: "uploading",
            percent: 0,
            message: "Uploading file...",
          });
          return;
        }

        const percent = clampProgress((event.loaded / event.total) * 100);
        setProgress({
          active: true,
          phase: "uploading",
          percent,
          message: `Uploading file... ${percent}%`,
        });
      };

      xhr.onload = () => {
        uploadRequestRef.current = null;
        const data = (xhr.response ?? {}) as JobAcceptedResponse & { detail?: string };

        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(data);
          return;
        }

        reject(new Error(data.detail || "Upload transcription failed."));
      };

      xhr.onerror = () => {
        uploadRequestRef.current = null;
        reject(new Error("Upload transcription failed."));
      };

      xhr.onabort = () => {
        uploadRequestRef.current = null;
        reject(new Error("Request canceled."));
      };

      xhr.send(formData);
    });
  }

  async function handleCancel() {
    if (uploadRequestRef.current) {
      uploadRequestRef.current.abort();
      setSubmitting(false);
      setProgress({
        active: true,
        phase: "canceled",
        percent: 0,
        message: "Canceled.",
      });
      return;
    }

    const activeJobId = activeJobIdRef.current;
    if (!activeJobId) {
      return;
    }

    setProgress((current) => ({
      ...current,
      active: true,
      message: "Cancel requested...",
    }));

    try {
      await fetch(`/api/transcript-whisper/jobs/${activeJobId}/cancel`, {
        method: "POST",
      });
    } catch {
      setErrorMessage("Unable to cancel the backend job.");
    }
  }

  async function handleUploadSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;

    if (!selectedFile) {
      setErrorMessage("Choose a media file first.");
      return;
    }

    setSubmitting(true);
    setErrorMessage(null);
    setUploadResult(null);
    setProcessResult(null);

    const formData = new FormData();
    formData.append("file", selectedFile);
    formData.append("model", uploadModel);
    formData.append("task", uploadTask);
    if (uploadLanguage.trim()) {
      formData.append("language", uploadLanguage.trim());
    }

    try {
      const job = await createUploadJob(formData);
      setProgress({
        active: true,
        phase: "queued",
        percent: 0,
        message: "Upload finished. Job queued...",
      });
      const result = await streamJobUntilFinished<UploadResult>(job.job_id);
      setUploadResult(result);
      setSelectedFile(null);
      form.reset();
    } catch (error) {
      setUploadResult(null);
      if (error instanceof Error && error.message === "Request canceled.") {
        setErrorMessage(null);
        setProgress({
          active: true,
          phase: "canceled",
          percent: 0,
          message: "Canceled.",
        });
      } else {
        setErrorMessage(error instanceof Error ? error.message : "Upload transcription failed.");
        setProgress(IDLE_PROGRESS);
      }
    } finally {
      uploadRequestRef.current = null;
      activeJobIdRef.current = null;
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      setSubmitting(false);
      void refreshHealth();
    }
  }

  async function handlePathSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!pathInput.trim()) {
      setErrorMessage("Enter a media file path.");
      return;
    }

    setSubmitting(true);
    setErrorMessage(null);
    setUploadResult(null);
    setProcessResult(null);
    setProgress({
      active: true,
      phase: "queued",
      percent: 0,
      message: "Submitting transcription job...",
    });

    try {
      const job = await createPathJob();
      const result = await streamJobUntilFinished<ProcessResult>(job.job_id);
      setProcessResult(result);
    } catch (error) {
      setProcessResult(null);
      if (error instanceof Error && error.message === "Request canceled.") {
        setErrorMessage(null);
        setProgress({
          active: true,
          phase: "canceled",
          percent: 0,
          message: "Canceled.",
        });
      } else {
        setErrorMessage(error instanceof Error ? error.message : "Path transcription failed.");
        setProgress(IDLE_PROGRESS);
      }
    } finally {
      activeJobIdRef.current = null;
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      setSubmitting(false);
      void refreshHealth();
    }
  }

  return (
    <div className="transcript-shell">
      <header className="transcript-topbar">
        <div>
          <h1 className="transcript-topbar-title">Transcript Whisper</h1>
          <p className="transcript-topbar-copy">
            Transcribe uploads or local media paths without leaving Studyspace.
          </p>
        </div>
        <div className="transcript-topbar-actions">
          <div className="rag-status-pill">
            <Activity
              className={`h-4 w-4 ${health.connected ? "text-[#22c55e]" : "text-text-muted"}`}
            />
            {health.status === "checking"
              ? "Checking"
              : health.connected
                ? "Connected"
                : "Offline"}
          </div>
          <button
            type="button"
            onClick={() => void refreshHealth()}
            className="study-button-secondary"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
        </div>
      </header>

      {errorMessage ? <div className="rag-error-banner">{errorMessage}</div> : null}

      <div className="transcript-board">
        <section className="transcript-column">
          <div className="rag-panel-header">
            <div>
              <div className="rag-panel-title">Workflow</div>
              <div className="rag-panel-subtitle">
                Switch between direct upload and local path processing.
              </div>
            </div>
            <div className="rag-mini-badge">
              {mode === "upload" ? "Upload" : "Path"}
            </div>
          </div>

          <div className="transcript-column-scroll">
            <div className="transcript-mode-toggle">
              <button
                type="button"
                onClick={() => {
                  setMode("upload");
                  setErrorMessage(null);
                }}
                className={mode === "upload" ? "study-button-primary" : "study-button-secondary"}
              >
                <FileAudio2 className="h-4 w-4" />
                Upload file
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode("path");
                  setErrorMessage(null);
                }}
                className={mode === "path" ? "study-button-primary" : "study-button-secondary"}
              >
                <FolderSearch className="h-4 w-4" />
                Process path
              </button>
            </div>

            {mode === "upload" ? (
              <form key="upload-form" className="transcript-form" onSubmit={handleUploadSubmit}>
                <div className="transcript-field-group">
                  <label className="study-label" htmlFor="media-file">
                    Media file
                  </label>
                  <input
                    id="media-file"
                    type="file"
                    className="study-field"
                    onChange={(event) => setSelectedFile(event.target.files?.[0] || null)}
                    accept="audio/*,video/*"
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="study-label" htmlFor="upload-model">
                      Model
                    </label>
                    <select
                      id="upload-model"
                      className="study-field"
                      value={uploadModel}
                      onChange={(event) =>
                        setUploadModel(event.target.value as (typeof MODEL_OPTIONS)[number])
                      }
                    >
                      {MODEL_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="study-label" htmlFor="upload-task">
                      Task
                    </label>
                    <select
                      id="upload-task"
                      className="study-field"
                      value={uploadTask}
                      onChange={(event) =>
                        setUploadTask(event.target.value as (typeof TASK_OPTIONS)[number])
                      }
                    >
                      {TASK_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="transcript-field-group">
                  <label className="study-label" htmlFor="upload-language">
                    Language code
                  </label>
                  <input
                    id="upload-language"
                    className="study-field"
                    type="text"
                    placeholder="Optional, e.g. en"
                    value={uploadLanguage}
                    onChange={(event) => setUploadLanguage(event.target.value)}
                  />
                </div>

                <div className="transcript-form-actions">
                  <button type="submit" className="study-button-primary" disabled={submitting}>
                    {submitting ? (
                      <>
                        <Loader className="h-4 w-4 animate-spin" />
                        Working
                      </>
                    ) : (
                      <>
                        <AudioLines className="h-4 w-4" />
                        Transcribe upload
                      </>
                    )}
                  </button>
                  {submitting ? (
                    <button type="button" className="study-button-secondary" onClick={handleCancel}>
                      Cancel
                    </button>
                  ) : null}
                </div>
              </form>
            ) : (
              <form key="path-form" className="transcript-form" onSubmit={handlePathSubmit}>
                <div className="transcript-field-group">
                  <label className="study-label" htmlFor="input-path">
                    Input path
                  </label>
                  <input
                    id="input-path"
                    className="study-field"
                    type="text"
                    placeholder="C:\\media\\lecture.mp4"
                    value={pathInput}
                    onChange={(event) => setPathInput(event.target.value)}
                  />
                </div>
                <div className="transcript-field-group">
                  <label className="study-label" htmlFor="output-dir">
                    Output directory
                  </label>
                  <input
                    id="output-dir"
                    className="study-field"
                    type="text"
                    placeholder="Optional output folder"
                    value={outputDir}
                    onChange={(event) => setOutputDir(event.target.value)}
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="study-label" htmlFor="path-model">
                      Model
                    </label>
                    <select
                      id="path-model"
                      className="study-field"
                      value={pathModel}
                      onChange={(event) =>
                        setPathModel(event.target.value as (typeof MODEL_OPTIONS)[number])
                      }
                    >
                      {MODEL_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="study-label" htmlFor="path-task">
                      Task
                    </label>
                    <select
                      id="path-task"
                      className="study-field"
                      value={pathTask}
                      onChange={(event) =>
                        setPathTask(event.target.value as (typeof TASK_OPTIONS)[number])
                      }
                    >
                      {TASK_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-3">
                  <div>
                    <label className="study-label" htmlFor="output-format">
                      Output format
                    </label>
                    <select
                      id="output-format"
                      className="study-field"
                      value={outputFormat}
                      onChange={(event) =>
                        setOutputFormat(event.target.value as (typeof OUTPUT_OPTIONS)[number])
                      }
                    >
                      {OUTPUT_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="study-label" htmlFor="audio-format">
                      Audio format
                    </label>
                    <input
                      id="audio-format"
                      className="study-field"
                      type="text"
                      value={audioFormat}
                      onChange={(event) => setAudioFormat(event.target.value)}
                    />
                  </div>
                  <div>
                    <label className="study-label" htmlFor="audio-bitrate">
                      Audio bitrate
                    </label>
                    <input
                      id="audio-bitrate"
                      className="study-field"
                      type="text"
                      value={audioBitrate}
                      onChange={(event) => setAudioBitrate(event.target.value)}
                    />
                  </div>
                </div>

                <div className="transcript-field-group">
                  <label className="study-label" htmlFor="path-language">
                    Language code
                  </label>
                  <input
                    id="path-language"
                    className="study-field"
                    type="text"
                    placeholder="Optional, e.g. en"
                    value={pathLanguage}
                    onChange={(event) => setPathLanguage(event.target.value)}
                  />
                </div>

                <div className="transcript-form-actions">
                  <button type="submit" className="study-button-primary" disabled={submitting}>
                    {submitting ? (
                      <>
                        <Loader className="h-4 w-4 animate-spin" />
                        Working
                      </>
                    ) : (
                      <>
                        <FolderSearch className="h-4 w-4" />
                        Process file path
                      </>
                    )}
                  </button>
                  {submitting ? (
                    <button type="button" className="study-button-secondary" onClick={handleCancel}>
                      Cancel
                    </button>
                  ) : null}
                </div>
              </form>
            )}

            <div className="transcript-note">
              Transcript Whisper runs through your local Studyspace proxy. Keep the backend
              available at `TRANSCRIPT_WHISPER_API_BASE_URL` or `http://127.0.0.1:8000/api/v1`.
            </div>
          </div>
        </section>

        <section className="transcript-column">
          <div className="rag-panel-header">
            <div>
              <div className="rag-panel-title">Output</div>
              <div className="rag-panel-subtitle">
                Progress, transcript text, and saved output paths appear here.
              </div>
            </div>
            <div className="study-icon-frame">
              <FileText className="h-4 w-4" />
            </div>
          </div>

          <div className="transcript-column-scroll">
            <div className="transcript-stack">
              <div className="transcript-status-card">
                <div className="transcript-status-row">
                  <div>
                    <div className="transcript-status-label">Service</div>
                    <div className="transcript-status-value">
                      {health.status === "checking"
                        ? "Checking connection"
                        : health.connected
                          ? "Ready"
                          : "Offline"}
                    </div>
                  </div>
                  <div className="rag-mini-badge">
                    {progress.active ? formatPhaseLabel(progress.phase) : "Idle"}
                  </div>
                </div>
                <p className="transcript-status-copy">
                  {health.status === "checking"
                    ? "Verifying the local transcript service."
                    : health.connected
                      ? "Transcript Whisper is reachable through the Studyspace proxy."
                      : health.detail || "Start the transcript-whisper service first."}
                </p>
              </div>

              {progress.active ? (
                <div className="transcript-progress-card">
                  <div className="transcript-status-row">
                    <div className="transcript-status-value">{formatPhaseLabel(progress.phase)}</div>
                    <div className="text-sm font-semibold text-accent">{progress.percent}%</div>
                  </div>
                  <div className="transcript-progress-bar">
                    <div
                      className="transcript-progress-fill"
                      style={{ width: `${progress.percent}%` }}
                    />
                  </div>
                  <div className="transcript-status-copy">{progress.message}</div>
                </div>
              ) : null}

              {uploadResult ? (
                <div className="transcript-result-block">
                  <div className="study-kicker">Transcript</div>
                  <textarea className="study-textarea transcript-result-textarea" value={uploadResult.text} readOnly />
                </div>
              ) : null}

              {processResult ? (
                <div className="transcript-stack">
                  <div className="transcript-result-block">
                    <div className="study-kicker">Audio path</div>
                    <div className="transcript-path-card">{processResult.audio_path}</div>
                  </div>

                  {processResult.text ? (
                    <div className="transcript-result-block">
                      <div className="study-kicker">Transcript text</div>
                      <textarea
                        className="study-textarea transcript-result-textarea"
                        value={processResult.text}
                        readOnly
                      />
                    </div>
                  ) : null}

                  <div className="transcript-result-block">
                    <div className="study-kicker">Saved outputs</div>
                    <div className="transcript-path-list">
                      {Object.entries(processResult.transcript_paths).map(([key, value]) => (
                        <div key={key} className="transcript-path-card">
                          <div className="transcript-path-label">{key}</div>
                          <div className="transcript-path-value">{value}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}

              {!uploadResult && !processResult ? (
                <div className="rag-empty-state">
                  No transcript yet. Run an upload or process a local path to populate this panel.
                </div>
              ) : null}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
