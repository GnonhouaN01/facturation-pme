import { ESLint } from "eslint";
import { describe, expect, test } from "vitest";

// Règles ESLint O à R de la 0.6, vérifiées par l'API d'ESLint sur du code
// fourni en texte : aucun fichier n'est écrit. Les chemins désignent des
// fichiers fictifs, auxquels eslint.config.mjs s'applique comme aux vrais.
// Fichier distinct de src/server/db/regles-import.test.ts, dont l'aide ne
// retient que no-restricted-imports et no-restricted-syntax.
// Fiche : docs/features/socle-interface.md, section 7.
//
// Les messages des sélecteurs propres à ces règles (no-restricted-syntax,
// no-restricted-imports) citent leur lettre : « règle O », « règle P »,
// « règle R ».

const eslint = new ESLint();

type Erreur = { regle: string | null; message: string };

// Erreurs (sévérité 2) seulement : un avertissement ne bloque pas la CI.
async function erreurs(code: string, fichier: string): Promise<Erreur[]> {
  const [resultat] = await eslint.lintText(code, { filePath: fichier });
  if (!resultat) throw new Error("ESLint n'a renvoyé aucun résultat.");
  const fatales = resultat.messages.filter((message) => message.fatal);
  expect(fatales, "code de test illisible par ESLint").toEqual([]);
  return resultat.messages
    .filter((message) => message.severity === 2)
    .map((message) => ({ regle: message.ruleId, message: message.message }));
}

const citeLaRegle = (lettre: string) => (erreur: Erreur) =>
  erreur.message.includes(`règle ${lettre}`);

const REGLES_O = new Set([
  "react/no-danger",
  "react/jsx-no-script-url",
  "no-eval",
  "no-new-func",
  "no-implied-eval",
]);
const estO = (erreur: Erreur) =>
  (erreur.regle !== null && REGLES_O.has(erreur.regle)) || citeLaRegle("O")(erreur);
const estP = citeLaRegle("P");
const estQ = (erreur: Erreur) => erreur.regle?.startsWith("jsx-a11y/") === true;
const estR = (erreur: Erreur) =>
  erreur.regle === "react/jsx-no-literals" || citeLaRegle("R")(erreur);

const COMPOSANT = "src/components/essai/composant.tsx";
const PAGE = "src/app/essai/page.tsx";
const SERVEUR = "src/server/essai/rendu.tsx";
const LIB = "src/lib/essai.ts";
const UI = "src/components/ui/essai.tsx";

