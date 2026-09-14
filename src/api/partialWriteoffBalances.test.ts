import { describe, expect, it, vi } from "vitest";
import {
  newestBalanceOperationByBudget,
  pendingItemsFromBalanceRows,
  readAllBalanceRows,
  type PartialBalanceOperation,
  type PartialWriteoffBalanceRow,
} from "../../supabase/functions/_shared/partial-writeoff-balances";

describe("saldo de baixa parcial compartilhado", () => {
  const operation = (overrides: Partial<PartialBalanceOperation> = {}): PartialBalanceOperation => ({
    id: "operation-5332",
    budget_id: "366134940",
    budget_code: "5332",
    status: "awaiting_execution",
    updated_at: "2026-09-14T20:30:56Z",
    ...overrides,
  });

  it.each(["awaiting_execution", "completed"])("localiza saldo zerado em %s sem confundir com orçamento ausente", status => {
    const operations = newestBalanceOperationByBudget([operation({ status })]);
    expect(operations).toHaveLength(1);
    expect(operations[0].budget_code).toBe("5332");
    expect(pendingItemsFromBalanceRows([{
      operation_id: operations[0].id,
      line_key: "linha-1",
      product_id: "10",
      variation_id: null,
      product_name: "Peça já retirada",
      product_code: "P10",
      unit: "UN",
      original_quantity: 4,
      withdrawn_quantity: 4,
      pending_purchase_quantity: 0,
    }])).toEqual([]);
  });

  it("não ressuscita saldo antigo quando a operação mais recente aguarda execução", () => {
    const current = operation();
    const previous = operation({ id: "anterior", status: "awaiting_balance", updated_at: "2026-08-23T13:19:07Z" });
    expect(newestBalanceOperationByBudget([previous, current, current])).toEqual([current]);
  });

  it("exclui operações canceladas e mantém orçamento ausente sem saldo inventado", () => {
    expect(newestBalanceOperationByBudget([operation({ budget_code: "6082", status: "cancelled" })])).toEqual([]);
    expect(newestBalanceOperationByBudget([])).toEqual([]);
  });

  it("não reutiliza saldo encerrado de um ciclo antigo após cancelamento do ciclo mais recente", () => {
    const completed = operation({ id: "ciclo-anterior", status: "completed", updated_at: "2026-08-23T13:19:07Z" });
    const cancelled = operation({ id: "ciclo-atual", status: "cancelled" });
    expect(newestBalanceOperationByBudget([completed, cancelled])).toEqual([]);
  });

  it("permite ciclo novo em andamento após um cancelamento anterior", () => {
    const cancelled = operation({ id: "cancelada-anterior", status: "cancelled", updated_at: "2026-08-23T13:19:07Z" });
    const current = operation({ status: "awaiting_balance" });
    expect(newestBalanceOperationByBudget([current, cancelled])).toEqual([current]);
  });

  it("lê o saldo das operações após a primeira página antes de declarar peças encerradas", async () => {
    const rows: PartialWriteoffBalanceRow[] = Array.from({ length: 3 }, (_, index) => ({
      operation_id: `op-${index}`,
      line_key: `linha-${index}`,
      product_id: String(index),
      variation_id: null,
      product_name: "Peça",
      product_code: "",
      unit: "UN",
      original_quantity: 1,
      withdrawn_quantity: index < 2 ? 1 : 0,
      pending_purchase_quantity: index < 2 ? 0 : 1,
    }));
    const fetchPage = vi.fn(async (from: number, to: number) => rows.slice(from, to + 1));
    const allRows = await readAllBalanceRows(fetchPage, 2);
    expect(fetchPage.mock.calls).toEqual([[0, 1], [2, 3]]);
    expect(pendingItemsFromBalanceRows(allRows)).toMatchObject([{ product_id: "2", pending_quantity: 1 }]);
  });

  it("propaga falha de página sem devolver saldo parcial como completo", async () => {
    await expect(readAllBalanceRows(async () => { throw new Error("falha de consulta"); })).rejects.toThrow("falha de consulta");
  });

  it("remove itens totalmente baixados e preserva somente o saldo confirmado", () => {
    const items = pendingItemsFromBalanceRows([
      {
        operation_id: "op-1",
        line_key: "linha-1",
        product_id: "10",
        variation_id: "",
        product_name: "Item completo",
        product_code: "P10",
        unit: "UN",
        original_quantity: 1,
        withdrawn_quantity: 1,
        pending_purchase_quantity: 0,
      },
      {
        operation_id: "op-1",
        line_key: "linha-2",
        product_id: "20",
        variation_id: "v1",
        product_name: "Item parcial",
        product_code: "P20",
        unit: "UN",
        original_quantity: 3,
        withdrawn_quantity: 2,
        pending_purchase_quantity: 1,
      },
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      product_id: "20",
      variation_id: "v1",
      original_quantity: 3,
      withdrawn_quantity: 2,
      pending_quantity: 1,
    });
  });

  it("não desconta quantidade apenas reservada", () => {
    const items = pendingItemsFromBalanceRows([{
      operation_id: "op-1",
      line_key: "linha-1",
      product_id: "10",
      variation_id: null,
      product_name: "Item reservado",
      product_code: "P10",
      unit: "UN",
      original_quantity: 4,
      withdrawn_quantity: 1,
      pending_purchase_quantity: 3,
    }]);

    expect(items[0].pending_quantity).toBe(3);
  });
});
