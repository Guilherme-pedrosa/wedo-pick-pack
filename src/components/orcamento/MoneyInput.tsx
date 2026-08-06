import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const format = (v: number) =>
  v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Converte o texto digitado (pt-BR) em número. Retorna null quando o campo está vazio. */
export function parseMoneyInput(text: string): number | null {
  const cleaned = text.replace(/[^\d,.-]/g, "");
  if (!cleaned.trim()) return null;
  const normalized = cleaned.replace(/\./g, "").replace(",", ".");
  const parsed = parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

interface MoneyInputProps {
  value: number;
  onValueChange: (value: number) => void;
  ariaLabel?: string;
  edited?: boolean;
  className?: string;
}

/**
 * Campo monetário controlado por texto enquanto está em foco — permite apagar
 * o conteúdo e digitar livremente — e formatado em pt-BR ao sair do campo.
 */
export function MoneyInput({ value, onValueChange, ariaLabel, edited, className }: MoneyInputProps) {
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    if (text === null) return;
    // mantém o texto local enquanto o usuário edita
  }, [value, text]);

  return (
    <Input
      inputMode="decimal"
      aria-label={ariaLabel}
      className={cn(
        "h-7 w-28 border-transparent bg-transparent px-1 text-right tabular-nums hover:border-input focus:border-input",
        edited && "border-primary/60 font-medium",
        className,
      )}
      value={text ?? format(value)}
      onFocus={(e) => {
        setText(format(value));
        requestAnimationFrame(() => e.target.select());
      }}
      onChange={(e) => {
        const next = e.target.value;
        setText(next);
        const parsed = parseMoneyInput(next);
        onValueChange(parsed ?? 0);
      }}
      onBlur={() => setText(null)}
    />
  );
}
