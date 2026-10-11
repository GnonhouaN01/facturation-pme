import { DM_Mono, DM_Sans, Space_Grotesk } from "next/font/google";

// Polices du thème Signal, communes au gabarit racine et à global-error.tsx,
// qui porte son propre document. next/font les télécharge à la construction
// et les sert depuis /_next/static/media : aucune requête vers Google à
// l'affichage (font-src 'self'). Fiche : docs/features/socle-interface.md,
// sections 4.1 et 5.3.

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
});

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
});

const dmMono = DM_Mono({
  variable: "--font-dm-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const CLASSES_POLICES = `${spaceGrotesk.variable} ${dmSans.variable} ${dmMono.variable}`;
