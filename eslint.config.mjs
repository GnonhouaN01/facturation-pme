import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Fichiers de l'application. Les règles d'architecture ne visent que src/ :
// scripts/, drizzle.config.ts et les fichiers de configuration à la racine
// en sont exclus par construction.
const SRC = "src/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}";
const DB = "src/server/db/**";
const ENV = "src/server/env.ts";
const TESTS = "src/**/*.test.{ts,tsx}";
const TESTS_DB = "src/server/db/**/*.test.{ts,tsx}";
const OUTILS_TEST = "src/server/db/outils-test/**";
const CONFIG_AUTH = "src/server/auth/config.ts";
const JOURNAL_AUDIT = "src/server/journal/audit.ts";
const CLIENT = "src/server/db/client.ts";
const ISOLATION = "src/server/db/schema/isolation.ts";
const ACTIONS = "src/server/actions/**";
const ACTION = "src/server/actions/action.ts";
const EXPOSER = "src/server/actions/exposer.ts";
const APP_ACTIONS = "src/app/**/actions.ts";
const DEBIT = "src/server/debit/**";
const DB_DEBIT = "src/server/db/debit.ts";
const PROXY = "src/proxy.ts";
// Écrans : pages et composants, où s'affiche le texte (règle R). Les
// composants de ui/, générés par shadcn, ne portent pas de texte affiché.
const ECRANS = ["src/app/**", "src/components/**"];
const UI = "src/components/ui/**";

// En configuration plate, une règle déclarée par un bloc postérieur remplace
// entièrement celle d'un bloc antérieur pour un même fichier : les options ne
// se cumulent pas. Les blocs ci-dessous visent donc des ensembles de fichiers
// disjoints, et chacun porte toutes les restrictions qui s'y appliquent.

// Import dynamique import("...") et require("...") d'un module dont le nom
// vérifie l'expression régulière, chaîne ou gabarit sans expression.
const chargementsDynamiques = (modules, message) =>
  [
    `ImportExpression[source.value=${modules}]`,
    `ImportExpression[source.quasis.0.value.raw=${modules}]`,
    `CallExpression[callee.name='require'][arguments.0.value=${modules}]`,
    `CallExpression[callee.name='require'][arguments.0.quasis.0.value.raw=${modules}]`,
  ].map((selector) => ({ selector, message }));

// A. drizzle-orm et pg restent confinés à la couche d'accès aux données.
const MESSAGE_A = "drizzle-orm et pg ne s'importent que dans src/server/db/ (CLAUDE.md, règle 4).";
const IMPORTS_A = {
  paths: [
    { name: "drizzle-orm", message: MESSAGE_A },
    { name: "pg", message: MESSAGE_A },
  ],
  patterns: [{ group: ["drizzle-orm/*"], message: MESSAGE_A }],
};
// / désigne la barre oblique, que esquery n'accepte pas littéralement
// dans une expression régulière.
const SYNTAXE_A = chargementsDynamiques("/^(drizzle-orm|drizzle-orm\\u002F.*|pg)$/", MESSAGE_A);

// B. process.env ne se lit que dans src/server/env.ts, y compris par un
// import du module process.
const MESSAGE_B = "process.env ne se lit que dans src/server/env.ts (CLAUDE.md, règle 12).";
const IMPORTS_B = {
  paths: [
    { name: "process", message: MESSAGE_B },
    { name: "node:process", message: MESSAGE_B },
  ],
};
const PROPRIETES_B = [{ object: "process", property: "env", message: MESSAGE_B }];
const SYNTAXE_B = chargementsDynamiques("/^(node:)?process$/", MESSAGE_B);
// Exception de la 0.6 (décision 11) : src/proxy.ts lit process.env.NODE_ENV,
// et cette seule propriété, pour choisir la politique de développement.
// no-restricted-properties ne sait pas exclure une propriété de process.env :
// pour ce fichier, il est remplacé par ces sélecteurs. Refusés : toute autre
// propriété, l'accès entre crochets, process.env employé seul (copie,
// décomposition, argument), process["env"] et const { env } = process.
const MESSAGE_B_PROXY =
  "Dans src/proxy.ts, seul process.env.NODE_ENV se lit ; process.env ne se lit que dans src/server/env.ts (CLAUDE.md, règle 12).";
const SYNTAXE_B_PROXY = [
  "MemberExpression[object.object.name='process'][object.property.name='env']:not([computed=false][property.name='NODE_ENV'])",
  ":not(MemberExpression) > MemberExpression[object.name='process'][property.name='env']",
  "MemberExpression > MemberExpression.property[object.name='process'][property.name='env']",
  "MemberExpression[object.name='process'][property.value='env']",
  "VariableDeclarator[init.name='process'] > ObjectPattern > Property[key.name='env']",
].map((selector) => ({ selector, message: MESSAGE_B_PROXY }));

