import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { User } from '@supabase/supabase-js';

interface UserProfile {
  name: string;
  gc_usuario_id?: string | null;
  os_status_to_show?: string[] | null;
  venda_status_to_show?: string[] | null;
  default_os_conclusion_status?: string | null;
  default_venda_conclusion_status?: string | null;
}

interface AuthState {
  user: User | null;
  profile: UserProfile | null;
  isAdmin: boolean;
  loading: boolean;
}

export function useAuth(): AuthState {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        const u = session?.user ?? null;
        setUser(u);

        if (u) {
          setTimeout(async () => {
            try {
              const { data: profileData } = await supabase
                .from('profiles')
                .select('name, gc_usuario_id, os_status_to_show, venda_status_to_show, default_os_conclusion_status, default_venda_conclusion_status')
                .eq('id', u.id)
                .maybeSingle();

              setProfile((profileData as UserProfile | null) ?? null);

              const { data: roleData } = await supabase
                .from('user_roles')
                .select('role')
                .eq('user_id', u.id);

              setIsAdmin(roleData?.some(r => r.role === 'admin') ?? false);
            } catch (err) {
              console.error('Error fetching profile/roles:', err);
              setProfile(null);
              setIsAdmin(false);
            } finally {
              setLoading(false);
            }
          }, 0);
        } else {
          setProfile(null);
          setIsAdmin(false);
          setLoading(false);
        }
      }
    );

    supabase.auth.getSession().then(({ data: { session } }) => {
      const u = session?.user ?? null;
      setUser(u);
      if (!u) setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  return { user, profile, isAdmin, loading };
}
