-- Permite operação compartilhada de maletas entre operadores autenticados
-- (vincular/desvincular técnico, conferência e ajustes de status)
DROP POLICY IF EXISTS "Users can update own toolboxes" ON public.toolboxes;

CREATE POLICY "Authenticated users can update toolboxes"
ON public.toolboxes
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);