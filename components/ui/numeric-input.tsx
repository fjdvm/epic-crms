import * as React from "react"

import { Input } from "@/components/ui/input"
import { maskNumeric, type NumericKind } from "@/lib/numeric-mask"

type Props = Omit<React.ComponentProps<"input">, "type" | "inputMode"> & { kind: NumericKind }

/**
 * A field that holds a number: letters and symbols never get in, whether typed or pasted. `peso` takes an amount with
 * up to two decimals; `whole` takes digits only. A drop-in for Input: onChange still receives the event, with the
 * cleaned text in event.target.value.
 */
const NumericInput = React.forwardRef<HTMLInputElement, Props>(({ kind, onChange, ...props }, ref) => (
  <Input
    ref={ref}
    inputMode={kind === "peso" ? "decimal" : "numeric"}
    onChange={(e) => {
      const masked = maskNumeric(kind, e.target.value)
      if (masked !== e.target.value) e.target.value = masked
      onChange?.(e)
    }}
    {...props}
  />
))
NumericInput.displayName = "NumericInput"

export { NumericInput }