// C. Le rôle propriétaire n'apparaît nulle part dans l'application.
const SYNTAXE_C = [
  "Identifier[name='DATABASE_URL_MIGRATION']",
  "Literal[value=/DATABASE_URL_MIGRATION/]",
  "TemplateElement[value.raw=/DATABASE_URL_MIGRATION/]",
  "JSXText[value=/DATABASE_URL_MIGRATION/]",
].map((selector) => ({
  selector,
  message: "L'application n'utilise jamais le rôle propriétaire (CLAUDE.md, règle 2).",
}));

// D. L'outillage de test, qui crée et supprime des organisations, ne
// s'importe que depuis un fichier de test ou depuis son propre dossier.
const MESSAGE_D =
  "src/server/db/outils-test/ ne s'importe que depuis un fichier de test (docs/features/acces-donnees.md, section 4.1).";
const IMPORTS_D = {
  patterns: [{ regex: "(^|/)outils-test(/|$)", message: MESSAGE_D }],
};
const SYNTAXE_D = chargementsDynamiques("/(^|\\u002F)outils-test(\\u002F|$)/", MESSAGE_D);

// E. db n'a pas d'organisation active : hors de Better Auth et de la couche
// d'accès aux données, tout passe par executerDansOrganisation.
const MESSAGE_E =
  "db ne s'importe que dans src/server/auth/config.ts et src/server/db/ : utiliser executerDansOrganisation (docs/features/acces-donnees.md, section 1.3).";
const IMPORTS_E = {
  patterns: [{ regex: "(^|/)db/client$", importNames: ["db"], message: MESSAGE_E }],
};

// F. L'insertion au journal d'audit ne s'importe que depuis la fonction
// d'écriture, qui valide l'entrée. Depuis un autre fichier de requetes/,
// l'import relatif « ./journal » est aussi refusé.
const MESSAGE_F =
  "src/server/db/requetes/journal.ts ne s'importe que depuis src/server/journal/audit.ts : écrire au journal par journaliser (docs/features/journal-audit.md, section 7).";
const IMPORTS_F = {
  patterns: [{ regex: "(^|/)requetes/journal$", message: MESSAGE_F }],
};
const IMPORTS_F_REQUETES = {
  patterns: [{ regex: "^\\./journal$", message: MESSAGE_F }],
};
const SYNTAXE_F = chargementsDynamiques("/(^|\\u002F)requetes\\u002Fjournal$/", MESSAGE_F);

// G. Un fichier qui commence par "use server" n'exporte que
// export const x = exposer(y) : tout autre export serait un point d'entrée
// POST sans la chaîne de contrôles. Les exports de types, effacés à la
// compilation, restent permis.
const MESSAGE_G =
  'Un fichier "use server" n\'exporte que export const x = exposer(y) (docs/features/chaine-controles.md, section 7, règle G).';
const FICHIER_SERVEUR = "Program:has(> ExpressionStatement[directive='use server'])";
const SYNTAXE_G = [
  `${FICHIER_SERVEUR} > ExportDefaultDeclaration`,
  `${FICHIER_SERVEUR} > ExportAllDeclaration`,
  `${FICHIER_SERVEUR} > ExportNamedDeclaration:not([declaration])`,
  `${FICHIER_SERVEUR} > ExportNamedDeclaration > :not(VariableDeclaration, TSTypeAliasDeclaration, TSInterfaceDeclaration).declaration`,
  `${FICHIER_SERVEUR} > ExportNamedDeclaration > VariableDeclaration[kind!='const']`,
  `${FICHIER_SERVEUR} > ExportNamedDeclaration > VariableDeclaration > VariableDeclarator:not([init.type='CallExpression'][init.callee.type='Identifier'][init.callee.name='exposer'])`,
].map((selector) => ({ selector, message: MESSAGE_G }));

// H. La directive "use server" n'apparaît qu'en tête de src/app/**/actions.ts :
// pas d'action serveur en ligne dans une fonction, ni de fichier "use server"
// ailleurs.
const MESSAGE_H =
  "La directive \"use server\" n'apparaît qu'en tête de src/app/**/actions.ts (docs/features/chaine-controles.md, section 7, règle H).";
const SYNTAXE_H = [{ selector: "ExpressionStatement[directive='use server']", message: MESSAGE_H }];
const SYNTAXE_H_EN_LIGNE = [
  { selector: "BlockStatement > ExpressionStatement[directive='use server']", message: MESSAGE_H },
];

