import { createClient } from '@/lib/supabase/server';

export async function getSections() {
  const supabase = createClient();
  const { data, error } = await supabase.from('sections').select('id, name').order('name');
  return { sections: data ?? [], error };
}
