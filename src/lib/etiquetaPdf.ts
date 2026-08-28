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
const START_C = 105;
/** Troca para o subconjunto C no meio do símbolo. */
const CODE_C = 99;
/** Troca para o subconjunto B no meio do símbolo. */
const CODE_B = 100;
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

const ehDigito = (ch: string) => ch >= '0' && ch <= '9';

/** Quantos dígitos seguidos existem a partir de uma posição. */
function digitosAPartirDe(txt: string, i: number): number {
  let n = 0;
  while (i + n < txt.length && ehDigito(txt[i + n])) n++;
  return n;
}

/**
 * Sequência Code 128 usando os subconjuntos B e C.
 *
 * O subconjunto C codifica dígitos **aos pares** — um símbolo para cada dois —
 * e é o que torna um código numérico curto o bastante para caber na etiqueta
 * com margem. Só com o B, os 13 dígitos de um EAN viravam 178 módulos: 89 mm
 * numa etiqueta de 110 mm, de ponta a ponta, e o leitor não lia. Pelo C o
 * mesmo código cai para 123 módulos, ~61 mm, com folga dos dois lados.
 *
 * A regra de troca é a usual: começa em C quando há pelo menos quatro dígitos
 * à frente, volta para B quando sobra dígito ímpar ou aparece letra, e torna a
 * entrar em C quando surge uma corrida de seis dígitos ou mais — abaixo disso
 * o símbolo de troca custa mais do que economiza.
 */
export function encodeCode128(value: string): number[] {
  const t = sanitizeCode128B(value);
  if (!t) return [];

  const values: number[] = [];
  let i = 0;
  let emC = digitosAPartirDe(t, 0) >= 4;
  values.push(emC ? START_C : START_B);

  while (i < t.length) {
    if (emC) {
      if (digitosAPartirDe(t, i) >= 2) {
        values.push(Number(t.slice(i, i + 2)));
        i += 2;
        continue;
      }
      values.push(CODE_B);
      emC = false;
      continue;
    }
    const corrida = digitosAPartirDe(t, i);
    // No fim da cadeia, dois dígitos já pagam a troca; no meio, exige seis.
    if (corrida >= 6 || (corrida >= 2 && corrida % 2 === 0 && i + corrida === t.length)) {
      values.push(CODE_C);
      emC = true;
      continue;
    }
    values.push(t.charCodeAt(i) - 32);
    i += 1;
  }

  let checksum = values[0];
  for (let k = 1; k < values.length; k++) checksum += values[k] * k;
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
  /**
   * Endereço Rational, o outro campo extra do cadastro.
   *
   * Muita peça só tem este preenchido — as UNOX, por exemplo. A etiqueta
   * olhava apenas a localização física e saía sem endereço nenhum, deixando
   * o separador procurar a peça na prateleira no olho.
   */
  localizacaoRational?: string;
  /** Quantidade de etiquetas (páginas) deste item. */
  copies: number;
}

/**
 * Geometria copiada da etiqueta "Etiqueta Wedo 2.0" do Gestão Click, medida no
 * PDF que ele gera (MediaBox 312×142 pt, transformação 0.36 e fonte 39 → 14 pt).
 *
 * A impressora está calibrada para esse formato: gerar em outro tamanho faz o
 * avanço do rolo sair errado e a etiqueta desalinhar ao longo da bobina.
 */
const PAGE_W = 110.07;
const PAGE_H = 50.09;

/** Margem lateral (7 mm) mais o recuo interno do HTML do GC (2 mm). */
const MARGIN_X = 9.0;
const FONT_SIZE = 14;
/** Entrelinha medida entre as baselines do GC. */
const LINE_H = 5.97;

const Y_TOPO = 7.1;
const Y_NOME = 13.07;
/** Altura reservada às barras — o salto de 16,2 mm entre "Codigo:" e o número. */
const BARCODE_H = 12.5;

/**
 * Baseline do endereço, fixa no pé da etiqueta.
 *
 * É o único elemento que não existe no modelo do GC. Fixá-lo aqui embaixo
 * mantém o resto idêntico e garante que ele sempre caiba: com nome de duas
 * linhas o número do código fica em 41,2 mm, e ainda sobram quase 6 mm.
 */
const Y_ENDERECO = 47.4;

/** Endereço a imprimir: a localização física manda; sem ela, vale a Rational. */
export function enderecoDaEtiqueta(item: EtiquetaItem): string {
  const fisica = (item.localizacao ?? '').trim();
  const rational = (item.localizacaoRational ?? '').trim();
  if (fisica && rational) return `${fisica} - Rational ${rational}`;
  if (fisica) return fisica;
  if (rational) return `Rational ${rational}`;
  return '';
}

function drawLabel(doc: jsPDF, item: EtiquetaItem): void {
  const usableW = PAGE_W - MARGIN_X * 2;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(FONT_SIZE);
  doc.text('WeDo Cozinhas', MARGIN_X, Y_TOPO);

  // Duas linhas no máximo. O GC corta o nome em 70 caracteres e, quando passa
  // de duas linhas, a etiqueta dele sai SEM código de barras — foi o que
  // aconteceu com o FORNO COMBINADO CHEFTOP. Aqui o corte é garantido.
  const nameLines = (doc.splitTextToSize(item.nome || '—', usableW) as string[]).slice(0, 2);
  doc.text(nameLines, MARGIN_X, Y_NOME);

  const y = Y_NOME + nameLines.length * LINE_H;
  doc.setFont('helvetica', 'normal');
  doc.text(`Codigo: ${item.codigo || '—'}`, MARGIN_X, y);

  const values = encodeCode128(item.barcodeValue);
  if (values.length) {
    const { bars, totalModules } = code128Bars(values);
    const module = Math.min(0.5, usableW / totalModules);
    const barcodeW = totalModules * module;
    const x0 = (PAGE_W - barcodeW) / 2;
    const barcodeY = y + 2;
    doc.setFillColor(0, 0, 0);
    for (const bar of bars) {
      doc.rect(x0 + bar.x * module, barcodeY, bar.width * module, BARCODE_H, 'F');
    }
    doc.text(sanitizeCode128B(item.barcodeValue), PAGE_W / 2, barcodeY + BARCODE_H + 3.7, {
      align: 'center',
    });
  } else {
    doc.text('(sem código para gerar barras)', MARGIN_X, y + LINE_H);
  }

  // Endereço do estoque, no pé. É por ele que o separador acha a peça, e vale
  // tanto a localização física quanto a Rational — muita peça só tem a segunda.
  const endereco = enderecoDaEtiqueta(item);
  if (endereco) {
    doc.setFont('helvetica', 'bold');
    const linha = (doc.splitTextToSize(`LOCAL: ${endereco}`, usableW) as string[])[0];
    doc.text(linha, MARGIN_X, Y_ENDERECO);
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
