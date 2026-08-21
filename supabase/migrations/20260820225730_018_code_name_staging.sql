create table if not exists public.dos_code_names (
  proc_code   text primary key,
  layman      text not null,
  is_custom   boolean not null default false
);

create table if not exists public.dos_codenum_map (
  office_slug text not null,
  proc_code   text not null,
  codenum     bigint not null,
  primary key (office_slug, proc_code)
);

create table if not exists public.dos_write_log (
  id           bigserial primary key,
  office_slug  text not null,
  proc_code    text not null,
  field        text not null,
  wanted       text,
  stored       text,
  result       text not null,
  ran_at       timestamptz not null default now()
);

create or replace function public.dos_load_codenums(p_office text)
returns int
language plpgsql
security definer
set search_path to 'public','extensions','vault'
as $function$
declare
  v_offset int := 0;
  v_res    jsonb;
  v_n      int;
  v_total  int := 0;
begin
  delete from dos_codenum_map where office_slug = lower(trim(p_office));

  loop
    v_res := od_probe(
      p_office, 'PUT',
      '/queries/ShortQuery' || case when v_offset = 0 then '' else '?Offset=' || v_offset end,
      jsonb_build_object('SqlCommand',
        'SELECT CodeNum, ProcCode FROM procedurecode ORDER BY CodeNum')
    );

    v_n := coalesce(jsonb_array_length(v_res->'body'), 0);
    exit when v_n = 0;

    insert into dos_codenum_map (office_slug, proc_code, codenum)
    select lower(trim(p_office)), x."ProcCode", x."CodeNum"
    from jsonb_to_recordset(v_res->'body')
      as x("CodeNum" bigint, "ProcCode" text)
    on conflict (office_slug, proc_code) do nothing;

    v_total := v_total + v_n;
    v_offset := v_offset + v_n;
    exit when v_offset > 5000;
  end loop;

  return (select count(*) from dos_codenum_map where office_slug = lower(trim(p_office)));
end;
$function$;;
