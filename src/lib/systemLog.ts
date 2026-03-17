import { supabase } from "@/integrations/supabase/client";

export interface SystemLogParams {
  module: string;
  action: string;
  entityType?: string;
  entityId?: string;
  entityName?: string;
  details?: Record<string, unknown>;
}

let cachedUserInfo: { id: string; name: string } | null = null;

async function getUserInfo(): Promise<{ id: string; name: string } | null> {
  if (cachedUserInfo) return cachedUserInfo;
  
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  let name = user.email || "";
  const { data: prof } = await supabase
    .from("profiles")
    .select("name")
    .eq("id", user.id)
    .single();
  if (prof) name = prof.name;

  cachedUserInfo = { id: user.id, name };
  return cachedUserInfo;
}

// Clear cache on auth changes
supabase.auth.onAuthStateChange(() => {
  cachedUserInfo = null;
});

export async function logSystemAction(params: SystemLogParams) {
  try {
    const info = await getUserInfo();
    if (!info) return;

    await supabase.from("system_logs" as any).insert({
      user_id: info.id,
      user_name: info.name,
      module: params.module,
      action: params.action,
      entity_type: params.entityType || null,
      entity_id: params.entityId || null,
      entity_name: params.entityName || null,
      details: params.details || null,
    });
  } catch (e) {
    console.error("Failed to log system action:", e);
  }
}
