import { describe, expect, it } from "vitest";
import { pendingItemsFromBalanceRows } from "../../supabase/functions/_shared/partial-writeoff-balances";

describe("saldo de baixa parcial compartilhado", () => {
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
