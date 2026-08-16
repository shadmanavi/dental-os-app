-- =====================================================================
-- Migration 013 — od_probe, part two: the function
--
-- Read-only by construction:
--   - GET is allowed, and PUT only to /queries/ShortQuery, which
--     OpenDental itself refuses to run for anything but a SELECT.
--     There is no path through this function that writes to a patient
--     record.
--   - EXECUTE is revoked from anon and authenticated, so this adds no
--     surface to the application.
--   - Responses are never stored. The log records what was asked and
--     how it went, never what came back.
-- =====================================================================

create or replace function od_probe(
  p_office text,
  p_method text,
  p_path   text,
  p_body   jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  v_office      text := lower(trim(p_office));
  v_method      text := upper(trim(p_method));
  v_secret_name text;
  v_dev_key     text;
  v_cust_key    text;
  v_auth        text;
  v_started     timestamptz := clock_timestamp();
  v_response    extensions.http_response;
  v_parsed      jsonb;
  v_rows        int;
  v_elapsed     int;
begin
  -- ---- Which office ----
  if v_office = 'downey' then
    v_secret_name := 'OD_CUSTOMER_KEY_DOWNEY';
  elsif v_office = 'maywood' then
    v_secret_name := 'OD_CUSTOMER_KEY_MAYWOOD';
  else
    raise exception 'Unknown office %. Use downey or maywood.', p_office;
  end if;

  -- ---- Read-only by construction ----
  if v_method = 'GET' then
    null;
  elsif v_method = 'PUT' and p_path like '/queries/ShortQuery%' then
    null;
  else
    raise exception
      'od_probe is read-only. GET, or PUT to /queries/ShortQuery. Got % %.',
      v_method, p_path;
  end if;

  -- ---- Credentials, read fresh and never returned ----
  select decrypted_secret into v_dev_key
  from vault.decrypted_secrets where name = 'OD_DEVELOPER_KEY';

  select decrypted_secret into v_cust_key
  from vault.decrypted_secrets where name = v_secret_name;

  if v_dev_key is null or v_cust_key is null then
    raise exception
      'OpenDental keys are not in Vault. Store OD_DEVELOPER_KEY and % first.',
      v_secret_name;
  end if;

  v_auth := 'ODFHIR ' || v_dev_key || '/' || v_cust_key;

  -- A probe that hangs should fail rather than hold a backend open.
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '45');

  begin
    select * into v_response from extensions.http((
      v_method,
      'https://api.opendental.com/api/v1' || p_path,
      array[
        extensions.http_header('Authorization', v_auth),
        extensions.http_header('Accept', 'application/json')
      ],
      'application/json',
      case when p_body is null then null else p_body::text end
    )::extensions.http_request);
  exception when others then
    v_elapsed := (extract(epoch from clock_timestamp() - v_started) * 1000)::int;

    insert into od_probe_log (office_slug, method, path, request_body, error, elapsed_ms)
    values (v_office, v_method, p_path, p_body, sqlerrm, v_elapsed);

    raise;
  end;

  v_elapsed := (extract(epoch from clock_timestamp() - v_started) * 1000)::int;

  begin
    v_parsed := v_response.content::jsonb;
  exception when others then
    -- Not JSON. OpenDental's refusals arrive as bare text, and those
    -- are worth seeing verbatim.
    v_parsed := to_jsonb(v_response.content);
  end;

  v_rows := case
    when jsonb_typeof(v_parsed) = 'array' then jsonb_array_length(v_parsed)
    else null
  end;

  insert into od_probe_log (
    office_slug, method, path, request_body, http_status, elapsed_ms, row_count
  )
  values (v_office, v_method, p_path, p_body, v_response.status, v_elapsed, v_rows);

  return jsonb_build_object(
    'ok',          v_response.status between 200 and 299,
    'http_status', v_response.status,
    'elapsed_ms',  v_elapsed,
    'row_count',   v_rows,
    'body',        v_parsed
  );
end;
$$;

comment on function od_probe(text, text, text, jsonb) is
  'Read-only OpenDental probe. GET, or PUT to /queries/ShortQuery. Responses are returned but never stored.';

revoke all on function od_probe(text, text, text, jsonb) from public;
revoke all on function od_probe(text, text, text, jsonb) from anon;
revoke all on function od_probe(text, text, text, jsonb) from authenticated;;
