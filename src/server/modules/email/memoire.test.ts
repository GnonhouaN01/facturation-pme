import { describe, expect, test } from "vitest";

import { creerTransportMemoire } from "./memoire";
import type { MessageEmail } from "./transport";

// Transport des tests : garde les messages en mémoire, n'ouvre aucune
// connexion. Fiche : docs/features/envoi-emails.md, section 2.

const MESSAGE: MessageEmail = {
  de: "application@exemple.invalid",
  nomExpediteur: "Facturation PME",
  a: "client@exemple.invalid",
  sujet: "Sujet",
  corps: "Corps",
};

describe("creerTransportMemoire", () => {
  test("garde chaque message remis, dans l'ordre", async () => {
    const transport = creerTransportMemoire();

    await transport.remettre(MESSAGE);
    await transport.remettre({ ...MESSAGE, a: "autre@exemple.invalid" });

    expect(transport.messages.map((m) => m.a)).toEqual([
      "client@exemple.invalid",
      "autre@exemple.invalid",
    ]);
  });

  test("garde une copie : modifier l'objet remis ne change pas la boîte", async () => {
    const transport = creerTransportMemoire();
    const remis = { ...MESSAGE };

    await transport.remettre(remis);
    remis.a = "modifie@exemple.invalid";

    expect(transport.messages[0]?.a).toBe("client@exemple.invalid");
  });

  test("vider efface la boîte ; deux transports ont deux boîtes", async () => {
    const premier = creerTransportMemoire();
    const second = creerTransportMemoire();

    await premier.remettre(MESSAGE);
    expect(second.messages).toEqual([]);
    premier.vider();

    expect(premier.messages).toEqual([]);
  });
});
