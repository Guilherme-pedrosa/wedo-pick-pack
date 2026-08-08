const { createClient } = require('@supabase/supabase-js');

async function test() {
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
  );

  console.log('Triggering sync for OS situation 7684665...');
  // Find which task index corresponds to OS + 7684665
  // Usually OS comes after Vendas.
  // Let's just try taskIndex 10 or so, or better, just pass the situation we want if the code allowed it.
  // Actually, the code iterates based on tasks[taskIndex].
  // I will call it with taskIndex 0 to see what task it is.
  
  const { data, error } = await supabase.functions.invoke('inventory-consumption-sync', {
    body: { cursor: { taskIndex: 13, page: 1, stats: { os_seen: 0, vendas_seen: 0, os_debited: 0, vendas_debited: 0, pecas_created: 0, skipped: 0, errors: 0 } } }
  });

  if (error) {
    console.error('Error:', error);
    return;
  }
  
  console.log('Next task should be shown in response or inferred.');
  console.log('Data:', JSON.stringify(data, null, 2));
}

test();
