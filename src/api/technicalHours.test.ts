import { describe, expect, it } from 'vitest';
import { budgetTechnicalHours, withMissingTechnicalHours } from '../../supabase/functions/_shared/technicalHours';

const budget = { servicos: [{ servico: { nome_servico: 'HORA TECNICA A', quantidade: '8.0000', valor_venda: '235.0000' } }] };
describe('HORAS TÉCNICAS das OS parciais', () => {
  it('usa as 8 horas do orçamento sem inserir serviços nem alterar a origem', () => {
    const sourceBefore = structuredClone(budget);
    const document = { produtos: [{ produto: { produto_id: '1', quantidade: '3' } }], atributos: [{ atributo: { atributo_id: '81831', conteudo: '6277' } }] };
    const result = withMissingTechnicalHours(document, budget);
    expect(result.atributos).toEqual([...document.atributos, { atributo: { atributo_id: '73897', conteudo: '8' } }]);
    expect(result.produtos).toEqual(document.produtos);
    expect(result.servicos).toBeUndefined();
    expect(document.atributos).toHaveLength(1);
    expect(budget).toEqual(sourceBefore);
  });
  it('mantém um valor manual diferente das horas do orçamento', () => {
    const document = { atributos: [{ atributo: { atributo_id: '73897', conteudo: '26' } }] };
    expect(withMissingTechnicalHours(document, budget)).toBe(document);
  });
  it('prioriza o atributo explícito e soma apenas linhas de horas quando ele falta', () => {
    expect(budgetTechnicalHours({ ...budget, atributos: [{ atributo: { atributo_id: '67350', conteudo: '12' } }] })).toBe('12');
    expect(budgetTechnicalHours({ servicos: [...budget.servicos,
      { servico: { nome_servico: 'INSTALAÇÃO TÉCNICA (HORA HOMEM)', quantidade: '1,5' } },
      { servico: { nome_servico: 'MANUTENÇÃO', quantidade: '50' } },
    ] })).toBe('9.5');
  });
  it('não inventa horas a partir de serviços sem unidade conhecida', () => {
    expect(() => withMissingTechnicalHours({}, { servicos: [{ servico: { nome_servico: 'MANUTENÇÃO', quantidade: '1' } }] })).toThrow('não informa esse valor');
  });
});
