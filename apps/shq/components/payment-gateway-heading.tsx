import Image from "next/image";
import type { PaymentGateway } from "@bitocard/api-client/reseller";

const gatewayNames = {
  stripe: "Stripe",
  paystack: "Paystack",
  flutterwave: "Flutterwave",
  monnify: "Monnify",
  pawapay: "pawaPay",
} satisfies Record<PaymentGateway, string>;

export function PaymentGatewayHeading({ gateway }: { gateway: PaymentGateway }) {
  return (
    <span className="flex min-h-6 items-center gap-2 text-sm font-semibold text-ink">
      {gateway === "pawapay" ? (
        <Image src="/payment-gateways/pawapay.svg" width={76} height={16} alt={gatewayNames[gateway]} unoptimized />
      ) : (
        <>
          <Image src={`/payment-gateways/${gateway}.svg`} width={24} height={24} alt="" className="size-6 shrink-0 object-contain" unoptimized />
          {gatewayNames[gateway]}
        </>
      )}
    </span>
  );
}
