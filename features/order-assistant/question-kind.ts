// Mirrors the storefront recognised kinds; classifies stored questions only, never calls a model.
export type QuestionKind =
  | "order_status"
  | "payment"
  | "return_window"
  | "delivery_fee"
  | "shop_info"
  | "shop_rules"
  | "product";

const kindPatterns: { kind: QuestionKind; pattern: RegExp }[] = [
  { kind: "product", pattern: /ingredient|sangkap|storage|store it|keep it|refrigerat|ref\b|shelf|tumatagal|how long (does|will|can)|gaano katagal|best before|expir/i },
  { kind: "delivery_fee", pattern: /delivery fee|shipping|shipping fee|magkano (ang )?(delivery|shipping)|how much (is|for) (the )?delivery|rate ng delivery|delivery rate|bayad sa delivery/i },
  { kind: "return_window", pattern: /\breturn(s)?\b|ibabalik|still (request|return)/i },
  { kind: "payment", pattern: /\bpay(ment|ing|\b)|gcash|maya|bank transfer|proof|reference number|bayad|\bpaid\b|\bcod\b|cash on delivery/i },
  { kind: "shop_rules", pattern: /cancel|policy|rules?|free delivery|free shipping|minimum|payment methods?|how do i (order|pay)|paano (mag-?order|magbayad)/i },
  { kind: "order_status", pattern: /where('| i)?s? (is )?my|track|status|dispatch|deliver|rider|courier|lalamove|grab|\beta\b|arrive|when (will|is|does)|asan na|nasaan|kailan|dumating|order|pickup ready|ready for pick/i },
  { kind: "shop_info", pattern: /pick ?up|opening|open (on|at|today|until)|hours|schedule|closed|sunday|address|location|where (is|are) (the |your )?(store|shop)|saan (kayo|ang tindahan)|oras ng/i },
];

/** What the message is asking, or undefined when it is none of the recognised kinds. */
export function questionKindOf(message: string): QuestionKind | undefined {
  return kindPatterns.find(({ pattern }) => pattern.test(message))?.kind;
}

