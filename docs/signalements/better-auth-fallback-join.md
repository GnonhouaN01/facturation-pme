# Brouillon : signalement au projet Better Auth

Statut : brouillon, à envoyer par le développeur (jamais par l'assistant). Canal suggéré : la politique de sécurité du dépôt `better-auth/better-auth` (signalement privé), le texte pouvant contenir un exemple de jeton. Aucune donnée réelle ci-dessous : requête et jeton sont fictifs.

Contexte côté projet : `docs/THREATS.md` (T-39), `docs/features/socle-interface.md`, section 4.4.

---

**Title:** `handleFallbackJoin` logs the full database error with `console.error`, including SQL parameters (session tokens)

**Version:** `better-auth` 1.7.7 / `@better-auth/core` 1.7.7, Drizzle adapter (`@better-auth/drizzle-adapter` 1.7.7, PostgreSQL), experimental joins disabled.

**Where:** `@better-auth/core/dist/db/adapter/factory.mjs`, `handleFallbackJoin`, `catch` block:

```js
} catch (error) {
  logger.error(`Failed to query fallback join for model ${modelName}:`, { where, limit: joinConfig.limit });
  console.error(error);
  throw error;
}
```

**Problem:**

1. `console.error(error)` bypasses the configured `logger`. Applications that replace or silence Better Auth's logger to keep secrets out of server logs still get the full error printed.
2. With Drizzle, the error message embeds the query and its bound parameters (`Failed query: select ... where ... = $1\nparams: ...`). On a session lookup with a joined user, the parameters may include the session token or user identifiers, and the stack trace is printed as well.
3. The `logger.error` call also passes the `where` clause, including the filtered value.

**Reproduction (no database needed):** create an adapter with `createAdapterFactory` whose `findOne` returns a session row for `session` and throws `new Error("Failed query: select ... from \"user\" where \"user\".\"id\" = $1\nparams: u-1,<token>")` for `user`, then call `adapter.findOne({ model: "session", where: [{ field: "token", value: "<token>" }], join: { user: true } })`. The token and the query appear on stderr even when `logger.disabled` is `true`.

**Expected:** errors go through the configured logger only (or are rethrown without logging), and logged context never includes filter values or bound parameters.

**Suggested fix:** remove `console.error(error)` (the error is rethrown anyway), and log only the model name and the error class/code, without `where` values.

**Our mitigation:** a `console.error` filter installed at server start that never formats objects (class and code only) and drops SQL-like text. It works, but it hides useful diagnostics from every library writing errors to `console.error`, so an upstream fix would let us remove it.
