// src/shared/formats.ts
// Centralised format lists for export and preview features.

export const EXPORT_FORMATS = ['html', 'pdf', 'typst', 'docx', 'revealjs', 'beamer', 'epub', 'pptx'] as const;
export type ExportFormat = typeof EXPORT_FORMATS[number];

// Quarto preview renders output into an embedded browser frame, so only
// HTML-based and PDF formats are supported at preview time.
export const PREVIEW_FORMATS = ['html', 'revealjs', 'pdf'] as const;
export type PreviewFormat = typeof PREVIEW_FORMATS[number];
