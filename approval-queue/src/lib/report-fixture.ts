/** A made-up round report in the shape a conductor writes, shared by the report tests. */
export const FIXTURE = `# Round ur-queue, aq-fixture/sample, written 2026-11-12 06:14
Round state: running

| Pass | State | PR | Planned min | Actual min |
| --- | --- | --- | --- | --- |
| Q1 | merged | #51 | 60 | 31 |
| Q2 | merged | #52 | 90 | 44 |
| Q3 | merged | #53 | 120 | 70 |
| Q4 | parked | #54 | 120 | 38 |

Stops: 1
Refusals: 0
Waiting for Geoff: one stop packet
`;
