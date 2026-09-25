-- Boards an incident activated before titles took the template's name were
-- titled "<incident>: <template key>". Each such board takes the incident's
-- name and its template's title, as boards activated since do. A board
-- someone has since renamed keeps its title.
update public.boards b
   set title = i.name || ': ' || coalesce((
         select t.title from public.board_templates t
          where t.key = b.template_key order by t.version desc limit 1), b.template_key)
  from public.incident_boards ib
  join public.incidents i on i.id = ib.incident_id
 where ib.board_id = b.id and b.title = i.name || ': ' || b.template_key;
