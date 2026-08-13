import "./globals.css";

export const metadata = {
  metadataBase: new URL("https://rigel-ten.vercel.app"),
  title: "Rigel — wallet diagnostics agent",
  description:
    "An agent that decides what to check on a Base wallet, goes and looks, and re-scores what it finds. Every number computed by a deterministic engine — the model never produces one.",
  openGraph: {
    title: "Rigel — it decides what to check",
    description:
      "Nine deterministic checks on any Base wallet. Then the agent picks what the first pass missed — other chains, open approvals — and investigates. On jesse.base.eth that took health from 85 to 67.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Rigel — it decides what to check",
    description:
      "It found $1,293 reachable through 19 live approvals that no portfolio view would ever show. The score moved on evidence, not on opinion.",
    creator: "@BerlinBuildWeb3",
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Spectral:ital,wght@0,300;0,400;0,600;1,400&family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
