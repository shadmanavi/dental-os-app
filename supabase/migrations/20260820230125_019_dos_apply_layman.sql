create or replace function public.dos_apply_layman(
  p_office text,
  p_batch  int default 40,
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','extensions','vault'
as $function$
declare
  v_office   text := lower(trim(p_office));
  v_secret   text;
  v_dev      text;
  v_cust     text;
  v_auth     text;
  v_resp     extensions.http_response;
  r          record;
  v_ids      text := '';
  v_n        int := 0;
  v_applied  int := 0;
  v_rejected int := 0;
  v_readback jsonb;
  v_stored   text;
begin
  if v_office = 'downey' then v_secret := 'OD_CUSTOMER_KEY_DOWNEY';
  elsif v_office = 'maywood' then v_secret := 'OD_CUSTOMER_KEY_MAYWOOD';
  else raise exception 'Unknown office %.', p_office; end if;

  -- Pending = named, exists at this office, and not already confirmed applied.
  create temp table if not exists _batch (codenum bigint, proc_code text, layman text)
    on commit drop;
  delete from _batch;

  insert into _batch
  select m.codenum, n.proc_code, n.layman
  from dos_code_names n
  join dos_codenum_map m
    on m.office_slug = v_office and m.proc_code = n.proc_code
  where not exists (
    select 1 from dos_write_log l
    where l.office_slug = v_office and l.proc_code = n.proc_code
      and l.field = 'LaymanTerm' and l.result = 'applied'
      and l.wanted = n.layman
  )
  order by n.proc_code
  limit p_batch;

  select count(*) into v_n from _batch;
  if v_n = 0 then
    return jsonb_build_object('office', v_office, 'pending', 0, 'done', true);
  end if;

  if p_dry_run then
    return jsonb_build_object(
      'office', v_office, 'dry_run', true, 'would_write', v_n,
      'sample', (select jsonb_agg(jsonb_build_object('code', proc_code, 'layman', layman))
                 from (select * from _batch order by proc_code limit 10) s)
    );
  end if;

  select decrypted_secret into v_dev from vault.decrypted_secrets where name='OD_DEVELOPER_KEY';
  select decrypted_secret into v_cust from vault.decrypted_secrets where name=v_secret;
  if v_dev is null or v_cust is null then
    raise exception 'OpenDental keys are not in Vault.';
  end if;
  v_auth := 'ODFHIR ' || v_dev || '/' || v_cust;
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT','30');

  for r in select * from _batch order by proc_code loop
    begin
      select * into v_resp from extensions.http((
        'PUT',
        'https://api.opendental.com/api/v1/procedurecodes/' || r.codenum,
        array[
          extensions.http_header('Authorization', v_auth),
          extensions.http_header('Accept','application/json')
        ],
        'application/json',
        jsonb_build_object('LaymanTerm', r.layman)::text
      )::extensions.http_request);
    exception when others then
      insert into dos_write_log (office_slug, proc_code, field, wanted, stored, result)
      values (v_office, r.proc_code, 'LaymanTerm', r.layman, null, 'ERROR: ' || sqlerrm);
      continue;
    end;

    v_ids := v_ids || case when v_ids = '' then '' else ',' end || r.codenum;
  end loop;

  -- ---- One read-back for the whole batch. The database is the answer. ----
  v_readback := od_probe(
    v_office, 'PUT', '/queries/ShortQuery',
    jsonb_build_object('SqlCommand',
      'SELECT CodeNum, ProcCode, LaymanTerm FROM procedurecode WHERE CodeNum IN (' || v_ids || ')')
  );

  for r in select * from _batch order by proc_code loop
    select x."LaymanTerm" into v_stored
    from jsonb_to_recordset(v_readback->'body')
      as x("CodeNum" bigint, "ProcCode" text, "LaymanTerm" text)
    where x."CodeNum" = r.codenum;

    if v_stored is not distinct from r.layman then
      v_applied := v_applied + 1;
      insert into dos_write_log (office_slug, proc_code, field, wanted, stored, result)
      values (v_office, r.proc_code, 'LaymanTerm', r.layman, v_stored, 'applied');
    else
      v_rejected := v_rejected + 1;
      insert into dos_write_log (office_slug, proc_code, field, wanted, stored, result)
      values (v_office, r.proc_code, 'LaymanTerm', r.layman, v_stored,
              'REJECTED - OpenDental kept its own value');
    end if;
  end loop;

  return jsonb_build_object(
    'office', v_office,
    'attempted', v_n,
    'applied', v_applied,
    'rejected', v_rejected,
    'remaining', (
      select count(*) from dos_code_names n
      join dos_codenum_map m on m.office_slug = v_office and m.proc_code = n.proc_code
      where not exists (
        select 1 from dos_write_log l
        where l.office_slug = v_office and l.proc_code = n.proc_code
          and l.field='LaymanTerm' and l.result='applied' and l.wanted = n.layman)
    )
  );
end;
$function$;;
