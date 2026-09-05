import type { TemplateLabelTranslator } from './i18nLabels';

const labels: Record<string, string> = {
  'time.mixed': 'Mixed rates',
  'time.unknown': 'Rate unavailable',
  'time.other': 'Other billed time',
  'time.ticket': 'Ticket',
  'time.task': 'Project task',
  'time.partial': 'Some billed time is shown as service charges because ticket detail is unavailable.',
  'time.unavailable': 'Ticket detail is unavailable. All charges are shown below.',
};

/** Pure localization of semantic renderer fields, including nested transform rows.
 * Snapshot descriptions and numeric money are never translated or reformatted.
 */
export function localizeTimePresentation<T>(value: T, t: TemplateLabelTranslator = (_key, options) => options.defaultValue): T {
  const visit = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(visit);
    if (!input || typeof input !== 'object') return input;
    const row = Object.fromEntries(Object.entries(input).map(([key, child]) => [key, visit(child)]));
    if (row.timePresentation === true) {
      if (row.rateKind === 'mixed' || row.rateKind === 'unknown') {
        const key = `time.${row.rateKind}`;
        row.rateDisplay = t(key, { defaultValue: labels[key] });
      }
      if (typeof row.labelKey === 'string' && labels[row.labelKey]) row.label = t(row.labelKey, { defaultValue: labels[row.labelKey] });
    }
    if (typeof row.ticketCoverageStatus === 'string') {
      const key = `time.${row.ticketCoverageStatus}`;
      row.ticketCoverageNote = labels[key] ? t(key, { defaultValue: labels[key] }) : '';
    }
    return row;
  };
  return visit(value) as T;
}
