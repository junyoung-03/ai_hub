-- Restrict the one added RPC to Drive/Upload. Preserve its implementation and privileges.
-- Do not edit the already-applied migration or the existing Gmail RPC.
begin;
do $migration$
declare
  v_definition text;
  v_old text := $guard$and ((source='gmail' and format='email')
      or (source='drive' and format='document')$guard$;
  v_new text := $guard$and ((source='drive' and format='document')$guard$;
begin
  v_definition := pg_get_functiondef(
    'public.persist_eligible_item_analysis(uuid,uuid,text,text,jsonb,text,text)'::regprocedure);
  if position(v_old in v_definition) = 0 then
    raise exception 'Unexpected eligible analysis source guard; no changes applied';
  end if;
  execute replace(v_definition, v_old, v_new);
end;
$migration$;
commit;
