# Registre des exceptions de sécurité

Ce fichier liste les failles connues que le projet accepte temporairement.
Une faille absente de ce registre doit être corrigée, pas ignorée.
Chaque entrée est revue à chaque audit des dépendances.

| Date | Faille | Paquet | Amené par | Portée | Décision | Condition de levée |
|---|---|---|---|---|---|---|
| 2026-10-03 | GHSA-vfj7-8cjw-p6xm, déni de service par motif imbriqué | braces, via micromatch et fast-glob | shadcn (outil en ligne de commande), eslint-config-next | Outils de développement uniquement. Aucune donnée d'utilisateur n'atteint ces outils. Absent du code livré, vérifié par `npm audit --omit=dev` | Acceptée | Publication d'une version corrigée de braces ou de fast-glob |
