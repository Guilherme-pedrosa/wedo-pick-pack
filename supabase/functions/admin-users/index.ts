import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.98.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  // Verify caller is authenticated
  const authHeader = req.headers.get('Authorization') || req.headers.get('authorization');
  if (!authHeader) {
    console.error('No authorization header found');
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Validate the JWT token explicitly
  const token = authHeader.replace('Bearer ', '');
  const supabaseUser = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: claimsData, error: claimsError } = await supabaseUser.auth.getClaims(token);
  if (claimsError || !claimsData?.claims?.sub) {
    console.error('JWT validation failed:', claimsError?.message || 'no claims');
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const callerId = claimsData.claims.sub as string;

  // Check if caller is admin
  const { data: isAdmin } = await supabaseAdmin.rpc('has_role', {
    _user_id: callerId,
    _role: 'admin',
  });

  if (!isAdmin) {
    return new Response(JSON.stringify({ error: 'Forbidden: admin role required' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await req.json();
    const { action } = body;

    if (action === 'list') {
      // List all users with profiles and roles
      const { data: profiles, error } = await supabaseAdmin
        .from('profiles')
        .select('id, name, gc_usuario_id, created_at');

      if (error) throw error;

      // Get roles for all users
      const { data: roles } = await supabaseAdmin
        .from('user_roles')
        .select('user_id, role');

      // Get auth user emails
      const { data: { users: authUsers } } = await supabaseAdmin.auth.admin.listUsers();

      const enriched = (profiles || []).map(p => {
        const authUser = authUsers?.find(u => u.id === p.id);
        const userRoles = (roles || []).filter(r => r.user_id === p.id).map(r => r.role);
        return {
          ...p,
          email: authUser?.email || '',
          roles: userRoles,
        };
      });

      return new Response(JSON.stringify({ users: enriched }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'create') {
      const { email, password, name, role, gc_usuario_id } = body;

      if (!email || !password || !name) {
        return new Response(JSON.stringify({ error: 'email, password, and name are required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Create auth user
      const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { name },
      });

      if (createError) throw createError;

      // Update profile with gc_usuario_id if provided
      if (gc_usuario_id && newUser.user) {
        await supabaseAdmin.from('profiles').update({ gc_usuario_id }).eq('id', newUser.user.id);
      }

      // Assign role
      if (role && newUser.user) {
        await supabaseAdmin.from('user_roles').insert({
          user_id: newUser.user.id,
          role: role,
        });
      }

      return new Response(JSON.stringify({ user: { id: newUser.user?.id, email, name } }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'update') {
      const { userId, name, gc_usuario_id, email, password } = body;
      if (!userId) {
        return new Response(JSON.stringify({ error: 'userId is required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Update profile fields
      const profileUpdate: Record<string, unknown> = {};
      if (name !== undefined) profileUpdate.name = name;
      if (gc_usuario_id !== undefined) profileUpdate.gc_usuario_id = gc_usuario_id || null;
      if (Object.keys(profileUpdate).length > 0) {
        await supabaseAdmin.from('profiles').update(profileUpdate).eq('id', userId);
      }

      // Update auth email/password if provided
      const authUpdate: Record<string, unknown> = {};
      if (email) authUpdate.email = email;
      if (password) authUpdate.password = password;
      if (Object.keys(authUpdate).length > 0) {
        const { error: authErr } = await supabaseAdmin.auth.admin.updateUserById(userId, authUpdate);
        if (authErr) throw authErr;
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'delete') {
      const { userId } = body;
      if (!userId) {
        return new Response(JSON.stringify({ error: 'userId is required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Prevent self-deletion
      if (userId === callerId) {
        return new Response(JSON.stringify({ error: 'Cannot delete yourself' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(userId);
      if (deleteError) throw deleteError;

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'toggle_admin') {
      const { userId } = body;
      if (!userId) {
        return new Response(JSON.stringify({ error: 'userId is required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Prevent self-demotion
      if (userId === callerId) {
        return new Response(JSON.stringify({ error: 'Você não pode alterar sua própria permissão de admin' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Check if user already has admin role
      const { data: existing } = await supabaseAdmin
        .from('user_roles')
        .select('id')
        .eq('user_id', userId)
        .eq('role', 'admin')
        .maybeSingle();

      if (existing) {
        // Remove admin
        await supabaseAdmin.from('user_roles').delete().eq('id', existing.id);
      } else {
        // Add admin
        await supabaseAdmin.from('user_roles').insert({ user_id: userId, role: 'admin' });
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('admin-users error:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
