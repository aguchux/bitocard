// @vitest-environment jsdom
// Anjio's answers come as a few HTML tags (paragraphs, emphasis, lists, links a tool returned) and are drawn as real
// formatting: read tag by tag into elements, never set as HTML, so a script, an attribute or another tag only ever
// shows as words; older answers kept as plain text show as paragraphs.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { AnswerHtml, answerPlainText, parseAnswer } from "@bitocard/ui/answer-html";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Array<() => void> = [];
function draw(html: string) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(createElement(AnswerHtml, { html, className: "answer" })));
  mounted.push(() => act(() => root.unmount()));
  return host.querySelector(".answer")!;
}
afterEach(() => {
  for (const unmount of mounted.splice(0)) unmount();
  document.body.innerHTML = "";
});

describe("an answer", () => {
  it("is drawn as paragraphs, emphasis, lists and links", () => {
    const answer = draw('<p>Two phones <strong>match</strong>:</p><ul><li><a href="https://udozo.com/ng/l/12-iphone-13">iPhone 13</a></li><li>A <em>Samsung</em> A54</li></ul><p>Use Safe pay &amp; chat first.<br>Thanks</p>');
    expect(answer.innerHTML).toBe('<p>Two phones <strong>match</strong>:</p><ul><li><a href="https://udozo.com/ng/l/12-iphone-13">iPhone 13</a></li><li>A <em>Samsung</em> A54</li></ul><p>Use Safe pay &amp; chat first.<br>Thanks</p>');
    expect(answer.textContent).not.toMatch(/\*\*|<|&amp;/);
  });

  it("never runs or keeps anything else", () => {
    const answer = draw('<p onclick="steal()">Hi <img src=x onerror="steal()"><script>steal()</script><a href="javascript:steal()">tap</a> <a href="//evil.example">here</a></p>');
    expect(answer.querySelector("img, script, [onclick], [onerror]")).toBeNull();
    expect(answer.querySelectorAll("a")).toHaveLength(0);
    expect(answer.innerHTML).toBe("<p>Hi steal()tap here</p>");
    expect(draw('<p><a href="/ng/safe-trade">The guide</a></p>').querySelector("a")?.getAttribute("href")).toBe("/ng/safe-trade");
  });

  it("mends tags left open or closed twice, and shows older plain answers as paragraphs", () => {
    expect(draw("<p>Open <strong>bold</p></strong><li>loose").innerHTML).toBe("<p>Open <strong>bold</strong></p><li>loose</li>");
    expect(draw("First line\nsecond\n\nNext 1 < 2").innerHTML).toBe("<p>First line<br>second</p><p>Next 1 &lt; 2</p>");
    expect(parseAnswer("").children).toEqual([]);
  });

  it("reads as plain words for previews", () => {
    expect(answerPlainText("<p>Two:</p><ul><li>One</li><li>Two &amp; three</li></ul><p>Bye<br>now</p>")).toBe("Two:\n\n• One\n• Two & three\n\nBye\nnow");
  });
});
