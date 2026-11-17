"use client";

import { useId, useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { maskProfileInput, validateProfileField } from "@/lib/profile-fields";

type Props = Omit<React.ComponentProps<"input">, "onChange" | "value" | "defaultValue"> & {
  field: string;
  label: string;
  initialValue?: string;
  /** A message from the server (e.g. a duplicate email); shown until the user edits the field. */
  serverError?: string;
  onValueChange?: (value: string) => void;
};

const INPUT_MODE: Record<string, React.HTMLAttributes<HTMLInputElement>["inputMode"]> = {
  contactNumber: "tel",
  email: "email",
};

/**
 * A Customer profile field with the input mask and inline error. Characters the field does not allow
 * never enter it (typed or pasted); the message is the same one the server returns.
 */
export function ProfileInput({ field, label, initialValue = "", serverError, onValueChange, ...rest }: Props) {
  const id = useId();
  const [value, setValue] = useState(maskProfileInput(field, initialValue));
  const [touched, setTouched] = useState(false);
  const [dismissedServerError, setDismissedServerError] = useState(false);

  const error = (touched ? validateProfileField(field, value) : null) ?? (dismissedServerError ? null : serverError ?? null);

  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Input
        {...rest}
        id={id}
        value={value}
        inputMode={INPUT_MODE[field]}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(e) => {
          const next = maskProfileInput(field, e.target.value);
          setValue(next);
          setDismissedServerError(true);
          onValueChange?.(next);
        }}
        onBlur={() => setTouched(true)}
      />
      {error ? <p id={`${id}-error`} role="alert" className="text-label-md text-destructive">{error}</p> : null}
    </div>
  );
}
