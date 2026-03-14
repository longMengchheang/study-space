import type { Metadata } from "next";
import "./globals.css";

const THEME_BOOTSTRAP_SCRIPT = `
  (function () {
    try {
      var key = "studyspace:theme";
      var stored = window.localStorage.getItem(key);
      var theme = stored === "dark" ? "dark" : "light";
      var root = document.documentElement;
      root.dataset.theme = theme;
      root.style.colorScheme = theme;
    } catch (_error) {}
  })();
`;

export const metadata: Metadata = {
  title: "Studyspace",
  description: "A calm, focused workspace for study tools, notes, and learning systems.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
        {children}
      </body>
    </html>
  );
}
