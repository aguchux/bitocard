import Link from "next/link";
import { ContactEmail, LegalPage, Section } from "@/components/legal";
import { pageMetadata } from "@/components/seo";

const seo = { title: "Cookie notice", description: "The few cookies BitoCard uses (your chosen country on the store, and signing in), and how we will ask for your consent before any optional cookie.", path: "/documents/cookies" };

export const metadata = pageMetadata(seo);

export default function CookieNotice() {
  return (
    <LegalPage
      seo={seo}
      intro={<p>This notice explains how the BitoCard websites use cookies and similar technologies. In short: <strong>we set only the cookies listed below</strong>, to remember the country you choose on our store and to keep you signed in, and we do not use analytics, advertising or tracking technologies.</p>}
    >
      <Section id="what" title="1. What cookies are">
        <p>Cookies are small text files a website stores on your device. Similar technologies include local storage, pixels and device fingerprinting. They can be used to make a site work, remember preferences, measure visits or track people across sites.</p>
      </Section>

      <Section id="ours" title="2. What we use today">
        <p>We set only these first-party cookies. None is used for analytics, advertising or tracking, and none is shared with anyone else.</p>
        <ul>
          <li>
            <strong>bc_market</strong> (bitocard.com): remembers the country you chose to shop from, or that you chose to see everything, so the store shows products for your country. It is set only when you make that choice, lasts one year, and is read only by our servers. Choose another country at any time from the store&apos;s header; deleting the cookie makes the store ask again.
          </li>
          <li>
            <strong>bc_customer</strong> (bitocard.com and its country stores): keeps you signed in to your customer account, so you can buy and see your orders. It is strictly necessary, is set only when you sign in or create an account, holds a random sign-in token that only our servers can read, and lasts up to 30 days or until you sign out. Each site keeps its own: it is never shared between them.
          </li>
          <li>
            <strong>bc_signed_in</strong> (bitocard.com and its country stores): after you sign in on one of these sites, lets the others offer &ldquo;Continue as&rdquo; with your first name, so you can sign in there with one click instead of typing your password again. It holds only your first name and which of our sites you are signed in on. It is not a sign-in token: continuing always asks that site for a one-time code that works once, for one minute. It is shared across those sites, read only by our servers, set only when you sign in, lasts up to 30 days, and is removed when you sign out of the site it names. It is never set on resellers&apos; stores.
          </li>
          <li>
            <strong>bc_public_spin</strong> (bitocard.com and its country stores): keeps the free visitor spins you asked us to save before creating an account. It holds only a random claim token that our servers can read, not the prize values; those stay on our server. It works across BitoCard&apos;s country subdomains, lasts up to 30 days, and is removed after the claim is credited, dismissed, expires or is found ineligible.
          </li>
          <li>
            <strong>bc_access</strong> (bitocard.com and the stores on it): after you confirm the code we email you to open an order&apos;s page, lets that page show your order on this device. It is strictly necessary, is set only when you enter a correct code, works only on that one order&apos;s page, holds a signed pass that only our servers can read, and lasts 30 minutes.
          </li>
          <li>
            <strong>bc_chat</strong> (bitocard.com and the stores on it): when you chat with a store without signing in, keeps your chat on this browser so you can come back to it. It is strictly necessary for the chat you asked for, is set only when you start a chat with your name and email, holds a random token (the store&apos;s server keeps your name and email, not the cookie), works only on that store&apos;s address, and lasts 30 days.
          </li>
          <li>
            <strong>bc_kyc</strong> (BitoCard Verify, verify.bitocard.com): keeps your identity check open while you complete it, after you open the link we gave you. It is strictly necessary, holds a random token only our servers can read, works only on verify.bitocard.com, and lasts two hours.
          </li>
          <li>
            <strong>bc_session</strong> and <strong>bc_admin_session</strong> (our reseller dashboard and admin console): keep you signed in and protect your account. They are strictly necessary, are set only when you sign in, and end when you sign out or the session expires.
          </li>
        </ul>
        <p>We do not use local storage, pixels, fingerprinting or other tracking technologies on our websites, other than to remember on your own device choices you make in our dashboards (for example which account you were using). These stay on your device and are never sent to us.</p>
        <p>bitocard.com (with its country stores) and our reseller dashboard (SHQ) can also be installed as apps. Where we ask you to install one, your device remembers, for that site, how many times we have asked and when (<strong>bc_install</strong>, in local storage, and <strong>bc_install_visit</strong> for the current visit only), so we ask no more than three times, at least an hour apart, and never once it is installed. Each site&apos;s service worker shows a page of its own when you have no connection; it stores nothing about you. None of this is ever sent to us, and clearing a site&apos;s data removes it.</p>
        <p>When you pay for an order, you do so on the payment provider&apos;s own page (for example Stripe, Flutterwave, Monnify, Paystack or pawaPay), which uses its own cookies under its own cookie notice.</p>
        <p>Our hosting provider processes technical information such as your IP address to deliver and protect the websites, as described in our <Link href="/documents/privacy">privacy notice</Link>. This does not involve cookies on your device. Visits to resellers&apos; stores are also counted without cookies (see the privacy notice): nothing is stored on your device, and nothing follows you across sites or days. The only exception is when its security systems detect suspicious traffic. They may then set a strictly necessary cookie to confirm you are not an automated attack, which is used only for that purpose.</p>
      </Section>

      <Section id="future" title="3. If this changes">
        <p>If we ever want to use optional cookies, such as analytics, we will:</p>
        <ul>
          <li>update this notice first and list each cookie, its purpose and how long it lasts;</li>
          <li>ask for your consent before setting optional cookies wherever the law requires it, including in the UK, the European Economic Area, Switzerland and other countries with similar rules;</li>
          <li>let you change your choice at any time; and</li>
          <li>honour Global Privacy Control signals where they apply.</li>
        </ul>
      </Section>

      <Section id="control" title="4. Controlling cookies">
        <p>Most browsers let you view, block and delete cookies in their settings. Blocking strictly necessary cookies may stop parts of a website from working.</p>
      </Section>

      <Section id="contact" title="5. Contact us">
        <p>Email <ContactEmail /> with any question about this notice.</p>
      </Section>
    </LegalPage>
  );
}
