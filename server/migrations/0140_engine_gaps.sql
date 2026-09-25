-- Workflow requests can be rejected or cancelled, and each is recorded.
alter table public.board_workflow_history drop constraint board_workflow_history_event_kind_check;
alter table public.board_workflow_history add constraint board_workflow_history_event_kind_check
  check (event_kind in ('transition_requested', 'approval_recorded', 'transition_completed', 'escalation',
                        'transition_rejected', 'transition_cancelled'));

-- The ICS-211 reads every check-in of a jurisdiction, open or closed, in check-in order.
create index staff_checkins_history on public.staff_checkins (jurisdiction_id, checked_in_at, id);

-- A facility can be edited, and removed from the registry by retiring it:
-- the row stays so its reports and the requests that asked it keep their history.
alter table public.facilities
  add column retired_at timestamptz,
  add column retired_by uuid references public.persons(id);
create policy facilities_update on public.facilities for update
  using (public.is_writer_of(jurisdiction_id)) with check (public.is_writer_of(jurisdiction_id));

-- Status requests are listed newest first.
create index status_queries_recent on public.status_queries (jurisdiction_id, created_at desc, id desc);
