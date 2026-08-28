import { describe, expect, it } from 'vitest';
import {
  buildEtiquetasPdf,
  code128Bars,
  encodeCode128,
  encodeCode128B,
  enderecoDaEtiqueta,
  sanitizeCode128B,
} from './etiquetaPdf';

describe('encodeCode128B', () => {
  it('codifica "AIM" com o checksum clássico (valor 45)', () => {
    // Start B (104), A(33), I(41), M(45), checksum (104+33+82+135) % 103 = 45, Stop (106)
    expect(encodeCode128B('AIM')).toEqual([104, 33, 41, 45, 45, 106]);
  });

  it('aceita códigos com ponto e letra como 50.01.050S', () => {
    const values = encodeCode128B('50.01.050S');
    expect(values[0]).toBe(104);
    expect(values[values.length - 1]).toBe(106);
    expect(values).toHaveLength(10 + 3); // 10 chars + start + checksum + stop
  });

  it('remove caracteres fora do ASCII imprimível', () => {
    expect(sanitizeCode128B('ABÇ\n12')).toBe('AB12');
  });

  it('devolve vazio quando não há valor', () => {
    expect(encodeCode128B('')).toEqual([]);
  });
});

describe('code128Bars', () => {
  it('gera o total de módulos esperado (11 por símbolo + 13 do stop)', () => {
    // start + A + I + M + checksum = 5 símbolos de 11 módulos, mais o stop de 13
    const values = encodeCode128B('AIM');
    const { totalModules } = code128Bars(values);
    expect(totalModules).toBe(5 * 11 + 13);
  });
});

describe('buildEtiquetasPdf', () => {
  it('cria uma página por cópia', () => {
    const doc = buildEtiquetasPdf([
      { nome: 'PEÇA A', codigo: '50.01.050S', barcodeValue: '50.01.050S', copies: 2 },
      { nome: 'PEÇA B', codigo: 'X1', barcodeValue: 'X1', localizacao: 'E3-P2', copies: 1 },
    ]);
    expect(doc.getNumberOfPages()).toBe(3);
  });

  it('ignora itens com zero cópias', () => {
    const doc = buildEtiquetasPdf([
      { nome: 'PEÇA A', codigo: 'A', barcodeValue: 'A', copies: 0 },
      { nome: 'PEÇA B', codigo: 'B', barcodeValue: 'B', copies: 1 },
    ]);
    expect(doc.getNumberOfPages()).toBe(1);
  });
});

describe('enderecoDaEtiqueta', () => {
  const base = { nome: 'PEÇA', codigo: 'X', barcodeValue: 'X', copies: 1 };

  it('usa a localização física quando ela existe', () => {
    expect(enderecoDaEtiqueta({ ...base, localizacao: 'E3-P2' })).toBe('E3-P2');
  });

  it('cai para a Rational quando só ela está preenchida', () => {
    // Caso das peças UNOX: o cadastro só tem o endereço Rational, e a etiqueta
    // saía sem endereço nenhum.
    expect(enderecoDaEtiqueta({ ...base, localizacaoRational: 'A12' })).toBe('Rational A12');
  });

  it('mostra as duas quando as duas existem', () => {
    expect(enderecoDaEtiqueta({ ...base, localizacao: 'E3-P2', localizacaoRational: 'A12' }))
      .toBe('E3-P2 - Rational A12');
  });

  it('devolve vazio sem endereço, e ignora espaço em branco', () => {
    expect(enderecoDaEtiqueta(base)).toBe('');
    expect(enderecoDaEtiqueta({ ...base, localizacao: '   ' })).toBe('');
  });
});

describe('layout da etiqueta', () => {
  it('gera a etiqueta com nome longo e endereço Rational', () => {
    // Nome real do cadastro, dos mais compridos que aparecem.
    const doc = buildEtiquetasPdf([{
      nome: 'FORNO COMBINADO UNOX CHEFTOP MIND.MAPS ONE - 10 GN 1/1 - ELÉTRICO -',
      codigo: '2009040525809',
      barcodeValue: '2009040525809',
      localizacaoRational: 'A12',
      copies: 1,
    }]);
    expect(doc.getNumberOfPages()).toBe(1);
  });
});

/**
 * Decodifica a sequência de volta para texto, seguindo as trocas de
 * subconjunto. Serve para provar que o codificador não está gerando um símbolo
 * que o leitor consegue ler mas que significa outra coisa — falha pior que
 * não ler.
 */
function decodificar(values: number[]): string {
  const corpo = values.slice(0, -2); // tira checksum e stop
  let emC = corpo[0] === 105;
  let saida = '';
  for (const v of corpo.slice(1)) {
    if (v === 99) { emC = true; continue; }
    if (v === 100) { emC = false; continue; }
    saida += emC ? String(v).padStart(2, '0') : String.fromCharCode(v + 32);
  }
  return saida;
}

describe('encodeCode128 — subconjuntos B e C', () => {
  const casos = ['2059144081848', '124654', 'KVM1319A', '50.01.050S', '7891234560001', '9', '12', 'A1B2C3'];

  it.each(casos)('ida e volta preserva %s', (codigo) => {
    expect(decodificar(encodeCode128(codigo))).toBe(codigo);
  });

  it('o checksum fecha pela fórmula posicional', () => {
    for (const codigo of casos) {
      const v = encodeCode128(codigo);
      const corpo = v.slice(0, -2);
      let soma = corpo[0];
      for (let i = 1; i < corpo.length; i++) soma += corpo[i] * i;
      expect(v[v.length - 2]).toBe(soma % 103);
      expect(v[v.length - 1]).toBe(106);
    }
  });

  it('encurta o código numérico pela metade — era o que não deixava ler', () => {
    // 13 dígitos só no subconjunto B davam 178 módulos: 89 mm numa etiqueta de
    // 110 mm, de ponta a ponta. Pelo C caem para 123, cerca de 61 mm.
    expect(code128Bars(encodeCode128B('2059144081848')).totalModules).toBe(178);
    expect(code128Bars(encodeCode128('2059144081848')).totalModules).toBe(123);
  });

  it('não troca de subconjunto quando não compensa', () => {
    // Corrida curta de dígitos: o símbolo de troca custa mais do que economiza.
    expect(encodeCode128('AB12CD')).not.toContain(99);
  });

  it('começa em C quando o código é todo numérico', () => {
    expect(encodeCode128('124654')[0]).toBe(105);
    expect(encodeCode128('KVM1319A')[0]).toBe(104);
  });
});
