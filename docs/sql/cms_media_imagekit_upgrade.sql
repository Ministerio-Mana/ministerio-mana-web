-- Proveedor de medios intercambiable para el CMS.
-- Compatible con los archivos existentes en Supabase Storage.

alter table public.cms_media
  add column if not exists provider text not null default 'supabase',
  add column if not exists provider_file_id text,
  add column if not exists folder text,
  add column if not exists original_name text,
  add column if not exists width integer,
  add column if not exists height integer;

update public.cms_media
set folder = case
  when position('/' in path) > 0 then regexp_replace(path, '/[^/]+$', '')
  else 'general'
end
where folder is null or btrim(folder) = '';

alter table public.cms_media
  alter column folder set default 'general',
  alter column folder set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'cms_media_provider_check'
      and conrelid = 'public.cms_media'::regclass
  ) then
    alter table public.cms_media
      add constraint cms_media_provider_check
      check (provider in ('supabase', 'imagekit'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'cms_media_dimensions_check'
      and conrelid = 'public.cms_media'::regclass
  ) then
    alter table public.cms_media
      add constraint cms_media_dimensions_check
      check (
        (width is null or width between 1 and 5000)
        and (height is null or height between 1 and 5000)
      );
  end if;
end
$$;

create unique index if not exists cms_media_provider_file_unique
  on public.cms_media(provider, provider_file_id)
  where provider_file_id is not null;

create index if not exists cms_media_provider_folder_created_idx
  on public.cms_media(provider, folder, created_at desc);

select
  count(*) filter (where provider = 'supabase') as supabase_files,
  count(*) filter (where provider = 'imagekit') as imagekit_files,
  count(*) filter (where folder is null or btrim(folder) = '') as files_without_folder
from public.cms_media;
