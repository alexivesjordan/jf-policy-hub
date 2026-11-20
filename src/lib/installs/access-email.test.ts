import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { accessFormLetter } from "./access-email";

const letter = {
  contactName: "Alex Example",
  orderNumber: "SO-00650",
  postcode: "PE30 4JJ",
  repName: "Riley Hart",
  repEmail: "riley.hart@jordanfitness.com",
  url: "https://pulse.jordanfitness.com/access/token",
};

describe("access form email", () => {
  it("greets the customer and includes the order, postcode, link, and rep", () => {
    const sent = accessFormLetter(letter);
    assert.equal(sent.subject, "Site access for your Jordan Fitness install");
    assert.match(sent.text, /Hello Alex,/);
    assert.match(sent.text, /photos of the access route/);
    assert.match(sent.text, /Order SO-00650/);
    assert.match(sent.text, /Install postcode PE30 4JJ/);
    assert.match(sent.text, /Riley Hart at riley.hart@jordanfitness.com/);
    assert.match(sent.text, /Kind regards/);
    assert.match(sent.html, /Open the access form/);
    assert.match(sent.html, /href="https:\/\/pulse.jordanfitness.com\/access\/token"/);
    assert.match(sent.html, /#ce0037/);
    assert.equal(sent.replyTo, "riley.hart@jordanfitness.com");
  });

  it("uses the same letter for a reminder, with one opening line", () => {
    const first = accessFormLetter(letter);
    const reminder = accessFormLetter({ ...letter, reminder: true });
    assert.equal(reminder.subject, "Reminder: site access for your Jordan Fitness install");
    assert.match(reminder.text, /This is a reminder/);
    assert.match(reminder.html, /This is a reminder/);
    assert.match(reminder.text, /Hello Alex,/);
    assert.match(reminder.text, /Order SO-00650/);
    assert.match(reminder.text, /Open the access form: https:\/\/pulse.jordanfitness.com\/access\/token/);
    assert.match(reminder.html, /Open the access form/);
    assert.equal(reminder.text.includes("Before your Jordan Fitness install"), first.text.includes("Before your Jordan Fitness install"));
  });

  it("escapes a name and still has a contact when the rep is missing", () => {
    const sent = accessFormLetter({
      contactName: "Sam<script>",
      url: "https://pulse.jordanfitness.com/access/token",
      siteAddress: "1 Harbour Road, King's Lynn PE30 4JJ",
    });
    assert.match(sent.text, /Hello Sam<script>,/);
    assert.equal(sent.html.includes("<script>"), false);
    assert.match(sent.html, /Sam&lt;script&gt;/);
    assert.match(sent.text, /Install postcode PE30 4JJ/);
    assert.match(sent.text, /sales@jordanfitness.co.uk/);
    assert.equal(sent.replyTo, null);
  });
});
