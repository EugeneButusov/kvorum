# Actor merge runbook

Use `admin-cli actors merge` when two addresses belong to the same real-world actor and the survivor should keep the canonical identity.

## Preconditions

- You have verified both addresses represent the same person or delegate.
- You know which address should survive.
- You have a reason string ready that explains the merge to future operators.

## Recommended workflow

1. Run a dry run first.

```bash
admin-cli actors merge <primary_address> <secondary_address> --reason "same delegate; signed both addresses in forum post #142" --dry-run
```

2. Check the dry-run output.

- Survivor vs secondary are shown explicitly.
- FK rewrite counts should be plausible for the actor.
- `actor_address` retarget count should include the secondary's alias rows.
- If the survivor already owns the secondary primary address, fix that collision before proceeding.

3. Apply the merge.

```bash
admin-cli actors merge <primary_address> <secondary_address> --reason "same delegate; signed both addresses in forum post #142" --confirm
```

4. Verify the result.

```bash
admin-cli actors show <secondary_address>
admin-cli actors show <primary_address>
```

- The secondary should report `merged into <survivor_actor_id>`.
- The survivor should list the secondary primary address as `secondary, source=manual` or `source=merge_redirect` depending on how it arrived.
- Inbound redirects should show the secondary primary address and any flattened historical redirects.

## Common errors

- `actor not found for address`: one of the addresses does not exist in `actor_address`.
- `actor for address ... is already merged`: the address was already merged by another operator.
- `primary and secondary addresses resolve to the same actor`: the operator passed two addresses that already collapse to one actor.
- `survivor actor ... already owns address ...`: the survivor already has the secondary primary address and the merge would violate `actor_address_pkey`.

## Merge volume metric

Merge volume is derived from the audit log instead of a dedicated counter:

```sql
SELECT count(*)
FROM admin_audit
WHERE command = 'actors merge'
  AND outcome = 'success'
  AND args->>'dry_run' != 'true';
```

This count is what the metrics pipeline should scrape when it needs a merge-volume number.
