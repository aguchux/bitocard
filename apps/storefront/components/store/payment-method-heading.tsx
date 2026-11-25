import Image from "next/image";
import { Banknote, Wallet } from "lucide-react";

const gatewayNames = new Map([
  ["stripe", "Stripe"],
  ["paystack", "Paystack"],
  ["flutterwave", "Flutterwave"],
  ["monnify", "Monnify"],
  ["pawapay", "pawaPay"],
]);

/** Present the gateway by name while keeping the method ID and its supported channels separate. */
export function PaymentMethodHeading({ id, label }: { id: string; label: string }) {
  const gateway = gatewayNames.get(id);
  return (
    <span className="flex min-h-6 items-center gap-2 text-sm font-semibold">
      {id === "pawapay" ? (
        <Image src="/payment-gateways/pawapay.svg" width={76} height={16} alt="pawaPay" unoptimized />
      ) : (
        <>
          {gateway ? (
            <Image src={`/payment-gateways/${id}.svg`} width={24} height={24} alt="" className="size-6 shrink-0 object-contain" unoptimized />
          ) : id === "bank_deposit" ? (
            <Banknote className="size-5 shrink-0" aria-hidden="true" />
          ) : id === "wallet" ? (
            <Wallet className="size-5 shrink-0" aria-hidden="true" />
          ) : null}
          {gateway ?? label}
        </>
      )}
    </span>
  );
}
