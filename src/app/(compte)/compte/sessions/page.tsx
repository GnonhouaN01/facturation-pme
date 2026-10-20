import { ListeSessions } from "@/components/compte/liste-sessions";
import { lireComptePourPage, lireSessions } from "@/server/actions/exposer";
import { TEXTES_COMPTE } from "@/textes/compte";

// Sessions actives (UC-05, F-004, 1.5). Elle se protège elle-même : sans
// session vérifiée, la page « introuvable ». Elle ne lit que les sessions de
// l'utilisateur de la session, sans jeton ni texte du navigateur. Fiche :
// docs/features/profil-sessions.md, sections 3 et 9.
export default async function PageSessions() {
  const sessions = await lireComptePourPage(lireSessions);
  const textes = TEXTES_COMPTE.sessions;
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-12">
      <div className="flex flex-col gap-2">
        <h1 className="font-heading text-[2rem] leading-9.5 font-semibold tracking-[-0.02em] text-foreground">
          {textes.titre}
        </h1>
        <p className="text-[0.9375rem] leading-6 text-muted-foreground">{textes.introduction}</p>
      </div>
      <ListeSessions sessions={sessions} />
    </main>
  );
}
