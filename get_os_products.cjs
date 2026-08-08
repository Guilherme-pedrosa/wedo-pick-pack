const { createClient } = require('@supabase/supabase-js');

async function test() {
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
  );

  const { data, error } = await supabase.functions.invoke('gc-proxy', {
    body: { path: '/api/ordens_servicos/386612144' }
  });

  if (error) {
    console.error('Error:', error);
    return;
  }
  
  if (data.data && data.data.produtos) {
    console.log('OS 386612144 Products:');
    data.data.produtos.forEach(p => {
      console.log(`- [${p.codigo}] ${p.nome_produto} (ID: ${p.produto_id})`);
    });
  } else {
    console.log('No products found in OS response.');
  }
}

test();
