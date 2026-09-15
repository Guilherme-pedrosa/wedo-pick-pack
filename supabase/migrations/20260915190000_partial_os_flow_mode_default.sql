-- OS de baixa parcial segue o rito normal de qualquer OS (PEDIDO EM CONFERÊNCIA → Checkout →
-- PEDIDO CONFERIDO AGUARDANDO EXECUÇÃO → retirada → execução). O modo 'reservation' ficou
-- restrito a vendas em 20260915153000; o default da coluna acompanha a RPC
-- partial_writeoff_open_operation para que nenhum INSERT direto crie OS em modo de reserva.
-- Não altera o histórico: flow_mode antigo também distingue escolhas Auvo legadas.
ALTER TABLE public.partial_writeoff_operations ALTER COLUMN flow_mode SET DEFAULT 'partial_execution';
