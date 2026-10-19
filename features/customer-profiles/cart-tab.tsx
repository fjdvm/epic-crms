import { formatPesos } from "./format";
import { TabCard } from "./tab-card";
import type { Cart } from "./cart";

export function CartTab({ cart }: { cart: Cart }) {
  if (cart.lines.length === 0) {
    return (
      <TabCard title="Cart">
        <div className="p-xl text-center text-muted-foreground">This customer&apos;s cart is empty.</div>
      </TabCard>
    );
  }

  return (
    <TabCard title="Cart">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th className="py-1 font-medium">Product</th>
            <th className="py-1 font-medium">Size</th>
            <th className="py-1 text-right font-medium">Qty</th>
            <th className="py-1 text-right font-medium">Price</th>
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
      <p className="flex justify-between text-sm font-medium">
        <span>Cart total</span>
        <span>{formatPesos(cart.total)}</span>
      </p>
    </TabCard>
  );
}
