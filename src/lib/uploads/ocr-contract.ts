// Shared, browser-safe contract. Provider identity is selected by the server;
// the client's version/confidence reports are not proof of engine execution.
export const BROWSER_OCR = Object.freeze({provider:'tesseract.js' as const,providerVersion:'7.0.0',execution:'client' as const,language:'kor+eng' as const});
export const PDF_ORIGIN = Object.freeze({method:'embedded' as const,provider:'pdfjs' as const,providerVersion:'6.4.299',execution:'server' as const,language:null,extractionVersion:'upload-text-v1' as const});
export const OCR_ORIGIN = Object.freeze({method:'ocr' as const,...BROWSER_OCR,extractionVersion:'upload-text-v1' as const});
export const OCR_JSON_BYTES=2_500_000;
