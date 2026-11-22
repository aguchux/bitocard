// Rich text for support messages: only the allowed tags survive, every one closed and its text escaped; links only
// to https:// and mailto:; plain text read as paragraphs; and the same file in the API as here.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { cleanRichText, richTextToPlain, safeRichHref } from "../src/rich-text-core.ts";

test("formatting an editor writes is kept, in the canonical tags", () => {
  assert.equal(cleanRichText("<div><b>Order</b> <i>BC-1</i> was <u>late</u> and <strike>wrong</strike></div>"), "<p><strong>Order</strong> <em>BC-1</em> was <u>late</u> and <s>wrong</s></p>");
  assert.equal(cleanRichText("<ul><li>One</li><li>Two</li></ul><ol><li>First</li></ol>"), "<ul><li>One</li><li>Two</li></ul><ol><li>First</li></ol>");
  assert.equal(cleanRichText("<blockquote>You said</blockquote><pre><code>  GET /v1/orders</code></pre>"), "<blockquote>You said</blockquote><pre><code>  GET /v1/orders</code></pre>");
  assert.equal(cleanRichText("Loose words<br>and a break"), "<p>Loose words<br>and a break</p>");
});

test("nothing dangerous survives: scripts, handlers, styles, other tags, unsafe links", () => {
  const html = cleanRichText('<p onclick="x()" style="color:red">Hi <img src=x onerror=alert(1)><script>alert(1)</script><a href="javascript:alert(1)">click</a> <a href="https://bitocard.com" target="_blank">ok</a></p><!-- note --><style>p{}</style>');
  assert.equal(html, '<p>Hi click <a href="https://bitocard.com">ok</a></p>');
  assert.equal(cleanRichText("<p>5 &lt; 6 &amp; <b>&quot;7&quot;</b></p>"), "<p>5 &lt; 6 &amp; <strong>\"7\"</strong></p>");
  assert.equal(cleanRichText('<a href="https://x.test/?a=1&amp;b=2">x</a>'), '<p><a href="https://x.test/?a=1&amp;b=2">x</a></p>');
  assert.equal(cleanRichText('<a href="https://x.test/&quot;onmouseover=x">x</a>'), '<p>x</p>');
  for (const href of ["javascript:alert(1)", "data:text/html,x", "/relative", "http://plain.test", "  JAVASCRIPT:x"]) assert.equal(safeRichHref(href), null, href);
  assert.equal(safeRichHref("mailto:help@bitocard.com"), "mailto:help@bitocard.com");
});

test("broken HTML is mended, empty formatting dropped, and plain text read as paragraphs", () => {
  assert.equal(cleanRichText("<p><b>open bold<p>next</p>"), "<p><strong>open bold</strong></p><p>next</p>");
  assert.equal(cleanRichText("<p><b></b></p><p>  </p><p>kept</p>"), "<p>kept</p>");
  assert.equal(cleanRichText("First line\nsecond line\n\nNew paragraph <3"), "<p>First line<br>second line</p><p>New paragraph &lt;3</p>");
});

test("the plain text keeps lists, quotes and link addresses readable", () => {
  assert.equal(
    richTextToPlain('<p>Hello <strong>Ada</strong></p><ol><li>Open it</li><li>Retry</li></ol><blockquote>It failed</blockquote><p><a href="https://bitocard.com/help">help</a></p>'),
    "Hello Ada\n\n1. Open it\n2. Retry\n\n> It failed\n\nhelp (https://bitocard.com/help)",
  );
});

test("the API keeps the same file", () => {
  const ours = readFileSync(new URL("../src/rich-text-core.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const api = readFileSync(new URL("../../../apps/api/src/support/rich-text-core.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.equal(api, ours, "apps/api/src/support/rich-text-core.ts must match packages/ui/src/rich-text-core.ts");
});
