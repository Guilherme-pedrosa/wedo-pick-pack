import jsPDF from 'jspdf';

/**
 * Etiquetas de peça em PDF (uma etiqueta por página), no layout da etiqueta
 * padrão da WeDo: cabeçalho "WeDo Cozinhas", nome da peça, "Codigo: X",
 * código de barras Code 128 e a localização física do estoque.
 *
 * O código de barras codifica o valor que o GestãoClick reconhece na
 * conferência (codigo_barras do produto quando existir; senão o código
 * interno) — o mesmo matching usado pelo scanner do Checkout.
 */

// Tabela padrão Code 128 (valores 0–106): larguras de barras/espaços.
const CODE128_PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];

const START_B = 104;
const STOP = 106;

/** Remove caracteres fora do conjunto Code 128 B (ASCII 32–126). */
export function sanitizeCode128B(value: string): string {
  return String(value ?? '').split('').filter(ch => {
    const c = ch.charCodeAt(0);
    return c >= 32 && c <= 126;
  }).join('');
}

/** Sequência de valores Code 128 (conjunto B), incluindo start, checksum e stop. */
export function encodeCode128B(value: string): number[] {
  const clean = sanitizeCode128B(value);
  if (!clean) return [];
  const values = [START_B];
  for (const ch of clean) values.push(ch.charCodeAt(0) - 32);
  let checksum = START_B;
  for (let i = 1; i < values.length; i++) checksum += values[i] * i;
  values.push(checksum % 103);
  values.push(STOP);
  return values;
}

interface Bar { x: number; width: number }

/** Converte a sequência de valores em barras (posições em módulos). */
export function code128Bars(values: number[]): { bars: Bar[]; totalModules: number } {
  const bars: Bar[] = [];
  let x = 0;
  for (const value of values) {
    const pattern = CODE128_PATTERNS[value];
    for (let i = 0; i < pattern.length; i++) {
      const width = Number(pattern[i]);
      if (i % 2 === 0) bars.push({ x, width }); // índices pares = barra
      x += width;
    }
  }
  return { bars, totalModules: x };
}

export interface EtiquetaItem {
  /** Nome da peça (linha em destaque). */
  nome: string;
  /** Código interno do produto — o "Codigo:" impresso. */
  codigo: string;
  /** Valor codificado no código de barras (codigo_barras || codigo). */
  barcodeValue: string;
  /** Localização física do estoque (campo extra do produto no GC). */
  localizacao?: string;
  /** Quantidade de etiquetas (páginas) deste item. */
  copies: number;
}

// Etiqueta 100 × 60 mm, uma por página.
const PAGE_W = 100;
const PAGE_H = 60;
const MARGIN_X = 6;

function drawLabel(doc: jsPDF, item: EtiquetaItem): void {
  const usableW = PAGE_W - MARGIN_X * 2;
  let y = 9;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('WeDo Cozinhas', MARGIN_X, y);
  y += 5.5;

  const nameLines = (doc.splitTextToSize(item.nome || '—', usableW) as string[]).slice(0, 2);
  doc.text(nameLines, MARGIN_X, y);
  y += nameLines.length * 5;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`Codigo: ${item.codigo || '—'}`, MARGIN_X, y);
  y += 3;

  // Código de barras
  const values = encodeCode128B(item.barcodeValue);
  if (values.length) {
    const { bars, totalModules } = code128Bars(values);
    const module = Math.min(0.5, usableW / totalModules);
    const barcodeW = totalModules * module;
    const x0 = (PAGE_W - barcodeW) / 2;
    const barcodeH = 16;
    doc.setFillColor(0, 0, 0);
    for (const bar of bars) {
      doc.rect(x0 + bar.x * module, y, bar.width * module, barcodeH, 'F');
    }
    y += barcodeH + 4.5;
    doc.setFontSize(10);
    doc.text(sanitizeCode128B(item.barcodeValue), PAGE_W / 2, y, { align: 'center' });
    y += 5;
  } else {
    doc.setFontSize(9);
    doc.text('(sem código para gerar barras)', MARGIN_X, y + 6);
    y += 12;
  }

  // Localização física, em destaque no rodapé
  if (item.localizacao) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(`LOCAL: ${item.localizacao}`, MARGIN_X, PAGE_H - 6);
  }
}

/** Monta o PDF: cada cópia de cada item vira uma página de etiqueta. */
export function buildEtiquetasPdf(items: EtiquetaItem[]): jsPDF {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [PAGE_W, PAGE_H] });
  let first = true;
  for (const item of items) {
    const copies = Math.max(0, Math.floor(item.copies));
    for (let i = 0; i < copies; i++) {
      if (!first) doc.addPage([PAGE_W, PAGE_H], 'landscape');
      first = false;
      drawLabel(doc, item);
    }
  }
  return doc;
}
