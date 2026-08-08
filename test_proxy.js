const { createClient } = require('@supabase/supabase-js');

async function test() {
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
  );

  const { data, error } = await supabase.functions.invoke('gc-proxy', {
    body: { path: '/api/ordens_servicos/386472015' }
  });

  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log('Proxy Response Keys:', Object.keys(data));
  console.log('Proxy Status:', data._proxy);
  if (data.data) {
     console.log('OS Data ID:', data.data.id);
     console.log('OS Data Codigo:', data.data.codigo);
     console.log('OS Products count:', data.data.produtos ? data.data.produtos.length : 0);
  } else {
     console.log('No data field in response');
     console.log('Keys in body:', Object.keys(data));
  }
}

test();
