import Link from "next/link";
import { appUrl } from "@bitocard/ui/site";
import { ContactEmail, EntityTable, LegalPage, Section } from "@/components/legal";
import { pageMetadata } from "@/components/seo";

const seo = {
  title: "BitoCard Shop terms",
  description: "The terms for buying and selling on BitoCard Shop: listings and what may be sold, chats and offers, Safe pay (fees, holding, release codes, deadlines, refunds and disputes), selling through resellers, paying directly, and the shop assistants.",
  path: "/documents/shop-terms",
};

export const metadata = pageMetadata(seo);

export default function ShopTerms() {
  return (
    <LegalPage
      seo={seo}
      intro={
        <>
          <p>These terms apply when you use BitoCard Shop, our marketplace for buying and selling near you, at shop.bitocard.com and in the Shop tab of your BitoCard account. They sit alongside our <Link href="/documents/terms">terms of use</Link> and <Link href="/documents/privacy">privacy notice</Link>; where they differ on BitoCard Shop, these terms apply.</p>
          <p><strong>This is a draft.</strong> BitoCard Shop is not open in any country yet. It describes how BitoCard Shop is built to work and is being reviewed by lawyers in each region. It may change before BitoCard Shop opens, and we will show you the final version before you post a listing or pay with Safe pay.</p>
        </>
      }
    >
      <Section id="who" title="1. Who we are and what these terms cover">
        <p>BitoCard Shop is operated by companies in the Golojan group. Your agreement is with the company for your region.</p>
        <EntityTable caption="Contracting entity by region" />
        <p>In these terms, &ldquo;we&rdquo;, &ldquo;us&rdquo; and &ldquo;BitoCard&rdquo; mean that company. A &ldquo;listing&rdquo; is an advert for an item or service; the &ldquo;seller&rdquo; is the person who posts it and the &ldquo;buyer&rdquo; the person who buys it. BitoCard Shop opens country by country: in a country where it is not open, nothing in these terms is an offer.</p>
      </Section>

      <Section id="role" title="2. What BitoCard does, and does not do">
        <ul>
          <li><strong>We host listings and chats.</strong> Sellers post listings and buyers contact them. We check listings, keep the marketplace safe and offer Safe pay (section 8).</li>
          <li><strong>We are not the seller or the buyer.</strong> A sale is between the buyer and the seller. We do not own, inspect, store, value or deliver the items, and we do not promise that an item is as described, that a seller will sell or that a buyer will pay.</li>
          <li><strong>Safe pay is the one exception.</strong> When a buyer pays with Safe pay, we hold the money and pay it to the seller, or back to the buyer, as section 8 says. We still do not become the seller or inspect the item.</li>
          <li><strong>Paying directly is at your own risk.</strong> If you pay or are paid outside Safe pay (in cash, by transfer or any other way), we take no part in that payment and cannot get the money back. Section 10 sets out how to trade safely.</li>
        </ul>
      </Section>

      <Section id="account" title="3. Your account">
        <ul>
          <li>You use BitoCard Shop with your BitoCard customer account (the one you use on bitocard.com), with a confirmed email address. You must be at least 18.</li>
          <li>You sell and buy in your account&apos;s country, which is fixed when you open the account. One person, one account: do not open accounts to get round a limit, a block or a suspension.</li>
          <li>Some things need more: showing your phone number needs it confirmed with a code, and selling with Safe pay needs a passed identity check and a payout bank account in your verified name (section 8).</li>
          <li>Keep your password and codes secret. BitoCard never asks for them in a chat, a call or a message.</li>
        </ul>
      </Section>

      <Section id="listings" title="4. Posting a listing">
        <h3 id="listings-promise">What you promise as a seller</h3>
        <ul>
          <li>You own the item, or have the right to sell it, and it is yours to hand over.</li>
          <li>The listing is true and complete: the title, description, features, condition and photos describe the actual item, including its faults. Photos are of the item itself, not taken from someone else.</li>
          <li>The price is the price you will sell at. A &ldquo;was&rdquo; price or a discount must be one you genuinely offered before. You list each item once, in the right category and area.</li>
          <li>You follow the law that applies to you and to the item, including consumer law if you sell as a business.</li>
        </ul>
        <h3 id="listings-rules">The rules for listings</h3>
        <ul>
          <li><strong>No contact details or links in listings.</strong> Titles and descriptions cannot contain web addresses, links or phone numbers: buyers contact you through BitoCard Shop, and you choose whether they can see your confirmed phone number.</li>
          <li><strong>Photos and video.</strong> Each listing needs at least the number of photos shown when you post it (4 in Nigeria, up to 12), and may have one video of up to 60 seconds. We remove the hidden details phones add (such as where a photo was taken) and re-encode videos.</li>
          <li><strong>How long and how many.</strong> A listing is live for 30 days unless you renew it, and there is a limit on how many listings you post in each category every 30 days (10 in Nigeria). We tell you the limits for your country when you post.</li>
          <li><strong>What is public.</strong> Live listings are public, on BitoCard Shop and in search engines: the title, description, features, photos, video, price, condition, the area you choose, and your first name and initial with your badges (for example a confirmed phone or a passed identity check). Never put anyone&apos;s personal details in a listing.</li>
          <li><strong>Sold listings</strong> stay visible, marked Sold, for about 30 days, then leave the market.</li>
          <li><strong>Your content.</strong> You keep the rights in your words, photos and video, and you give us a free, worldwide licence to host, show, resize and share them (including in previews on other sites and apps) to run and promote BitoCard Shop, for as long as the listing is live and for a reasonable time after.</li>
          <li><strong>Listing is free</strong> for now. If we add paid features, such as promoting a listing or plans for shops, we will publish their prices and terms first, and you choose whether to use them.</li>
        </ul>
      </Section>

      <Section id="prohibited" title="5. What may not be sold">
        <p>You must not list, offer or ask for:</p>
        <ul>
          <li>weapons, ammunition, explosives and their parts, and anything designed to injure;</li>
          <li>illegal drugs, prescription-only and restricted medicines, and anything to make or take them;</li>
          <li>counterfeit, replica or fake goods, and anything that infringes someone else&apos;s trademark, copyright or other rights;</li>
          <li>stolen goods, or goods you cannot show you are entitled to sell;</li>
          <li>fake or copied money, cards or documents, stolen card or account details, and anything for fraud;</li>
          <li>financial products, investments, loans, crypto offers, gift card codes and money transfer services;</li>
          <li>protected or restricted animals and wildlife products, and any animal where the law limits its sale;</li>
          <li>adult content and sexual services;</li>
          <li>people, personal data, accounts and anything else whose sale is illegal where you or the buyer are.</li>
        </ul>
        <p>Some categories (for example vehicles, property and jobs) have their own rules, shown when you post in them. If you are not sure, ask us before you post.</p>
      </Section>

      <Section id="moderation" title="6. Checks, removal and suspension">
        <ul>
          <li><strong>We check listings</strong> when they are posted or changed. Some checks are automatic: a listing using a word for an item that may never be sold is refused, and listings that look doubtful (for example a price far below similar listings, a photo another seller uses, many listings posted at once, or a new seller&apos;s first listings) wait for a person to review them.</li>
          <li><strong>We may ask you to change a listing,</strong> refuse it, or remove a live one, at any time, if we think it breaks these terms or the law, or is unsafe for buyers. We tell you why.</li>
          <li><strong>Reports.</strong> Anyone can report a listing, and buyers and sellers can report each other from a chat. We review reports. A moderator reads a chat only when it has been reported or when it matters to a Safe pay dispute.</li>
          <li><strong>Suspension.</strong> If you break these terms, try to defraud anyone, or put people at risk, we may suspend you from BitoCard Shop or close your account, and your listings leave the market. Where the law requires it, we report it to the authorities.</li>
          <li><strong>If you disagree</strong> with a decision, email <ContactEmail /> or ask us for help from your account, and a person will review it.</li>
        </ul>
      </Section>

      <Section id="contact-sellers" title="7. Chats, offers and phone numbers">
        <ul>
          <li><strong>Keep the conversation on BitoCard Shop.</strong> Chats protect both of you: we can see them if you report a problem. Be polite, honest and lawful. Do not send spam, links, threats or other people&apos;s personal details.</li>
          <li><strong>Offers.</strong> Either side can offer a price in a chat. An offer lasts 48 hours unless it is accepted, declined, withdrawn or replaced first. An accepted offer is the price for Safe pay for 7 days. Accepting an offer is a statement that you will buy or sell at that price; it does not move any money.</li>
          <li><strong>Phone numbers.</strong> If a seller allows it, a signed-in buyer can ask to see the seller&apos;s confirmed phone number. We limit how many numbers a buyer can see each hour and tell the seller how many people asked. Do not use a number for anything but the listing.</li>
          <li><strong>Blocking.</strong> You can block someone in a chat. They can no longer write to you there.</li>
          <li>We keep chats for 12 months after their last message (longer while a report on them is open), then delete them with their photos.</li>
        </ul>
      </Section>

      <Section id="safe-pay" title="8. Safe pay">
        <p>Safe pay lets a buyer pay through BitoCard, which holds the money until the buyer has the item. It is the buyer&apos;s choice, offered where we have opened it in your country. <strong>Safe pay is not taking real payments in any country yet</strong>: it will open in each country only once we have the approvals its law requires.</p>

        <h3 id="safe-pay-steps">How it works</h3>
        <ol>
          <li><strong>The buyer asks</strong> to buy with Safe pay, at the listed price or a price the seller accepted in a chat in the last 7 days, choosing to meet in person (where the seller hands over in person) or, where the seller delivers, delivery to an address. The buyer sees the price, any delivery charge, their fee and the total first. A seller who delivers sets the delivery charge in their listing (within their state and elsewhere, or free); it goes to the seller in full once the buyer has the item, and is refunded with the order if it never arrives.</li>
          <li><strong>The seller accepts or declines</strong> within the time shown (24 hours in Nigeria). To accept, a seller must have passed our identity check and added a payout bank account in their verified name.</li>
          <li><strong>The buyer pays</strong> the total from their BitoCard wallet within the time shown (24 hours in Nigeria). We hold it, and the listing shows as reserved: other buyers&apos; requests end.</li>
          <li><strong>The hand-over</strong>, within the time shown (5 days in Nigeria):
            <ul>
              <li><strong>Meeting in person:</strong> the buyer gets a 6-digit release code in their account. When they have the item and are happy with it, they give the code to the seller, who enters it to be paid. <strong>Buyers: never give the code before you have the item.</strong> Five wrong codes lock the release until we help.</li>
              <li><strong>Delivery:</strong> the seller sees the delivery address once the buyer has paid, photographs the item and the sealed parcel (at least two photos, kept private to the order and to us), sends it by courier and marks it sent with the courier and tracking number, then keeps the tracking up to date. Once it is delivered, the buyer confirms it arrived in good condition, or opens a dispute, within the time shown (3 days in Nigeria); if they do neither, the money is released to the seller. A parcel never reported delivered is released after the country&apos;s longest transit time plus that confirmation time, unless the buyer opens a dispute. The item is the seller&apos;s responsibility until the buyer has it: loss or damage on the way is the seller&apos;s to put right, and the photos and tracking help us decide any dispute.</li>
            </ul>
          </li>
          <li><strong>We release the money</strong> to the seller (section 8.4), and the listing is marked sold.</li>
        </ol>

        <h3 id="safe-pay-fees">Fees</h3>
        <ul>
          <li>Safe pay has a fee for the buyer and a fee for the seller, each a percentage of the price up to a maximum amount, set for each country and shown before anyone commits. The fees fixed when the buyer asks are the ones that apply to that order.</li>
          <li>The buyer pays their fee with the price. It is refunded with the price if the item does not change hands (a cancellation, a seller who does not hand over in time, or a dispute decided with a full refund).</li>
          <li>The seller&apos;s fee is taken only from money released to them: from the price, or the part of it released after a dispute.</li>
        </ul>

        <h3 id="safe-pay-cancel">Cancelling, deadlines and refunds</h3>
        <ul>
          <li>Before the buyer pays, either side can cancel and nothing is charged. A request not answered, or an accepted order not paid, in time ends by itself.</li>
          <li>Once paid, either side can cancel until the hand-over, and the buyer is refunded in full, their fee included. A delivery that has been sent cannot be cancelled: the buyer confirms it or opens a dispute.</li>
          <li>If the seller does not hand over in time, the order is cancelled and the buyer refunded in full.</li>
          <li><strong>Refunds go back to the buyer&apos;s BitoCard wallet</strong>, which paid for the order. Wallet money can be spent on BitoCard but not withdrawn.</li>
        </ul>

        <h3 id="safe-pay-release">Releases and the seller&apos;s money</h3>
        <ul>
          <li>Released money (the price less the seller&apos;s fee) goes to the seller&apos;s Shop money in their account. It can be paid out to the seller&apos;s bank account in their verified name once the payout hold for their country has passed (so that a payment later reversed can still be put right), above the minimum for their country.</li>
          <li>When a buyer paid with money topped up by card or mobile money in the last 60 days (payments that can be reversed), we may check the payment before the seller can withdraw it. We tell the seller when it is ready.</li>
          <li><strong>A release is final.</strong> Once the code is entered, the delivery is confirmed or the confirmation time has passed, the money is the seller&apos;s and we cannot take it back for the buyer, except where a payment is reversed or the law requires it.</li>
        </ul>

        <h3 id="safe-pay-disputes">Disputes</h3>
        <ul>
          <li>Before the money is released, the buyer can open a dispute: the item did not arrive, is not as described or is damaged. The money stays held. Both sides add their side, with photos, in the dispute.</li>
          <li><strong>BitoCard decides</strong> from what both sides give us, the listing and the chat: a full refund to the buyer, a part refund with the rest released to the seller, or release to the seller. We do not inspect items. Our decision settles where the Safe pay money goes; it does not stop either of you using your legal rights against the other.</li>
        </ul>

        <h3 id="safe-pay-protection">Protecting Safe pay</h3>
        <ul>
          <li>The same person cannot be the buyer and the seller. We compare identity checks and payout accounts to stop it, and refuse those orders.</li>
          <li>A seller new to Safe pay can sell up to a limit for their first five sales.</li>
          <li>Cancelling after accepting, not handing over in time, and disputes decided against the seller each count as a strike. A seller with too many strikes in 90 days (3 in Nigeria) cannot take Safe pay orders until we review it.</li>
          <li>We may refuse, hold or reverse a Safe pay order, and report it, where we suspect fraud, money laundering or a breach of these terms.</li>
        </ul>
      </Section>

      <Section id="resellers" title="9. Selling through resellers">
        <p>Where we offer it in your country, you can let resellers sell your listing on their own BitoCard stores, as well as on BitoCard Shop or instead of it. It is not open in any country yet.</p>
        <h3 id="resellers-opening">Opening a listing to resellers</h3>
        <ul>
          <li>You choose, for each listing, whether it is sold on BitoCard Shop, through resellers, or both, and how many you have: every sale takes one, wherever it is made. A listing sold only through resellers does not appear on BitoCard Shop.</li>
          <li>You set the discount resellers earn off your price and how far above your price they may sell, within the limits we set for your country (shown when you post). Resellers never sell below your price unless you agree a better deal with a reseller through BitoCard.</li>
          <li>To open listings to resellers you need a passed identity check and a payout bank account in your verified name. You can pause reselling, or stop it, at any time; orders already paid continue.</li>
        </ul>
        <h3 id="resellers-what-they-show">What resellers can and cannot do</h3>
        <ul>
          <li>Resellers&apos; stores show your listing exactly as you wrote it: your title, photos, description, features and condition, with your name, and a link to your page on their store. Resellers cannot change any of it.</li>
          <li>A reseller may add a short note to your listing on their store, but it shows only once you approve it, and you can withdraw your approval at any time.</li>
          <li>A reseller must never present themselves as the owner or maker of your item. Tell us if one does.</li>
        </ul>
        <h3 id="resellers-sales">When a reseller sells your item</h3>
        <ul>
          <li><strong>You are the seller of the item.</strong> The reseller&apos;s store is where it was bought; BitoCard holds the money, as for Safe pay (section 8).</li>
          <li>The buyer pays from their store wallet. The money is locked until you accept the order within the time shown, then held by us; if you decline or do not answer in time, it goes back to the buyer. Letting an order go unanswered counts as a strike. You can choose to accept resale orders automatically while you have stock; you must then hand over or ship each one in time, as for any order you accept.</li>
          <li>You get the item to the buyer yourself, safely and in one piece: by meeting them and handing it over (they give you their release code once they have checked it), or by sending it with a courier, with the tracking number, a tracking link and photos of the item and the sealed parcel before it goes. The item is your responsibility until the buyer has it: loss or damage on the way is yours to put right.</li>
          <li>Once you accept an order you see the buyer&apos;s name, phone number, email and delivery address, so you can deliver. Use them only for that order, never to sell to the buyer outside the reseller&apos;s store; we keep a record of who views them.</li>
          <li>You and the reseller can both write to the buyer in the order&apos;s chat. The buyer sees every message as from the reseller&apos;s store, and you and the reseller both see the whole chat. You and the reseller also have a chat of your own about the order, which the buyer never sees.</li>
          <li>Once released, you receive your price less the reseller&apos;s discount (or a deal you agreed), less our Safe pay seller&apos;s fee; the reseller receives the rest of what the buyer paid, less our fee on it. If a dispute ends in a part refund, what remains is shared between you and the reseller in proportion to what each would have received.</li>
          <li>Disputes are decided by BitoCard as in section 8, and the same strikes apply to you as for any Safe pay sale.</li>
        </ul>
        <h3 id="resellers-contact">You and your resellers</h3>
        <p>You can see which resellers carry your listings, and chat with them on BitoCard. You and a reseller you work with can see each other&apos;s confirmed phone numbers. You can offer a reseller a better deal in that chat (a bigger discount, and how far below your price they may sell), which applies once they accept it, to new orders only; either of you can end it. You can stop any reseller selling your listings, on all their stores, at any time. Keep payments for your items inside BitoCard: never let a reseller or their buyer pay you directly for a sale made through their store.</p>
      </Section>

      <Section id="safe-trade" title="10. Safe Trade Policy: paying directly">
        <p>Many people meet, look at the item and pay directly. We take no part in those payments and cannot recover money paid outside Safe pay. Our <a href={appUrl("shop", "/safe-trade")}>Safe Trade Guide</a> gives each category&apos;s checks. In short:</p>
        <ul>
          <li>meet in a busy public place in daylight, and bring someone if you can;</li>
          <li>inspect the item, and check it works, before you pay; check papers for vehicles and property;</li>
          <li>never pay a deposit, an &ldquo;inspection fee&rdquo; or a delivery charge in advance to someone you have not met;</li>
          <li>keep the chat on BitoCard Shop and be wary of anyone who pushes you to another app, or to pay or be paid in a hurry;</li>
          <li>never share codes, passwords or card details: BitoCard never asks for them;</li>
          <li>report anything suspicious from the listing or the chat.</li>
        </ul>
        <p>The guide gives advice; it is not a guarantee that a trade will be safe, and following it does not make BitoCard part of the sale.</p>
      </Section>

      <Section id="assistants" title="11. Shop assistants">
        <ul>
          <li><strong>An AI assistant,</strong> Anjio (or another named assistant in your country), can answer questions about BitoCard Shop, find and compare listings, and help sellers write listings, price them and reply to buyers. It always says it is an AI assistant.</li>
          <li><strong>It can be wrong.</strong> Check what it says against the listing and the seller. Price ranges come from similar listings on BitoCard Shop; they are not valuations, offers or guarantees.</li>
          <li><strong>It never acts for you.</strong> It cannot buy, sell, pay, message anyone or change a listing. Its suggestions change nothing until you accept them, and you are responsible for what you post or send.</li>
          <li><strong>A person, any time.</strong> Signed in, you can ask for a person, and your conversation is passed to our support team.</li>
          <li>Do not tell it personal details you do not need to: it hides numbers that look like phone numbers, card numbers or codes before they are sent. There is a daily limit on questions. What is sent to the AI provider, and how long we keep conversations (30 days), is in our <Link href="/documents/privacy">privacy notice</Link>.</li>
        </ul>
      </Section>

      <Section id="law" title="12. Consumer rights and the law">
        <ul>
          <li>If you buy from someone selling as a business, you have the rights consumer law gives you against them. These terms do not take away any right the law gives you.</li>
          <li>Sellers who sell as a business must say so in their listings and follow consumer law, including on prices, discounts and returns.</li>
          <li>Our responsibility to you, and the law that applies, are set out in our <Link href="/documents/terms#liability">terms of use</Link>. We are responsible for running Safe pay as these terms describe, and for holding and paying out Safe pay money correctly; we are not responsible for the items, for what buyers and sellers say or do, or for payments made outside Safe pay.</li>
        </ul>
      </Section>

      <Section id="changes" title="13. Changes">
        <p>We may change these terms, for example when we open BitoCard Shop in a new country or add a feature. We will tell you before a change that affects you takes effect. Changes never apply to a Safe pay order already requested: it follows the terms and fees shown when the buyer asked.</p>
      </Section>

      <Section id="contact" title="14. Contact us">
        <p>Ask for help from your BitoCard account, or email <ContactEmail />.</p>
      </Section>
    </LegalPage>
  );
}
