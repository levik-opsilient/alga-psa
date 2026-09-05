import { it, expect, vi } from 'vitest';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import knex from 'knex';
import dotenv from 'dotenv';

// Opt-in local acceptance fixture. Uses the wired stack, creates only synthetic source
// records, and leaves the invoice for live designer/PDF inspection. Authentication is
// supplied by a real fixture user's identity; charge math, DB, transactions and reads
// are not mocked. No completed snapshots are inserted.
const evidenceDir = process.env.INVOICE_TICKET_EVIDENCE_DIR ?? '/tmp/invoice-ticket-evidence';
const state = vi.hoisted(() => ({ user: null as any, tenant: '' }));
vi.mock('@alga-psa/auth', async (original) => {
  const actual = await original<any>();
  return { ...actual, getSession: async () => ({ user: { ...state.user, id: state.user.user_id } }), withAuth: (fn: any) => async (...args: any[]) => {
    const { runWithTenant } = await import('@alga-psa/db');
    return runWithTenant(state.tenant, () => fn(state.user, { tenant: state.tenant }, ...args));
  } };
});
vi.mock('@alga-psa/auth/getCurrentUser', () => ({ getCurrentUser: async () => state.user }));

it.runIf(process.env.INVOICE_TICKET_LIVE === '1')('generates immutable ticket presentation from approved source records', async () => {
  fs.mkdirSync(evidenceDir, { recursive: true });
  const env = dotenv.parse(fs.readFileSync('.env.local'));
  Object.assign(process.env, env, { DB_PORT: '5472' });
  const db = knex({ client: 'pg', connection: { host: env.DB_HOST, port: 5472, database: env.DB_NAME_SERVER, user: env.DB_USER_ADMIN, password: env.DB_PASSWORD_ADMIN } });
  try {
    state.user = await db('users').where({ email: 'invoice-draft-verifier@example.invalid' }).first();
    state.tenant = state.user.tenant;
    const tenant = state.tenant, userId = state.user.user_id;
    const clientId = randomUUID(), contractId = randomUUID(), lineId = randomUUID(), serviceId = randomUUID(), cycleId = randomUUID(), profileId = randomUUID(), usageLineId = randomUUID(), usageServiceId = randomUUID();
    await db.transaction(async (tx) => {
      const baseClient = await tx('clients').where({ tenant }).first();
      await tx('clients').insert({ ...baseClient, client_id: clientId, client_name: `Invoice ticket acceptance ${clientId.slice(0,6)}`, billing_email: 'billing@example.invalid', billing_contact_id: null, invoice_template_id: null, notes_document_id: null, auto_invoice: false, default_currency_code: 'USD', is_tax_exempt: false });
      await tx('client_billing_profiles').insert({ tenant, billing_profile_id: profileId, client_id: clientId, name: 'Default', is_default: true, is_system_managed_default: true, is_active: true, billing_email: 'billing@example.invalid' });
      await tx('client_billing_cycles').insert({ tenant, billing_profile_id: profileId, billing_cycle_id: cycleId, client_id: clientId, billing_cycle: 'monthly', effective_date: '2026-09-01', period_start_date: '2026-09-01', period_end_date: '2026-10-01', is_active: true });
      await tx('contracts').insert({ tenant, contract_id: contractId, contract_name: `Invoice ticket acceptance ${clientId.slice(0,6)}`, billing_frequency: 'monthly', is_active: true, status: 'active', currency_code: 'USD', owner_client_id: clientId });
      await tx('client_contracts').insert({ tenant, client_contract_id: randomUUID(), client_id: clientId, contract_id: contractId, start_date: '2026-07-01', is_active: true });
      await tx('contract_lines').insert({ tenant, contract_line_id: lineId, contract_id: contractId, contract_line_name: 'Ticket acceptance hourly', contract_line_type: 'Hourly', billing_frequency: 'monthly', billing_timing: 'arrears', cadence_owner: 'client', is_active: true, enable_overtime: true, overtime_threshold: 1, overtime_rate: 22500 });
      const baseService = await tx('service_catalog').where({ tenant, billing_method: 'hourly' }).first();
      if (!baseService) throw new Error('Live fixture needs an existing hourly service type');
      await tx('service_catalog').insert({ ...baseService, service_id: serviceId, service_name: `Ticket acceptance hourly ${clientId.slice(0,6)}`, default_rate: 15000, tax_rate_id: null });
      await tx('service_prices').insert({ tenant, price_id: randomUUID(), service_id: serviceId, currency_code: 'USD', rate: 15000 });
      const configId = randomUUID();
      await tx('contract_line_services').insert({ tenant, contract_line_id: lineId, service_id: serviceId, quantity: 1, custom_rate: 15000 });
      await tx('contract_line_service_configuration').insert({ tenant, config_id: configId, contract_line_id: lineId, service_id: serviceId, configuration_type: 'Hourly', custom_rate: 15000, quantity: 1 });
      await tx('contract_line_service_hourly_config').insert({ tenant, config_id: configId, minimum_billable_time: 0, round_up_to_nearest: 0 });
      await tx('contract_lines').insert({ tenant, contract_line_id: usageLineId, contract_id: contractId, contract_line_name: 'Ticket acceptance usage', contract_line_type: 'Usage', billing_frequency: 'monthly', billing_timing: 'arrears', cadence_owner: 'client', is_active: true });
      await tx('service_catalog').insert({ ...baseService, service_id: usageServiceId, service_name: `Ticket acceptance usage ${clientId.slice(0,6)}`, billing_method: 'usage', default_rate: 5000, tax_rate_id: null });
      await tx('service_prices').insert({ tenant, price_id: randomUUID(), service_id: usageServiceId, currency_code: 'USD', rate: 5000 });
      const usageConfigId = randomUUID();
      await tx('contract_line_services').insert({ tenant, contract_line_id: usageLineId, service_id: usageServiceId, quantity: 1, custom_rate: 5000 });
      await tx('contract_line_service_configuration').insert({ tenant, config_id: usageConfigId, contract_line_id: usageLineId, service_id: usageServiceId, configuration_type: 'Usage', custom_rate: 5000, quantity: 1 });
      await tx('contract_line_service_usage_config').insert({ tenant, config_id: usageConfigId, unit_of_measure: 'unit', base_rate: 5000 });
      await tx('usage_tracking').insert({ tenant, usage_id: randomUUID(), service_id: usageServiceId, client_id: clientId, contract_line_id: usageLineId, usage_date: '2026-08-15', quantity: 1, invoiced: false });
      const baseTicket = await tx('tickets').where({ tenant }).first();
      for (let i = 0; i < 2; i++) {
        const ticketId = randomUUID();
        await tx('tickets').insert({ tenant, ticket_id: ticketId, ticket_number: `DRAFT-${clientId.slice(0,6)}-${i}`, title: `Public ticket ${i}`, attributes: { description: `Public work ${i}`, internal_note: 'PRIVATE_SENTINEL' }, client_id: clientId, status_id: baseTicket.status_id, board_id: baseTicket.board_id, priority_id: baseTicket.priority_id, entered_by: userId });
        for (let j = 0; j < 2; j++) {
          const minutes = i === 0 && j === 0 ? 120 : 60;
          await tx('time_entries').insert({ tenant, entry_id: randomUUID(), user_id: userId, start_time: `2026-08-${15+i}T10:00:00Z`, end_time: `2026-08-${15+i}T${minutes===120?12:11}:00:00Z`, work_timezone: 'UTC', work_date: `2026-08-${15+i}`, work_item_id: ticketId, work_item_type: 'ticket', approval_status: 'APPROVED', service_id: serviceId, contract_line_id: lineId, billable_duration: minutes, invoiced: false, notes: 'PRIVATE_TIME_SENTINEL' });
        }
      }
    });
    // Isolated tax configuration: never changes a shared service or tax region.
    const taxRateId = randomUUID(), regionCode = `DRAFT-${clientId}`;
    await db('tax_regions').insert({ tenant, region_code: regionCode, region_name: 'Acceptance 10%' });
    await db('tax_rates').insert({ tenant, tax_rate_id: taxRateId, region_code: regionCode, tax_percentage: 10, start_date: '2026-01-01', is_active: true });
    await db('client_tax_rates').insert({ tenant, client_id: clientId, tax_rate_id: taxRateId, is_default: true });
    await db('client_tax_settings').insert({ tenant, client_id: clientId, billing_profile_id: profileId, is_reverse_charge_applicable: false });
    await db('service_catalog').where({ tenant }).whereIn('service_id', [serviceId, usageServiceId]).update({ tax_rate_id: taxRateId });
    const { syncRecurringServicePeriodsForContractLine } = await import('@alga-psa/billing/actions/recurringServicePeriodSync');
    await db.transaction((tx) => syncRecurringServicePeriodsForContractLine(tx, { tenant, contractLineId: lineId, sourceRunPrefix: 'invoice-ticket-acceptance' }));
    await db.transaction((tx) => syncRecurringServicePeriodsForContractLine(tx, { tenant, contractLineId: usageLineId, sourceRunPrefix: 'invoice-ticket-acceptance' }));
    fs.writeFileSync(`${evidenceDir}/source.json`, JSON.stringify({ tenant, clientId, lineId, cycleId, userId }, null, 2));
    const { generateInvoice, previewInvoice } = await import('@alga-psa/billing/actions/invoiceGeneration');
    const preview = await previewInvoice(cycleId) as any;
    expect(preview.success, JSON.stringify(preview)).toBe(true);
    expect(preview.data.ticketPresentationRows.filter((r: any) => r.id.startsWith('ticket:'))).toHaveLength(2);
    expect(preview.data.ticketPresentationRows.reduce((sum: number, r: any) => sum + r.amount, 0)).toBe(preview.data.subtotal);
    fs.writeFileSync(`${evidenceDir}/recurring-preview.json`, JSON.stringify(preview.data, null, 2));
    const result = await generateInvoice(cycleId) as any;
    if (result?.actionError || result?.permissionError) throw new Error(JSON.stringify(result));
    expect(result?.invoice_id).toBeTruthy();
    const links = await db('invoice_time_entries').where({ tenant, invoice_id: result.invoice_id });
    expect(links).toHaveLength(4);
    expect(links.some((l) => l.work_item_snapshot.rateKind === 'mixed' && l.work_item_snapshot.netAmount === 37500)).toBe(true);
    const { default: Invoice } = await import('@alga-psa/billing/models/invoice');
    const { mapDbInvoiceToWasmViewModel } = await import('@alga-psa/billing/lib/adapters/invoiceAdapters');
    const { QuickBooksCSVAdapter } = await import('@alga-psa/billing/adapters/accounting/quickBooksCSVAdapter');
    const { runWithTenant } = await import('@alga-psa/db');
    const canonicalCharges = await db('invoice_charges').where({ tenant, invoice_id: result.invoice_id });
    for (const service of [serviceId, usageServiceId]) {
      await db('tenant_external_entity_mappings').insert({ id: randomUUID(), tenant, integration_type: 'quickbooks_csv',
        alga_entity_type: 'service', alga_entity_id: service, external_entity_id: `Acceptance ${service}`, external_realm_id: null });
    }
    // Fixture export envelope only: transform loads the real invoice, charges,
    // and persisted mappings. No delivery or accounting-system write is performed.
    const exportContext = { batch: { tenant, batch_id: randomUUID(), adapter_type: 'quickbooks_csv' },
      lines: canonicalCharges.map((charge) => ({ line_id: charge.item_id, document_id: result.invoice_id, document_line_id: charge.item_id, client_id: clientId })) } as any;
    const exportPayload = () => runWithTenant(tenant, () => new QuickBooksCSVAdapter().transform(exportContext));
    const exportBefore = await exportPayload();
    const csvRows = exportBefore.documents[0].payload.csvRows as any[];
    expect(csvRows.map((row) => row.ItemDescription)).toEqual(canonicalCharges.map((charge) => charge.description));
    expect(csvRows.map((row) => row['*Item'])).toEqual(canonicalCharges.map((charge) => `Acceptance ${charge.service_id}`));
    const invoice = await Invoice.getFullInvoiceById(db, tenant, result.invoice_id);
    const vm = mapDbInvoiceToWasmViewModel(invoice)!;
    expect(vm.ticketPresentationRows).toHaveLength(3);
    expect(vm.ticketPresentationRows!.filter((r) => r.id.startsWith('ticket:'))).toHaveLength(2);
    const persistedCharges = await db('invoice_charges').where({ tenant, invoice_id: result.invoice_id });
    for (const charge of persistedCharges) {
      const contributions = vm.ticketPresentationRows!.flatMap((r) => r.contributions).filter((c) => c.itemId === charge.item_id);
      expect(contributions.reduce((sum, c) => sum + c.amount, 0)).toBe(Number(charge.net_amount));
      if (contributions.some((c) => c.entryId === null)) expect(contributions).toHaveLength(1);
    }
    expect(vm.subtotal).toBe(87500);
    expect(vm.tax).toBe(8750);
    expect(vm.total).toBe(vm.subtotal + vm.tax);
    const frozen = JSON.stringify(vm);
    // Invoiced fields are locked in the UI. Deliberate fixture-only source edits
    // test immutable historical rendering, not a supported edit workflow.
    await db('tickets').where({ tenant, client_id: clientId }).update({ title: 'EDITED AFTER BILLING', attributes: { description: 'EDITED DESCRIPTION' } });
    await db('time_entries').where({ tenant, contract_line_id: lineId }).update({ notes: 'EDITED PRIVATE NOTE' });
    const fresh = mapDbInvoiceToWasmViewModel(await Invoice.getFullInvoiceById(db, tenant, result.invoice_id))!;
    expect(JSON.stringify(fresh)).toBe(frozen);
    expect(await exportPayload()).toEqual(exportBefore);
    expect(await db('invoice_charges').where({ tenant, invoice_id: result.invoice_id })).toEqual(canonicalCharges);
    fs.writeFileSync(`${evidenceDir}/accounting-export.json`, JSON.stringify(exportBefore, null, 2));
    const duplicate = await generateInvoice(cycleId) as any;
    expect(duplicate?.invoice_id).toBeUndefined();
    expect(await db('invoice_time_entries').where({ tenant, invoice_id: result.invoice_id }).count('* as count').first().then((r) => Number(r!.count))).toBe(4);
    expect(JSON.stringify(links)).not.toContain('PRIVATE');
    fs.writeFileSync(`${evidenceDir}/generated.json`, JSON.stringify({ invoiceId: result.invoice_id, links, vm }, null, 2));
    const { PDFGenerationService } = await import('@alga-psa/billing/services/pdfGenerationService');
    const template = await db('standard_invoice_templates').where({ standard_invoice_template_code: 'standard-invoice-by-ticket' }).first();
    fs.writeFileSync(`${evidenceDir}/production.pdf`, await new PDFGenerationService(tenant).generatePDF({ invoiceId: result.invoice_id, userId, templateId: template.template_id }));
    await db('clients').where({ tenant, client_id: clientId }).update({ properties: { defaultLocale: 'fr' } });
    const pdf = new PDFGenerationService(tenant);
    expect(await pdf.resolveRenderLocale({ invoiceId: result.invoice_id })).toBe('fr');
    fs.writeFileSync(`${evidenceDir}/production-fr.pdf`, await pdf.generatePDF({ invoiceId: result.invoice_id, userId, templateId: template.template_id }));
    const { grantCredit, applyCreditToInvoice } = await import('@alga-psa/billing/actions/creditActions');
    const credit = await grantCredit(clientId, 2500, undefined, 'Synthetic acceptance credit', profileId) as any;
    expect(credit.credit_id, JSON.stringify(credit)).toBeTruthy();
    expect(await applyCreditToInvoice(clientId, result.invoice_id, 2500)).toBeUndefined();
    const creditedInvoice = await Invoice.getFullInvoiceById(db, tenant, result.invoice_id);
    const creditedVm = mapDbInvoiceToWasmViewModel(creditedInvoice)!;
    expect(creditedVm.ticketPresentationRows).toEqual(vm.ticketPresentationRows);
    expect(creditedVm.subtotal).toBe(vm.subtotal);
    expect(creditedVm.tax).toBe(vm.tax);
    expect(Number(creditedInvoice!.credit_applied)).toBe(2500);
    fs.writeFileSync(`${evidenceDir}/credited.json`, JSON.stringify(creditedVm, null, 2));
    const { addManualItemsToInvoice } = await import('@alga-psa/billing/actions/invoiceModification');
    const adjusted = await addManualItemsToInvoice(result.invoice_id, [
      { description: 'Synthetic line discount', quantity: 1, rate: -1000, is_discount: true, discount_type: 'fixed', applies_to_item_id: persistedCharges[0].item_id, is_taxable: false },
      { description: 'Synthetic negative credit', quantity: 1, rate: -500, is_taxable: false },
      { description: 'Synthetic zero information', quantity: 1, rate: 0, is_taxable: false },
    ] as any) as any;
    expect(adjusted.invoice_id, JSON.stringify(adjusted)).toBe(result.invoice_id);
    const adjustedVm = mapDbInvoiceToWasmViewModel(adjusted)!;
    expect(adjustedVm.subtotal).toBe(86000);
    expect(adjustedVm.tax).toBe(8750);
    expect(adjustedVm.total).toBe(94750);
    expect(Number(adjusted.credit_applied)).toBe(2500);
    const adjustmentCharges = await db('invoice_charges').where({ tenant, invoice_id: result.invoice_id });
    for (const charge of adjustmentCharges) {
      expect(adjustedVm.ticketPresentationRows!.flatMap((r) => r.contributions).filter((c) => c.itemId === charge.item_id).reduce((sum, c) => sum + c.amount, 0)).toBe(Number(charge.net_amount));
    }
    expect(adjustedVm.ticketPresentationRows!.filter((r) => r.id.startsWith('ticket:'))).toHaveLength(2);
    for (const description of ['Synthetic line discount', 'Synthetic negative credit', 'Synthetic zero information']) {
      expect(adjustedVm.ticketPresentationRows!.filter((r) => r.description === description)).toHaveLength(1);
    }
    fs.writeFileSync(`${evidenceDir}/adjusted.json`, JSON.stringify(adjustedVm, null, 2));
    // Corrupt-history cases deliberately modify already-generated snapshots only
    // inside rolled-back transactions. They are not generation fixtures.
    for (const variant of ['legacy', 'partial', 'invalid-version', 'v1']) {
      const tx = await db.transaction();
      try {
        const selected = tx('invoice_time_entries').where({ tenant, invoice_id: result.invoice_id });
        if (variant === 'legacy') await selected.update({ work_item_snapshot: null });
        else {
          const original = links[0].work_item_snapshot;
          const snapshot = variant === 'partial' ? null : { ...original, version: variant === 'v1' ? 1 : 99 };
          await selected.andWhere({ entry_id: links[0].entry_id }).update({ work_item_snapshot: snapshot });
        }
        const historical = mapDbInvoiceToWasmViewModel(await Invoice.getFullInvoiceById(tx, tenant, result.invoice_id))!;
        for (const charge of adjustmentCharges) {
          const contributions = historical.ticketPresentationRows!.flatMap((r) => r.contributions).filter((c) => c.itemId === charge.item_id);
          expect(contributions.reduce((sum, c) => sum + c.amount, 0)).toBe(Number(charge.net_amount));
          if (contributions.some((c) => c.entryId === null)) expect(contributions).toHaveLength(1);
        }
        if (variant === 'legacy') expect(historical.ticketPresentationRows).toHaveLength(adjustmentCharges.length);
        if (variant === 'partial' || variant === 'invalid-version') expect(historical.ticketPresentationRows!.some((r) => r.id === links[0].item_id)).toBe(true);
        if (variant === 'v1') expect(historical.timeEntries!.find((e) => e.id === links[0].entry_id)?.rateKind).toBe('unknown');
      } finally { await tx.rollback(); }
    }


  } finally { await db.destroy(); }
}, 120000);

