// Balance sync: confirmed withdrawal and execution statuses (2026-09-14).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import {
  normalizeBudgetReference,
  newestBalanceOperationByBudget,
  pendingItemsFromBalanceRows,
  readAllBalanceRows,
  type PartialBalanceOperation,
  type PartialWriteoffBalanceRow,
} from "../_shared/partial-writeoff-balances.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-internal-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type BudgetReference = { id: string; code: string };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function sanitizeBudgets(value: unknown): BudgetReference[] {
  if (!Array.isArray(value)) return [];
  const unique = new Map<string, BudgetReference>();
  for (const raw of value.slice(0, 200)) {
    const id = normalizeBudgetReference(raw?.id).slice(0, 80);
    const code = normalizeBudgetReference(raw?.code).slice(0, 80);
    if (!id && !code) continue;
    unique.set(`${id}::${code}`, { id, code });
  }
  return [...unique.values()];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  const expectedToken = Deno.env.get("PARTIAL_BALANCE_SYNC_TOKEN")?.trim();
  if (!expectedToken) return json({ ok: false, error: "INTEGRATION_NOT_CONFIGURED" }, 503);
  if (req.headers.get("x-internal-token")?.trim() !== expectedToken) {
    return json({ ok: false, error: "UNAUTHORIZED" }, 401);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const budgets = sanitizeBudgets(body?.budgets);
    if (budgets.length === 0) return json({ ok: true, balances: [], unmatched: [] });

    const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const ids = [...new Set(budgets.map((budget) => budget.id).filter(Boolean))];
    const codes = [...new Set(budgets.map((budget) => budget.code).filter(Boolean))];

    const queries = [];
    if (ids.length > 0) {
      queries.push(
        service
          .from("partial_writeoff_operations")
          .select("id,budget_id,budget_code,status,updated_at")
          .in("budget_id", ids)
          .order("updated_at", { ascending: false }),
      );
    }
    if (codes.length > 0) {
      queries.push(
        service
          .from("partial_writeoff_operations")
          .select("id,budget_id,budget_code,status,updated_at")
          .in("budget_code", codes)
          .order("updated_at", { ascending: false }),
      );
    }

    const queryResults = await Promise.all(queries);
    const firstError = queryResults.find((result) => result.error)?.error;
    if (firstError) throw firstError;

    const operationsById = new Map<string, PartialBalanceOperation>();
    for (const result of queryResults) {
      for (const operation of (result.data ?? []) as PartialBalanceOperation[])
        operationsById.set(operation.id, operation);
    }
    const operations = newestBalanceOperationByBudget([...operationsById.values()]);
    const operationIds = operations.map((operation) => operation.id);

    let itemRows: PartialWriteoffBalanceRow[] = [];
    if (operationIds.length > 0) {
      itemRows = await readAllBalanceRows(async (from, to) => {
        const { data, error } = await service
          .from("partial_writeoff_item_balances")
          .select(
            "operation_id,line_key,product_id,variation_id,product_name,product_code,unit,original_quantity,withdrawn_quantity,pending_purchase_quantity",
          )
          .in("operation_id", operationIds)
          .order("operation_id")
          .order("line_key")
          .range(from, to);
        if (error) throw error;
        return (data ?? []) as PartialWriteoffBalanceRow[];
      });
    }

    const itemsByOperation = new Map<string, PartialWriteoffBalanceRow[]>();
    for (const item of itemRows) {
      const current = itemsByOperation.get(item.operation_id) ?? [];
      current.push(item);
      itemsByOperation.set(item.operation_id, current);
    }

    const balances = operations.map((operation) => ({
      budget_id: normalizeBudgetReference(operation.budget_id),
      budget_code: normalizeBudgetReference(operation.budget_code),
      operation_status: operation.status,
      updated_at: operation.updated_at,
      items: pendingItemsFromBalanceRows(itemsByOperation.get(operation.id) ?? []),
    }));
    const matchedIds = new Set(balances.map((balance) => balance.budget_id).filter(Boolean));
    const matchedCodes = new Set(balances.map((balance) => balance.budget_code).filter(Boolean));
    const unmatched = budgets.filter(
      (budget) => !(budget.id && matchedIds.has(budget.id)) && !(budget.code && matchedCodes.has(budget.code)),
    );

    console.log(`[partial-writeoff-balances] ${balances.length}/${budgets.length} orçamento(s) localizado(s)`);
    return json({ ok: true, balances, unmatched });
  } catch (error) {
    console.error("[partial-writeoff-balances] consulta falhou", error);
    return json({ ok: false, error: "BALANCE_QUERY_FAILED" }, 500);
  }
});
