// pdf-parse@1.1.1 no expone tipos para el subpath lib/ (importado directo para
// evitar el modo debug de index.js que lee un archivo de test al importarse).
declare module "pdf-parse/lib/pdf-parse.js" {
  interface PdfParseResult {
    text: string;
    numpages: number;
    numrender: number;
    info: any;
    metadata: any;
    version: string;
  }
  function pdfParse(
    dataBuffer: Buffer,
    options?: { pagerender?: (pageData: any) => string; max?: number }
  ): Promise<PdfParseResult>;
  export default pdfParse;
}
