import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useCheckoutStore } from '@/store/checkoutStore';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { UserPlus, Trash2, Shield, ShieldOff, Loader2, Users, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { logSystemAction } from '@/lib/systemLog';

interface UserEntry {
  id: string;
  name: string;
  email: string;
  roles: string[];
  gc_usuario_id: string | null;
  created_at: string;
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState<string>('user');
  const [newGcId, setNewGcId] = useState('');
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Edit state
  const [editOpen, setEditOpen] = useState(false);
  const [editUser, setEditUser] = useState<UserEntry | null>(null);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [editGcId, setEditGcId] = useState('');
  const [saving, setSaving] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const setConfig = useCheckoutStore(s => s.setConfig);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setCurrentUserId(data.user?.id ?? null));
  }, []);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('admin-users', {
        body: { action: 'list' },
      });
      if (error) throw error;
      setUsers(data.users || []);
    } catch (err) {
      toast.error('Erro ao carregar usuários');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const handleCreate = async () => {
    if (!newEmail || !newPassword || !newName) {
      toast.error('Preencha todos os campos');
      return;
    }
    setCreating(true);
    try {
      const { data, error } = await supabase.functions.invoke('admin-users', {
        body: { action: 'create', email: newEmail, password: newPassword, name: newName, role: newRole, gc_usuario_id: newGcId || undefined },
      });
      if (error) throw error;
      if (data.error) throw new Error(data.error);
      toast.success(`Usuário ${newName} criado!`);
      setCreateOpen(false);
      setNewEmail('');
      setNewPassword('');
      setNewName('');
      setNewRole('user');
      setNewGcId('');
      fetchUsers();
    } catch (err: any) {
      toast.error(err.message || 'Erro ao criar usuário');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (userId: string, name: string) => {
    if (!confirm(`Tem certeza que deseja excluir ${name}? Esta ação não pode ser desfeita.`)) return;
    setDeletingId(userId);
    try {
      const { data, error } = await supabase.functions.invoke('admin-users', {
        body: { action: 'delete', userId },
      });
      if (error) throw error;
      if (data.error) throw new Error(data.error);
      toast.success(`${name} removido`);
      fetchUsers();
    } catch (err: any) {
      toast.error(err.message || 'Erro ao excluir');
    } finally {
      setDeletingId(null);
    }
  };

  const handleToggleAdmin = async (userId: string) => {
    try {
      const { data, error } = await supabase.functions.invoke('admin-users', {
        body: { action: 'toggle_admin', userId },
      });
      if (error) throw error;
      if (data.error) throw new Error(data.error);
      toast.success('Permissão atualizada');
      fetchUsers();
    } catch (err: any) {
      toast.error(err.message || 'Erro ao atualizar permissão');
    }
  };

  const openEdit = (u: UserEntry) => {
    setEditUser(u);
    setEditName(u.name);
    setEditEmail(u.email);
    setEditGcId(u.gc_usuario_id || '');
    setEditPassword('');
    setEditOpen(true);
  };

  const handleUpdate = async () => {
    if (!editUser) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = { action: 'update', userId: editUser.id };
      if (editName !== editUser.name) body.name = editName;
      if (editEmail !== editUser.email) body.email = editEmail;
      if (editGcId !== (editUser.gc_usuario_id || '')) body.gc_usuario_id = editGcId;
      if (editPassword) body.password = editPassword;

      const { data, error } = await supabase.functions.invoke('admin-users', { body });
      if (error) throw error;
      if (data.error) throw new Error(data.error);
      toast.success('Usuário atualizado');
      if (editUser.id === currentUserId) {
        setConfig({ operatorName: editName, gcUsuarioId: editGcId });
      }
      setEditOpen(false);
      fetchUsers();
    } catch (err: any) {
      toast.error(err.message || 'Erro ao atualizar');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Users className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold text-foreground">Gerenciar Usuários</h1>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-2">
          <UserPlus className="h-4 w-4" /> Novo Usuário
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-3">
          {users.map(u => (
            <Card key={u.id} className="p-4">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground">{u.name}</span>
                    {u.roles.includes('admin') && (
                      <Badge className="bg-primary text-primary-foreground text-xs">Admin</Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">{u.email}</p>
                  {u.gc_usuario_id && (
                    <p className="text-xs text-muted-foreground">GC ID: {u.gc_usuario_id}</p>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openEdit(u)}
                    title="Editar"
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  {u.id !== currentUserId && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleToggleAdmin(u.id)}
                      title={u.roles.includes('admin') ? 'Remover admin' : 'Tornar admin'}
                    >
                      {u.roles.includes('admin') ? (
                        <ShieldOff className="h-4 w-4" />
                      ) : (
                        <Shield className="h-4 w-4" />
                      )}
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => handleDelete(u.id, u.name)}
                    disabled={deletingId === u.id}
                  >
                    {deletingId === u.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
            </Card>
          ))}
          {users.length === 0 && (
            <p className="text-center text-muted-foreground py-8">Nenhum usuário cadastrado</p>
          )}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Novo Usuário</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Nome do operador" />
            </div>
            <div className="space-y-2">
              <Label>E-mail</Label>
              <Input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="email@empresa.com" />
            </div>
            <div className="space-y-2">
              <Label>Senha</Label>
              <Input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="Senha de acesso" />
            </div>
            <div className="space-y-2">
              <Label>Tipo</Label>
              <Select value={newRole} onValueChange={setNewRole}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">Operador</SelectItem>
                  <SelectItem value="admin">Administrador</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>ID Usuário GestãoClick</Label>
              <Input value={newGcId} onChange={e => setNewGcId(e.target.value)} placeholder="Ex: 1028512 (GET /api/usuarios)" />
              <p className="text-xs text-muted-foreground">ID do usuário no GC para atribuir mudanças de situação</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancelar</Button>
            <Button onClick={handleCreate} disabled={creating} className="gap-2">
              {creating && <Loader2 className="h-4 w-4 animate-spin" />}
              Criar Usuário
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Editar Usuário</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input value={editName} onChange={e => setEditName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>E-mail</Label>
              <Input type="email" value={editEmail} onChange={e => setEditEmail(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Nova Senha (deixe em branco para manter)</Label>
              <Input type="password" value={editPassword} onChange={e => setEditPassword(e.target.value)} placeholder="••••••••" />
            </div>
            <div className="space-y-2">
              <Label>ID Usuário GestãoClick</Label>
              <Input value={editGcId} onChange={e => setEditGcId(e.target.value)} placeholder="Ex: 1028512" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancelar</Button>
            <Button onClick={handleUpdate} disabled={saving} className="gap-2">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
