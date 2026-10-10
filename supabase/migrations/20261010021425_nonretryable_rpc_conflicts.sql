-- Only application conflict SQLSTATE literals change; no data/schema/RLS/ACL changes.
-- Guard exact normalized bodies and preserve actual attributes via pg_get_functiondef.
begin;

DO $conflict_persist_calendar_item$
declare target oid; source text; definition text;
begin
  select p.oid into strict target from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='persist_calendar_item' and p.prokind='f';
  select replace(p.prosrc,E'\r\n',E'\n'),pg_get_functiondef(p.oid) into source,definition from pg_proc p where p.oid=target;
  if md5(source) not in ('04cf92721a95e3a66957e6a4781b2113','99e7d19d479a1b357c2771d2c28398c5') then
    raise exception 'Unexpected persist_calendar_item body; review required';
  end if;
  if md5(source)='04cf92721a95e3a66957e6a4781b2113' then
    -- Exactly 3 application raises; every other body byte/message is preserved.
    execute replace(definition,$old$errcode='40001'$old$,$new$errcode='PT409'$new$);
  end if;
end $conflict_persist_calendar_item$;

DO $conflict_persist_drive_item$
declare target oid; source text; definition text;
begin
  select p.oid into strict target from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='persist_drive_item' and p.prokind='f';
  select replace(p.prosrc,E'\r\n',E'\n'),pg_get_functiondef(p.oid) into source,definition from pg_proc p where p.oid=target;
  if md5(source) not in ('b0e27e049a0e102bdf402e36a2112589','1fd8599ead4827a4a1dabe7b686de839') then
    raise exception 'Unexpected persist_drive_item body; review required';
  end if;
  if md5(source)='b0e27e049a0e102bdf402e36a2112589' then
    -- Exactly 4 application raises; every other body byte/message is preserved.
    execute replace(definition,$old$errcode='40001'$old$,$new$errcode='PT409'$new$);
  end if;
end $conflict_persist_drive_item$;

DO $conflict_search_index$
declare target oid; source text; definition text;
begin
  select p.oid into strict target from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='search_index' and p.prokind='f';
  select replace(p.prosrc,E'\r\n',E'\n'),pg_get_functiondef(p.oid) into source,definition from pg_proc p where p.oid=target;
  if md5(source) not in ('0ee3538be44cbe3cca645d3c624f5983','9827e5117442ba779603b8e2846ec19c') then
    raise exception 'Unexpected search_index body; review required';
  end if;
  if md5(source)='0ee3538be44cbe3cca645d3c624f5983' then
    -- Exactly 2 application raises; every other body byte/message is preserved.
    execute replace(definition,$old$errcode='40001'$old$,$new$errcode='PT409'$new$);
  end if;
end $conflict_search_index$;

DO $conflict_search_runtime$
declare target oid; source text; definition text;
begin
  select p.oid into strict target from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='search_runtime' and p.prokind='f';
  select replace(p.prosrc,E'\r\n',E'\n'),pg_get_functiondef(p.oid) into source,definition from pg_proc p where p.oid=target;
  if md5(source) not in ('1c20bad5b1c45ebe6f7f606abdc840ea','03306bab542afd6348d22abf936bdb98') then
    raise exception 'Unexpected search_runtime body; review required';
  end if;
  if md5(source)='1c20bad5b1c45ebe6f7f606abdc840ea' then
    -- Exactly 1 application raises; every other body byte/message is preserved.
    execute replace(definition,$old$errcode='40001'$old$,$new$errcode='PT409'$new$);
  end if;
end $conflict_search_runtime$;

DO $conflict_upgrade_google_calendar_scopes$
declare target oid; source text; definition text;
begin
  select p.oid into strict target from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='upgrade_google_calendar_scopes' and p.prokind='f';
  select replace(p.prosrc,E'\r\n',E'\n'),pg_get_functiondef(p.oid) into source,definition from pg_proc p where p.oid=target;
  if md5(source) not in ('e9a098f0c427cadc216685a35b2417d1','bbf0d3e4fc13266c234e687d22b1ddee') then
    raise exception 'Unexpected upgrade_google_calendar_scopes body; review required';
  end if;
  if md5(source)='e9a098f0c427cadc216685a35b2417d1' then
    -- Exactly 2 application raises; every other body byte/message is preserved.
    execute replace(definition,$old$errcode='40001'$old$,$new$errcode='PT409'$new$);
  end if;
end $conflict_upgrade_google_calendar_scopes$;

DO $conflict_upgrade_google_connection_scopes$
declare target oid; source text; definition text;
begin
  select p.oid into strict target from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='upgrade_google_connection_scopes' and p.prokind='f';
  select replace(p.prosrc,E'\r\n',E'\n'),pg_get_functiondef(p.oid) into source,definition from pg_proc p where p.oid=target;
  if md5(source) not in ('36eb97bbcaf8df36845916eeaeb9f3bd','d7460fa1174f8520ed89366793de9af2') then
    raise exception 'Unexpected upgrade_google_connection_scopes body; review required';
  end if;
  if md5(source)='36eb97bbcaf8df36845916eeaeb9f3bd' then
    -- Exactly 2 application raises; every other body byte/message is preserved.
    execute replace(definition,$old$errcode='40001'$old$,$new$errcode='PT409'$new$);
  end if;
end $conflict_upgrade_google_connection_scopes$;

commit;
