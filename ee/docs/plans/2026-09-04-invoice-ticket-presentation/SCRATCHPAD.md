# Invoice ticket presentation — working notes

## Assignment and scope

- Design assignment for alga0002322 follow-up; create the four ALGA plan artifacts. Implementation and live acceptance verification belong to subsequent workflow assignments.
- Predecessor: PR https://github.com/Nine-Minds/alga-psa/pull/3314, merged revision `45d8f81f875322342923a00bc81c4bd2cf4c40e7`. This is a standalone follow-up from main.
- Worktree: `/home/robert/alga-copies/feature-invoice-ticket-layouts-finish-rollup-presentatio`; branch `feature/invoice-ticket-layouts-finish-rollup-presentatio`; development port 3967; compose project `alga-psa-local-test`.
- Existing local modifications to `package-lock.json` and `packages/migration-cli/bin/alga-migrate.mjs` predate this assignment. Leave them untouched.
- The commissioning brief supplies the scope and authorizes creating the complete plan. No additional scope-confirmation gate is needed to draft its checklists. Workflow advancement and approvals remain with the XO/captain.

## Initial source findings

- `buildInvoiceTimeCollections` in `packages/billing/src/lib/adapters/invoiceAdapters.ts` groups immutable entry snapshots, compares only each entry's base `rate`, and inserts English mixed-rate/fallback labels.
- `computeTimeBasedCharges.ts` already calculates overtime components, but `buildTimeEntryWorkItemSnapshot` writes version 1 with only the base rate and net amount.
- `preview/previewBindings.ts` uses a separate collection map and falls back to `items` for unknown IDs. `TableEditorWidget.tsx` selects time/ticket presets by literal source IDs.
- `docs/billing/invoice_templates.md` describes both a rollup default and the superseded per-entry-band catalog entry. Its portal detail claim requires verification.

## Validation status

- Findings above are from source inspection. The overtime runtime reproduction and seeded-PDF limitations are commissioning evidence; they have not been re-executed in this design assignment.
- Behavioral, database, browser, and PDF acceptance checks remain pending implementation.

## Design decisions

- Use a new complete renderer collection (`ticketPresentationRows`, provisional name) for one primary table. Keep canonical `items` and existing detail bindings available.
- Replace a charge only with complete, unique, time-only immutable coverage and exact net-amount reconciliation. Partial coverage retains the entire original charge and excludes its snapshots from primary rollups. No guessed residual or historical backfill.
- Version 2 records uniform/mixed/unknown rate evidence from the calculator. Version 1 always has unavailable rate evidence for presentation. Explicit rate components are not required; optional entry detail must still identify within-entry mixed rates honestly.
- Preserve separate adjustments/credits and authoritative totals. Project cap and other inline discrepancies trigger canonical-row fallback; do not allocate write-downs to tickets speculatively.
- Share collection schemas and resolve canvas rows from evaluator bindings. Sort/filter preserve schema; grouped output uses its actual wrapper and nested schema. Unknown explicit bindings must not become invoice items.
- Localize derived display fields with the document translator and effective locale. Keep snapshots and evaluator inputs language-neutral.
- Default to requesting a billed-time breakdown from the service provider. Optional portal guidance is limited to verified client-visible ticket updates, with no promise of billed-entry/rate detail.

## Additional source findings

- Inspected worktree HEAD: `d33175f14c14254221fa9bdc7f0b7d9f4895b604`.
- `packages/billing/src/services/invoiceService.ts::linkAndMarkSourceBillingRecord` writes the snapshot and source link after guarding the invoiced flag, in the existing transaction. Hour-block informational charges can have time-entry links without work-item snapshots; links alone do not establish time-only provenance.
- `packages/billing/src/models/invoice.ts::getInvoiceItems` currently filters null snapshots before `attachTimeEntrySnapshots`. Retain immutable unavailable-link metadata to make coverage checks possible.
- `packages/billing/src/lib/billing/billingEngine.ts` applies project cap write-downs to `charge.total` after charge construction. The unresolved/catalog path separately calls `buildTimeEntryWorkItemSnapshot`; both paths need version-2 semantics.
- `packages/billing/src/actions/invoiceGeneration.ts` exposes `generateInvoice`, selection-input generation actions, production preview construction, and PDF actions. The acceptance path must begin with source entries and run generation, not call only the final persistence helper with a mocked billing result.
- `packages/billing/src/lib/invoice-template-ast/evaluator.ts::evaluateTemplateAst` already returns canonical and transformed collections in `bindings`. Reuse that evaluated context in canvas.
- `packages/billing/src/components/invoice-designer/fields/documentBindingCatalog.ts` serves invoices, quotes, and sales orders; metadata extraction must remain document-kind aware.
- `packages/billing/src/lib/invoice-template-ast/i18nLabels.ts::localizeTemplateAstForLocale` loads the `documents` namespace and resolves effective locale. Its current AST-only traversal does not translate dynamic row labels; add a shared derived-presentation seam, not string replacement.
- Inspected `packages/client-portal/src/components/tickets/TicketDetails.tsx` and `packages/client-portal/src/components/billing/InvoiceDetailsDialog.tsx`. Ticket comments/documents and canonical invoice lines are visible source paths. No live portal verification was performed; omission of the optional portal note is the safe default.

## Checklist sizing and verification handoff

- Estimated scope: roughly 25–30 atomic features. Final checklist: 29 features and 19 representative behavioral scenarios, with multiple feature mappings per scenario. The main skill's Pareto test guidance takes precedence over the older reference's suggestion that tests exceed features.
- Every checklist item is pending. No source-string/import-presence checks are planned.
- For later live evidence, create an `evidence/` manifest in this folder listing source fixture setup, exact generation action/commands, commit, test results, screenshots, PDF text, and a per-charge reconciliation. Use synthetic identifiers in fixtures and redact tenant/customer identifiers from committed evidence.
- Seeded completed snapshots are permitted only for disclosed legacy/corrupt-history cases. They do not satisfy T001, T004, or the production generation acceptance criterion.
- Compare semantic PDF content and source contribution amounts; binary PDF bytes may differ because of renderer timestamps or version changes.
- Browser, integration, and PDF work should use the corresponding repository testing/browser skills when implementation reaches that stage.

## Plan validation

Run from the worktree root:

```bash
python3 /home/robert/.codex/skills/alga-plan/scripts/validate_plan.py ee/docs/plans/2026-09-04-invoice-ticket-presentation
git diff --check
```

- Plan schema validation passed: 29 features, 19 tests, valid feature references.
- Additional handoff checks verify unique IDs, coverage of every feature by at least one test, all flags false, and PRD section references.
- No implementation, billing-generation, database, browser, or PDF tests were run for this design-only assignment.
