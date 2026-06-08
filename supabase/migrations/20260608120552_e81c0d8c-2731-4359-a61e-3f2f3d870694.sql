DROP POLICY IF EXISTS "Authenticated users can update own separations" ON public.separations;

CREATE POLICY "Authenticated users can update separations"
ON public.separations FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);