import assert from "node:assert/strict";
import { test } from "node:test";
import { forceGcApiUserInRequest } from "../supabase/functions/_shared/gc-user-core.ts";

const API_USER = "1320473";
for (const identity of [undefined, null, "", "  ", "1023771"]) {
  test(`REST replaces absent/blank/personal identity: ${String(identity)}`, async () => {
    const query = identity === undefined ? "" : `?usuario_id=${encodeURIComponent(String(identity))}&usuario_id=1023771`;
    const payload = { usuario_id: identity, vendedor_id: "1023771", tecnico_id: "321", cliente_id: "77", produtos: [{ produto_id: "5", quantidade: "2.00" }] };
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const request = await forceGcApiUserInRequest(`https://api.gestaoclick.com/api/vendas/1${query}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }, API_USER);
      assert.deepEqual(new URL(request.url).searchParams.getAll("usuario_id"), [API_USER]);
      assert.deepEqual(await request.json(), { ...payload, usuario_id: API_USER });
    }
    for (const method of ["GET", "HEAD"]) {
      const request = await forceGcApiUserInRequest(`https://api.gestaoclick.com/api/clientes${query}`, { method }, API_USER);
      assert.equal(new URL(request.url).searchParams.get("usuario_id"), API_USER);
    }
  });
}

test("Request/init overrides cannot restore the personal identity", async () => {
  const input = new Request("https://api.gestaoclick.com/api/vendas?usuario_id=1023771", {
    method: "PUT",
    body: JSON.stringify({ usuario_id: "1023771", vendedor_id: "99" }),
  });
  const request = await forceGcApiUserInRequest(input, {
    body: JSON.stringify({ usuario_id: null, vendedor_id: "99" }),
  }, API_USER);
  assert.deepEqual(await request.json(), { usuario_id: API_USER, vendedor_id: "99" });
  assert.equal(new URL(request.url).searchParams.get("usuario_id"), API_USER);
});

test("all direct GC callers install the shared guard", async () => {
  const { readdirSync, readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const base = new URL("../supabase/functions/", import.meta.url);
  const entries = readdirSync(base, { recursive: true }).filter(p => p.endsWith(".ts") && !p.startsWith("_shared"));
  const callers = entries.filter(p => /api\.gestaoclick\.com|GC_ACCESS_TOKEN/.test(readFileSync(new URL(p.replaceAll("\\\\", "/"), base), "utf8")));
  assert.equal(callers.length, 16);
  for (const file of callers) {
    assert.match(readFileSync(new URL(file.replaceAll("\\\\", "/"), base), "utf8"), /installGcUsuarioId\(\);/, file);
  }
});

test("the shared guard protects actual fetch and leaves other services unchanged", async () => {
  const original = globalThis.fetch;
  const captured = [];
  globalThis.fetch = async (input, init) => {
    captured.push(new Request(input, init));
    return new Response("{}");
  };
  try {
    const { installGcUsuarioId } = await import("../supabase/functions/_shared/gc-user.ts");
    installGcUsuarioId();
    await fetch("https://api.gestaoclick.com/api/vendas?usuario_id=", {
      method: "POST", body: JSON.stringify({ usuario_id: "1023771", vendedor_id: "88" }),
    });
    await fetch("https://example.test/task?usuario_id=human", { method: "GET" });
    assert.equal(new URL(captured[0].url).searchParams.get("usuario_id"), API_USER);
    assert.deepEqual(await captured[0].json(), { usuario_id: API_USER, vendedor_id: "88" });
    assert.equal(new URL(captured[1].url).searchParams.get("usuario_id"), "human");
  } finally {
    globalThis.fetch = original;
  }
});

