
-- Drop the restrictive update policy
DROP POLICY IF EXISTS "Users can update own boxes" ON public.boxes;

-- Create a new policy allowing any authenticated user to update any box
CREATE POLICY "Authenticated users can update boxes" ON public.boxes
FOR UPDATE TO authenticated
USING (true)
WITH CHECK (true);
