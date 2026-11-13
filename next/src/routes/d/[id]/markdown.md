---
kind: report
---
# Every form of Markdown a document can use

A document is written in GitHub Flavored Markdown, and the queue draws all of it. This page shows each form once, using facts from the queue's design. Nothing here needs a decision. Leave a note on any form that looks wrong.

## Text

Inside a paragraph a session can mark *emphasis*, **strong emphasis**, `code`, and a [link to the specification](https://github.github.com/gfm/). ~~Struck text~~ is for a statement that no longer holds. A bare address such as https://github.github.com/gfm/ becomes a link with no marks around it.

A line that ends in a backslash\
breaks at that point.

## Headings

A second-level heading opens each section of this page under a dashed rule. Four smaller levels follow.

### A third-level heading

The reading text continues under it at the same size.

#### A fourth-level heading

This is the last level set in the serif face.

##### A fifth-level heading

It is set in the sans face, one size smaller than the text.

###### A sixth-level heading

It is lighter than the fifth.

## Lists

A bulleted list can hold a second level:

- The left rail lists three sections.
  - Outstanding decisions
  - Reports
  - Recently merged PRs
- The main column holds the front page or a document.
- The notes margin sits to the right of every document.

A numbered list is for steps in order:

1. The session checks its document.
2. The session sends the document and waits.
3. You approve it or send it back.

A task list shows what is done and what is left. The queue draws the five additions that GitHub Flavored Markdown makes to plain Markdown. It leaves out four features that GitHub's website adds outside the specification:

- [x] Tables
- [x] Task lists
- [x] Struck text
- [x] Bare addresses as links
- [x] The filter on raw HTML
- [ ] Footnotes, alerts, mathematics, and diagrams

## Tables

A column of numbers aligns to the right.

| What the queue counts | Fewest | Most |
| --- | ---: | ---: |
| Options in one question | 2 | 6 |
| Questions in one document | 0 | 30 |
| Size of the file, in KB | | 200 |

A table too wide for the column scrolls sideways inside its frame. This one does so on a phone:

| | First pass | Second pass | Third pass | Fourth pass | Fifth pass | Sixth pass |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Minutes | 120 | 120 | 120 | 120 | 100 | 75 |

## Quotations

A quotation has a rule down its left side. This is what you said of the mockup on 2026-11-12:

> This is solid. Give it a final craft pass, and then proceed to the design.

## Code

A fenced block keeps its line breaks, and a long line scrolls sideways.

```sh
approval-queue check design.md
approval-queue send design.md
```

A question block inside a fence is shown as text and draws no buttons:

```markdown
:::question The edit to a file Survey owns
- **Keep the edit** and add the same two passages to Survey. {recommended}
- **Send the pull request back** until a Survey release carries them.
:::
```

## Rules

A line of three hyphens draws a rule across the column.

---

The text carries on below it.

## Raw HTML

HTML typed into a document is kept, so a key such as <kbd>Tab</kbd> can be shown as a key, and a passage can be folded away:

<details>
<summary>The nine tags the filter turns into text</summary>

`title`, `textarea`, `style`, `xmp`, `iframe`, `noembed`, `noframes`, `script`, and `plaintext`.

</details>

A whole section folds the same way when its heading sits inside the summary. The heading keeps its size and its line in the "On this page" list, and a link to anything inside opens the fold:

<details>
<summary><h3>A folded section</h3></summary>

A design puts its technical notes in a fold like this one, so the part you decide on comes first and the reference material takes one line until you want it.

</details>

One of those nine typed into a document appears as the characters that were typed, and does nothing: <script>window.close()</script>

## Images

The page loads an image only from the queue or from a `data:` address inside the document. A remote image shows nothing and makes no request to the outside.
