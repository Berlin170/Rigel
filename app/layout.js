import "./globals.css";

export const metadata = {
  title: "Rigel — wallet diagnostics agent",
  description:
    "Rigel reads any wallet, measures what is actually wrong with it, and writes the diagnosis in plain language. Every claim traced to a real tool call.",
  openGraph: {
    title: "Rigel — wallet diagnostics agent",
    description:
      "Paste a wallet. Rigel plots it as a constellation, runs a deterministic risk engine, then decides what the first pass missed and goes looking.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Rigel — wallet diagnostics agent",
    description:
      "Most portfolio tools show you what you hold. Rigel tells you what is wrong with it.",
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
