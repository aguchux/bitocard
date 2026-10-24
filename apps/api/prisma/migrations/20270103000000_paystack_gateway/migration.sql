-- Paystack joins the payment gateways admins can offer per market (Settings > Markets > Payment methods). It starts
-- switched off everywhere: no market offers it until an admin switches it on.
ALTER TABLE "payment_methods" DROP CONSTRAINT "payment_methods_gateway_check";
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_gateway_check" CHECK ("gateway" IN ('stripe', 'flutterwave', 'monnify', 'pawapay', 'paystack'));
