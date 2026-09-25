-- IPAWS-OPEN as FEMA's Interface Design Guide v4.02 defines it. The COG
-- credential is a certificate and its private key; the certificate's expiry
-- is kept in the clear so a send can be refused before it is attempted.
-- Each submission keeps the CAP XML actually transmitted, which carries the
-- sent time stamped at confirmation and the alert's signature, and the
-- status IPAWS-OPEN returned for each dissemination channel.
alter table public.ipaws_config
  add column certificate_expires_at timestamptz;

alter table public.ipaws_submissions
  add column channels jsonb not null default '[]'::jsonb,
  add column transmitted_xml text;
