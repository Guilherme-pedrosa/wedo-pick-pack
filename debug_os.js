
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function checkOS(osId) {
  try {
    const { data, error } = await supabase.functions.invoke('gc-proxy', {
      body: { path: `/api/ordens_servicos/${osId}`, method: 'GET' },
    });
    console.log(`OS ${osId} check:`, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error(`OS ${osId} check error:`, err);
  }
}

checkOS('378588370'); // The OS ID for 9756 from the logs
