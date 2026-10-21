---
title: Fix a slow build
type: troubleshooting
---

# Fix a slow build

A slow build almost always has one slow step.
This page shows how to find it. :fact[aa11]

## Read the build log

The build log names each step and its time. A step over a minute is worth a look. :fact[bb22]

- Sort the steps by time.
- Open the slowest one, then read its output
  for the file it was working on. :fact[cc33]

  Keep the log open while you work.

| Step | Typical time |
| ---- | ------------ |
| Images | 40 s |
| Pages | 5 s |

:::note
A paragraph inside a note is not counted.
:::

## Cache the resized images

Every image is resized on every build because the cache key includes the build time. :fact[dd44]

```md
A paragraph in a code block is not counted.
## Nor is this a heading
```

See [the cache guide](cache.md).