// I. executerDansOrganisation ne s'importe que dans actions/action.ts, db/ et
// les tests : un service reçoit ctx.tx, il n'ouvre ni n'imbrique de
// transaction. Le chargement dynamique de db/client est refusé en entier.
const MESSAGE_I =
  "executerDansOrganisation ne s'importe que dans src/server/actions/action.ts, src/server/db/ et les tests : un service reçoit ctx.tx (docs/features/chaine-controles.md, section 7, règle I).";
const IMPORTS_I = {
  patterns: [
    { regex: "(^|/)db/client$", importNames: ["executerDansOrganisation"], message: MESSAGE_I },
  ],
};
const SYNTAXE_I = chargementsDynamiques("/(^|\\u002F)db\\u002Fclient$/", MESSAGE_I);

// J. journaliser ne s'importe que dans actions/action.ts et les tests : un
// service écrit au journal par ctx.journaliser, avec l'auteur de la session.
const MESSAGE_J =
  "journaliser ne s'importe que dans src/server/actions/action.ts et les tests : écrire au journal par ctx.journaliser (docs/features/chaine-controles.md, section 7, règle J).";
const IMPORTS_J = {
  patterns: [
    { regex: "(^|/)journal/audit$", importNames: ["journaliser"], message: MESSAGE_J },
    { regex: "^\\./audit$", importNames: ["journaliser"], message: MESSAGE_J },
  ],
};
const SYNTAXE_J = chargementsDynamiques("/((^|\\u002F)journal|^\\.)\\u002Faudit$/", MESSAGE_J);

// K. La chaîne app.organisation_id (littéral ou gabarit) n'apparaît que dans
// db/client.ts, db/schema/isolation.ts et les tests : un set_config vers une
// autre organisation devient visible. Ne voit pas une chaîne construite par
// concaténation (limite acceptée, docs/features/chaine-controles.md).
const MESSAGE_K =
  "app.organisation_id n'apparaît que dans src/server/db/client.ts, src/server/db/schema/isolation.ts et les tests (docs/features/chaine-controles.md, section 7, règle K).";
const SYNTAXE_K = [
  "Literal[value=/app.organisation_id/]",
  "TemplateElement[value.raw=/app.organisation_id/]",
].map((selector) => ({ selector, message: MESSAGE_K }));

// L. Dans src/server/actions/, next/headers ne s'importe que dans exposer.ts :
// la chaîne reste testable sans Next.js.
const MESSAGE_L =
  "Dans src/server/actions/, next/headers ne s'importe que dans exposer.ts (docs/features/chaine-controles.md, section 7, règle L).";
const IMPORTS_L = {
  paths: [
    { name: "next/headers", message: MESSAGE_L },
    { name: "next/headers.js", message: MESSAGE_L },
  ],
};
const SYNTAXE_L = chargementsDynamiques("/^next\\u002Fheaders(\\.js)?$/", MESSAGE_L);

// M. executerChaine ne s'importe que dans actions/exposer.ts et les tests :
// une action ne s'exécute que par une fonction exposée, donc avec une
// déclaration marquée. creerChaine ne s'importe que dans les tests : elle
// construit une chaîne aux dépendances de son choix (session, adhésion
// factices). Le chargement dynamique de actions/action est refusé en entier.
const MESSAGE_M =
  "executerChaine ne s'importe que dans src/server/actions/exposer.ts et les tests : exposer une action par exposer (docs/features/chaine-controles.md, section 7, règle M).";
const MESSAGE_M_FABRIQUE =
  "creerChaine ne s'importe que dans les tests : une chaîne aux dépendances factices contournerait les contrôles (docs/features/chaine-controles.md, section 7, règle M).";
const motifsM = (nom, message) => [
  { regex: "(^|/)actions/action$", importNames: [nom], message },
  { regex: "^\\./action$", importNames: [nom], message },
];
const IMPORTS_M_FABRIQUE = { patterns: motifsM("creerChaine", MESSAGE_M_FABRIQUE) };
const IMPORTS_M = {
  patterns: [...motifsM("executerChaine", MESSAGE_M), ...IMPORTS_M_FABRIQUE.patterns],
};
const SYNTAXE_M = chargementsDynamiques("/((^|\\u002F)actions|^\\.)\\u002Faction$/", MESSAGE_M);

// N. Le compteur de débit : compteurDebit ne s'importe que dans db/debit.ts,
// seul fichier qui touche compteur_debit, et db/debit.ts ne s'importe que dans
// server/debit/, qui calcule les clés en empreinte. Le chargement dynamique de
// db/debit et de schema/technique est refusé en entier.
const MESSAGE_N =
  "compteurDebit ne s'importe que dans src/server/db/debit.ts, et src/server/db/debit.ts que dans src/server/debit/ et les tests : compter par verifierDebit (docs/features/limitation-debit.md, section 7, règle N).";