it.runIf(process.env.INVOICE_TICKET_CUSTOM === '1')('renders the UI-saved transformed detail and primary tables through preview and PDF', async () => {
  fs.mkdirSync(evidenceDir, { recursive: true });
  const env = dotenv.parse(fs.readFileSync('.env.local'));
  Object.assign(process.env, env, { DB_PORT: '5472' });
  const db = knex({ client: 'pg', connection: { host: env.DB_HOST, port: 5472, database: env.DB_NAME_SERVER, user: env.DB_USER_ADMIN, password: env.DB_PASSWORD_ADMIN } });
  try {
    state.user = await db('users').where({ email: 'invoice-draft-verifier@example.invalid' }).first();
    state.tenant = state.user.tenant;
    const tenant = state.tenant;
    if (!process.env.INVOICE_TICKET_CUSTOM_NUMBER || !process.env.INVOICE_TICKET_CUSTOM_TEMPLATE) {
      throw new Error('Set INVOICE_TICKET_CUSTOM_NUMBER and INVOICE_TICKET_CUSTOM_TEMPLATE to the UI-verified invoice and saved layout.');
    }
    const invoice = await db('invoices').where({ tenant, invoice_number: process.env.INVOICE_TICKET_CUSTOM_NUMBER }).first();
    const template = await db('invoice_templates').where({ tenant, template_id: process.env.INVOICE_TICKET_CUSTOM_TEMPLATE }).first();
    expect(template.templateAst.transforms.sourceBindingId).toBe('timeEntries');
    const { default: Invoice } = await import('@alga-psa/billing/models/invoice');
    const { mapDbInvoiceToWasmViewModel } = await import('@alga-psa/billing/lib/adapters/invoiceAdapters');
    const { resolveCanvasCollection } = await import('@alga-psa/billing/components/invoice-designer/preview/previewBindings');
    const { evaluateTemplateAst } = await import('@alga-psa/billing/lib/invoice-template-ast/evaluator');
    const { PDFGenerationService } = await import('@alga-psa/billing/services/pdfGenerationService');
    const vm = mapDbInvoiceToWasmViewModel(await Invoice.getFullInvoiceById(db, tenant, invoice.invoice_id))!;
    const ast = template.templateAst;
    fs.writeFileSync(`${evidenceDir}/custom-template.json`, JSON.stringify(ast, null, 2));
    const evaluation = evaluateTemplateAst(ast, vm as unknown as Record<string, unknown>);
    const tables: any[] = [];
    const visit = (node: any) => { if (node.type === 'dynamic-table') tables.push(node); (node.children ?? []).forEach(visit); };
    visit(ast.layout);
    expect(tables).toHaveLength(2);
    for (const table of tables) {
      const source = table.repeat.sourceBinding.bindingId;
      expect(resolveCanvasCollection(vm, source, ast)).toEqual({ rows: evaluation.bindings[source] });
    }
    expect(resolveCanvasCollection(vm, ast.transforms.outputBindingId, ast).rows).toHaveLength(4);
    expect(resolveCanvasCollection(vm, ast.transforms.outputBindingId, ast).rows.map((row) => row.amount)).toEqual([37500, 15000, 15000, 15000]);
    fs.writeFileSync(`${evidenceDir}/custom-canvas-rows.json`, JSON.stringify(tables.map((table) => ({
      source: table.repeat.sourceBinding.bindingId,
      ...resolveCanvasCollection(vm, table.repeat.sourceBinding.bindingId, ast),
    })), null, 2));
    const pdf = new PDFGenerationService(tenant);
    const preview = await pdf.renderInvoicePreview({ invoiceId: invoice.invoice_id, templateId: template.template_id });
    expect(preview.html).toContain('Tarifs variables');
    expect(preview.html).toContain('included in the charges above');
    fs.writeFileSync(`${evidenceDir}/custom-preview.html`, preview.html);
    fs.writeFileSync(`${evidenceDir}/custom.pdf`, await pdf.generatePDF({ invoiceId: invoice.invoice_id, userId: state.user.user_id, templateId: template.template_id }));
    const { execFileSync } = await import('node:child_process');
    const text = execFileSync('pdftotext', ['-layout', `${evidenceDir}/custom.pdf`, '-'], { encoding: 'utf8' });
    expect(text).toContain('375,00');
    expect(text).toContain('525,00');
    expect(text).toContain(new Intl.NumberFormat('fr', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(vm.total / 100));
    expect(text).not.toContain('EDITED');
    fs.writeFileSync(`${evidenceDir}/custom.txt`, text);
  } finally { await db.destroy(); }
}, 120000);
