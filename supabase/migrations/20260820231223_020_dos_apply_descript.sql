create or replace function public.dos_apply_descript(
  p_office text,
  p_batch  int default 60,
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

  create temp table if not exists _dbatch (codenum bigint, proc_code text, layman text)
    on commit drop;
  delete from _dbatch;

  insert into _dbatch
  select m.codenum, n.proc_code, n.layman
  from dos_code_names n
  join dos_codenum_map m
    on m.office_slug = v_office and m.proc_code = n.proc_code
  where n.is_custom
    and not exists (
      select 1 from dos_write_log l
      where l.office_slug = v_office and l.proc_code = n.proc_code
        and l.field = 'Descript' and l.result = 'applied' and l.wanted = n.layman
    )
  order by n.proc_code
  limit p_batch;

  select count(*) into v_n from _dbatch;
  if v_n = 0 then
    return jsonb_build_object('office', v_office, 'remaining', 0, 'done', true);
  end if;

  if p_dry_run then
    return jsonb_build_object('office', v_office, 'dry_run', true, 'would_write', v_n);
  end if;

  select decrypted_secret into v_dev from vault.decrypted_secrets where name='OD_DEVELOPER_KEY';
  select decrypted_secret into v_cust from vault.decrypted_secrets where name=v_secret;
  v_auth := 'ODFHIR ' || v_dev || '/' || v_cust;
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT','30');

  for r in select * from _dbatch order by proc_code loop
    begin
      select * into v_resp from extensions.http((
        'PUT',
        'https://api.opendental.com/api/v1/procedurecodes/' || r.codenum,
        array[
          extensions.http_header('Authorization', v_auth),
          extensions.http_header('Accept','application/json')
        ],
        'application/json',
        jsonb_build_object('Descript', r.layman)::text
      )::extensions.http_request);
    exception when others then
      insert into dos_write_log (office_slug, proc_code, field, wanted, stored, result)
      values (v_office, r.proc_code, 'Descript', r.layman, null, 'ERROR: ' || sqlerrm);
      continue;
    end;
    v_ids := v_ids || case when v_ids = '' then '' else ',' end || r.codenum;
  end loop;

  v_readback := od_probe(
    v_office, 'PUT', '/queries/ShortQuery',
    jsonb_build_object('SqlCommand',
      'SELECT CodeNum, ProcCode, Descript FROM procedurecode WHERE CodeNum IN (' || v_ids || ')')
  );

  for r in select * from _dbatch order by proc_code loop
    select x."Descript" into v_stored
    from jsonb_to_recordset(v_readback->'body')
      as x("CodeNum" bigint, "ProcCode" text, "Descript" text)
    where x."CodeNum" = r.codenum;

    if v_stored is not distinct from r.layman then
      v_applied := v_applied + 1;
      insert into dos_write_log (office_slug, proc_code, field, wanted, stored, result)
      values (v_office, r.proc_code, 'Descript', r.layman, v_stored, 'applied');
    else
      v_rejected := v_rejected + 1;
      insert into dos_write_log (office_slug, proc_code, field, wanted, stored, result)
      values (v_office, r.proc_code, 'Descript', r.layman, v_stored,
              'REJECTED - OpenDental kept its own value');
    end if;
  end loop;

  return jsonb_build_object(
    'office', v_office, 'attempted', v_n, 'applied', v_applied, 'rejected', v_rejected,
    'remaining', (
      select count(*) from dos_code_names n
      join dos_codenum_map m on m.office_slug = v_office and m.proc_code = n.proc_code
      where n.is_custom and not exists (
        select 1 from dos_write_log l
        where l.office_slug = v_office and l.proc_code = n.proc_code
          and l.field='Descript' and l.result='applied' and l.wanted = n.layman)
    )
  );
end;
$function$;;
