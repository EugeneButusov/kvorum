// Snapshot GraphQL queries. Both page forward by `created` ascending so a `created_gte`
// cursor can walk all history (live poller self-backfills from createdGte=0; AG1 accelerates
// the same path with an API key + larger pages). Field selections are deliberately wide so the
// archived payload — and thus its contentHash — captures every edit-salient field (title/body/
// choices/state/scores/scores_state), letting mutable-latest detect edits and the active→final flip.

export const PROPOSALS_QUERY = `query Proposals($space: String!, $createdGte: Int!, $first: Int!, $skip: Int!) {
  proposals(
    first: $first
    skip: $skip
    where: { space: $space, created_gte: $createdGte }
    orderBy: "created"
    orderDirection: asc
  ) {
    id
    title
    body
    choices
    type
    start
    end
    snapshot
    state
    scores
    scores_total
    scores_state
    created
    author
    ipfs
    network
    flagged
    privacy
    space { id }
  }
}`;

export const VOTES_QUERY = `query Votes($space: String!, $createdGte: Int!, $first: Int!, $skip: Int!) {
  votes(
    first: $first
    skip: $skip
    where: { space: $space, created_gte: $createdGte }
    orderBy: "created"
    orderDirection: asc
  ) {
    id
    voter
    created
    choice
    vp
    vp_by_strategy
    reason
    ipfs
    proposal { id }
  }
}`;
