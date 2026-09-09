import { installGcUsuarioId as installCore } from "./gc-user-core.ts";

// Identidade técnica confirmada no GestãoClick; nunca usar o perfil do operador.
export const GC_API_USER_ID = "1320473";

export function installGcUsuarioId() {
  installCore(GC_API_USER_ID);
}

