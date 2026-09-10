const fs = require('fs');

async function extractPdfText(filePath) {
    const buf = await fs.promises.readFile(filePath);
    if (buf.slice(0, 5).toString() !== '%PDF-') throw new Error('Not a PDF file.');
    let pdfMod;
    try {
        pdfMod = require('pdf-parse');
    } catch {
        throw new Error('PDF parser unavailable. Install pdf-parse or upload a .txt version.');
    }
    let text = '';
    if (typeof pdfMod === 'function') {
        const data = await pdfMod(buf, { max: 200 });
        text = data.text || '';
    } else if (pdfMod && typeof pdfMod.PDFParse === 'function') {
        const parser = new pdfMod.PDFParse({ data: buf });
        const result = await parser.getText();
        text = result.text || result.total || '';
        if (typeof parser.destroy === 'function') await parser.destroy().catch(() => {});
    } else {
        throw new Error('PDF parser has unsupported API. Upload a .txt version.');
    }
    return String(text)
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

module.exports = {
    extractPdfText
};