const IMPORTS_N_TABLE = {
  patterns: [
    { regex: "(^|/)schema/technique$", importNames: ["compteurDebit"], message: MESSAGE_N },
  ],
};
const IMPORTS_N_COMPTEUR = {
  patterns: [{ regex: "(^|/)db/debit$", message: MESSAGE_N }],
};
// Depuis db/, « ./debit » et « ../debit » désignent db/debit.ts.
const IMPORTS_N_COMPTEUR_DB = {
  patterns: [{ regex: "^\\.\\.?/debit$", message: MESSAGE_N }],
};
const SYNTAXE_N = chargementsDynamiques(
  "/(^|\\u002F)(db\\u002Fdebit|schema\\u002Ftechnique)$/",
  MESSAGE_N,
);
const SYNTAXE_N_DB = chargementsDynamiques(
  "/((^|\\u002F)(db\\u002Fdebit|schema\\u002Ftechnique)|^\\.\\.?\\u002Fdebit)$/",
  MESSAGE_N,
);

// O. Aucun point d'injection de HTML ni de script (S-51, T-34) : le texte
// s'affiche par React, qui l'échappe. Les règles nommées (react/no-danger,
// react/jsx-no-script-url, no-eval, no-new-func, no-implied-eval) sont
// activées dans leur propre bloc ; les sélecteurs ci-dessous rejoignent chaque
// bloc de syntaxe. write et writeln ne sont visés que sur document : un flux
// Node a aussi une méthode write.
const MESSAGE_O =
  "Aucun point d'injection de HTML ni de script : afficher le texte par React, sans dangerouslySetInnerHTML, innerHTML, document.write, srcDoc, script ni next/script (docs/features/socle-interface.md, section 7, règle O).";
const SYNTAXE_O = [
  "JSXAttribute[name.name='dangerouslySetInnerHTML']",
  "Property[key.name='dangerouslySetInnerHTML']",
  "Property[key.value='dangerouslySetInnerHTML']",
  "AssignmentExpression > MemberExpression.left[property.name=/^(inner|outer)HTML$/]",
  "AssignmentExpression > MemberExpression.left[property.value=/^(inner|outer)HTML$/]",
  "CallExpression > MemberExpression.callee[property.name='insertAdjacentHTML']",
  "CallExpression > MemberExpression.callee[object.name='document'][property.name=/^(write|writeln)$/]",
  "JSXAttribute[name.name=/^src[Dd]oc$/]",
  "JSXOpeningElement[name.name='script']",
  "ImportDeclaration[source.value=/^next\\u002Fscript(\\.js)?$/]",
  "ExportNamedDeclaration[source.value=/^next\\u002Fscript(\\.js)?$/]",
]
  .map((selector) => ({ selector, message: MESSAGE_O }))
  .concat(chargementsDynamiques("/^next\\u002Fscript(\\.js)?$/", MESSAGE_O));

// P. Aucun attribut style : la politique de sécurité du contenu, sans
// 'unsafe-inline', bloque un attribut style rendu par le serveur. Les styles
// passent par les classes Tailwind. Rejoint chaque bloc de syntaxe.
const MESSAGE_P =
  "Aucun attribut style : la politique de sécurité du contenu le bloque ; utiliser les classes Tailwind (docs/features/socle-interface.md, section 7, règle P).";
const SYNTAXE_P = [{ selector: "JSXAttribute[name.name='style']", message: MESSAGE_P }];

