import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PROVINCE } from "@shared/province";

/** Valore riservato del menu per «nessuna provincia»: Radix non accetta la stringa vuota. */
const NESSUNA = "__nessuna__";

/**
 * Menu a tendina delle province italiane per l'anagrafica cliente: il
 * valore è la sigla (due lettere) o la stringa vuota. La sigla finisce in
 * `address_province` della fattura elettronica, dove è obbligatoria.
 */
export default function ProvinciaSelect({
  value,
  onChange,
  ariaLabel = "Provincia",
}: {
  value: string;
  onChange: (sigla: string) => void;
  ariaLabel?: string;
}) {
  return (
    <Select
      value={value || NESSUNA}
      onValueChange={v => onChange(v === NESSUNA ? "" : v)}
    >
      <SelectTrigger aria-label={ariaLabel} className="min-h-11">
        <SelectValue placeholder="Provincia" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NESSUNA}>— nessuna —</SelectItem>
        {PROVINCE.map(p => (
          <SelectItem key={p.sigla} value={p.sigla}>
            {p.sigla} — {p.nome}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
