export type EventDocumentPresentationInput = {
  original_name?: string | null;
  mime_type?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

const EXCEL_WORKBOOK_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function isEventRegistrationsWorkbook(documentItem: EventDocumentPresentationInput): boolean {
  const name = String(documentItem.original_name || '').trim().toLocaleLowerCase('es');
  const mimeType = String(documentItem.mime_type || '').trim().toLowerCase();
  return name === 'inscripciones.xlsx' || (name.endsWith('.xlsx') && mimeType === EXCEL_WORKBOOK_MIME);
}

export function eventDocumentActivityDate(documentItem: EventDocumentPresentationInput): string {
  return String(documentItem.updated_at || documentItem.created_at || '');
}

export function eventDocumentPresentation(documentItem: EventDocumentPresentationInput) {
  const isWorkbook = isEventRegistrationsWorkbook(documentItem);
  return {
    isWorkbook,
    activityDate: eventDocumentActivityDate(documentItem),
    dateLabel: isWorkbook ? 'Actualizado' : 'Subido',
    actionLabel: isWorkbook ? 'Abrir en Excel web' : 'Abrir',
  } as const;
}
