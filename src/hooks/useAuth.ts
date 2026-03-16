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

  // Separate refs for dedup vs current-user tracking
  const activeUserIdRef = useRef<string | null>(null);
  const inFlightPromiseRef = useRef<Promise<void> | null>(null);
  const inFlightUserIdRef = useRef<string | null>(null);

  const fetchProfileAndRoles = useCallback(async (u: User): Promise<void> => {
    // If we already have an in-flight fetch for this exact user, reuse it
    if (inFlightUserIdRef.current === u.id && inFlightPromiseRef.current) {
      return inFlightPromiseRef.current;
    }

    activeUserIdRef.current = u.id;
    inFlightUserIdRef.current = u.id;

    const promise = (async () => {
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

        // Only apply if this user is still the active one
        if (activeUserIdRef.current !== u.id) return;

        setProfile((profileResult.data as UserProfile | null) ?? null);
        setIsAdmin(roleResult.data?.some(r => r.role === 'admin') ?? false);
      } catch (err) {
        console.error('[Auth] Error fetching profile/roles:', err);
        if (activeUserIdRef.current === u.id) {
          setProfile(null);
          setIsAdmin(false);
        }
      } finally {
        // Clear in-flight state only if still for this user
        if (inFlightUserIdRef.current === u.id) {
          inFlightUserIdRef.current = null;
          inFlightPromiseRef.current = null;
        }
        if (activeUserIdRef.current === u.id) {
          setLoading(false);
        }
      }
    })();

    inFlightPromiseRef.current = promise;
    return promise;
  }, []);

  useEffect(() => {
    let mounted = true;

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (!mounted) return;

        // Filter: only react to meaningful events
        if (event === 'TOKEN_REFRESHED') {
          // Token refresh doesn't change profile/roles — skip refetch
          return;
        }

        const u = session?.user ?? null;
        setUser(u);

        if (u) {
          // Use setTimeout to avoid Supabase internal deadlock
          setTimeout(() => {
            if (mounted) fetchProfileAndRoles(u);
          }, 0);
        } else {
          activeUserIdRef.current = null;
          inFlightUserIdRef.current = null;
          inFlightPromiseRef.current = null;
          setProfile(null);
          setIsAdmin(false);
          setLoading(false);
        }
      }
    );

    // Proactive initial fetch
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) return;
      const u = session?.user ?? null;
      setUser(u);
      if (u) {
        // Proactively fetch profile — don't wait for onAuthStateChange
        fetchProfileAndRoles(u);
      } else {
        setLoading(false);
      }
    });

    // Safety timeout: if loading is still true after 8s, force it false
    const safetyTimeout = setTimeout(() => {
      if (mounted) {
        setLoading((prev) => {
          if (prev) {
            console.warn('[Auth] Safety timeout: forcing loading=false');
          }
          return false;
        });
      }
    }, 8000);

    return () => {
      mounted = false;
      clearTimeout(safetyTimeout);
      subscription.unsubscribe();
    };
  }, [fetchProfileAndRoles]);

  return { user, profile, isAdmin, loading };
}
