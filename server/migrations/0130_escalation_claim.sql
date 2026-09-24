-- A claim on a resource request while its escalation is delivered to a peer.
--
-- Delivery to the peer runs outside any transaction, between the transaction
-- that checks and claims the request and the one that records the
-- escalation. While a claim younger than a minute is held, a second
-- escalation of the same request is refused, so the peer cannot receive it
-- twice. The claim is cleared when the escalation is recorded or its delivery
-- fails; one left by a stopped process lapses after the minute, which is
-- longer than the delivery timeout. The existing update policy covers it.

alter table public.resource_requests
  add column escalation_claimed_at timestamptz;
