import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import DocsLibraryClient from "./DocsLibraryClient";

export default function DocsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center text-text-primary">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      }
    >
      <DocsLibraryClient />
    </Suspense>
  );
}
