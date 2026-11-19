import '../src/server/env';
import { supabaseAdmin } from '../src/server/supabaseAdmin';

(async () => {
  const { data, error } = await supabaseAdmin.from('outlets').select('*').order('name');
  if (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
  console.log(`Found ${data?.length || 0} outlet(s):`);
  for (const o of data || []) {
    console.log(`  - ${o.name} | ${o.type} | ${o.is_active ? 'active' : 'inactive'}`);
  }
})();
