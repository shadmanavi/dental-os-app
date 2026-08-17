-- 015_office_email_from_emailaddress
--
-- od_sync_offices() v2 -- takes the practice email from the default
-- emailaddress row rather than the legacy EmailSenderAddress preference,
-- and strips a "Name <addr>" wrapper down to the bare address.
--
-- EmailSenderAddress is not exposed anywhere in OpenDental's interface
-- and held stale personal addresses on both servers. It survives here
-- only as a last-resort fallback.
--
-- Reconstructed on 17 August 2026 from pg_get_functiondef() against the
-- live database. The body below is that output verbatim; the original
-- file was blanked by "supabase migration fetch". Verified by md5 match
-- against the live definition.

CREATE OR REPLACE FUNCTION public.od_sync_offices()
 RETURNS TABLE(office_slug text, office_name text, updated boolean, detail text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'vault'
AS $function$
declare
  r           record;
  v_probe     jsonb;
  v_body      jsonb;
  v_pref      jsonb;
  v_title     text;
  v_email     text;
  v_source    text;
  v_addr_num  int;
begin
  for r in
    select o.slug, o.name
    from public.offices o
    where o.opendental_customer_key_name is not null
    order by o.slug
  loop
    office_slug := r.slug;
    office_name := r.name;
    updated     := false;

    v_probe := od_probe(
      r.slug,
      'PUT',
      '/queries/ShortQuery',
      jsonb_build_object(
        'SqlCommand',
        $q$SELECT PrefName, ValueString FROM preference WHERE PrefName IN ('PracticeTitle','PracticeAddress','PracticeAddress2','PracticeCity','PracticeST','PracticeZip','PracticePhone','PracticeFax','EmailSenderAddress','EmailDefaultAddressNum')$q$
      )
    );

    if coalesce((v_probe->>'ok')::boolean, false) is not true then
      detail := 'probe failed, nothing written — HTTP '
                || coalesce(v_probe->>'http_status', 'no status');
      return next;
      continue;
    end if;

    v_body := v_probe->'body';

    if jsonb_typeof(v_body) <> 'array' then
      detail := 'probe returned a non-array body, nothing written';
      return next;
      continue;
    end if;

    select jsonb_object_agg(
             elem->>'PrefName',
             btrim(coalesce(elem->>'ValueString', ''))
           )
    into v_pref
    from jsonb_array_elements(v_body) as elem;

    v_title := nullif(coalesce(v_pref->>'PracticeTitle', ''), '');

    if v_title is null then
      detail := 'PracticeTitle is empty in OpenDental, nothing written';
      return next;
      continue;
    end if;

    v_email  := null;
    v_source := 'no email found';

    begin
      v_addr_num := nullif(coalesce(v_pref->>'EmailDefaultAddressNum', ''), '')::int;
    exception when others then
      v_addr_num := null;
    end;

    if v_addr_num is not null and v_addr_num > 0 then
      v_probe := od_probe(
        r.slug,
        'PUT',
        '/queries/ShortQuery',
        jsonb_build_object(
          'SqlCommand',
          'SELECT SenderAddress FROM emailaddress WHERE EmailAddressNum = '
            || v_addr_num::text
        )
      );

      if coalesce((v_probe->>'ok')::boolean, false)
         and jsonb_typeof(v_probe->'body') = 'array'
         and jsonb_array_length(v_probe->'body') > 0
      then
        v_email := btrim(coalesce(
          (v_probe->'body'->0)->>'SenderAddress', ''
        ));

        if v_email like '%<%>%' then
          v_email := btrim(substring(v_email from '<([^>]+)>'));
        end if;

        v_email := nullif(v_email, '');

        if v_email is not null then
          v_source := 'email from emailaddress #' || v_addr_num::text;
        end if;
      end if;
    end if;

    if v_email is null then
      v_email := nullif(coalesce(v_pref->>'EmailSenderAddress', ''), '');
      if v_email is not null then
        v_source := 'email from the legacy EmailSenderAddress preference';
      end if;
    end if;

    update public.offices o
    set name               = v_title,
        legal_name         = v_title,
        address_line1      = nullif(coalesce(v_pref->>'PracticeAddress', ''), ''),
        address_line2      = nullif(coalesce(v_pref->>'PracticeAddress2', ''), ''),
        city               = nullif(coalesce(v_pref->>'PracticeCity', ''), ''),
        state              = nullif(coalesce(v_pref->>'PracticeST', ''), ''),
        postal_code        = nullif(coalesce(v_pref->>'PracticeZip', ''), ''),
        phone              = nullif(coalesce(v_pref->>'PracticePhone', ''), ''),
        fax                = nullif(coalesce(v_pref->>'PracticeFax', ''), ''),
        email              = v_email,
        identity_synced_at = now(),
        updated_at         = now()
    where o.slug = r.slug;

    office_name := v_title;
    updated     := true;
    detail      := 'written from OpenDental preference — ' || v_source;
    return next;
  end loop;
end;
$function$
;
;
