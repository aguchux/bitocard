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
            <strong>bc_session</strong> and <strong>bc_admin_session</strong> (our reseller dashboard and admin console): keep you signed in and protect your account. They are strictly necessary, are set only when you sign in, and end when you sign out or the session expires.
          </li>
        </ul>
        <p>We do not use local storage, pixels, fingerprinting or other tracking technologies on our websites, other than to remember on your own device choices you make in our dashboards (for example which account you were using).</p>
        <p>Our hosting provider processes technical information such as your IP address to deliver and protect the websites, as described in our <Link href="/documents/privacy">privacy notice</Link>. This does not involve cookies on your device. The only exception is when its security systems detect suspicious traffic. They may then set a strictly necessary cookie to confirm you are not an automated attack, which is used only for that purpose.</p>
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
