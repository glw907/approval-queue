---
page: Fix a slow build
type: troubleshooting
track: extend
---

# Fix a slow build

:::reader
**Who reads it.** A developer whose site builds slowly.

- A bullet in the reader block is not an item.
:::

## Read the build log

*Shows the reader where the build log lives.*

- The build log names each step and its time. :fact[aa11]
- A step over a minute is worth a look. :fact[bb22] :fact[cc33]

### Find the slow step

*Gets the reader to the step that costs the most.*

1. Sort the steps by time.
2. Open the slowest one.

:::row
**Symptom.** The image step takes minutes.
**Cause.** Every image is resized on every build. :fact[dd44]
**Fix.** Cache the resized images between builds.
:::

- See [the cache guide](cache.md).

## `build.cache_miss` events

*Explains the cache-miss event.*

- A cache miss logs `build.cache_miss` once per file. :fact[ee55]

```md
- A bullet in a code block is not an item.
## Nor is this a heading
```
