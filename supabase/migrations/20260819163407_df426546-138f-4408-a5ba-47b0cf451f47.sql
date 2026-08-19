DO $$
BEGIN
  PERFORM public.partial_writeoff_claim_confirmation('117883c4-3b2b-4617-b180-c88cf8c36234');
  PERFORM public.partial_writeoff_finish_confirmation(
    '117883c4-3b2b-4617-b180-c88cf8c36234',
    true,
    NULL,
    NULL,
    'Correcao: OS auxiliar 10098 ja baixada no GestaoClick (Retirada pelo tecnico)'
  );
END $$;