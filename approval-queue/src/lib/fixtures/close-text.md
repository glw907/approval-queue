# Skip a decided item in the queue order

You are asked to approve two pull requests that change which item the queue opens next. If you approve, the session merges both. After a decision, the queue opens the next waiting item instead of the item you just decided.

The queue used to list items in the order they arrived, so a decided item that nobody had collected yet stayed at the head of the list. The first pull request filters decided items out of the order and adds a test. The second adds one sentence to the queue page that says a decided item leaves the list.

You have two calls to make. The first is whether the order should skip a decided item at all. The second is whether the docs page needs your read before it merges.

## Deep dive

How the order is chosen, and what a decided item does until it is collected.

### How the order is chosen

The queue keeps every item in a list. Before this change the list order was the arrival order. The change filters out items that have a decision.

## Your calls

Both calls are small. The first sets the behavior, and the second sets when the docs page goes out.

### Should the queue order skip a decided item?

Context: Today the first item in the list opens after each decision, whether or not it is decided.

Risk: A decided item stays in the list and can be reached from history only.

Recommendation: Skip it. A decided item has nothing left to read.

### Does the docs page change need your read before it merges?

Context: The second pull request adds one sentence to the queue page.

Risk: The page is a public surface, and the sentence is the only change.

Recommendation: Merge it with the code. The sentence repeats the behavior of the first pull request.

## Decided for you

### Which test file should hold the skip case?

Context: The skip case needed a test file, and the queue tests already live in one file.

Why: The case sits beside the other queue tests, which keeps the suite in one place.

## Not checked

The page was not read in a browser.

## What changed

Two pull requests change 3 files, adding 8 lines and removing 1. Most of it is the queue order and its test.

- The queue order now skips an item that has a decision. [aq-fixture/sample#1 lib/queue.ts:10-14]
- A test covers the skip. [aq-fixture/sample#1 lib/queue.test.ts:1-4]
- The queue page says a decided item leaves the list. [aq-fixture/sample#2 docs/queue.md:3-5]
