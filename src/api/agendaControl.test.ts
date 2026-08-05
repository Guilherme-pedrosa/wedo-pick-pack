import { describe, expect, it } from 'vitest';
import {
  classifyAgendaRow,
  getExecutionTaskIds,
  getOsAttributeValue,
  normalizeFilterText,
  parseTaskIds,
} from './agendaControl';

describe('agendaControl', () => {
  it('extracts only execution task ids from GC attribute 73344', () => {
    expect(getExecutionTaskIds({
      atributos: [
        { atributo: { atributo_id: '73343', conteudo: '111' } },
        { atributo: { atributo_id: '73344', conteudo: '222 / 333' } },
      ],
    })).toEqual(['222', '333']);
  });

  it('does not infer an execution task from text or another attribute', () => {
    expect(getExecutionTaskIds({
      atributos: [{ atributo: { atributo_id: '73343', conteudo: 'OS 999' } }],
    })).toEqual([]);
  });

  it('normalizes and deduplicates task id lists', () => {
    expect(parseTaskIds('12 / 13; 12, inválido')).toEqual(['12', '13']);
  });

  it('reads the local do reparo attribute used by Controle OS filters', () => {
    expect(getOsAttributeValue({
      atributos: [{ atributo: { atributo_id: '68658', conteudo: 'GALPÃO' } }],
    }, '68658')).toBe('GALPÃO');
  });

  it('normalizes accents and spacing for filter comparisons', () => {
    expect(normalizeFilterText('  Em Execução  ')).toBe('em execucao');
  });

  it('classifies scheduling availability without matching customer names', () => {
    expect(classifyAgendaRow({ taskId: null, taskDate: null, technicianId: null, selectedDate: '2026-08-05' })).toBe('no-task');
    expect(classifyAgendaRow({ taskId: '1', taskDate: null, technicianId: null, selectedDate: '2026-08-05' })).toBe('available');
    expect(classifyAgendaRow({ taskId: '1', taskDate: '2026-08-05T09:00:00', technicianId: 7, selectedDate: '2026-08-05' })).toBe('scheduled-date');
    expect(classifyAgendaRow({ taskId: '1', taskDate: '2026-08-06T09:00:00', technicianId: 7, selectedDate: '2026-08-05' })).toBe('other-date');
  });
});
