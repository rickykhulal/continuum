// Minimal PDF writer for the one-page brief (product PRD FR-27). No dependency, no network:
// it emits a valid single-page A4 PDF with Helvetica text, which browsers and viewers accept.

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 48;
const LINE_GAP = 15;

function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[^\x20-\x7E]/g, '');
}

function wrap(line: string, width = 96): string[] {
  if (line.length <= width) return [line];
  const words = line.split(/\s+/);
  const out: string[] = [];
  let current = '';
  for (const w of words) {
    if ((current + ' ' + w).trim().length > width) {
      if (current) out.push(current);
      current = w;
    } else {
      current = (current ? current + ' ' : '') + w;
    }
  }
  if (current) out.push(current);
  return out;
}

function bytes(value: string): number[] {
  return Array.from(value).map((c) => c.charCodeAt(0) & 0xff);
}

function streamText(lines: string[]): string {
  const out: string[] = ['BT'];
  let y = PAGE_H - MARGIN - 30;
  lines.forEach((raw, i) => {
    const heading = i === 0;
    const wrapped = wrap(raw, heading ? 52 : 100);
    for (const piece of wrapped) {
      if (y < MARGIN) {
        out.push('/F1 9 Tf', `${MARGIN} ${y.toFixed(2)} Tm (${escapeText('...more in the live app.')}) Tj`, 'ET');
        return out.join('\n');
      }
      out.push(heading ? '/F1 15 Tf' : '/F1 10 Tf');
      out.push(`${MARGIN} ${y.toFixed(2)} Tm (${escapeText(piece)}) Tj`);
      y -= heading ? 22 : LINE_GAP;
    }
    y -= 4;
  });
  out.push('ET');
  return out.join('\n');
}

export interface PdfDoc {
  /** Raw PDF bytes — works as a Blob part in the browser and as a Buffer on the server. */
  data: Uint8Array;
  size: number;
}

export function buildPdf(lines: string[]): PdfDoc {
  const content = streamText(lines.length ? lines : ['Continuum']);
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 /MediaBox [0 0 595.28 841.89] >>',
    '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Producer (Continuum) /Title (Continuum area brief) /CreationDate (D:20261101000000Z) >>',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((obj, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  const arr = new Uint8Array(bytes(pdf));
  return { data: arr, size: arr.length };
}

/** Browser helper: trigger a download of the built PDF. */
export function downloadPdf(lines: string[], filename: string): boolean {
  if (typeof document === 'undefined') return false;
  const doc = buildPdf(lines);
  const blob = new Blob([doc.data as unknown as BlobPart], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return true;
}
