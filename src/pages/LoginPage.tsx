import { useState } from 'react';
import { useCheckoutStore } from '@/store/checkoutStore';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { PackageCheck, LogIn } from 'lucide-react';
import { toast } from 'sonner';

export default function LoginPage() {
  const config = useCheckoutStore(s => s.config);
  const login = useCheckoutStore(s => s.login);

  const [name, setName] = useState('');
  const [password, setPassword] = useState('');

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      toast.error('Digite seu nome');
      return;
    }

    if (!config.accessPassword) {
      // No password configured — just login with name
      login(name.trim());
      toast.success(`Bem-vindo, ${name.trim()}!`);
      return;
    }

    if (password !== config.accessPassword) {
      toast.error('Senha incorreta');
      return;
    }

    login(name.trim());
    toast.success(`Bem-vindo, ${name.trim()}!`);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm p-8 space-y-6">
        <div className="text-center space-y-2">
          <PackageCheck className="h-12 w-12 text-primary mx-auto" />
          <h1 className="text-2xl font-bold text-foreground">WeDo Checkout</h1>
          <p className="text-sm text-muted-foreground">Identifique-se para iniciar</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="operator-name">Nome do operador</Label>
            <Input
              id="operator-name"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Seu nome"
              autoFocus
              autoComplete="off"
            />
          </div>

          {config.accessPassword && (
            <div className="space-y-2">
              <Label htmlFor="access-password">Senha de acesso</Label>
              <Input
                id="access-password"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Digite a senha"
              />
            </div>
          )}

          <Button type="submit" className="w-full gap-2">
            <LogIn className="h-4 w-4" /> Entrar
          </Button>
        </form>
      </Card>
    </div>
  );
}
