-- Allow manual text source in eligible analysis RPC.
-- Idempotent: NO-OP if manual text guard already exists.
-- Preserves existing Drive and Upload guards, permissions, and security context.
begin;
do $migration$
declare
  v_definition text;
  v_manual text := $guard$(source='manual' and format='text')$guard$;
  v_old text := $guard$and ((source='drive' and format='document')$guard$;
  v_new text := $guard$and ((source='drive' and format='document')
      or (source='manual' and format='text')$guard$;
begin
  v_definition := pg_get_functiondef(
    'public.persist_eligible_item_analysis(uuid,uuid,text,text,jsonb,text,text)'::regprocedure);

  if position(v_manual in v_definition) > 0 then
    -- Already applied (e.g. dev DB); succeed safely without modification.
    return;
  elsif position(v_old in v_definition) > 0 then
    -- Not yet applied (e.g. prod DB); add manual text guard.
    execute replace(v_definition, v_old, v_new);
  else
    -- Unexpected function definition; abort safely.
    raise exception 'Unexpected eligible analysis source guard; no changes applied';
  end if;
end;
$migration$;
commit;
