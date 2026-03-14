import DashboardOverviewClient from "./DashboardOverviewClient";
import { STUDY_DOCS } from "@/lib/study-docs";

export default function DashboardPage() {
  return (
    <DashboardOverviewClient
      docs={STUDY_DOCS.map((doc) => ({
        slug: doc.slug,
        title: doc.title,
        summary: doc.summary,
        tags: doc.tags,
      }))}
    />
  );
}
