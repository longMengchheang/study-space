const DOCS_DB_NAME = "studyspace-docs";
const DOCS_DB_VERSION = 1;
const DOCS_FILES_STORE = "files";

type StoredDocsFile = {
  blob: Blob;
  fileName: string;
  contentType: string;
  updatedAt: string;
};

function openDocsDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available in this environment."));
      return;
    }

    const request = indexedDB.open(DOCS_DB_NAME, DOCS_DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(DOCS_FILES_STORE)) {
        database.createObjectStore(DOCS_FILES_STORE);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Unable to open Docs storage."));
  });
}

export async function saveDocsPdfFile(
  assetId: string,
  file: Blob,
  fileName: string,
  contentType: string,
) {
  const database = await openDocsDb();

  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(DOCS_FILES_STORE, "readwrite");
    const store = transaction.objectStore(DOCS_FILES_STORE);

    store.put(
      {
        blob: file,
        fileName,
        contentType,
        updatedAt: new Date().toISOString(),
      } satisfies StoredDocsFile,
      assetId,
    );

    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("Unable to save PDF to Docs storage."));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("Unable to save PDF to Docs storage."));
  });

  database.close();
}

export async function loadDocsPdfFile(assetId: string): Promise<StoredDocsFile | null> {
  const database = await openDocsDb();

  const result = await new Promise<StoredDocsFile | null>((resolve, reject) => {
    const transaction = database.transaction(DOCS_FILES_STORE, "readonly");
    const store = transaction.objectStore(DOCS_FILES_STORE);
    const request = store.get(assetId);

    request.onsuccess = () => resolve((request.result as StoredDocsFile | undefined) ?? null);
    request.onerror = () =>
      reject(request.error ?? new Error("Unable to load PDF from Docs storage."));
  });

  database.close();
  return result;
}

export async function deleteDocsPdfFile(assetId: string) {
  const database = await openDocsDb();

  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(DOCS_FILES_STORE, "readwrite");
    const store = transaction.objectStore(DOCS_FILES_STORE);

    store.delete(assetId);

    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("Unable to delete PDF from Docs storage."));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("Unable to delete PDF from Docs storage."));
  });

  database.close();
}
