import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { PackageCheck, Shield, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  onComplete: () => void;
}

export default function SetupPage({ onComplete }: Props) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !email || !password) {
      toast.error('Preencha todos os campos');
      return;
    }
    if (password.length < 6) {
      toast.error('Senha deve ter pelo menos 6 caracteres');
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('setup-admin', {
        body: { email, password, name },
      });
      if (error) throw error;
      if (data.error) throw new Error(data.error);

      toast.success('Admin criado! Fazendo login...');

      // Auto-login
      await supabase.auth.signInWithPassword({ email, password });
      onComplete();
    } catch (err: any) {
      toast.error(err.message || 'Erro ao criar admin');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm p-8 space-y-6">
        <div className="text-center space-y-2">
          <PackageCheck className="h-12 w-12 text-primary mx-auto" />
          <h1 className="text-2xl font-bold text-foreground">WeDo Checkout</h1>
          <div className="flex items-center justify-center gap-2 text-muted-foreground">
            <Shield className="h-4 w-4" />
            <p className="text-sm">Configuração inicial — criar administrador</p>
          </div>
        </div>

        <form onSubmit={handleSetup} className="space-y-4">
          <div className="space-y-2">
            <Label>Nome</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Seu nome" autoFocus />
          </div>
          <div className="space-y-2">
            <Label>E-mail</Label>
            <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="admin@empresa.com" />
          </div>
          <div className="space-y-2">
            <Label>Senha</Label>
            <Input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Mínimo 6 caracteres" />
          </div>

          <Button type="submit" className="w-full gap-2" disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shield className="h-4 w-4" />}
            Criar Administrador
          </Button>
        </form>
      </Card>
    </div>
  );
}
