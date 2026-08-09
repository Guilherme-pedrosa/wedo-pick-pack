import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Loader2, ArrowLeft, ShoppingCart, ClipboardList } from 'lucide-react';

const formatNumber = (val: any) => {
  const num = parseFloat(String(val));
  return isNaN(num) ? '0' : num.toString();
};

export default function ProductDetailPage() {
  const { productId } = useParams<{ productId: string }>();
  const navigate = useNavigate();

  const { data: product, isLoading: loadingProduct } = useQuery({
    queryKey: ['product-details', productId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products_index')
        .select('*')
        .eq('produto_id', productId)
        .single();
      if (error) throw error;
      
      const payload = data.payload_min_json as any;
      return {
        ...data,
        description: payload?.descricao || 'Sem descrição detalhada.',
        price: parseFloat(payload?.valor_venda || '0'),
        stock: payload?.estoque_atual || 0
      };
    },
    enabled: !!productId
  });

  const { data: salesHistory, isLoading: loadingSales } = useQuery({
    queryKey: ['product-sales', productId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventory_consumption_events')
        .select('*')
        .eq('produto_id', productId)
        .eq('source_type', 'venda')
        .order('occurred_at', { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!productId
  });

  const { data: osHistory, isLoading: loadingOS } = useQuery({
    queryKey: ['product-os', productId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventory_consumption_events')
        .select('*')
        .eq('produto_id', productId)
        .eq('source_type', 'os')
        .order('occurred_at', { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!productId
  });

  if (loadingProduct) {
    return (
      <div className="flex h-[400px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!product) {
    return (
      <div className="p-8 text-center">
        <h2 className="text-xl font-bold">Produto não encontrado</h2>
        <Button variant="ghost" onClick={() => navigate(-1)} className="mt-4">
          Voltar
        </Button>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-2xl font-bold">Detalhes do Produto</h1>
      </div>

      {/* 1. Informações do Produto */}
      <Card>
        <CardHeader>
          <div className="flex justify-between items-start">
            <div>
              <CardTitle className="text-xl font-bold">
                [{product.codigo_interno}] {product.nome}
              </CardTitle>
              <p className="text-sm text-muted-foreground mt-1">ID: {product.produto_id}</p>
            </div>
            <Badge variant={product.stock > 0 ? "secondary" : "destructive"} className="text-sm px-3 py-1">
              Estoque: {product.stock} un
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="grid md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Descrição</h3>
              <p className="mt-1 text-sm leading-relaxed">{product.description}</p>
            </div>
          </div>
          <div className="flex flex-col justify-center items-end bg-muted/30 p-4 rounded-lg border border-border/50">
            <span className="text-sm text-muted-foreground">Preço de Venda</span>
            <span className="text-3xl font-black text-primary">
              {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(product.price)}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Tabs para Históricos */}
      <Tabs defaultValue="vendas" className="w-full">
        <TabsList className="grid w-full grid-cols-2 max-w-[400px]">
          <TabsTrigger value="vendas" className="gap-2">
            <ShoppingCart className="h-4 w-4" /> Vendas
          </TabsTrigger>
          <TabsTrigger value="os" className="gap-2">
            <ClipboardList className="h-4 w-4" /> Ordens de Serviço
          </TabsTrigger>
        </TabsList>

        {/* 2. Histórico de Vendas */}
        <TabsContent value="vendas" className="mt-4">
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead className="text-right">Qtd</TableHead>
                  <TableHead className="text-right">Valor Custo (Ref)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingSales ? (
                  <TableRow><TableCell colSpan={4} className="text-center py-8"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></TableCell></TableRow>
                ) : salesHistory?.length === 0 ? (
                  <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">Nenhuma venda registrada.</TableCell></TableRow>
                ) : salesHistory?.map((sale) => (
                  <TableRow key={sale.id}>
                    <TableCell className="font-medium text-xs">
                      {new Date(sale.occurred_at).toLocaleDateString('pt-BR')}
                    </TableCell>
                    <TableCell className="text-xs">{sale.cliente_nome || 'Consumidor Final'}</TableCell>
                    <TableCell className="text-right font-semibold">{formatNumber(sale.qty)} un</TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">
                      {sale.valor_custo ? `R$ ${parseFloat(String(sale.valor_custo)).toFixed(2)}` : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        {/* 3. Histórico de Ordens de Serviço */}
        <TabsContent value="os" className="mt-4">
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead className="text-right">Qtd Utilizada</TableHead>
                  <TableHead>Nº Documento</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingOS ? (
                  <TableRow><TableCell colSpan={4} className="text-center py-8"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></TableCell></TableRow>
                ) : osHistory?.length === 0 ? (
                  <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">Nenhum consumo em OS registrado.</TableCell></TableRow>
                ) : osHistory?.map((os) => (
                  <TableRow key={os.id}>
                    <TableCell className="font-medium text-xs">
                      {new Date(os.occurred_at).toLocaleDateString('pt-BR')}
                    </TableCell>
                    <TableCell className="text-xs">{os.cliente_nome || '—'}</TableCell>
                    <TableCell className="text-right font-semibold text-blue-600">{formatNumber(os.qty)} un</TableCell>
                    <TableCell className="text-xs font-mono">{os.source_id}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
      </Tabs>

      {/* 4. Botão de Ação */}
      <div className="flex justify-end pt-4 border-t sticky bottom-0 bg-background/80 backdrop-blur-sm pb-4 px-2 z-10">
        <Button 
          size="lg" 
          className="gap-2 shadow-lg"
          onClick={() => navigate('/checkout')}
        >
          <ShoppingCart className="h-5 w-5" />
          Registrar Nova Venda / Saída
        </Button>
      </div>
    </div>
  );
}
