create or replace function public.od_write(
  p_office   text,
  p_codenum  bigint,
  p_changes  jsonb,
  p_dry_run  boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','extensions','vault'
as $function$
declare
  v_office      text := lower(trim(p_office));
  v_secret_name text;
  v_dev_key     text;
  v_cust_key    text;
  v_auth        text;
  v_started     timestamptz := clock_timestamp();
  v_response    extensions.http_response;
  v_parsed      jsonb;
  v_elapsed     int;
  v_key         text;
  v_before      jsonb;
  v_after       jsonb;
  v_verdict     jsonb := '{}'::jsonb;
  v_field       text;
  v_want        text;
  v_got         text;
  v_allowed     text[] := array['Descript','AbbrDesc','TreatArea','LaymanTerm','ProcCat','procCat'];
  v_area_map    jsonb := jsonb_build_object(
                   'None','0','Surf','1','Tooth','2','Mouth','3',
                   'Quad','4','Sextant','5','Arch','6','ToothRange','7');
begin
  if v_office = 'downey' then
    v_secret_name := 'OD_CUSTOMER_KEY_DOWNEY';
  elsif v_office = 'maywood' then
    v_secret_name := 'OD_CUSTOMER_KEY_MAYWOOD';
  else
    raise exception 'Unknown office %. Use downey or maywood.', p_office;
  end if;

  if p_changes is null or jsonb_typeof(p_changes) <> 'object'
     or p_changes = '{}'::jsonb then
    raise exception 'od_write needs a non-empty JSON object of changes.';
  end if;

  -- Only fields we agreed may move. Anything else is refused outright.
  for v_key in select jsonb_object_keys(p_changes) loop
    if not (v_key = any(v_allowed)) then
      raise exception
        'od_write refuses field %. Allowed: Descript, AbbrDesc, TreatArea, LaymanTerm, ProcCat, procCat.',
        v_key;
    end if;
  end loop;

  if p_changes ? 'TreatArea'
     and not (v_area_map ? (p_changes->>'TreatArea')) then
    raise exception
      'TreatArea must be None, Surf, Tooth, Mouth, Quad, Sextant, Arch or ToothRange. Got %.',
      p_changes->>'TreatArea';
  end if;

  -- ---- What the code looks like now ----
  v_before := od_probe(
    v_office, 'PUT', '/queries/ShortQuery',
    jsonb_build_object('SqlCommand',
      'SELECT ProcCode, Descript, AbbrDesc, TreatArea, LaymanTerm, ProcCat '
      || 'FROM procedurecode WHERE CodeNum = ' || p_codenum)
  );

  if coalesce(jsonb_array_length(v_before->'body'),0) = 0 then
    raise exception 'No procedure code with CodeNum % at %.', p_codenum, v_office;
  end if;
  v_before := (v_before->'body')->0;

  if p_dry_run then
    return jsonb_build_object(
      'dry_run', true,
      'office',  v_office,
      'codenum', p_codenum,
      'proc_code', v_before->>'ProcCode',
      'before',  v_before,
      'would_set', p_changes
    );
  end if;

  select decrypted_secret into v_dev_key
  from vault.decrypted_secrets where name = 'OD_DEVELOPER_KEY';
  select decrypted_secret into v_cust_key
  from vault.decrypted_secrets where name = v_secret_name;

  if v_dev_key is null or v_cust_key is null then
    raise exception 'OpenDental keys are not in Vault.';
  end if;

  v_auth := 'ODFHIR ' || v_dev_key || '/' || v_cust_key;
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '45');

  begin
    select * into v_response from extensions.http((
      'PUT',
      'https://api.opendental.com/api/v1/procedurecodes/' || p_codenum,
      array[
        extensions.http_header('Authorization', v_auth),
        extensions.http_header('Accept', 'application/json')
      ],
      'application/json',
      p_changes::text
    )::extensions.http_request);
  exception when others then
    v_elapsed := (extract(epoch from clock_timestamp() - v_started) * 1000)::int;
    insert into od_probe_log (office_slug, method, path, request_body, error, elapsed_ms)
    values (v_office, 'PUT', '/procedurecodes/' || p_codenum, p_changes, sqlerrm, v_elapsed);
    raise;
  end;

  v_elapsed := (extract(epoch from clock_timestamp() - v_started) * 1000)::int;

  begin
    v_parsed := v_response.content::jsonb;
  exception when others then
    v_parsed := to_jsonb(v_response.content);
  end;

  insert into od_probe_log (office_slug, method, path, request_body, http_status, elapsed_ms)
  values (v_office, 'PUT', '/procedurecodes/' || p_codenum, p_changes, v_response.status, v_elapsed);

  -- ---- Read it back. The database is the only answer that counts. ----
  v_after := od_probe(
    v_office, 'PUT', '/queries/ShortQuery',
    jsonb_build_object('SqlCommand',
      'SELECT ProcCode, Descript, AbbrDesc, TreatArea, LaymanTerm, ProcCat '
      || 'FROM procedurecode WHERE CodeNum = ' || p_codenum)
  );
  v_after := (v_after->'body')->0;

  for v_field in select jsonb_object_keys(p_changes) loop
    if v_field = 'procCat' then
      continue;
    end if;

    v_want := p_changes->>v_field;
    if v_field = 'TreatArea' then
      v_want := v_area_map->>v_want;
    end if;

    v_got := v_after->>v_field;

    v_verdict := v_verdict || jsonb_build_object(
      v_field,
      jsonb_build_object(
        'wanted', v_want,
        'stored', v_got,
        'result', case
          when v_got is not distinct from v_want then 'applied'
          else 'REJECTED - OpenDental kept its own value'
        end
      )
    );
  end loop;

  return jsonb_build_object(
    'dry_run',     false,
    'office',      v_office,
    'codenum',     p_codenum,
    'proc_code',   v_after->>'ProcCode',
    'http_status', v_response.status,
    'elapsed_ms',  v_elapsed,
    'all_applied', not (v_verdict::text like '%REJECTED%'),
    'fields',      v_verdict,
    'before',      v_before,
    'after',       v_after
  );
end;
$function$;;
