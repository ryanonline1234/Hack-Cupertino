# Site candidates: OpenStreetMap data (ODbL)

The `<SSCCC>.json` files in this folder contain commercial-site candidates
(vacant shops, retail and commercial buildings, retail areas) extracted from
OpenStreetMap for four counties: 04001, 06001, 06085 and 28151.

© OpenStreetMap contributors. This data is available under the Open Database
License (ODbL) 1.0: https://opendatacommons.org/licenses/odbl/1-0/
Copyright and attribution: https://www.openstreetmap.org/copyright

These files are a derived database made from OpenStreetMap data and are
licensed under the ODbL, not under the MIT license that covers this
project's code.

How they were built: `scripts/build-site-candidates.mjs`, one Overpass API
query per county (OSM data of 2026-10-03; each file records its
`retrievedAt` and `osmBase`). Selection rules and the rebuild command:
`docs/data.md` in the project repository.
