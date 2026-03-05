import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { User } from '@supabase/supabase-js';

interface AuthState {
  user: User | null;
  profile: { name: string } | null;
  isAdmin: boolean;
  loading: boolean;
}

export function useAuth(): AuthState {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<{ name: string } | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Listen for auth changes FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        const u = session?.user ?? null;
        setUser(u);

        if (u) {
          // Fetch profile and roles with setTimeout to avoid deadlock
          setTimeout(async () => {
            const { data: profileData } = await supabase
              .from('profiles')
              .select('name')
              .eq('id', u.id)
              .maybeSingle();
            setProfile(profileData);

            const { data: roleData } = await supabase
              .from('user_roles')
              .select('role')
              .eq('user_id', u.id);
            setIsAdmin(roleData?.some(r => r.role === 'admin') ?? false);
            setLoading(false);
          }, 0);
        } else {
          setProfile(null);
          setIsAdmin(false);
          setLoading(false);
        }
      }
    );

    // Then check existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      const u = session?.user ?? null;
      setUser(u);
      if (!u) setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  return { user, profile, isAdmin, loading };
}
