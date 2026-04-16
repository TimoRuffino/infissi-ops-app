import * as React from "react";
import { Check, ChevronsUpDown, Plus } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export type SearchSelectOption = {
  value: string;
  label: string;
  /** Extra text searched against the query, e.g. phone/email */
  keywords?: string;
  /** Optional right-aligned secondary label (e.g. role, email) */
  hint?: string;
};

export type SearchSelectProps = {
  options: SearchSelectOption[];
  value: string | null | undefined;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  className?: string;
  disabled?: boolean;
  /** Optional callback fired when the "+ crea" footer row is clicked */
  onCreate?: () => void;
  /** Label for the create row (defaults to "Crea nuovo") */
  createLabel?: string;
  /** When true, shows a "— Nessuno —" clear item at the top */
  allowClear?: boolean;
  clearLabel?: string;
};

/**
 * Searchable single-select combobox backed by cmdk. Drop-in replacement for
 * shadcn <Select> when the option list is long or when the user needs to
 * search by partial text.
 */
export default function SearchSelect({
  options,
  value,
  onChange,
  placeholder = "Seleziona...",
  searchPlaceholder = "Cerca...",
  emptyText = "Nessun risultato",
  className,
  disabled,
  onCreate,
  createLabel = "Crea nuovo",
  allowClear,
  clearLabel = "— Nessuno —",
}: SearchSelectProps) {
  const [open, setOpen] = React.useState(false);

  const current = options.find((o) => o.value === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "w-full justify-between font-normal",
            !current && "text-muted-foreground",
            className
          )}
        >
          <span className="truncate text-left">
            {current?.label ?? placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="p-0 w-[--radix-popover-trigger-width] min-w-[280px]"
        align="start"
      >
        <Command
          filter={(value, search, keywords) => {
            const hay = `${value} ${keywords?.join(" ") ?? ""}`.toLowerCase();
            return hay.includes(search.toLowerCase()) ? 1 : 0;
          }}
        >
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {allowClear && (
                <CommandItem
                  value="__clear__"
                  onSelect={() => {
                    onChange("");
                    setOpen(false);
                  }}
                >
                  <span className="text-muted-foreground italic">{clearLabel}</span>
                </CommandItem>
              )}
              {options.map((o) => (
                <CommandItem
                  key={o.value}
                  value={o.label}
                  keywords={o.keywords ? [o.keywords] : undefined}
                  onSelect={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === o.value ? "opacity-100" : "opacity-0"
                    )}
                  />
                  <span className="truncate flex-1">{o.label}</span>
                  {o.hint && (
                    <span className="ml-2 text-xs text-muted-foreground truncate max-w-[40%]">
                      {o.hint}
                    </span>
                  )}
                </CommandItem>
              ))}
              {onCreate && (
                <CommandItem
                  value="__create__"
                  onSelect={() => {
                    setOpen(false);
                    onCreate();
                  }}
                  className="border-t text-primary font-medium"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  {createLabel}
                </CommandItem>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
