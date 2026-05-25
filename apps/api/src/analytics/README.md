# Analytics Module

This module contains analytical endpoints and read-side helper utilities.

- ClickHouse reads should follow ADR-061 patterns.
- UInt256 values from ClickHouse arrive as strings and must be parsed with BigInt for arithmetic.
- Do not use ClickHouse `arrayNormalizedGini` for inequality metrics; use `computeGini`.
