import { useState, useEffect, useRef, useCallback } from 'react';
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
  const fetchingRef = useRef<string | null>(null);

  const fetchProfileAndRoles = useCallback(async (u: User) => {
    // Deduplicate: skip if we're already fetching for this user
    if (fetchingRef.current === u.id) return;
    fetchingRef.current = u.id;

    try {
      const [profileResult, roleResult] = await Promise.all([
        supabase
          .from('profiles')
          .select('name, gc_usuario_id, os_status_to_show, venda_status_to_show, default_os_conclusion_status, default_venda_conclusion_status')
          .eq('id', u.id)
          .maybeSingle(),
        supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', u.id),
      ]);

      // Only apply if still the current user
      if (fetchingRef.current !== u.id) return;

      setProfile((profileResult.data as UserProfile | null) ?? null);
      setIsAdmin(roleResult.data?.some(r => r.role === 'admin') ?? false);
    } catch (err) {
      console.error('Error fetching profile/roles:', err);
      setProfile(null);
      setIsAdmin(false);
    } finally {
      if (fetchingRef.current === u.id) {
        fetchingRef.current = null;
      }
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (!mounted) return;
        const u = session?.user ?? null;
        setUser(u);

        if (u) {
          // Use setTimeout to avoid Supabase deadlock warning
          setTimeout(() => {
            if (mounted) fetchProfileAndRoles(u);
          }, 0);
        } else {
          fetchingRef.current = null;
          setProfile(null);
          setIsAdmin(false);
          setLoading(false);
        }
      }
    );

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) return;
      const u = session?.user ?? null;
      setUser(u);
      if (!u) setLoading(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [fetchProfileAndRoles]);

  return { user, profile, isAdmin, loading };
}