// Q. Accessibilité (NF-04) : les 31 règles en erreur du jeu recommandé
// d'eslint-plugin-jsx-a11y 6.10.2, avec ses options. Le module est enregistré
// par eslint-config-next sous le préfixe jsx-a11y : il n'est pas importé ici.
// Les trois règles que le jeu désactive (anchor-ambiguous-text,
// control-has-associated-label, label-has-for) restent désactivées. alt-text
// garde le composant Image de Next.js, que vise la configuration de Next.js.
const REGLES_Q = {
  "jsx-a11y/alt-text": ["error", { img: ["Image"] }],
  "jsx-a11y/anchor-has-content": "error",
  "jsx-a11y/anchor-is-valid": "error",
  "jsx-a11y/aria-activedescendant-has-tabindex": "error",
  "jsx-a11y/aria-props": "error",
  "jsx-a11y/aria-proptypes": "error",
  "jsx-a11y/aria-role": "error",
  "jsx-a11y/aria-unsupported-elements": "error",
  "jsx-a11y/autocomplete-valid": "error",
  "jsx-a11y/click-events-have-key-events": "error",
  "jsx-a11y/heading-has-content": "error",
  "jsx-a11y/html-has-lang": "error",
  "jsx-a11y/iframe-has-title": "error",
  "jsx-a11y/img-redundant-alt": "error",
  "jsx-a11y/interactive-supports-focus": [
    "error",
    { tabbable: ["button", "checkbox", "link", "searchbox", "spinbutton", "switch", "textbox"] },
  ],
  "jsx-a11y/label-has-associated-control": "error",
  "jsx-a11y/media-has-caption": "error",
  "jsx-a11y/mouse-events-have-key-events": "error",
  "jsx-a11y/no-access-key": "error",
  "jsx-a11y/no-autofocus": "error",
  "jsx-a11y/no-distracting-elements": "error",
  "jsx-a11y/no-interactive-element-to-noninteractive-role": [
    "error",
    { tr: ["none", "presentation"], canvas: ["img"] },
  ],
  "jsx-a11y/no-noninteractive-element-interactions": [
    "error",
    {
      handlers: [
        "onClick",
        "onError",
        "onLoad",
        "onMouseDown",
        "onMouseUp",
        "onKeyPress",
        "onKeyDown",
        "onKeyUp",
      ],
      alert: ["onKeyUp", "onKeyDown", "onKeyPress"],
      body: ["onError", "onLoad"],
      dialog: ["onKeyUp", "onKeyDown", "onKeyPress"],
      iframe: ["onError", "onLoad"],
      img: ["onError", "onLoad"],
    },
  ],
  "jsx-a11y/no-noninteractive-element-to-interactive-role": [
    "error",
    {
      ul: ["listbox", "menu", "menubar", "radiogroup", "tablist", "tree", "treegrid"],
      ol: ["listbox", "menu", "menubar", "radiogroup", "tablist", "tree", "treegrid"],
      li: ["menuitem", "menuitemradio", "menuitemcheckbox", "option", "row", "tab", "treeitem"],
      table: ["grid"],
      td: ["gridcell"],
      fieldset: ["radiogroup", "presentation"],
    },
  ],
  "jsx-a11y/no-noninteractive-tabindex": [
    "error",
    { tags: [], roles: ["tabpanel"], allowExpressionValues: true },
  ],
  "jsx-a11y/no-redundant-roles": "error",
  "jsx-a11y/no-static-element-interactions": [
    "error",
    {
      allowExpressionValues: true,
      handlers: ["onClick", "onMouseDown", "onMouseUp", "onKeyPress", "onKeyDown", "onKeyUp"],
    },
  ],
  "jsx-a11y/role-has-required-aria-props": "error",
  "jsx-a11y/role-supports-aria-props": "error",
  "jsx-a11y/scope": "error",
  "jsx-a11y/tabindex-no-positive": "error",
};

// R. Texte affiché écrit en dur (NF-01) : les textes vivent dans src/textes/.
// Dans les écrans hors de ui/ : react/jsx-no-literals refuse une chaîne entre
// les balises (sauf « : » et « · », seuls signes permis), et ces sélecteurs
// refusent une chaîne écrite en dur dans les attributs qui portent un texte
// lu. Les autres attributs (className, href, variant) restent permis.
const MESSAGE_R =
  "Texte affiché écrit en dur : le placer dans src/textes/ (NF-01, docs/features/socle-interface.md, section 7, règle R).";
const ATTRIBUTS_TEXTE =
  "JSXAttribute[name.name=/^(alt|title|placeholder|aria-label|aria-description)$/]";
const SYNTAXE_R = [
  `${ATTRIBUTS_TEXTE} > Literal`,
  `${ATTRIBUTS_TEXTE} > TemplateLiteral`,
  `${ATTRIBUTS_TEXTE} > JSXExpressionContainer > Literal[value=/./]`,
  `${ATTRIBUTS_TEXTE} > JSXExpressionContainer > TemplateLiteral`,
].map((selector) => ({ selector, message: MESSAGE_R }));

// S. src/proxy.ts n'importe pas server/env.ts : une variable invalide fait
// échouer register, puis chaque requête (docs/features/socle-interface.md,
// sections 4.3, 5.5 et 7, règle S). Par alias, chemin relatif, chargement
// dynamique ou réexportation. Un import indirect n'est pas vu.
const MESSAGE_S =
  "src/proxy.ts n'importe pas server/env.ts : une variable invalide ferait échouer chaque requête (docs/features/socle-interface.md, section 7, règle S).";
const IMPORTS_S = {
  patterns: [{ regex: "(^|/)server/env(\\.ts)?$", message: MESSAGE_S }],
};
const SYNTAXE_S = chargementsDynamiques("/(^|\\u002F)server\\u002Fenv(\\.ts)?$/", MESSAGE_S);

