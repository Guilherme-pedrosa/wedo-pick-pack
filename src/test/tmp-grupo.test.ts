import { describe, it } from 'vitest';
import { analyzeGrupo, DEFAULT_DESLOCAMENTO, defaultExtras } from '@/api/orcamentoAnalysis';

const cfg: any = { impostoPct: 14, custoFixoPct: 5, garantiaPct: 2, margemMinima: 19, margemMeta: 30, custoPorKm: 1.05, alimentacaoDia: 50, moAdminHora: 40, moAdminHorasPadrao: 1, premiacaoPecaPct: 3, premiacaoServicoPct: 5, cdbAnualPct: 12 };
const orc = {
  id: '1', codigo: '1', nome_cliente: 'HOTELARIA', valor_total: '10000,00',
  produtos: [{ produto: { nome_produto: 'peca', quantidade: '1', valor_venda: '4000,00', valor_custo: '2000,00' } }],
  servicos: [{ servico: { nome_servico: 'MO', quantidade: '1', valor_venda: '6000,00', valor_custo: '3000,00' } }],
};
describe('x', () => { it('y', () => {
  const e = defaultExtras(cfg);
  const a = analyzeGrupo([orc], cfg, DEFAULT_DESLOCAMENTO, e, {});
  const b = analyzeGrupo([orc], cfg, DEFAULT_DESLOCAMENTO, e, { custoServicos: 0 });
  console.log('base', a.custoServicos, a.custoTotal, a.receitaLiquida, a.margemLiquidaPct);
  console.log('zero', b.custoServicos, b.custoTotal, b.receitaLiquida, b.margemLiquidaPct);
}); });
