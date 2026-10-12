import "server-only";

// Transport SMTP vers Gmail, PR 2 : seul fichier qui importera nodemailer
// (règle ESLint T). Module vide de la phase rouge : chaque export lève, sans
// logique ni import. Fiche : docs/features/envoi-emails.md, sections 6.3, 7
// et 10.

function nonImplemente(): never {
  throw new Error("non implémenté");
}

export function optionsTransportSmtp(): never {
  return nonImplemente();
}

export function creerTransportSmtp(): never {
  return nonImplemente();
}

export function traduireErreurSmtp(): never {
  return nonImplemente();
}