describe("règle O : aucun point d'injection de HTML ni de script", { timeout: 60_000 }, () => {
  test.each([
    [
      "dangerouslySetInnerHTML",
      `export const C = ({ x }: { x: string }) => <div dangerouslySetInnerHTML={{ __html: x }} />;\n`,
      COMPOSANT,
    ],
    [
      "dangerouslySetInnerHTML dans une page",
      `export default function P({ x }: { x: string }) { return <div dangerouslySetInnerHTML={{ __html: x }} />; }\n`,
      PAGE,
    ],
    [
      "dangerouslySetInnerHTML côté serveur",
      `export const C = ({ x }: { x: string }) => <div dangerouslySetInnerHTML={{ __html: x }} />;\n`,
      SERVEUR,
    ],
    [
      "dangerouslySetInnerHTML par décomposition",
      `const p = { dangerouslySetInnerHTML: { __html: "" } };\nexport const C = () => <div {...p} />;\n`,
      COMPOSANT,
    ],
    [
      "dangerouslySetInnerHTML par createElement",
      `import { createElement } from "react";\nexport const e = (x: string) => createElement("div", { dangerouslySetInnerHTML: { __html: x } });\n`,
      LIB,
    ],
    ["innerHTML", `export function f(el: HTMLElement, x: string) { el.innerHTML = x; }\n`, LIB],
    ["outerHTML", `export function f(el: HTMLElement, x: string) { el.outerHTML = x; }\n`, LIB],
    [
      "insertAdjacentHTML",
      `export function f(el: HTMLElement, x: string) { el.insertAdjacentHTML("beforeend", x); }\n`,
      LIB,
    ],
    ["document.write", `export function f(x: string) { document.write(x); }\n`, LIB],
    ["document.writeln", `export function f(x: string) { document.writeln(x); }\n`, LIB],
    [
      "srcDoc",
      `export const C = ({ x }: { x: string }) => <iframe srcDoc={x} title={x} />;\n`,
      COMPOSANT,
    ],
    [
      "élément script",
      `export const C = ({ x }: { x: string }) => <script>{x}</script>;\n`,
      COMPOSANT,
    ],
    [
      "next/script",
      `import Script from "next/script";\nexport const C = ({ x }: { x: string }) => <Script src={x} />;\n`,
      COMPOSANT,
    ],
    [
      "URL javascript:",
      `export const C = ({ x }: { x: string }) => <a href="javascript:void(0)">{x}</a>;\n`,
      COMPOSANT,
    ],
    ["eval", `export function f(x: string) { return eval(x); }\n`, LIB],
    ["new Function", `export function f(x: string) { return new Function(x); }\n`, LIB],
    ["setTimeout avec une chaîne", `export function f() { setTimeout("g()", 1); }\n`, LIB],
    ["setInterval avec une chaîne", `export function f() { setInterval("g()", 1); }\n`, LIB],
  ])("%s : refusé", async (_nom, code, fichier) => {
    expect((await erreurs(code, fichier)).filter(estO)).not.toEqual([]);
  });

  test.each([
    ["textContent", `export function f(el: HTMLElement, x: string) { el.textContent = x; }\n`, LIB],
    [
      "texte échappé par React",
      `export const C = ({ x }: { x: string }) => <div>{x}</div>;\n`,
      COMPOSANT,
    ],
    [
      "setTimeout avec une fonction",
      `export function f(g: () => void) { setTimeout(() => g(), 1); }\n`,
      LIB,
    ],
    [
      "lien ordinaire",
      `export const C = ({ x }: { x: string }) => <a href="/clients">{x}</a>;\n`,
      COMPOSANT,
    ],
  ])("%s : autorisé", async (_nom, code, fichier) => {
    expect((await erreurs(code, fichier)).filter(estO)).toEqual([]);
  });
});

describe("règle P : aucun attribut style", { timeout: 60_000 }, () => {
  const STYLE = `export const C = () => <div style={{ color: "red" }} />;\n`;

  test.each([
    ["composant", COMPOSANT],
    ["page", PAGE],
    ["composant shadcn", UI],
  ])("%s : refusé", async (_nom, fichier) => {
    expect((await erreurs(STYLE, fichier)).filter(estP)).not.toEqual([]);
  });

  test("className : autorisé", async () => {
    const code = `export const C = () => <div className="text-primary" />;\n`;
    expect((await erreurs(code, COMPOSANT)).filter(estP)).toEqual([]);
  });
});

// Jeu recommandé d'eslint-plugin-jsx-a11y 6.10.2 : 34 règles, dont 31 en
// erreur et 3 désactivées par le jeu lui-même.
const A11Y_EN_ERREUR = [
  "alt-text",
  "anchor-has-content",
  "anchor-is-valid",
  "aria-activedescendant-has-tabindex",
  "aria-props",
  "aria-proptypes",
  "aria-role",
  "aria-unsupported-elements",
  "autocomplete-valid",
  "click-events-have-key-events",
  "heading-has-content",
  "html-has-lang",
  "iframe-has-title",
  "img-redundant-alt",
  "interactive-supports-focus",
  "label-has-associated-control",
  "media-has-caption",
  "mouse-events-have-key-events",
  "no-access-key",
  "no-autofocus",
  "no-distracting-elements",
  "no-interactive-element-to-noninteractive-role",
  "no-noninteractive-element-interactions",
  "no-noninteractive-element-to-interactive-role",
  "no-noninteractive-tabindex",
  "no-redundant-roles",
  "no-static-element-interactions",
  "role-has-required-aria-props",
  "role-supports-aria-props",
  "scope",
  "tabindex-no-positive",
].map((nom) => `jsx-a11y/${nom}`);