const restreindreImports = (...listes) => [
  "error",
  {
    paths: listes.flatMap((liste) => liste.paths ?? []),
    patterns: listes.flatMap((liste) => liste.patterns ?? []),
  },
];

const restreindreSyntaxe = (...listes) => ["error", ...listes.flat()];

// Restrictions d'import du cas général de src/ : le bloc général et celui de
// src/proxy.ts. Une interdiction ajoutée ici s'applique aux deux.
const IMPORTS_GENERAUX = [
  IMPORTS_A,
  IMPORTS_B,
  IMPORTS_D,
  IMPORTS_E,
  IMPORTS_F,
  IMPORTS_I,
  IMPORTS_J,
  IMPORTS_M,
  IMPORTS_N_TABLE,
  IMPORTS_N_COMPTEUR,
];

// Propriétés interdites du cas général de src/. Celles de src/proxy.ts en
// dérivent : une interdiction ajoutée ici s'applique aussi au proxy. Seule
// l'entrée process.env y est retirée, remplacée par SYNTAXE_B_PROXY.
const PROPRIETES_GENERALES = [...PROPRIETES_B];
const PROPRIETES_PROXY = PROPRIETES_GENERALES.filter(
  (entree) => !(entree.object === "process" && entree.property === "env"),
);

// Restrictions de syntaxe du cas général de src/ : le bloc général, les
// blocs des écrans et celui de src/proxy.ts.
const SYNTAXE_GENERALE = [
  SYNTAXE_O,
  SYNTAXE_P,
  SYNTAXE_A,
  SYNTAXE_B,
  SYNTAXE_C,
  SYNTAXE_D,
  SYNTAXE_F,
  SYNTAXE_G,
  SYNTAXE_H,
  SYNTAXE_I,
  SYNTAXE_J,
  SYNTAXE_K,
  SYNTAXE_M,
  SYNTAXE_N,
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Aucun commentaire (eslint-disable, eslint-enable, /* eslint ... */) ne
  // suspend ni ne modifie une règle dans src/ : une exception passe par ce
  // fichier, donc par une PR (docs/features/chaine-controles.md, section 7).
  {
    files: [SRC],
    linterOptions: { noInlineConfig: true },
  },
  // Imports statiques.
  {
    files: [SRC],
    ignores: [DB, ENV, TESTS, CONFIG_AUTH, JOURNAL_AUDIT, ACTIONS, DEBIT, PROXY],
    rules: {
      "no-restricted-imports": restreindreImports(...IMPORTS_GENERAUX),
    },
  },
  // src/proxy.ts : les listes du bloc général (IMPORTS_GENERAUX), plus S. Un
  // second bloc pour ce fichier remplacerait celui-ci au lieu de s'y ajouter.
  {
    files: [PROXY],
    rules: {
      "no-restricted-imports": restreindreImports(...IMPORTS_GENERAUX, IMPORTS_S),
    },
  },
  {
    files: [DEBIT],
    ignores: [TESTS],
    rules: {
      "no-restricted-imports": restreindreImports(
        IMPORTS_A,
        IMPORTS_B,
        IMPORTS_D,
        IMPORTS_E,
        IMPORTS_F,
        IMPORTS_I,
        IMPORTS_J,
        IMPORTS_M,
        IMPORTS_N_TABLE,
      ),
    },
  },
  {
    files: [ACTIONS],
    ignores: [TESTS, ACTION, EXPOSER],
    rules: {
      "no-restricted-imports": restreindreImports(
        IMPORTS_A,
        IMPORTS_B,
        IMPORTS_D,
        IMPORTS_E,
        IMPORTS_F,
        IMPORTS_I,
        IMPORTS_J,
        IMPORTS_L,
        IMPORTS_M,
        IMPORTS_N_TABLE,
        IMPORTS_N_COMPTEUR,
      ),
    },
  },
  {
    files: [ACTION],
    rules: {
      "no-restricted-imports": restreindreImports(
        IMPORTS_A,
        IMPORTS_B,
        IMPORTS_D,
        IMPORTS_E,
        IMPORTS_F,
        IMPORTS_L,
        IMPORTS_N_TABLE,
        IMPORTS_N_COMPTEUR,
      ),
    },
  },
  {
    files: [EXPOSER],
    rules: {
      "no-restricted-imports": restreindreImports(
        IMPORTS_A,
        IMPORTS_B,
        IMPORTS_D,
        IMPORTS_E,
        IMPORTS_F,
        IMPORTS_I,
        IMPORTS_J,
        IMPORTS_M_FABRIQUE,
        IMPORTS_N_TABLE,
        IMPORTS_N_COMPTEUR,
      ),
    },
  },
  {
    files: [JOURNAL_AUDIT],
    rules: {
      "no-restricted-imports": restreindreImports(
        IMPORTS_A,
        IMPORTS_B,
        IMPORTS_D,
        IMPORTS_E,
        IMPORTS_I,
        IMPORTS_J,
        IMPORTS_M,
        IMPORTS_N_TABLE,
        IMPORTS_N_COMPTEUR,
      ),
    },
  },
  {
    files: [CONFIG_AUTH],
    rules: {
      "no-restricted-imports": restreindreImports(
        IMPORTS_A,
        IMPORTS_B,
        IMPORTS_D,
        IMPORTS_F,
        IMPORTS_I,
        IMPORTS_J,
        IMPORTS_M,
        IMPORTS_N_TABLE,
        IMPORTS_N_COMPTEUR,
      ),
    },
  },
  {
    files: [TESTS],
    ignores: [DB],
    rules: { "no-restricted-imports": restreindreImports(IMPORTS_A, IMPORTS_B, IMPORTS_E) },
  },
  {
    files: [ENV],
    rules: {
      "no-restricted-imports": restreindreImports(
        IMPORTS_A,
        IMPORTS_D,
        IMPORTS_E,
        IMPORTS_F,
        IMPORTS_I,
        IMPORTS_J,
        IMPORTS_M,
        IMPORTS_N_TABLE,
        IMPORTS_N_COMPTEUR,
      ),
    },
  },
  {
    files: [DB],
    ignores: [TESTS, OUTILS_TEST, DB_DEBIT],
    rules: {
      "no-restricted-imports": restreindreImports(
        IMPORTS_B,
        IMPORTS_D,
        IMPORTS_F,
        IMPORTS_F_REQUETES,
        IMPORTS_J,
        IMPORTS_M,
        IMPORTS_N_TABLE,
        IMPORTS_N_COMPTEUR,
        IMPORTS_N_COMPTEUR_DB,
      ),
    },
  },
  {
    files: [DB_DEBIT],
    rules: {
      "no-restricted-imports": restreindreImports(
        IMPORTS_B,
        IMPORTS_D,
        IMPORTS_F,
        IMPORTS_F_REQUETES,
        IMPORTS_J,
        IMPORTS_M,
      ),
    },
  },
  {
    files: [TESTS_DB, OUTILS_TEST],
    rules: { "no-restricted-imports": restreindreImports(IMPORTS_B) },
  },
  // Propriétés interdites, dont la lecture de process.env (B).
  {
    files: [SRC],
    ignores: [ENV, PROXY],
    rules: { "no-restricted-properties": ["error", ...PROPRIETES_GENERALES] },
  },
  // src/proxy.ts : les mêmes, moins process.env, remplacé par SYNTAXE_B_PROXY.
  {
    files: [PROXY],
    rules: { "no-restricted-properties": ["error", ...PROPRIETES_PROXY] },
  },
  // Syntaxe interdite. Les écrans ont leurs blocs, à cause de la règle R.
  {
    files: [SRC],
    ignores: [DB, ENV, TESTS, ACTIONS, APP_ACTIONS, PROXY, ...ECRANS],
    rules: { "no-restricted-syntax": restreindreSyntaxe(...SYNTAXE_GENERALE) },
  },
  // src/proxy.ts : la syntaxe générale, l'exception de B et S.
  {
    files: [PROXY],
    rules: {
      "no-restricted-syntax": restreindreSyntaxe(...SYNTAXE_GENERALE, SYNTAXE_B_PROXY, SYNTAXE_S),
    },
  },
  {
    files: ECRANS,
    ignores: [TESTS, APP_ACTIONS, UI],
    rules: { "no-restricted-syntax": restreindreSyntaxe(...SYNTAXE_GENERALE, SYNTAXE_R) },
  },
  {
    files: [UI],
    ignores: [TESTS],
    rules: { "no-restricted-syntax": restreindreSyntaxe(...SYNTAXE_GENERALE) },
  },
  {
    files: [APP_ACTIONS],
    rules: {
      "no-restricted-syntax": restreindreSyntaxe(
        SYNTAXE_O,
        SYNTAXE_P,
        SYNTAXE_A,
        SYNTAXE_B,
        SYNTAXE_C,
        SYNTAXE_D,
        SYNTAXE_F,
        SYNTAXE_G,
        SYNTAXE_H_EN_LIGNE,
        SYNTAXE_I,
        SYNTAXE_J,
        SYNTAXE_K,
        SYNTAXE_M,
        SYNTAXE_N,
      ),
    },
  },
  {
    files: [ACTIONS],
    ignores: [TESTS, ACTION, EXPOSER],
    rules: {
      "no-restricted-syntax": restreindreSyntaxe(
        SYNTAXE_O,
        SYNTAXE_P,
        SYNTAXE_A,
        SYNTAXE_B,
        SYNTAXE_C,
        SYNTAXE_D,
        SYNTAXE_F,
        SYNTAXE_G,
        SYNTAXE_H,
        SYNTAXE_I,
        SYNTAXE_J,
        SYNTAXE_K,
        SYNTAXE_L,
        SYNTAXE_M,
        SYNTAXE_N,
      ),
    },
  },
  {
    files: [ACTION],
    rules: {
      "no-restricted-syntax": restreindreSyntaxe(
        SYNTAXE_O,
        SYNTAXE_P,
        SYNTAXE_A,
        SYNTAXE_B,
        SYNTAXE_C,
        SYNTAXE_D,
        SYNTAXE_F,
        SYNTAXE_G,
        SYNTAXE_H,
        SYNTAXE_K,
        SYNTAXE_L,
        SYNTAXE_N,
      ),
    },
  },
  {
    files: [EXPOSER],
    rules: {
      "no-restricted-syntax": restreindreSyntaxe(
        SYNTAXE_O,
        SYNTAXE_P,
        SYNTAXE_A,
        SYNTAXE_B,
        SYNTAXE_C,
        SYNTAXE_D,
        SYNTAXE_F,
        SYNTAXE_G,
        SYNTAXE_H,
        SYNTAXE_I,
        SYNTAXE_J,
        SYNTAXE_K,
        SYNTAXE_N,
      ),
    },
  },
  {
    files: [TESTS],
    ignores: [DB],
    rules: {
      "no-restricted-syntax": restreindreSyntaxe(
        SYNTAXE_O,
        SYNTAXE_P,
        SYNTAXE_A,
        SYNTAXE_B,
        SYNTAXE_C,
        SYNTAXE_G,
        SYNTAXE_H,
      ),
    },
  },
  {
    files: [ENV],
    rules: {
      "no-restricted-syntax": restreindreSyntaxe(
        SYNTAXE_O,
        SYNTAXE_P,
        SYNTAXE_A,
        SYNTAXE_C,
        SYNTAXE_D,
        SYNTAXE_G,
        SYNTAXE_H,
        SYNTAXE_I,
        SYNTAXE_J,
        SYNTAXE_K,
        SYNTAXE_M,
        SYNTAXE_N,
      ),
    },
  },
  {
    files: [DB],
    ignores: [TESTS, OUTILS_TEST, CLIENT, ISOLATION],
    rules: {
      "no-restricted-syntax": restreindreSyntaxe(
        SYNTAXE_O,
        SYNTAXE_P,
        SYNTAXE_B,
        SYNTAXE_C,
        SYNTAXE_D,
        SYNTAXE_F,
        SYNTAXE_G,
        SYNTAXE_H,
        SYNTAXE_J,
        SYNTAXE_K,
        SYNTAXE_M,
        SYNTAXE_N_DB,
      ),
    },
  },
  {
    files: [CLIENT, ISOLATION],
    rules: {
      "no-restricted-syntax": restreindreSyntaxe(
        SYNTAXE_O,
        SYNTAXE_P,
        SYNTAXE_B,
        SYNTAXE_C,
        SYNTAXE_D,
        SYNTAXE_F,
        SYNTAXE_G,
        SYNTAXE_H,
        SYNTAXE_J,
        SYNTAXE_M,
        SYNTAXE_N_DB,
      ),
    },
  },
  {
    files: [OUTILS_TEST],
    rules: {
      "no-restricted-syntax": restreindreSyntaxe(
        SYNTAXE_O,
        SYNTAXE_P,
        SYNTAXE_B,
        SYNTAXE_C,
        SYNTAXE_G,
        SYNTAXE_H,
        SYNTAXE_K,
      ),
    },
  },
  {
    files: [TESTS_DB],
    rules: {
      "no-restricted-syntax": restreindreSyntaxe(
        SYNTAXE_O,
        SYNTAXE_P,
        SYNTAXE_B,
        SYNTAXE_C,
        SYNTAXE_G,
        SYNTAXE_H,
      ),
    },
  },
  // O. Règles nommées : pour tout src/.
  {
    files: [SRC],
    rules: {
      "react/no-danger": "error",
      "react/jsx-no-script-url": "error",
      "no-eval": "error",
      "no-new-func": "error",
      "no-implied-eval": "error",
    },
  },
  // Q. Accessibilité : pour tout src/.
  {
    files: [SRC],
    rules: REGLES_Q,
  },
  // R. Chaînes entre les balises : écrans hors de ui/.
  {
    files: ECRANS,
    ignores: [TESTS, UI],
    rules: {
      "react/jsx-no-literals": [
        "error",
        { noStrings: true, allowedStrings: [":", "·"], ignoreProps: true },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
