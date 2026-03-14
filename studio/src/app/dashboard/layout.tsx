"use client";

import { usePathname } from "next/navigation";
import DashboardSidebar from "@/components/DashboardSidebar";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isDashboard = pathname === "/dashboard";

  return (
    <div className="min-h-screen bg-bg-base">
      <DashboardSidebar />
      <main className="sidebar-shell-transition relative ml-[var(--sidebar-width)] min-h-screen w-[calc(100%-var(--sidebar-width))] overflow-x-hidden bg-bg-base">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(79,70,229,0.08),transparent_24%),radial-gradient(circle_at_bottom_right,rgba(34,211,238,0.08),transparent_22%)]" />
        <div
          className={`relative z-10 h-full w-full ${
            isDashboard ? "mx-auto max-w-[90rem] px-4 py-6 md:px-8 md:py-8" : ""
          }`}
        >
          {children}
        </div>
      </main>
    </div>
  );
}