describe(
  "règle Q : accessibilité, jeu recommandé de jsx-a11y en erreur",
  { timeout: 60_000 },
  () => {
    test("31 règles", () => {
      expect(A11Y_EN_ERREUR).toHaveLength(31);
    });

    test.each([COMPOSANT, PAGE, UI])("chacune est en erreur pour %s", async (fichier) => {
      const config = (await eslint.calculateConfigForFile(fichier)) as {
        rules?: Record<string, unknown>;
      };
      const severite = (valeur: unknown) => (Array.isArray(valeur) ? valeur[0] : valeur);
      const absentesOuFaibles = A11Y_EN_ERREUR.filter((regle) => {
        const s = severite(config.rules?.[regle]);
        return s !== 2 && s !== "error";
      });
      expect(absentesOuFaibles).toEqual([]);
    });

    test.each([
      ["image sans alt", `export const C = () => <img src="/logo.png" />;\n`],
      [
        "clic sans clavier sur un div",
        `export const C = ({ f }: { f: () => void }) => <div onClick={f} />;\n`,
      ],
      ["autofocus", `export const C = () => <input autoFocus />;\n`],
      [
        "tabindex positif",
        `export const C = ({ x }: { x: string }) => <span tabIndex={3}>{x}</span>;\n`,
      ],
    ])("%s : refusé", async (_nom, code) => {
      expect((await erreurs(code, COMPOSANT)).filter(estQ)).not.toEqual([]);
    });

    test.each([
      [
        "image avec alt",
        `export const C = ({ t }: { t: string }) => <img src="/logo.png" alt={t} />;\n`,
      ],
      [
        "bouton cliquable",
        `export const C = ({ f, t }: { f: () => void; t: string }) => <button type="button" onClick={f}>{t}</button>;\n`,
      ],
    ])("%s : autorisé", async (_nom, code) => {
      expect((await erreurs(code, COMPOSANT)).filter(estQ)).toEqual([]);
    });
  },
);

describe("règle R : textes dans src/textes/ (NF-01)", { timeout: 60_000 }, () => {
  test.each([
    ["texte entre balises", `export const C = () => <p>Bonjour</p>;\n`],
    ["chaîne dans une expression", `export const C = () => <p>{"Bonjour"}</p>;\n`],
    ["alt écrit en dur", `export const C = () => <img src="/logo.png" alt="Logo" />;\n`],
    [
      "aria-label écrit en dur",
      `export const C = () => <button type="button" aria-label="Fermer" />;\n`,
    ],
    ["title écrit en dur", `export const C = () => <abbr title="Franc CFA" />;\n`],
    [
      "placeholder écrit en dur",
      `export const C = ({ i }: { i: string }) => <input id={i} placeholder="Nom" />;\n`,
    ],
    [
      "aria-description écrit en dur",
      `export const C = () => <section aria-description="Liste" />;\n`,
    ],
  ])("%s : refusé dans un composant et dans une page", async (_nom, code) => {
    expect((await erreurs(code, COMPOSANT)).filter(estR)).not.toEqual([]);
    expect((await erreurs(code, PAGE)).filter(estR)).not.toEqual([]);
  });

  test.each([
    [
      "texte issu de src/textes/",
      `export const C = ({ t }: { t: { a: string } }) => <p>{t.a}</p>;\n`,
    ],
    [
      "point médian entre deux valeurs",
      `export const C = ({ a, b }: { a: string; b: string }) => <span>{a} · {b}</span>;\n`,
    ],
    [
      "deux-points entre deux valeurs",
      `export const C = ({ a, b }: { a: string; b: string }) => <span>{a} : {b}</span>;\n`,
    ],
    [
      "className, href et variante",
      `export const C = ({ t }: { t: string }) => <a className="flex gap-2" href="/clients" data-variant="outline">{t}</a>;\n`,
    ],
    [
      "alt issu de src/textes/",
      `export const C = ({ t }: { t: string }) => <img src="/logo.png" alt={t} />;\n`,
    ],
  ])("%s : autorisé", async (_nom, code) => {
    expect((await erreurs(code, COMPOSANT)).filter(estR)).toEqual([]);
  });

  test("composant shadcn de src/components/ui/ : hors de la règle", async () => {
    const code = `export const C = () => <p>Bonjour</p>;\n`;
    expect((await erreurs(code, UI)).filter(estR)).toEqual([]);
  });
});
