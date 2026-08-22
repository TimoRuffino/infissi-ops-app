# Final Fix Report

Date: 2026-08-22
Branch: `codex/messaggi-tars`

## Findings resolved

1. IMAP fallback now resolves the indexed occurrence of duplicate filenames.
2. Fresh Email attachment archival requires durable storage. A failed `putFile`
   returns an actionable retry error without persisting or mutating inline
   `dataBase64`; existing legacy inline documents remain readable.
3. WhatsApp context requests Tars proposals with the IDs of the currently
   loaded thread. The server accepts only direct payload, execution-source, or
   origin-chain links to those communication IDs; unprovable links show none.
4. Bulk spam and newsletter actions use the existing `ConfirmDialog` with the
   selected Email count before dispatching the mutation.
5. Email search includes `mittenteNome`. PostgreSQL `ILIKE` terms escape `%`,
   `_`, and backslash with the same literal semantics as the memory fallback.
6. `mail.whatsapp.segnaVista` is scoped by sede, account, and normalized
   counterpart. Opening a conversation invokes it once and invalidates the
   conversation list and thread queries.
7. Initial WhatsApp thread render scrolls to the newest message. Loading older
   messages still restores the previous viewport anchor after prepend.

## Focused coverage

- Duplicate-name IMAP occurrence selection.
- Durable archival failure and absence of a new document record.
- Tars proposal origin filtering against loaded communication IDs.
- Counted bulk exclusion copy.
- Email sender-name and literal wildcard search parity.
- WhatsApp mark-viewed scope, including account and cross-sede `NOT_FOUND`.
- Initial and prepend thread scroll calculations.

Client helper tests are now included by the Vitest configuration.

## Verification

- `pnpm check`: passed.
- `pnpm test`: passed, 15 files and 182 tests.
- `pnpm build`: passed.
- `git diff --check`: passed.

No Railway, live IMAP, or live WhatsApp account was contacted. PostgreSQL query
execution and real provider behavior still require deployment-environment QA.
