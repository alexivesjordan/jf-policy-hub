"use client";

import { Children, Fragment, isValidElement, useId, useMemo, useState, type ReactNode } from "react";
import { Combobox } from "@base-ui/react/combobox";
import { CheckIcon, ChevronsUpDownIcon } from "lucide-react";
import { Select as ShadSelect, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const EMPTY = "__pulse_empty__";

export type SelectOption = { value: string; label: string; disabled?: boolean };

const triggerClass =
  "h-11 w-full min-w-0 justify-between rounded-2xl border-line bg-field px-3 text-base font-normal text-ink shadow-none";

function plainText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(plainText).join("");
  if (isValidElement(node)) return plainText((node.props as { children?: ReactNode }).children);
  return "";
}

function flattenOptions(children: ReactNode): SelectOption[] {
  const options: SelectOption[] = [];
  const walk = (nodes: ReactNode) => {
    Children.forEach(nodes, (child) => {
      if (!isValidElement(child)) return;
      if (child.type === Fragment) {
        walk((child.props as { children?: ReactNode }).children);
        return;
      }
      if (child.type !== "option") return;
      const props = child.props as { value?: string | number; children?: ReactNode; disabled?: boolean };
      const value = props.value == null ? "" : String(props.value);
      options.push({ value, label: plainText(props.children).trim() || value || "Choose", disabled: Boolean(props.disabled) });
    });
  };
  walk(children);
  return options;
}

type SelectFieldProps = {
  name?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (event: { target: { value: string }; currentTarget: { value: string } }) => void;
  required?: boolean;
  disabled?: boolean;
  children?: ReactNode;
  className?: string;
  id?: string;
  "aria-label"?: string;
  searchable?: boolean;
  placeholder?: string;
};

export function Select({
  name,
  value,
  defaultValue,
  onChange,
  required,
  disabled,
  children,
  className,
  id,
  searchable,
  placeholder,
  ...rest
}: SelectFieldProps) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const options = useMemo(() => flattenOptions(children), [children]);
  const placeholderLabel =
    placeholder ?? options.find((option) => option.disabled && option.value === "")?.label ?? "Choose";
  const selectable = options.filter((option) => !(option.disabled && option.value === ""));
  const controlled = value !== undefined;
  const [uncontrolled, setUncontrolled] = useState(defaultValue ?? "");
  const current = controlled ? (value ?? "") : uncontrolled;
  const useCombo = Boolean(searchable) || selectable.length > 12;

  function commit(next: string) {
    if (!controlled) setUncontrolled(next);
    const event = { target: { value: next }, currentTarget: { value: next } };
    onChange?.(event);
  }

  return (
    <div className={cn("min-w-0", className)}>
      {name ? <input type="hidden" name={name} value={current} required={required && current === ""} /> : null}
      {useCombo ? (
        <OptionCombobox
          id={controlId}
          ariaLabel={rest["aria-label"]}
          disabled={disabled}
          placeholder={placeholderLabel}
          options={selectable}
          value={current}
          onValueChange={commit}
        />
      ) : (
        <EnumSelect
          id={controlId}
          ariaLabel={rest["aria-label"]}
          disabled={disabled}
          placeholder={placeholderLabel}
          options={selectable}
          value={current}
          onValueChange={commit}
        />
      )}
    </div>
  );
}

function itemValue(value: string) {
  return value === "" ? EMPTY : value;
}

function formValue(value: string | null | undefined) {
  if (!value || value === EMPTY) return "";
  return value;
}

function EnumSelect({
  id,
  ariaLabel,
  disabled,
  placeholder,
  options,
  value,
  onValueChange,
}: {
  id: string;
  ariaLabel?: string;
  disabled?: boolean;
  placeholder: string;
  options: SelectOption[];
  value: string;
  onValueChange: (value: string) => void;
}) {
  const hasEmpty = options.some((option) => option.value === "");
  const selected = value === "" ? (hasEmpty ? EMPTY : undefined) : value;
  const items = Object.fromEntries(options.map((option) => [itemValue(option.value), option.label]));
  return (
    <ShadSelect
      items={items}
      value={selected}
      onValueChange={(next) => onValueChange(formValue(typeof next === "string" ? next : ""))}
      disabled={disabled}
    >
      <SelectTrigger id={id} aria-label={ariaLabel} className={triggerClass}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={itemValue(option.value)} value={itemValue(option.value)} disabled={option.disabled}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </ShadSelect>
  );
}

type ComboItem = { value: string; label: string };

function OptionCombobox({
  id,
  ariaLabel,
  disabled,
  placeholder,
  options,
  value,
  onValueChange,
}: {
  id: string;
  ariaLabel?: string;
  disabled?: boolean;
  placeholder: string;
  options: SelectOption[];
  value: string;
  onValueChange: (value: string) => void;
}) {
  const items = useMemo<ComboItem[]>(
    () => options.map((option) => ({ value: itemValue(option.value), label: option.label })),
    [options],
  );
  const selected = items.find((item) => item.value === itemValue(value)) ?? null;

  return (
    <Combobox.Root
      items={items}
      value={selected}
      onValueChange={(next) => onValueChange(formValue(next?.value))}
      disabled={disabled}
      autoHighlight
    >
      <Combobox.InputGroup className="flex h-11 w-full items-center rounded-2xl border border-line bg-field px-2 text-ink focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
        <Combobox.Input
          id={id}
          aria-label={ariaLabel}
          placeholder={placeholder}
          className="h-full min-w-0 flex-1 bg-transparent px-1 text-base text-ink outline-none placeholder:text-muted-foreground"
        />
        <Combobox.Trigger
          aria-label={ariaLabel ? `${ariaLabel}, open list` : "Open list"}
          className="inline-flex size-9 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <ChevronsUpDownIcon className="size-4" />
        </Combobox.Trigger>
      </Combobox.InputGroup>
      <Combobox.Portal>
        <Combobox.Positioner className="z-50" sideOffset={6} align="start">
          <Combobox.Popup className="max-h-72 w-(--anchor-width) min-w-56 overflow-y-auto rounded-xl bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none">
            <Combobox.Empty className="px-3 py-4 text-sm text-muted-foreground">No matches.</Combobox.Empty>
            <Combobox.List>
              {(item: ComboItem) => (
                <Combobox.Item
                  key={item.value}
                  value={item}
                  className="flex cursor-default items-center gap-2 rounded-lg px-2 py-2 text-sm outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                >
                  <Combobox.ItemIndicator className="flex size-4 items-center justify-center">
                    <CheckIcon className="size-3.5" />
                  </Combobox.ItemIndicator>
                  <span className="flex-1">{item.label}</span>
                </Combobox.Item>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}
