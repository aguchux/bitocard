import type { Metadata } from "next";
import Link from "next/link";
import { ContactEmail, LegalPage, Section } from "@/components/legal";

export const metadata: Metadata = {
  title: "Cookie notice | BitoCard",
  description: "BitoCard's use of cookies and similar technologies. We set none today.",
  alternates: { canonical: "/legal/cookies" },
};

export default function CookieNotice() {
  return (
    <LegalPage
      title="Cookie notice"
      intro={<p>This notice explains how the BitoCard websites use cookies and similar technologies. In short: <strong>we do not currently set any cookies</strong>, and we do not use analytics, advertising or tracking technologies.</p>}
    >
      <Section id="what" title="1. What cookies are">
        <p>Cookies are small text files a website stores on your device. Similar technologies include local storage, pixels and device fingerprinting. They can be used to make a site work, remember preferences, measure visits or track people across sites.</p>
      </Section>

      <Section id="ours" title="2. What we use today">
        <p>Our websites do not set cookies or use local storage, pixels, fingerprinting or other tracking technologies. There is no analytics, advertising or social media tracking.</p>
        <p>Our hosting provider processes technical information such as your IP address to deliver and protect the websites, as described in our <Link href="/legal/privacy">privacy notice</Link>. This does not involve cookies on your device. The only exception is when its security systems detect suspicious traffic. They may then set a strictly necessary cookie to confirm you are not an automated attack, which is used only for that purpose.</p>
      </Section>

      <Section id="future" title="3. If this changes">
        <p>As BitoCard launches features such as sign-in, we will need strictly necessary cookies to keep you signed in and secure. If we ever want to use optional cookies, such as analytics, we will:</p>
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
