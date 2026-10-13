import { notFound } from "next/navigation";

// Toute adresse sans page passe par notFound(), comme une page de
// l'application refusée par lirePourPage : les deux réponses sont alors le
// même document (S-02). Next.js 16.4 ne rend jamais not-found.tsx sur le
// serveur après un notFound() levé pendant l'affichage : il envoie son
// document d'erreur, au corps vide, et la page « introuvable » s'affiche
// après hydratation. Sans cette route, une adresse inexistante recevait la
// page dans son HTML, et se distinguait d'une page refusée sans JavaScript.
// Les routes plus précises (pages, route.ts, fichiers de _next) passent
// avant celle-ci. Fiche : docs/features/controle-deploiement.md, section 5.
export default function PageAttrapeTout() {
  notFound();
}
