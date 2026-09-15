import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { NORMAL_OS_CREATION_STATUS_ID, partialAuxiliaryCreationStatus } from '../../supabase/functions/_shared/osRite';
import { technicianReleaseStatus } from './technicianRelease';

const read = (rel: string) => fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8');
const AGUARDANDO_EXECUCAO = { id: '7063705', name: 'PEDIDO CONFERIDO AGUARDANDO EXECUÇÃO' };

describe('rito da OS de baixa parcial — mesma situação de qualquer OS', () => {
  it('OS auxiliar nasce em PEDIDO EM CONFERÊNCIA (7063581), igual ao generate-os, ignorando settings e flow_mode', () => {
    expect(partialAuxiliaryCreationStatus('os', { venda_waiting_status_id: 'outra' })).toBe('7063581');
    expect(partialAuxiliaryCreationStatus('os', { venda_waiting_status_id: '7347355' })).toBe('7063581');
    expect(partialAuxiliaryCreationStatus('os', null)).toBe('7063581');
    const generateOs = read('supabase/functions/generate-os/index.ts');
    expect(generateOs).toMatch(/os:\s*\{[^}]*documentStatusId:\s*"7063581"/);
    expect(NORMAL_OS_CREATION_STATUS_ID).toBe('7063581');
  });

  it('venda auxiliar continua usando a situação configurada e falha sem configuração', () => {
    expect(partialAuxiliaryCreationStatus('venda', { venda_waiting_status_id: '8955109' })).toBe('8955109');
    expect(() => partialAuxiliaryCreationStatus('venda', { venda_waiting_status_id: '' })).toThrow('PARTIAL_STATUS_NOT_CONFIGURED');
  });

  it('cliente e edge criam o auxiliar pela mesma regra, e a OS definitiva nasce pela constante do rito', () => {
    const client = read('src/api/partialWriteoffClient.ts');
    const edge = read('supabase/functions/partial-writeoff/index.ts');
    const consolidation = read('supabase/functions/_shared/partialConsolidation.ts');
    expect(client).toMatch(/partialAuxiliaryCreationStatus\(operation\.document_type, settings\)/);
    expect(edge).toMatch(/partialAuxiliaryCreationStatus\(operation\.document_type, settings\)/);
    expect(consolidation).toMatch(/definitivePayload\(operation, budget, auxiliaries, attrs, NORMAL_OS_CREATION_STATUS_ID/);
    expect(consolidation).not.toMatch(/definitivePayload\([^)]*settings\.os_waiting_status_id/);
  });

  it('a edge antiga continua bloqueada para mover documentos, e o consolidate legado recusa OS', () => {
    const edge = read('supabase/functions/partial-writeoff/index.ts');
    expect(edge).toMatch(/\["open_operation", "prepare_batch", "confirm_batch", "consolidate"\]\.includes\(action\)/);
    const consolidate = edge.slice(edge.indexOf('async function handleConsolidate('));
    expect(consolidate.slice(0, 600)).toMatch(/document_type === "os"\) throw new Error\("OS_CONSOLIDATION_VIA_WORKER"\)/);
  });
});

describe('desvincular técnico devolve a OS a uma situação de espera do rito', () => {
  it('mantém o alvo do Checkout quando ele é uma situação de OS de "aguardando"', () => {
    expect(technicianReleaseStatus({ order_type: 'os', target_status_id: '7063705', target_status_name: 'PEDIDO CONFERIDO AGUARDANDO EXECUÇÃO' }))
      .toEqual(AGUARDANDO_EXECUCAO);
    expect(technicianReleaseStatus({ order_type: 'os', target_status_id: '7213493', target_status_name: 'SERVIÇO AGUARDANDO EXECUÇÃO' }).id).toBe('7213493');
    expect(technicianReleaseStatus({ order_type: 'os', target_status_id: '7748831', target_status_name: '' }).id).toBe('7748831');
  });

  it('marcador interno, situação de venda (7347355), retirada ou vazio caem em PEDIDO CONFERIDO AGUARDANDO EXECUÇÃO', () => {
    for (const target of ['partial:38914c7f-5932-4799-9a02-c2dd602ff2ef', '7347355', '7684665', '', undefined]) {
      expect(technicianReleaseStatus({ order_type: 'os', target_status_id: target, target_status_name: 'Baixa parcial aplicada (somente estoque)' }))
        .toEqual(AGUARDANDO_EXECUCAO);
    }
  });

  it('situação de OS que não é de espera (EXECUTADO, EM ROTA, sem nome conhecido) também cai no aguardando execução', () => {
    expect(technicianReleaseStatus({ order_type: 'os', target_status_id: '7116099', target_status_name: 'EXECUTADO – AG. NEGOCIAÇÃO' })).toEqual(AGUARDANDO_EXECUCAO);
    expect(technicianReleaseStatus({ order_type: 'os', target_status_id: '8219136', target_status_name: 'EM ROTA' })).toEqual(AGUARDANDO_EXECUCAO);
    expect(technicianReleaseStatus({ order_type: 'os', target_status_id: '7340613', target_status_name: 'CANCELADO' })).toEqual(AGUARDANDO_EXECUCAO);
  });

  it('venda não é tocada: volta ao alvo gravado', () => {
    expect(technicianReleaseStatus({ order_type: 'venda', target_status_id: '8955109', target_status_name: 'SEPARADO - AGUARDANDO ENTREGA / DESPACHO' }))
      .toEqual({ id: '8955109', name: 'SEPARADO - AGUARDANDO ENTREGA / DESPACHO' });
  });
});
