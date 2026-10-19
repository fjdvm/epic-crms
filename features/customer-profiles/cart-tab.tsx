import { formatPesos } from "./format";
import type { Cart } from "./cart";

export function CartTab({ cart }: { cart: Cart }) {
  if (cart.lines.length === 0) {
    return (
      <div className="p-xl text-center text-muted-foreground border border-border rounded-lg">
        This customer&apos;s cart is empty.
      </div>
    );
  }

  return (
    <div className="space-y-md">
      <table className="w-full text-body-md">
        <thead>
          <tr className="text-left text-label-md text-muted-foreground">
            <th className="py-1 font-normal">Product</th>
            <th className="py-1 font-normal">Size</th>
            <th className="py-1 text-right font-normal">Qty</th>
            <th className="py-1 text-right font-normal">Price</th>
          </tr>
        </thead>
        <tbody>
          {cart.lines.map((l, i) => (
            <tr key={i}>
              <td className="py-1">{l.product}</td>
              <td className="py-1">{l.size}</td>
              <td className="py-1 text-right">{l.quantity}</td>
              <td className="py-1 text-right">{formatPesos(l.price)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="flex justify-between font-medium text-body-md">
        <span>Cart total</span>
        <span>{formatPesos(cart.total)}</span>
      </p>
    </div>
  );
}
